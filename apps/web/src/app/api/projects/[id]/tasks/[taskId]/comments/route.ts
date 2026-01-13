import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createCommentSchema = z.object({
  body: z.string().min(1).max(10000),
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

  const { data: comments, error } = await supabase
    .from('task_comments')
    .select(`
      *,
      author:profiles!author_id(id, email, full_name, avatar_url)
    `)
    .eq('task_id', params.taskId)
    .eq('project_id', params.id)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(comments)
}

export async function POST(
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
  const result = createCommentSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Create comment
  const { data: comment, error } = await supabase
    .from('task_comments')
    .insert({
      task_id: params.taskId,
      project_id: params.id,
      author_id: user.id,
      body: result.data.body,
    })
    .select(`
      *,
      author:profiles!author_id(id, email, full_name, avatar_url)
    `)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Log activity
  await supabase.from('task_activity').insert({
    task_id: params.taskId,
    project_id: params.id,
    actor_id: user.id,
    kind: 'COMMENTED',
    after_value: { comment_id: comment.id },
  })

  return NextResponse.json(comment, { status: 201 })
}
