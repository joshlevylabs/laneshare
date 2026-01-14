import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { RepoDocsView } from '@/components/repo-docs'

interface PageProps {
  params: { id: string; repoId: string }
}

export default async function RepoDocsPage({ params }: PageProps) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    redirect('/projects')
  }

  // Get repo info
  const { data: repo, error: repoError } = await supabase
    .from('repos')
    .select('id, owner, name, status, doc_status, doc_bundle_id')
    .eq('id', params.repoId)
    .eq('project_id', params.id)
    .single()

  if (repoError || !repo) {
    redirect(`/projects/${params.id}`)
  }

  return (
    <div className="h-[calc(100vh-4rem)]">
      <RepoDocsView
        projectId={params.id}
        repoId={params.repoId}
        repo={{
          id: repo.id,
          owner: repo.owner,
          name: repo.name,
          doc_status: repo.doc_status,
          doc_bundle_id: repo.doc_bundle_id,
        }}
      />
    </div>
  )
}
