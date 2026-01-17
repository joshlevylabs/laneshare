// @ts-nocheck
/**
 * GET /api/projects/[id]/sidequests/[sqId]/tickets/[ticketId]/context
 *
 * Fetch the full context for a ticket including:
 * - Linked documents with markdown content
 * - Linked repos with details
 * - Linked architecture features
 * - Context analysis (suggested files, etc.)
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export interface TicketContextDocument {
  id: string
  title: string
  slug: string
  category: string
  description: string | null
  markdown: string | null
}

export interface TicketContextRepo {
  id: string
  name: string
  owner: string
  fullName: string
  defaultBranch: string | null
  description: string | null
}

export interface TicketContextFeature {
  id: string
  name: string
  slug: string
  description: string | null
  type: string | null
}

export interface TicketContextResponse {
  ticket: {
    id: string
    title: string
    description: string | null
    ticket_type: string
    acceptance_criteria: string[] | null
    priority: string | null
    story_points: number | null
    context_analysis: unknown | null
  }
  sidequest: {
    id: string
    title: string
    description: string | null
  }
  documents: TicketContextDocument[]
  repos: TicketContextRepo[]
  features: TicketContextFeature[]
}

export async function GET(
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

  // Get the ticket with linked IDs
  const { data: ticket, error: ticketError } = await supabase
    .from('sidequest_tickets')
    .select(`
      id,
      title,
      description,
      ticket_type,
      acceptance_criteria,
      priority,
      story_points,
      context_analysis,
      linked_doc_ids,
      linked_repo_ids,
      linked_feature_ids
    `)
    .eq('id', params.ticketId)
    .eq('sidequest_id', params.sqId)
    .single()

  if (ticketError || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }

  // Get sidequest info
  const { data: sidequest } = await supabase
    .from('sidequests')
    .select('id, title, description')
    .eq('id', params.sqId)
    .single()

  // Fetch linked documents with markdown content
  let documents: TicketContextDocument[] = []
  if (ticket.linked_doc_ids && ticket.linked_doc_ids.length > 0) {
    const { data: docs } = await supabase
      .from('documents')
      .select('id, title, slug, category, description, markdown')
      .in('id', ticket.linked_doc_ids)

    if (docs) {
      documents = docs.map(d => ({
        id: d.id,
        title: d.title,
        slug: d.slug,
        category: d.category,
        description: d.description,
        markdown: d.markdown,
      }))
    }
  }

  // Fetch linked repos
  let repos: TicketContextRepo[] = []
  if (ticket.linked_repo_ids && ticket.linked_repo_ids.length > 0) {
    const { data: repoData } = await supabase
      .from('repos')
      .select('id, name, owner, default_branch, description')
      .in('id', ticket.linked_repo_ids)

    if (repoData) {
      repos = repoData.map(r => ({
        id: r.id,
        name: r.name,
        owner: r.owner,
        fullName: `${r.owner}/${r.name}`,
        defaultBranch: r.default_branch,
        description: r.description,
      }))
    }
  }

  // Fetch linked architecture features
  let features: TicketContextFeature[] = []
  if (ticket.linked_feature_ids && ticket.linked_feature_ids.length > 0) {
    const { data: featureData } = await supabase
      .from('architecture_features')
      .select('id, name, slug, description, type')
      .in('id', ticket.linked_feature_ids)

    if (featureData) {
      features = featureData.map(f => ({
        id: f.id,
        name: f.name,
        slug: f.slug,
        description: f.description,
        type: f.type,
      }))
    }
  }

  const response: TicketContextResponse = {
    ticket: {
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      ticket_type: ticket.ticket_type,
      acceptance_criteria: ticket.acceptance_criteria,
      priority: ticket.priority,
      story_points: ticket.story_points,
      context_analysis: ticket.context_analysis,
    },
    sidequest: sidequest || { id: params.sqId, title: 'Unknown', description: null },
    documents,
    repos,
    features,
  }

  return NextResponse.json(response)
}
