import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET - Get invitation details (for preview before accepting)
export async function GET(
  request: Request,
  { params }: { params: { token: string } }
) {
  const serviceClient = createServiceRoleClient()

  const { data: invitations, error } = await serviceClient
    .rpc('get_valid_invitation', { p_token: params.token })

  if (error || !invitations || invitations.length === 0) {
    return NextResponse.json(
      { error: 'Invitation not found or has expired' },
      { status: 404 }
    )
  }

  const invitation = invitations[0]

  return NextResponse.json({
    projectName: invitation.project_name,
    role: invitation.role,
  })
}

// POST - Accept the invitation
export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get and validate invitation using service role (bypasses RLS)
  const { data: invitations, error: inviteError } = await serviceClient
    .rpc('get_valid_invitation', { p_token: params.token })

  if (inviteError || !invitations || invitations.length === 0) {
    return NextResponse.json(
      { error: 'Invitation not found or has expired' },
      { status: 404 }
    )
  }

  const invitation = invitations[0]

  // Check if user is already a member
  const { data: existingMember } = await serviceClient
    .from('project_members')
    .select('id')
    .eq('project_id', invitation.project_id)
    .eq('user_id', user.id)
    .single()

  if (existingMember) {
    return NextResponse.json(
      { error: 'You are already a member of this project' },
      { status: 400 }
    )
  }

  // Add user as project member
  const { error: memberError } = await serviceClient
    .from('project_members')
    .insert({
      project_id: invitation.project_id,
      user_id: user.id,
      role: invitation.role,
    })

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 })
  }

  // Mark invitation as accepted
  await serviceClient
    .from('project_invitations')
    .update({
      status: 'ACCEPTED',
      accepted_by: user.id,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', invitation.id)

  return NextResponse.json({
    success: true,
    projectId: invitation.project_id,
    projectName: invitation.project_name,
  })
}
