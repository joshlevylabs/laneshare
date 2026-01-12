import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { generateInviteToken, getInviteExpiration } from '@/lib/tokens'

const createInvitationSchema = z.object({
  role: z.enum(['MAINTAINER', 'MEMBER']).default('MEMBER'),
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

  // Check admin status
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'Only project owners and maintainers can view invitations' },
      { status: 403 }
    )
  }

  const { data: invitations, error } = await supabase
    .from('project_invitations')
    .select('*, profiles:created_by(email, full_name)')
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(invitations)
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

  // Check admin status
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'Only project owners and maintainers can create invitations' },
      { status: 403 }
    )
  }

  const body = await request.json()
  const result = createInvitationSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const token = generateInviteToken()
  const expiresAt = getInviteExpiration()

  const { data: invitation, error } = await supabase
    .from('project_invitations')
    .insert({
      project_id: params.id,
      token,
      role: result.data.role,
      created_by: user.id,
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(invitation, { status: 201 })
}
