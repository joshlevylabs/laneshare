import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import {
  buildSystemDocPrompt,
  type SystemGraph,
} from '@laneshare/shared'

// POST /api/projects/[id]/systems/[systemId]/generate-doc - Generate documentation for a system
export async function POST(
  request: Request,
  { params }: { params: { id: string; systemId: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check project admin access
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Get system with latest snapshot
  const { data: system, error: systemError } = await supabase
    .from('systems')
    .select(`
      *,
      system_flow_snapshots (
        id,
        version,
        graph_json
      ),
      system_evidence (
        id,
        source_type,
        source_ref,
        excerpt
      )
    `)
    .eq('id', params.systemId)
    .eq('project_id', params.id)
    .single()

  if (systemError || !system) {
    return NextResponse.json({ error: 'System not found' }, { status: 404 })
  }

  // Get latest snapshot
  const latestSnapshot = system.system_flow_snapshots
    ?.sort((a: { version: number }, b: { version: number }) => b.version - a.version)[0]

  if (!latestSnapshot?.graph_json) {
    return NextResponse.json(
      { error: 'No flow snapshot available. Process agent output first.' },
      { status: 400 }
    )
  }

  const graph = latestSnapshot.graph_json as SystemGraph

  try {
    // Build the doc generation prompt
    const docPrompt = buildSystemDocPrompt(
      system,
      graph,
      system.system_evidence || []
    )

    // Call AI to generate documentation
    const anthropic = new Anthropic()

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: 'You are a technical documentation writer. Generate clear, comprehensive documentation for software systems.',
      messages: [
        { role: 'user', content: docPrompt },
      ],
    })

    // Get AI response
    const aiContent = response.content[0]
    if (aiContent.type !== 'text') {
      throw new Error('Unexpected AI response format')
    }

    const markdown = aiContent.text

    // Create or update doc page
    const docSlug = `systems/${system.slug}`
    const docTitle = `System: ${system.name}`

    // Check if doc already exists
    const { data: existingDoc } = await supabase
      .from('doc_pages')
      .select('id')
      .eq('project_id', params.id)
      .eq('slug', docSlug)
      .single()

    let docPage
    if (existingDoc) {
      // Update existing doc
      const { data: updated, error: updateError } = await serviceClient
        .from('doc_pages')
        .update({
          title: docTitle,
          markdown,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingDoc.id)
        .select()
        .single()

      if (updateError) {
        throw updateError
      }
      docPage = updated
    } else {
      // Create new doc
      const { data: created, error: createError } = await serviceClient
        .from('doc_pages')
        .insert({
          project_id: params.id,
          slug: docSlug,
          title: docTitle,
          markdown,
          category: 'architecture',
        })
        .select()
        .single()

      if (createError) {
        throw createError
      }
      docPage = created
    }

    // Store as artifact
    await serviceClient
      .from('system_artifacts')
      .insert({
        project_id: params.id,
        system_id: params.systemId,
        kind: 'DOC_UPDATE',
        content: markdown,
        content_json: { docPageId: docPage.id, slug: docSlug },
        created_by: user.id,
      })

    // Update system status to GROUNDED if it has evidence
    const hasEvidence = graph.nodes.every((n) => n.refs.length > 0)
    if (hasEvidence && system.status !== 'GROUNDED') {
      await serviceClient
        .from('systems')
        .update({ status: 'GROUNDED' })
        .eq('id', params.systemId)
    }

    return NextResponse.json({
      docPageId: docPage.id,
      slug: docSlug,
      title: docTitle,
      markdown,
    })
  } catch (error: unknown) {
    console.error('Doc generation error:', error)
    const message = error instanceof Error ? error.message : 'Doc generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
