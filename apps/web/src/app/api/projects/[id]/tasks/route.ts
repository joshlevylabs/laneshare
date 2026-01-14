import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// Schema for context links
const ticketLinkSchema = z.object({
  id: z.string().uuid(),
  linkType: z.enum(['related', 'blocks', 'blocked_by', 'duplicates', 'duplicated_by']),
})

// Schema for backward compatible task creation (works with both old and new schema)
const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10000).nullable().optional(),
  // Task types including hierarchy types
  type: z.enum(['EPIC', 'STORY', 'FEATURE', 'TASK', 'BUG', 'SPIKE', 'SUBTASK']).optional(),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE']).default('TODO'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  labels: z.array(z.string()).optional(),
  story_points: z.number().int().min(0).max(100).nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  reporter_id: z.string().uuid().nullable().optional(),
  parent_task_id: z.string().uuid().nullable().optional(),
  repo_scope: z.array(z.string()).nullable().optional(),
  sprint_id: z.string().uuid().nullable().optional(),
  due_date: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  // Context links to create with the task
  context_repos: z.array(z.string().uuid()).optional(),
  context_services: z.array(z.string().uuid()).optional(),
  context_assets: z.array(z.string().uuid()).optional(),
  context_docs: z.array(z.string().uuid()).optional(),
  context_features: z.array(z.string().uuid()).optional(),
  context_tickets: z.array(ticketLinkSchema).optional(),
})

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Parse query params for filtering
  const url = new URL(request.url)
  const sprintId = url.searchParams.get('sprint_id')
  const status = url.searchParams.get('status')
  const type = url.searchParams.get('type')
  const assigneeId = url.searchParams.get('assignee_id')
  const parentTaskId = url.searchParams.get('parent_task_id')

  // Backward compatible query - only join on assignee which exists in original schema
  let query = supabase
    .from('tasks')
    .select(`
      *,
      assignee:profiles!assignee_id(id, email, full_name, avatar_url)
    `)
    .eq('project_id', params.id)

  // Apply filters
  if (status) {
    query = query.eq('status', status)
  }

  if (assigneeId === 'null') {
    query = query.is('assignee_id', null)
  } else if (assigneeId) {
    query = query.eq('assignee_id', assigneeId)
  }

  if (type) {
    query = query.eq('type', type)
  }

  if (sprintId === 'null') {
    query = query.is('sprint_id', null)
  } else if (sprintId) {
    query = query.eq('sprint_id', sprintId)
  }

  // Filter by parent_task_id for hierarchy queries
  if (parentTaskId) {
    query = query.eq('parent_task_id', parentTaskId)
  }

  const { data: tasks, error } = await query.order('rank', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(tasks)
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const body = await request.json()
  const result = createTaskSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Build insert data with all fields
  const insertData: Record<string, unknown> = {
    project_id: params.id,
    title: result.data.title,
    description: result.data.description,
    status: result.data.status,
    priority: result.data.priority,
    assignee_id: result.data.assignee_id,
    reporter_id: result.data.reporter_id || user.id,
    type: result.data.type || 'TASK',
    labels: result.data.labels || [],
    story_points: result.data.story_points,
    parent_task_id: result.data.parent_task_id,
    sprint_id: result.data.sprint_id,
    due_date: result.data.due_date,
    start_date: result.data.start_date,
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .insert(insertData)
    .select(`
      *,
      assignee:profiles!assignee_id(id, email, full_name, avatar_url)
    `)
    .single()

  if (error) {
    console.error('Task creation error:', error)
    return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: 500 })
  }

  // Create context links if provided
  const contextErrors: string[] = []

  // Repo links
  if (result.data.context_repos && result.data.context_repos.length > 0) {
    const repoLinks = result.data.context_repos.map((repoId) => ({
      task_id: task.id,
      project_id: params.id,
      repo_id: repoId,
      created_by: user.id,
    }))
    const { error: repoError } = await supabase.from('task_repo_links').insert(repoLinks)
    if (repoError) contextErrors.push(`repos: ${repoError.message}`)
  }

  // Service links
  if (result.data.context_services && result.data.context_services.length > 0) {
    const serviceLinks = result.data.context_services.map((connectionId) => ({
      task_id: task.id,
      project_id: params.id,
      connection_id: connectionId,
      created_by: user.id,
    }))
    const { error: serviceError } = await supabase.from('task_service_links').insert(serviceLinks)
    if (serviceError) contextErrors.push(`services: ${serviceError.message}`)
  }

  // Asset links
  if (result.data.context_assets && result.data.context_assets.length > 0) {
    const assetLinks = result.data.context_assets.map((assetId) => ({
      task_id: task.id,
      project_id: params.id,
      asset_id: assetId,
      created_by: user.id,
    }))
    const { error: assetError } = await supabase.from('task_asset_links').insert(assetLinks)
    if (assetError) contextErrors.push(`assets: ${assetError.message}`)
  }

  // Doc links
  if (result.data.context_docs && result.data.context_docs.length > 0) {
    const docLinks = result.data.context_docs.map((docId) => ({
      task_id: task.id,
      project_id: params.id,
      doc_id: docId,
      created_by: user.id,
    }))
    const { error: docError } = await supabase.from('task_doc_links').insert(docLinks)
    if (docError) contextErrors.push(`docs: ${docError.message}`)
  }

  // Feature links
  if (result.data.context_features && result.data.context_features.length > 0) {
    const featureLinks = result.data.context_features.map((featureId) => ({
      task_id: task.id,
      project_id: params.id,
      feature_id: featureId,
      created_by: user.id,
    }))
    const { error: featureError } = await supabase.from('task_feature_links').insert(featureLinks)
    if (featureError) contextErrors.push(`features: ${featureError.message}`)
  }

  // Ticket links
  if (result.data.context_tickets && result.data.context_tickets.length > 0) {
    const ticketLinks = result.data.context_tickets.map((ticket) => ({
      task_id: task.id,
      project_id: params.id,
      linked_task_id: ticket.id,
      link_type: ticket.linkType,
      created_by: user.id,
    }))
    const { error: ticketError } = await supabase.from('task_ticket_links').insert(ticketLinks)
    if (ticketError) contextErrors.push(`tickets: ${ticketError.message}`)
  }

  // Log any context link errors but don't fail the request
  if (contextErrors.length > 0) {
    console.error('Context link errors:', contextErrors)
  }

  return NextResponse.json(task, { status: 201 })
}
