import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const addMemberSchema = z.object({
  email: z.string().email(),
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

  const { data: members, error } = await supabase
    .from('project_members')
    .select('*, profiles(id, email, full_name)')
    .eq('project_id', params.id)
    .order('created_at')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(members)
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

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
      { error: 'Only project owners and maintainers can add members' },
      { status: 403 }
    )
  }

  const body = await request.json()
  const result = addMemberSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { email, role } = result.data

  // Find user by email using service role client
  const { data: targetUser } = await serviceClient
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single()

  if (!targetUser) {
    return NextResponse.json(
      { error: 'User not found. They must create an account first.' },
      { status: 404 }
    )
  }

  // Check if already a member
  const { data: existingMember } = await supabase
    .from('project_members')
    .select('id')
    .eq('project_id', params.id)
    .eq('user_id', targetUser.id)
    .single()

  if (existingMember) {
    return NextResponse.json(
      { error: 'This user is already a member of the project' },
      { status: 400 }
    )
  }

  // Add member
  const { data: newMember, error } = await supabase
    .from('project_members')
    .insert({
      project_id: params.id,
      user_id: targetUser.id,
      role,
    })
    .select('*, profiles(id, email, full_name)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(newMember, { status: 201 })
}
