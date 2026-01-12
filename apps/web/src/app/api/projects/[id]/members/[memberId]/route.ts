import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateMemberSchema = z.object({
  role: z.enum(['MAINTAINER', 'MEMBER']),
})

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; memberId: string } }
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
      { error: 'Only project owners and maintainers can update member roles' },
      { status: 403 }
    )
  }

  // Check target member
  const { data: targetMember } = await supabase
    .from('project_members')
    .select('role')
    .eq('id', params.memberId)
    .eq('project_id', params.id)
    .single()

  if (!targetMember) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  // Can't modify owner
  if (targetMember.role === 'OWNER') {
    return NextResponse.json(
      { error: 'Cannot modify project owner role' },
      { status: 403 }
    )
  }

  const body = await request.json()
  const result = updateMemberSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { data: updatedMember, error } = await supabase
    .from('project_members')
    .update({ role: result.data.role })
    .eq('id', params.memberId)
    .eq('project_id', params.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(updatedMember)
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; memberId: string } }
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
      { error: 'Only project owners and maintainers can remove members' },
      { status: 403 }
    )
  }

  // Check target member
  const { data: targetMember } = await supabase
    .from('project_members')
    .select('role, user_id')
    .eq('id', params.memberId)
    .eq('project_id', params.id)
    .single()

  if (!targetMember) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  // Can't remove owner
  if (targetMember.role === 'OWNER') {
    return NextResponse.json(
      { error: 'Cannot remove project owner' },
      { status: 403 }
    )
  }

  // Can't remove self
  if (targetMember.user_id === user.id) {
    return NextResponse.json(
      { error: 'Cannot remove yourself from the project' },
      { status: 403 }
    )
  }

  const { error } = await supabase
    .from('project_members')
    .delete()
    .eq('id', params.memberId)
    .eq('project_id', params.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
