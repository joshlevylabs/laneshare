import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ReposList } from '@/components/repos/repos-list'
import { AddRepoDialog } from '@/components/repos/add-repo-dialog'
import { ConnectGitHubButton } from '@/components/repos/connect-github-button'

export default async function ReposPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Check if user logged in via GitHub OAuth
  const isGitHubOAuthUser = user?.app_metadata?.provider === 'github'

  // Check if user has GitHub connection (PAT)
  const { data: connection } = await supabase
    .from('github_connections')
    .select('id')
    .eq('user_id', user?.id)
    .single()

  // User is connected if they logged in via GitHub OAuth OR have a stored PAT
  const hasGitHubAccess = isGitHubOAuthUser || !!connection

  // Fetch repos
  const { data: reposData } = await supabase
    .from('repos')
    .select('*')
    .eq('project_id', params.id)
    .order('installed_at', { ascending: false })

  // Transform repos to include has_codespaces_token flag
  const repos = (reposData || []).map((repo) => ({
    ...repo,
    has_codespaces_token: !!repo.github_token_encrypted,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Repositories</h1>
          <p className="text-muted-foreground">
            Connect and sync GitHub repositories to enable code search and context generation
          </p>
        </div>
        {hasGitHubAccess ? (
          <AddRepoDialog projectId={params.id} />
        ) : null}
      </div>

      {!hasGitHubAccess ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect GitHub</CardTitle>
            <CardDescription>
              Connect your GitHub account to add repositories to this project.
              We'll use your access to read repository contents for indexing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectGitHubButton />
          </CardContent>
        </Card>
      ) : (
        <ReposList repos={repos} projectId={params.id} />
      )}
    </div>
  )
}
