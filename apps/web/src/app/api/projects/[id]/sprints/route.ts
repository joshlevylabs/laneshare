import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createSprintSchema = z.object({
  name: z.string().min(1).max(100),
  goal: z.string().max(500).nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
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

  // Get sprints with task counts
  const { data: sprints, error } = await supabase
    .from('sprints')
    .select('*')
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get task counts for each sprint
  const sprintsWithCounts = await Promise.all(
    sprints.map(async (sprint) => {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('status, story_points')
        .eq('sprint_id', sprint.id)

      const taskCount = tasks?.length || 0
      const completedTaskCount = tasks?.filter((t) => t.status === 'DONE').length || 0
      const totalStoryPoints = tasks?.reduce((sum, t) => sum + (t.story_points || 0), 0) || 0
      const completedStoryPoints =
        tasks
          ?.filter((t) => t.status === 'DONE')
          .reduce((sum, t) => sum + (t.story_points || 0), 0) || 0

      return {
        ...sprint,
        task_count: taskCount,
        completed_task_count: completedTaskCount,
        total_story_points: totalStoryPoints,
        completed_story_points: completedStoryPoints,
      }
    })
  )

  return NextResponse.json(sprintsWithCounts)
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

  // Check if user is project admin (OWNER or MAINTAINER)
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Only project admins can create sprints' }, { status: 403 })
  }

  const body = await request.json()
  const result = createSprintSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { data: sprint, error } = await supabase
    .from('sprints')
    .insert({
      project_id: params.id,
      status: 'PLANNED',
      ...result.data,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(sprint, { status: 201 })
}
