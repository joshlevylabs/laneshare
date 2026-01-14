import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createSprintSchema = z.object({
  name: z.string().min(1).max(100),
  goal: z.string().max(500).optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED']).optional(),
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

  // Get sprints with task counts
  const { data: sprints, error } = await supabase
    .from('sprints')
    .select(`
      *,
      tasks:tasks(count)
    `)
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Transform to include task_count
  const sprintsWithCounts = sprints?.map(sprint => ({
    ...sprint,
    task_count: sprint.tasks?.[0]?.count || 0,
    tasks: undefined, // Remove the nested tasks array
  }))

  return NextResponse.json(sprintsWithCounts || [])
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

  // Check membership - require OWNER or MAINTAINER
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
      name: result.data.name,
      goal: result.data.goal,
      start_date: result.data.start_date,
      end_date: result.data.end_date,
      status: result.data.status || 'PLANNED',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(sprint, { status: 201 })
}
