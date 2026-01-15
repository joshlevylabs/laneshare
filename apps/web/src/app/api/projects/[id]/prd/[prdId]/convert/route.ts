import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { PRD_CONVERT_SYSTEM_PROMPT, PRDJson } from '@laneshare/shared'
import type { Json } from '@/lib/supabase/types'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(
  request: Request,
  { params }: { params: { id: string; prdId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Get PRD
  const { data: prd, error: prdError } = await supabase
    .from('project_prds')
    .select('*')
    .eq('id', params.prdId)
    .eq('project_id', params.id)
    .single()

  if (prdError || !prd) {
    return NextResponse.json({ error: 'PRD not found' }, { status: 404 })
  }

  if (!prd.raw_markdown) {
    return NextResponse.json({ error: 'PRD has no markdown content to convert' }, { status: 400 })
  }

  // Get project info
  const { data: project } = await supabase
    .from('projects')
    .select('name')
    .eq('id', params.id)
    .single()

  // Get available repos for context linking
  const { data: repos } = await supabase
    .from('repos')
    .select('id, owner, name')
    .eq('project_id', params.id)

  // Get available docs
  const { data: docs } = await supabase
    .from('doc_pages')
    .select('id, slug, title')
    .eq('project_id', params.id)

  const contextInfo = `
PROJECT NAME: ${project?.name || 'Unknown'}
PROJECT ID: ${params.id}

AVAILABLE REPOS (for linking):
${(repos || []).map(r => `- ${r.id}: ${r.owner}/${r.name}`).join('\n') || 'None'}

AVAILABLE DOCS (for linking):
${(docs || []).map(d => `- ${d.id}: ${d.title} (${d.slug})`).join('\n') || 'None'}

PRD MARKDOWN:
${prd.raw_markdown}
`.trim()

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 8192,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: PRD_CONVERT_SYSTEM_PROMPT },
        { role: 'user', content: contextInfo },
      ],
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      return NextResponse.json({ error: 'Failed to generate PRD JSON' }, { status: 500 })
    }

    let prdJson: PRDJson
    try {
      prdJson = JSON.parse(content) as PRDJson
    } catch (parseError) {
      console.error('Failed to parse PRD JSON:', parseError, content)
      return NextResponse.json({ error: 'Failed to parse PRD JSON response' }, { status: 500 })
    }

    // Validate required fields
    if (!prdJson.project || !prdJson.userStories || !Array.isArray(prdJson.userStories)) {
      return NextResponse.json({ error: 'Invalid PRD JSON structure' }, { status: 500 })
    }

    // Add metadata
    prdJson.metadata = {
      generatedAt: new Date().toISOString(),
      version: (prd.version || 0) + 1,
      totalStories: prdJson.userStories.length,
      completedStories: 0,
    }

    // Update PRD with JSON
    const { data: updatedPrd, error: updateError } = await supabase
      .from('project_prds')
      .update({
        prd_json: prdJson as unknown as Json,
        status: 'READY',
        version: prdJson.metadata?.version ?? 1,
      })
      .eq('id', params.prdId)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      prd: updatedPrd,
      prd_json: prdJson,
      story_count: prdJson.userStories.length,
    })
  } catch (error) {
    console.error('OpenAI error:', error)
    return NextResponse.json(
      { error: 'Failed to convert PRD to JSON' },
      { status: 500 }
    )
  }
}
