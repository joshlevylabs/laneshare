import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateSprintSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  goal: z.string().max(500).nullable().optional(),
  status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED']).optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
})

export async function GET(
  request: Request,
  { params }: { params: { id: string; sprintId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: sprint, error } = await supabase
    .from('sprints')
    .select('*')
    .eq('id', params.sprintId)
    .eq('project_id', params.id)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }

  // Get task counts
  const { data: tasks } = await supabase
    .from('tasks')
    .select('status, story_points')
    .eq('sprint_id', params.sprintId)

  const taskCount = tasks?.length || 0
  const completedTaskCount = tasks?.filter((t) => t.status === 'DONE').length || 0
  const totalStoryPoints = tasks?.reduce((sum, t) => sum + (t.story_points || 0), 0) || 0
  const completedStoryPoints =
    tasks
      ?.filter((t) => t.status === 'DONE')
      .reduce((sum, t) => sum + (t.story_points || 0), 0) || 0

  return NextResponse.json({
    ...sprint,
    task_count: taskCount,
    completed_task_count: completedTaskCount,
    total_story_points: totalStoryPoints,
    completed_story_points: completedStoryPoints,
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; sprintId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if user is project admin
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Only project admins can update sprints' }, { status: 403 })
  }

  const body = await request.json()
  const result = updateSprintSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // If starting a sprint, check no other sprint is active
  if (result.data.status === 'ACTIVE') {
    const { data: activeSprints } = await supabase
      .from('sprints')
      .select('id, name')
      .eq('project_id', params.id)
      .eq('status', 'ACTIVE')
      .neq('id', params.sprintId)

    if (activeSprints && activeSprints.length > 0) {
      return NextResponse.json(
        { error: `Sprint "${activeSprints[0].name}" is already active. Complete it first.` },
        { status: 400 }
      )
    }

    // Set start_date to today if not already set
    if (!result.data.start_date) {
      result.data.start_date = new Date().toISOString().split('T')[0]
    }
  }

  const { data: sprint, error } = await supabase
    .from('sprints')
    .update(result.data)
    .eq('id', params.sprintId)
    .eq('project_id', params.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(sprint)
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; sprintId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if user is project admin
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Only project admins can delete sprints' }, { status: 403 })
  }

  // Move all tasks from this sprint back to backlog
  await supabase
    .from('tasks')
    .update({ sprint_id: null })
    .eq('sprint_id', params.sprintId)

  const { error } = await supabase
    .from('sprints')
    .delete()
    .eq('id', params.sprintId)
    .eq('project_id', params.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
