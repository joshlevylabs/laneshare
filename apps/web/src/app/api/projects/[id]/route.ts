import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const aiModelSchema = z.enum(['gpt-4o', 'gpt-4o-mini', 'gpt-5', 'o1', 'o1-mini'])

const projectSettingsSchema = z.object({
  ai_model: aiModelSchema,
}).optional()

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  settings: projectSettingsSchema,
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

  const { data: project, error } = await supabase
    .from('projects')
    .select(`
      *,
      project_members!inner (
        user_id,
        role
      )
    `)
    .eq('id', params.id)
    .eq('project_members.user_id', user.id)
    .single()

  if (error || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  return NextResponse.json(project)
}

export async function PATCH(
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

  // Check project admin status
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'Only project owners and maintainers can update project settings' },
      { status: 403 }
    )
  }

  const body = await request.json()
  const result = updateProjectSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { data: project, error } = await supabase
    .from('projects')
    .update(result.data)
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(project)
}

export async function DELETE(
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

  // Only owner can delete
  const { data: project } = await supabase
    .from('projects')
    .select('owner_id')
    .eq('id', params.id)
    .single()

  if (!project || project.owner_id !== user.id) {
    return NextResponse.json(
      { error: 'Only project owner can delete the project' },
      { status: 403 }
    )
  }

  const { error } = await supabase.from('projects').delete().eq('id', params.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
