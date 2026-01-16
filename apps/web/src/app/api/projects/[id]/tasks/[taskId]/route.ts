import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { TASK_TYPE_HIERARCHY, VALID_PARENT_TYPES, type TaskType, type HierarchyLevel } from '@laneshare/shared'

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10000).nullable().optional(),
  type: z.enum(['EPIC', 'STORY', 'FEATURE', 'TASK', 'BUG', 'SPIKE', 'SUBTASK']).optional(),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  labels: z.array(z.string()).optional(),
  story_points: z.number().int().min(0).max(100).nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  parent_task_id: z.string().uuid().nullable().optional(),
  repo_scope: z.array(z.string()).nullable().optional(),
  sprint_id: z.string().uuid().nullable().optional(),
  due_date: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  rank: z.number().optional(),
})

export async function GET(
  request: Request,
  { params }: { params: { id: string; taskId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .select(`
      *,
      assignee:profiles!assignee_id(id, email, full_name, avatar_url),
      reporter:profiles!reporter_id(id, email, full_name, avatar_url),
      sprint:sprints!sprint_id(id, name, status)
    `)
    .eq('id', params.taskId)
    .eq('project_id', params.id)
    .single()

  if (error || !task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  // Get subtasks if this is a parent task
  const { data: subtasks } = await supabase
    .from('tasks')
    .select(`
      *,
      assignee:profiles!assignee_id(id, email, full_name, avatar_url)
    `)
    .eq('parent_task_id', params.taskId)
    .order('rank', { ascending: true })

  return NextResponse.json({ ...task, subtasks: subtasks || [] })
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; taskId: string } }
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
  const result = updateTaskSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // If type is being changed, validate hierarchy constraints
  if (result.data.type) {
    const newType = result.data.type as TaskType
    const newLevel = TASK_TYPE_HIERARCHY[newType]

    // Fetch current task to check parent
    const { data: currentTask } = await supabase
      .from('tasks')
      .select('id, type, parent_task_id')
      .eq('id', params.taskId)
      .eq('project_id', params.id)
      .single()

    if (!currentTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // If task has a parent, validate that new type can have that parent type
    if (currentTask.parent_task_id) {
      const { data: parentTask } = await supabase
        .from('tasks')
        .select('id, type')
        .eq('id', currentTask.parent_task_id)
        .single()

      if (parentTask) {
        const validParentTypes = VALID_PARENT_TYPES[newLevel] || []
        if (!validParentTypes.includes(parentTask.type as TaskType)) {
          return NextResponse.json(
            {
              error: 'Invalid type change',
              details: `Cannot change to ${newType} because parent task is ${parentTask.type}. ${newType} can only be a child of: ${validParentTypes.join(', ') || 'nothing (top level only)'}`
            },
            { status: 400 }
          )
        }
      }
    }

    // Check if task has children that would become invalid
    const { data: childTasks } = await supabase
      .from('tasks')
      .select('id, type')
      .eq('parent_task_id', params.taskId)

    if (childTasks && childTasks.length > 0) {
      for (const child of childTasks) {
        const childType = child.type as TaskType
        const childLevel = TASK_TYPE_HIERARCHY[childType]
        const validParentTypesForChild = VALID_PARENT_TYPES[childLevel] || []

        if (!validParentTypesForChild.includes(newType)) {
          return NextResponse.json(
            {
              error: 'Invalid type change',
              details: `Cannot change to ${newType} because it has ${childType} children. ${childType} can only be a child of: ${validParentTypesForChild.join(', ')}`
            },
            { status: 400 }
          )
        }
      }
    }
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .update(result.data as any)
    .eq('id', params.taskId)
    .eq('project_id', params.id)
    .select(`
      *,
      assignee:profiles!assignee_id(id, email, full_name, avatar_url),
      reporter:profiles!reporter_id(id, email, full_name, avatar_url),
      sprint:sprints!sprint_id(id, name, status)
    `)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(task)
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; taskId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check project admin status
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'Only project owners and maintainers can delete tasks' },
      { status: 403 }
    )
  }

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', params.taskId)
    .eq('project_id', params.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
