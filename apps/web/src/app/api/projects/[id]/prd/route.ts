import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createPRDSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  raw_markdown: z.string().max(100000).nullable().optional(),
  mode: z.enum(['paste', 'plan']).default('paste'),
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

  // Get PRDs with sprint counts
  const { data: prds, error } = await supabase
    .from('project_prds')
    .select(`
      *,
      created_by_profile:profiles!created_by(id, email, full_name, avatar_url)
    `)
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get sprint counts for each PRD
  const prdsWithCounts = await Promise.all(
    (prds || []).map(async (prd) => {
      const { data: sprints } = await supabase
        .from('prd_sprints')
        .select('id, implementation_status')
        .eq('prd_id', prd.id)

      const { data: storyTasks } = await supabase
        .from('prd_story_tasks')
        .select('passes')
        .eq('prd_id', prd.id)

      return {
        ...prd,
        sprint_count: sprints?.length || 0,
        completed_sprint_count: sprints?.filter(s => s.implementation_status === 'COMPLETED').length || 0,
        story_count: storyTasks?.length || 0,
        completed_story_count: storyTasks?.filter(s => s.passes).length || 0,
      }
    })
  )

  return NextResponse.json(prdsWithCounts)
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

  const body = await request.json()
  const result = createPRDSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const status = result.data.mode === 'plan' ? 'PLANNING' : 'DRAFT'

  const { data: prd, error } = await supabase
    .from('project_prds')
    .insert({
      project_id: params.id,
      title: result.data.title,
      description: result.data.description,
      raw_markdown: result.data.raw_markdown,
      status,
      created_by: user.id,
    })
    .select(`
      *,
      created_by_profile:profiles!created_by(id, email, full_name, avatar_url)
    `)
    .single()

  if (error) {
    console.error('PRD creation error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(prd, { status: 201 })
}
