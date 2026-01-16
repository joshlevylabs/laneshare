'use client'

import { Card, CardContent } from '@/components/ui/card'
import { GitBranch } from 'lucide-react'
import { RepoCard, type Repo } from './repo-card'

interface ReposListProps {
  repos: Repo[]
  projectId: string
}

export function ReposList({ repos, projectId }: ReposListProps) {
  if (repos.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <GitBranch className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No repositories yet</h3>
          <p className="text-muted-foreground text-center max-w-sm">
            Add a GitHub repository to start indexing code for search and context generation.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {repos.map((repo) => (
        <RepoCard key={repo.id} repo={repo} projectId={projectId} />
      ))}
    </div>
  )
}

export type { Repo }
