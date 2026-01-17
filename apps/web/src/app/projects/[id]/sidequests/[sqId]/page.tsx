import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SidequestDetail } from '@/components/sidequests'
import { notFound } from 'next/navigation'

export default async function SidequestPage({
  params,
}: {
  params: { id: string; sqId: string }
}) {
  const supabase = createServerSupabaseClient()

  // Fetch sidequest with related data
  const { data: sidequest, error } = await supabase
    .from('sidequests')
    .select(`
      *,
      creator:profiles!created_by(id, email, full_name, avatar_url)
    `)
    .eq('id', params.sqId)
    .eq('project_id', params.id)
    .single()

  if (error || !sidequest) {
    notFound()
  }

  // Fetch repos
  let repos: Array<{ id: string; owner: string; name: string; default_branch?: string }> = []
  if (sidequest.repo_ids && sidequest.repo_ids.length > 0) {
    const { data: repoData } = await supabase
      .from('repos')
      .select('id, owner, name, default_branch')
      .in('id', sidequest.repo_ids)
    repos = repoData || []
  }

  // Fetch tickets
  const { data: tickets } = await supabase
    .from('sidequest_tickets')
    .select(`
      *,
      approver:profiles!approved_by(id, email, full_name, avatar_url)
    `)
    .eq('sidequest_id', params.sqId)
    .order('hierarchy_level', { ascending: true })
    .order('sort_order', { ascending: true })

  // Fetch docs for context
  const { data: docs } = await supabase
    .from('documents')
    .select('id, title, slug, category')
    .eq('project_id', params.id)

  return (
    <div className="container max-w-6xl py-6">
      <SidequestDetail
        projectId={params.id}
        sidequest={{ ...sidequest, repos, tickets: tickets || [] }}
        repos={repos}
        docs={docs || []}
      />
    </div>
  )
}
