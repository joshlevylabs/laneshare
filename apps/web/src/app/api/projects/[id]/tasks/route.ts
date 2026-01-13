import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// Schema for backward compatible task creation (works with both old and new schema)
const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10000).nullable().optional(),
  // New fields - will be ignored if columns don't exist
  type: z.enum(['EPIC', 'STORY', 'TASK', 'BUG', 'SPIKE']).optional(),
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

  // Apply filters (only for columns that exist in original schema)
  if (status) {
    query = query.eq('status', status)
  }

  if (assigneeId === 'null') {
    query = query.is('assignee_id', null)
  } else if (assigneeId) {
    query = query.eq('assignee_id', assigneeId)
  }

  // Note: sprint_id, type, parent_task_id filters require migration to be applied
  // They will be silently ignored if columns don't exist

  const { data: tasks, error } = await query.order('position', { ascending: true })

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

  // Insert with only fields from original schema for backward compatibility
  // New fields (type, labels, story_points, etc.) will error if migration not applied
  const insertData: Record<string, unknown> = {
    project_id: params.id,
    title: result.data.title,
    description: result.data.description,
    status: result.data.status,
    priority: result.data.priority,
    assignee_id: result.data.assignee_id,
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

  return NextResponse.json(task, { status: 201 })
}
