/**
 * POST /api/projects/[id]/sidequests/[sqId]/analyze-all-context
 *
 * Analyze and add context (documents, repos, features) to all tickets in a sidequest.
 * This runs AI analysis on each ticket to intelligently link relevant project resources.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import type { TicketContextAnalysis } from '@laneshare/shared'

// Type definitions for sidequest tables (not yet in generated types)
interface SidequestRow {
  id: string
  title: string
  description: string | null
  repo_ids: string[] | null
}

interface SidequestTicketRow {
  id: string
  title: string
  description: string | null
  ticket_type: string
  acceptance_criteria: string[] | null
  parent_ticket_id: string | null
  context_analysis: TicketContextAnalysis | null
}

interface RepoRow {
  id: string
  owner: string
  name: string
  default_branch: string
  description: string | null
}

interface DocRow {
  id: string
  title: string
  slug: string
  category: string
  description: string | null
}

interface FeatureRow {
  id: string
  name: string
  slug: string
  description: string | null
}

const BATCH_SIZE = 5 // Process tickets in batches to avoid rate limits

const CONTEXT_ANALYSIS_PROMPT = `You are analyzing software development tickets to identify relevant project context.

Given the ticket details and available project resources, identify:
1. Which repositories are most relevant to this work
2. Which documentation pages would be helpful
3. Which architecture features are related
4. Key files that might need to be modified or referenced

For each suggestion, provide:
- The resource ID (from the available resources list)
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

Be selective - only suggest resources that are genuinely relevant with high confidence.`

export async function POST(
  request: Request,
  { params }: { params: { id: string; sqId: string } }
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

  // Get the sidequest (using type assertion since sidequest tables aren't in generated types)
  const { data: sidequest, error: sqError } = await (supabase as any)
    .from('sidequests')
    .select('id, title, description, repo_ids')
    .eq('id', params.sqId)
    .eq('project_id', params.id)
    .single() as { data: SidequestRow | null; error: any }

  if (sqError || !sidequest) {
    return NextResponse.json({ error: 'Sidequest not found' }, { status: 404 })
  }

  // Get all tickets that don't have context yet or need refresh
  const { data: tickets, error: ticketError } = await (supabase as any)
    .from('sidequest_tickets')
    .select('id, title, description, ticket_type, acceptance_criteria, parent_ticket_id, context_analysis')
    .eq('sidequest_id', params.sqId)
    .order('hierarchy_level', { ascending: true })
    .order('sort_order', { ascending: true }) as { data: SidequestTicketRow[] | null; error: any }

  if (ticketError || !tickets) {
    return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 })
  }

  // Filter to tickets that need context analysis (no linked docs/repos/features)
  const { data: ticketsNeedingAnalysis } = await (supabase as any)
    .from('sidequest_tickets')
    .select('id')
    .eq('sidequest_id', params.sqId)
    .or('linked_doc_ids.is.null,linked_doc_ids.eq.{}') as { data: { id: string }[] | null; error: any }

  const ticketIdsNeedingAnalysis = new Set(ticketsNeedingAnalysis?.map(t => t.id) || [])
  const ticketsToAnalyze = tickets.filter(t => ticketIdsNeedingAnalysis.has(t.id))

  if (ticketsToAnalyze.length === 0) {
    return NextResponse.json({
      message: 'All tickets already have context',
      analyzed: 0,
      total: tickets.length,
    })
  }

  // Fetch available repos (using type assertion for description column)
  const { data: repos } = await (supabase as any)
    .from('repos')
    .select('id, owner, name, default_branch, description')
    .eq('project_id', params.id) as { data: RepoRow[] | null; error: any }

  // Fetch available documents
  const { data: docs } = await (supabase as any)
    .from('documents')
    .select('id, title, slug, category, description')
    .eq('project_id', params.id)
    .limit(50) as { data: DocRow[] | null; error: any }

  // Fetch architecture features
  const { data: snapshots } = await supabase
    .from('architecture_snapshots')
    .select('id')
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })
    .limit(1)

  let features: FeatureRow[] = []
  if (snapshots && snapshots.length > 0) {
    const { data: featureData } = await (supabase as any)
      .from('architecture_features')
      .select('id, name, slug, description')
      .eq('snapshot_id', snapshots[0].id)
      .limit(50) as { data: FeatureRow[] | null; error: any }
    features = featureData || []
  }

  // Build context for AI
  const availableContext = `
## AVAILABLE REPOSITORIES
${repos?.map(r => `- ID: ${r.id}, Name: ${r.owner}/${r.name}${r.description ? ` - ${r.description}` : ''}`).join('\n') || 'None'}

## AVAILABLE DOCUMENTATION
${docs?.map(d => `- ID: ${d.id}, Title: "${d.title}" (${d.category}): ${d.description || 'No description'}`).join('\n') || 'None'}

## AVAILABLE ARCHITECTURE FEATURES
${features?.map(f => `- ID: ${f.id}, Name: "${f.name}": ${f.description || 'No description'}`).join('\n') || 'None'}
`

  const openai = new OpenAI()
  let analyzed = 0
  let failed = 0
  const results: Array<{ ticketId: string; success: boolean; linkedDocs: number; linkedRepos: number; linkedFeatures: number }> = []

  // Process tickets in batches
  for (let i = 0; i < ticketsToAnalyze.length; i += BATCH_SIZE) {
    const batch = ticketsToAnalyze.slice(i, i + BATCH_SIZE)

    await Promise.all(batch.map(async (ticket) => {
      try {
        // Build ticket context
        const ticketContext = `
## SIDEQUEST
Title: ${sidequest.title}
Description: ${sidequest.description || 'No description'}

## TICKET TO ANALYZE
Type: ${ticket.ticket_type}
Title: ${ticket.title}
Description: ${ticket.description || 'No description'}
Acceptance Criteria:
${ticket.acceptance_criteria && ticket.acceptance_criteria.length > 0 ? ticket.acceptance_criteria.map((c: string) => `- ${c}`).join('\n') : 'None specified'}

${availableContext}
`

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini', // Use mini for cost efficiency on bulk operations
          messages: [
            { role: 'system', content: CONTEXT_ANALYSIS_PROMPT },
            { role: 'user', content: ticketContext },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 1000,
          temperature: 0.3,
        })

        const content = completion.choices[0]?.message?.content
        if (!content) {
          throw new Error('No analysis generated')
        }

        let analysis: TicketContextAnalysis
        try {
          analysis = JSON.parse(content)
          analysis.analyzed_at = new Date().toISOString()
        } catch {
          throw new Error('Invalid analysis format')
        }

        // Validate and filter suggestions
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

        // Auto-link resources with confidence >= 0.7
        const LINK_THRESHOLD = 0.7
        const linkedRepoIds = analysis.suggested_repos
          .filter(s => s.confidence >= LINK_THRESHOLD)
          .map(s => s.id)

        const linkedDocIds = analysis.suggested_docs
          .filter(s => s.confidence >= LINK_THRESHOLD)
          .map(s => s.id)

        const linkedFeatureIds = analysis.suggested_features
          .filter(s => s.confidence >= LINK_THRESHOLD)
          .map(s => s.id)

        // Update the ticket (using type assertion)
        const { error: updateError } = await (supabase as any)
          .from('sidequest_tickets')
          .update({
            context_analysis: analysis,
            linked_repo_ids: linkedRepoIds.length > 0 ? linkedRepoIds : null,
            linked_doc_ids: linkedDocIds.length > 0 ? linkedDocIds : null,
            linked_feature_ids: linkedFeatureIds.length > 0 ? linkedFeatureIds : null,
          })
          .eq('id', ticket.id) as { error: any }

        if (updateError) {
          throw updateError
        }

        analyzed++
        results.push({
          ticketId: ticket.id,
          success: true,
          linkedDocs: linkedDocIds.length,
          linkedRepos: linkedRepoIds.length,
          linkedFeatures: linkedFeatureIds.length,
        })
      } catch (error) {
        console.error(`Failed to analyze ticket ${ticket.id}:`, error)
        failed++
        results.push({
          ticketId: ticket.id,
          success: false,
          linkedDocs: 0,
          linkedRepos: 0,
          linkedFeatures: 0,
        })
      }
    }))

    // Small delay between batches to avoid rate limits
    if (i + BATCH_SIZE < ticketsToAnalyze.length) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  // Calculate totals
  const totalLinkedDocs = results.reduce((sum, r) => sum + r.linkedDocs, 0)
  const totalLinkedRepos = results.reduce((sum, r) => sum + r.linkedRepos, 0)
  const totalLinkedFeatures = results.reduce((sum, r) => sum + r.linkedFeatures, 0)

  return NextResponse.json({
    message: `Analyzed ${analyzed} tickets, ${failed} failed`,
    analyzed,
    failed,
    total: tickets.length,
    linked: {
      docs: totalLinkedDocs,
      repos: totalLinkedRepos,
      features: totalLinkedFeatures,
    },
    results,
  })
}
