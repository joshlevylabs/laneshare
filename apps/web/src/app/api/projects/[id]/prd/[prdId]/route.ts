import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updatePRDSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  raw_markdown: z.string().max(100000).nullable().optional(),
  prd_json: z.any().optional(),
  status: z.enum(['DRAFT', 'PLANNING', 'READY', 'PROCESSING', 'COMPLETED']).optional(),
})

export async function GET(
  request: Request,
  { params }: { params: { id: string; prdId: string } }
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

  // Get PRD with full details
  const { data: prd, error } = await supabase
    .from('project_prds')
    .select(`
      *,
      created_by_profile:profiles!created_by(id, email, full_name, avatar_url)
    `)
    .eq('id', params.prdId)
    .eq('project_id', params.id)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.code === 'PGRST116' ? 404 : 500 })
  }

  // Get related sprints
  const { data: sprints } = await supabase
    .from('prd_sprints')
    .select(`
      *,
      sprint:sprints(id, name, status, start_date, end_date)
    `)
    .eq('prd_id', params.prdId)

  // Get story task mappings
  const { data: storyTasks } = await supabase
    .from('prd_story_tasks')
    .select(`
      *,
      task:tasks(id, key, title, status, type, priority)
    `)
    .eq('prd_id', params.prdId)

  return NextResponse.json({
    ...prd,
    sprints: sprints || [],
    story_tasks: storyTasks || [],
  })
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string; prdId: string } }
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
  const result = updatePRDSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Build update data
  const updateData: Record<string, unknown> = {}
  if (result.data.title !== undefined) updateData.title = result.data.title
  if (result.data.description !== undefined) updateData.description = result.data.description
  if (result.data.raw_markdown !== undefined) updateData.raw_markdown = result.data.raw_markdown
  if (result.data.prd_json !== undefined) updateData.prd_json = result.data.prd_json
  if (result.data.status !== undefined) updateData.status = result.data.status

  // If prd_json is being set, increment version
  if (result.data.prd_json) {
    const { data: currentPrd } = await supabase
      .from('project_prds')
      .select('version')
      .eq('id', params.prdId)
      .single()

    updateData.version = (currentPrd?.version || 0) + 1
  }

  const { data: prd, error } = await supabase
    .from('project_prds')
    .update(updateData)
    .eq('id', params.prdId)
    .eq('project_id', params.id)
    .select(`
      *,
      created_by_profile:profiles!created_by(id, email, full_name, avatar_url)
    `)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(prd)
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; prdId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if user is admin
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Only project admins can delete PRDs' }, { status: 403 })
  }

  const { error } = await supabase
    .from('project_prds')
    .delete()
    .eq('id', params.prdId)
    .eq('project_id', params.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
