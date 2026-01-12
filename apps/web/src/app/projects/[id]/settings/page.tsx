import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MembersList } from '@/components/settings/members-list'
import { AddMemberDialog } from '@/components/settings/add-member-dialog'
import { ProjectSettingsForm } from '@/components/settings/project-settings-form'

export default async function SettingsPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', params.id)
    .single()

  const { data: members } = await supabase
    .from('project_members')
    .select('*, profiles(id, email, full_name)')
    .eq('project_id', params.id)
    .order('created_at')

  const currentUserRole = members?.find((m: any) => m.user_id === user?.id)?.role || 'MEMBER'
  const isAdmin = ['OWNER', 'MAINTAINER'].includes(currentUserRole)

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Project Settings</h1>
        <p className="text-muted-foreground">
          Manage project details and team members
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project Details</CardTitle>
          <CardDescription>Update your project's name and description</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectSettingsForm
            project={project!}
            isAdmin={isAdmin}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>
                Manage who has access to this project
              </CardDescription>
            </div>
            {isAdmin && <AddMemberDialog projectId={params.id} />}
          </div>
        </CardHeader>
        <CardContent>
          <MembersList
            projectId={params.id}
            members={members?.map((m: any) => ({
              id: m.id,
              user_id: m.user_id,
              role: m.role,
              email: m.profiles.email,
              full_name: m.profiles.full_name,
              created_at: m.created_at,
            })) || []}
            currentUserId={user?.id || ''}
            isAdmin={isAdmin}
          />
        </CardContent>
      </Card>
    </div>
  )
}
