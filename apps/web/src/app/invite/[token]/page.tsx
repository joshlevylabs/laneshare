import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AcceptInviteCard } from './accept-invite-card'

export default async function InvitePage({
  params,
}: {
  params: { token: string }
}) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  // Get current user (may be null for unauthenticated users)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Validate invitation
  const { data: invitations, error } = await serviceClient
    .rpc('get_valid_invitation', { p_token: params.token })

  if (error || !invitations || invitations.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Invalid Invitation</h1>
          <p className="text-muted-foreground">
            This invitation link is invalid or has expired.
          </p>
        </div>
      </div>
    )
  }

  const invitation = invitations[0]

  // If user is logged in and already a member, redirect to project
  if (user) {
    const { data: existingMember } = await serviceClient
      .from('project_members')
      .select('id')
      .eq('project_id', invitation.project_id)
      .eq('user_id', user.id)
      .single()

    if (existingMember) {
      redirect(`/projects/${invitation.project_id}/dashboard`)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted p-4">
      <AcceptInviteCard
        token={params.token}
        projectName={invitation.project_name}
        role={invitation.role}
        isAuthenticated={!!user}
      />
    </div>
  )
}
