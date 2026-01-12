'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { formatRelativeTime } from '@laneshare/shared'
import { Progress } from '@/components/ui/progress'
import { GitBranch, RefreshCw, Trash2, Loader2, ExternalLink } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface Repo {
  id: string
  owner: string
  name: string
  default_branch: string
  status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR'
  last_synced_at: string | null
  sync_error: string | null
  installed_at: string
  sync_progress: number | null
  sync_total: number | null
  sync_stage: 'discovering' | 'indexing' | 'embedding' | 'generating_docs' | null
}

interface ReposListProps {
  repos: Repo[]
  projectId: string
}

interface SyncProgress {
  progress: number
  total: number
  stage: string | null
}

export function ReposList({ repos, projectId }: ReposListProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [syncingRepos, setSyncingRepos] = useState<Set<string>>(new Set())
  const [deletingRepos, setDeletingRepos] = useState<Set<string>>(new Set())
  const [repoProgress, setRepoProgress] = useState<Record<string, SyncProgress>>({})

  const getStageLabel = (stage: string | null): string => {
    switch (stage) {
      case 'discovering':
        return 'Discovering files...'
      case 'indexing':
        return 'Indexing files...'
      case 'embedding':
        return 'Generating embeddings...'
      case 'generating_docs':
        return 'Generating documentation...'
      default:
        return 'Syncing...'
    }
  }

  const handleSync = async (repoId: string) => {
    setSyncingRepos((prev) => new Set(prev).add(repoId))

    try {
      const response = await fetch(`/api/repos/${repoId}/sync`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to sync repository')
      }

      toast({
        title: 'Sync Started',
        description: 'Repository sync has been initiated. This may take a few minutes.',
      })

      // Poll for completion and progress
      const checkStatus = async () => {
        const statusRes = await fetch(`/api/repos/${repoId}`)
        if (statusRes.ok) {
          const repo = await statusRes.json()

          // Update progress state
          if (repo.status === 'SYNCING') {
            setRepoProgress((prev) => ({
              ...prev,
              [repoId]: {
                progress: repo.sync_progress || 0,
                total: repo.sync_total || 0,
                stage: repo.sync_stage,
              },
            }))
          }

          if (repo.status === 'SYNCED' || repo.status === 'ERROR') {
            setSyncingRepos((prev) => {
              const next = new Set(prev)
              next.delete(repoId)
              return next
            })
            setRepoProgress((prev) => {
              const next = { ...prev }
              delete next[repoId]
              return next
            })
            router.refresh()
            if (repo.status === 'ERROR') {
              toast({
                variant: 'destructive',
                title: 'Sync Failed',
                description: repo.sync_error || 'An error occurred during sync',
              })
            } else {
              toast({
                title: 'Sync Complete',
                description: 'Repository has been indexed and documentation generated.',
              })
            }
            return
          }
        }
        setTimeout(checkStatus, 1500)
      }
      checkStatus()
    } catch (error) {
      setSyncingRepos((prev) => {
        const next = new Set(prev)
        next.delete(repoId)
        return next
      })
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to sync repository',
      })
    }
  }

  const handleDelete = async (repoId: string) => {
    setDeletingRepos((prev) => new Set(prev).add(repoId))

    try {
      const response = await fetch(`/api/repos/${repoId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to delete repository')
      }

      toast({
        title: 'Repository Removed',
        description: 'Repository has been removed from the project.',
      })

      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete repository',
      })
    } finally {
      setDeletingRepos((prev) => {
        const next = new Set(prev)
        next.delete(repoId)
        return next
      })
    }
  }

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
      {repos.map((repo) => {
        const isSyncing = syncingRepos.has(repo.id) || repo.status === 'SYNCING'
        const isDeleting = deletingRepos.has(repo.id)

        return (
          <Card key={repo.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <GitBranch className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-lg">
                      <a
                        href={`https://github.com/${repo.owner}/${repo.name}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline inline-flex items-center gap-1"
                      >
                        {repo.owner}/{repo.name}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </CardTitle>
                    <CardDescription>
                      Branch: {repo.default_branch} • Added {formatRelativeTime(repo.installed_at)}
                    </CardDescription>
                  </div>
                </div>
                <Badge
                  variant={
                    repo.status === 'SYNCED'
                      ? 'success'
                      : repo.status === 'ERROR'
                      ? 'destructive'
                      : repo.status === 'SYNCING'
                      ? 'warning'
                      : 'secondary'
                  }
                >
                  {isSyncing ? 'Syncing...' : repo.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Progress bar when syncing */}
              {isSyncing && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {getStageLabel(repoProgress[repo.id]?.stage || repo.sync_stage)}
                    </span>
                    {(repoProgress[repo.id]?.total || repo.sync_total || 0) > 0 && (
                      <span className="text-muted-foreground">
                        {repoProgress[repo.id]?.progress || repo.sync_progress || 0} / {repoProgress[repo.id]?.total || repo.sync_total} files
                      </span>
                    )}
                  </div>
                  <Progress
                    value={repoProgress[repo.id]?.progress || repo.sync_progress || 0}
                    max={repoProgress[repo.id]?.total || repo.sync_total || 100}
                    className="h-2"
                  />
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {repo.last_synced_at ? (
                    <>Last synced: {formatRelativeTime(repo.last_synced_at)}</>
                  ) : (
                    <>Not synced yet</>
                  )}
                  {repo.sync_error && (
                    <span className="text-destructive ml-2">Error: {repo.sync_error}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSync(repo.id)}
                    disabled={isSyncing}
                  >
                    {isSyncing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    {isSyncing ? 'Syncing...' : 'Sync Now'}
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" disabled={isDeleting}>
                        {isDeleting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove Repository</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to remove {repo.owner}/{repo.name} from this project?
                          All indexed content will be deleted. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(repo.id)}>
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
