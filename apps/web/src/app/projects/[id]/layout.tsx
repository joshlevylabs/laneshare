import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { ProjectSidebar } from '@/components/projects/project-sidebar'
import { ProjectHeader } from '@/components/projects/project-header'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch project with membership check
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
    notFound()
  }

  const userRole = project.project_members[0]?.role || 'MEMBER'

  return (
    <div className="min-h-screen bg-background">
      <ProjectHeader project={project} userRole={userRole} />
      <div className="flex">
        <ProjectSidebar projectId={params.id} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
