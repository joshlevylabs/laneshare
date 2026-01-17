// @ts-nocheck
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import type { TicketContextAnalysis } from '@laneshare/shared'

const CONTEXT_ANALYSIS_PROMPT = `You are analyzing a software development ticket to identify relevant project context that would help implement it.

Given the ticket details and available project resources, identify:
1. Which repositories are most relevant to this work
2. Which documentation pages would be helpful
3. Which architecture features are related
4. Key files that might need to be modified or referenced

For each suggestion, provide:
- The resource ID
- The resource name
- A brief reason why it's relevant (max 100 chars)
- A confidence score from 0 to 1

Output your analysis as JSON:
{
  "suggested_repos": [
    { "id": "uuid", "name": "repo-name", "reason": "Why relevant", "confidence": 0.9 }
  ],
  "suggested_docs": [
    { "id": "uuid", "title": "Doc Title", "reason": "Why relevant", "confidence": 0.8 }
  ],
  "suggested_features": [
    { "id": "uuid", "name": "Feature Name", "reason": "Why relevant", "confidence": 0.7 }
  ],
  "key_files": [
    { "path": "src/path/to/file.ts", "repo_id": "uuid", "relevance": "Why important" }
  ]
}

Only suggest resources that are genuinely relevant. Better to suggest fewer with high confidence than many with low confidence.`

export async function POST(
  request: Request,
  { params }: { params: { id: string; sqId: string; ticketId: string } }
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

  // Get the ticket
  const { data: ticket, error: ticketError } = await supabase
    .from('sidequest_tickets')
    .select('*')
    .eq('id', params.ticketId)
    .eq('sidequest_id', params.sqId)
    .single()

  if (ticketError || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }

  // Get sidequest for repo context
  const { data: sidequest } = await supabase
    .from('sidequests')
    .select('repo_ids, title, description')
    .eq('id', params.sqId)
    .single()

  // Fetch available repos
  const { data: repos } = await supabase
    .from('repos')
    .select('id, owner, name, default_branch')
    .eq('project_id', params.id)

  // Fetch available documents
  const { data: docs } = await supabase
    .from('documents')
    .select('id, title, slug, category, description')
    .eq('project_id', params.id)
    .limit(30)

  // Fetch architecture features
  const { data: snapshots } = await supabase
    .from('architecture_snapshots')
    .select('id')
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })
    .limit(1)

  let features: Array<{ id: string; name: string; slug: string; description?: string }> = []
  if (snapshots && snapshots.length > 0) {
    const { data: featureData } = await supabase
      .from('architecture_features')
      .select('id, name, slug, description')
      .eq('snapshot_id', snapshots[0].id)
      .limit(30)
    features = featureData || []
  }

  // Build context prompt
  const ticketContext = `
## TICKET DETAILS
Type: ${ticket.ticket_type}
Title: ${ticket.title}
Description: ${ticket.description || 'No description'}
Acceptance Criteria:
${ticket.acceptance_criteria?.length > 0 ? ticket.acceptance_criteria.map((c: string) => `- ${c}`).join('\n') : 'None specified'}

## SIDEQUEST CONTEXT
Title: ${sidequest?.title || 'Unknown'}
Description: ${sidequest?.description || 'No description'}

## AVAILABLE REPOSITORIES
${repos?.map(r => `- ID: ${r.id}, Name: ${r.owner}/${r.name}`).join('\n') || 'None'}

## AVAILABLE DOCUMENTATION
${docs?.map(d => `- ID: ${d.id}, Title: "${d.title}" (${d.category}): ${d.description || 'No description'}`).join('\n') || 'None'}

## AVAILABLE ARCHITECTURE FEATURES
${features?.map(f => `- ID: ${f.id}, Name: "${f.name}": ${f.description || 'No description'}`).join('\n') || 'None'}
`

  // Call OpenAI
  const openai = new OpenAI()

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: CONTEXT_ANALYSIS_PROMPT },
        { role: 'user', content: ticketContext },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1500,
      temperature: 0.3,
    })

    const content = completion.choices[0]?.message?.content
    if (!content) {
      return NextResponse.json({ error: 'No analysis generated' }, { status: 500 })
    }

    let analysis: TicketContextAnalysis
    try {
      analysis = JSON.parse(content)
      analysis.analyzed_at = new Date().toISOString()
    } catch (e) {
      console.error('Failed to parse analysis:', e)
      return NextResponse.json({ error: 'Invalid analysis format' }, { status: 500 })
    }

    // Validate and filter suggestions to only include valid IDs
    const validRepoIds = new Set(repos?.map(r => r.id) || [])
    const validDocIds = new Set(docs?.map(d => d.id) || [])
    const validFeatureIds = new Set(features?.map(f => f.id) || [])

    analysis.suggested_repos = (analysis.suggested_repos || [])
      .filter(s => validRepoIds.has(s.id))
      .sort((a, b) => b.confidence - a.confidence)

    analysis.suggested_docs = (analysis.suggested_docs || [])
      .filter(s => validDocIds.has(s.id))
      .sort((a, b) => b.confidence - a.confidence)

    analysis.suggested_features = (analysis.suggested_features || [])
      .filter(s => validFeatureIds.has(s.id))
      .sort((a, b) => b.confidence - a.confidence)

    // Update the ticket with the analysis and auto-link high-confidence suggestions
    const linkedRepoIds = analysis.suggested_repos
      .filter(s => s.confidence >= 0.8)
      .map(s => s.id)

    const linkedDocIds = analysis.suggested_docs
      .filter(s => s.confidence >= 0.8)
      .map(s => s.id)

    const linkedFeatureIds = analysis.suggested_features
      .filter(s => s.confidence >= 0.8)
      .map(s => s.id)

    const { data: updatedTicket, error: updateError } = await supabase
      .from('sidequest_tickets')
      .update({
        context_analysis: analysis,
        linked_repo_ids: linkedRepoIds,
        linked_doc_ids: linkedDocIds,
        linked_feature_ids: linkedFeatureIds,
      })
      .eq('id', params.ticketId)
      .select()
      .single()

    if (updateError) {
      console.error('Failed to update ticket with analysis:', updateError)
      // Don't fail the request, just return the analysis
    }

    return NextResponse.json({
      analysis,
      ticket: updatedTicket || ticket,
      auto_linked: {
        repos: linkedRepoIds.length,
        docs: linkedDocIds.length,
        features: linkedFeatureIds.length,
      },
    })
  } catch (error) {
    console.error('Context analysis error:', error)
    return NextResponse.json(
      { error: 'Failed to analyze context' },
      { status: 500 }
    )
  }
}
