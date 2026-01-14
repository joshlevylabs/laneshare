'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { formatRelativeTime } from '@laneshare/shared'
import { Progress } from '@/components/ui/progress'
import { GitBranch, RefreshCw, Trash2, Loader2, ExternalLink, Bell, BellOff, FileText, Sparkles, CheckCircle, AlertCircle } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
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
  selected_branch: string | null
  status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR'
  last_synced_at: string | null
  sync_error: string | null
  installed_at: string
  sync_progress: number | null
  sync_total: number | null
  sync_stage: 'discovering' | 'indexing' | 'embedding' | null
  has_updates: boolean
  auto_sync_enabled: boolean
  last_synced_commit_sha: string | null
  latest_commit_sha: string | null
  doc_status: 'PENDING' | 'GENERATING' | 'READY' | 'NEEDS_REVIEW' | 'ERROR' | null
  doc_bundle_id: string | null
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
  const [togglingAutoSync, setTogglingAutoSync] = useState<Set<string>>(new Set())
  const [generatingDocs, setGeneratingDocs] = useState<Set<string>>(new Set())
  const [repoProgress, setRepoProgress] = useState<Record<string, SyncProgress>>({})

  const getStageLabel = (stage: string | null): string => {
    switch (stage) {
      case 'discovering':
        return 'Discovering files...'
      case 'indexing':
        return 'Indexing files...'
      case 'embedding':
        return 'Generating embeddings...'
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

  const handleToggleAutoSync = async (repoId: string, currentValue: boolean) => {
    setTogglingAutoSync((prev) => new Set(prev).add(repoId))

    try {
      const response = await fetch(`/api/repos/${repoId}/auto-sync`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSyncEnabled: !currentValue }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to update auto-sync setting')
      }

      toast({
        title: !currentValue ? 'Auto-sync Enabled' : 'Auto-sync Disabled',
        description: !currentValue
          ? 'Repository will automatically sync when new commits are pushed.'
          : 'You will need to manually sync to get updates.',
      })

      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update auto-sync',
      })
    } finally {
      setTogglingAutoSync((prev) => {
        const next = new Set(prev)
        next.delete(repoId)
        return next
      })
    }
  }

  const handleGenerateDocs = async (repoId: string) => {
    setGeneratingDocs((prev) => new Set(prev).add(repoId))

    try {
      const response = await fetch(`/api/projects/${projectId}/repos/${repoId}/docs/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate documentation')
      }

      if (data.skipped) {
        toast({
          title: 'Documentation Up to Date',
          description: 'No changes detected since last generation.',
        })
        setGeneratingDocs((prev) => {
          const next = new Set(prev)
          next.delete(repoId)
          return next
        })
      } else {
        toast({
          title: 'Generation Started',
          description: 'Documentation generation is in progress. This may take a few minutes.',
        })

        // Poll for completion
        const checkStatus = async () => {
          const statusRes = await fetch(`/api/repos/${repoId}`)
          if (statusRes.ok) {
            const repo = await statusRes.json()
            if (repo.doc_status === 'READY' || repo.doc_status === 'NEEDS_REVIEW' || repo.doc_status === 'ERROR') {
              setGeneratingDocs((prev) => {
                const next = new Set(prev)
                next.delete(repoId)
                return next
              })
              router.refresh()

              if (repo.doc_status === 'ERROR') {
                toast({
                  variant: 'destructive',
                  title: 'Documentation Generation Failed',
                  description: 'An error occurred while generating documentation.',
                })
              } else {
                toast({
                  title: 'Documentation Ready',
                  description: 'Click "View Docs" to see the generated documentation.',
                })
              }
              return
            }
          }
          setTimeout(checkStatus, 3000)
        }
        checkStatus()
      }
    } catch (error) {
      setGeneratingDocs((prev) => {
        const next = new Set(prev)
        next.delete(repoId)
        return next
      })
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to generate documentation',
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
        const isTogglingAutoSync = togglingAutoSync.has(repo.id)
        const branch = repo.selected_branch || repo.default_branch

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
                      Branch: {branch} • Added {formatRelativeTime(repo.installed_at)}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {repo.has_updates && !isSyncing && (
                    <Badge variant="outline" className="border-blue-500 text-blue-500">
                      Update available
                    </Badge>
                  )}
                  {/* Doc status badge */}
                  {repo.doc_status === 'READY' && (
                    <Badge variant="outline" className="border-green-500 text-green-500 gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Docs Ready
                    </Badge>
                  )}
                  {repo.doc_status === 'NEEDS_REVIEW' && (
                    <Badge variant="outline" className="border-yellow-500 text-yellow-500 gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Docs Need Review
                    </Badge>
                  )}
                  {repo.doc_status === 'GENERATING' && (
                    <Badge variant="outline" className="border-purple-500 text-purple-500 gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Generating Docs
                    </Badge>
                  )}
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
                <div className="flex flex-col gap-1">
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
                  {/* Auto-sync toggle */}
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`auto-sync-${repo.id}`}
                      checked={repo.auto_sync_enabled}
                      disabled={isTogglingAutoSync}
                      onCheckedChange={() => handleToggleAutoSync(repo.id, repo.auto_sync_enabled)}
                    />
                    <Label
                      htmlFor={`auto-sync-${repo.id}`}
                      className="text-sm text-muted-foreground cursor-pointer flex items-center gap-1"
                    >
                      {isTogglingAutoSync ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : repo.auto_sync_enabled ? (
                        <Bell className="h-3 w-3" />
                      ) : (
                        <BellOff className="h-3 w-3" />
                      )}
                      Auto-sync {repo.auto_sync_enabled ? 'enabled' : 'disabled'}
                    </Label>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Docs Buttons - Split into Generate and View */}
                  {repo.status === 'SYNCED' && (
                    <>
                      {/* Generate Docs button - only when no docs or error */}
                      {(!repo.doc_status || repo.doc_status === 'PENDING' || repo.doc_status === 'ERROR') && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleGenerateDocs(repo.id)}
                          disabled={generatingDocs.has(repo.id)}
                        >
                          {generatingDocs.has(repo.id) ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <Sparkles className="mr-2 h-4 w-4" />
                              Generate Docs
                            </>
                          )}
                        </Button>
                      )}

                      {/* Generating status */}
                      {repo.doc_status === 'GENERATING' && !generatingDocs.has(repo.id) && (
                        <Button variant="outline" size="sm" disabled>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Generating...
                        </Button>
                      )}

                      {/* View Docs button - when docs are ready */}
                      {(repo.doc_status === 'READY' || repo.doc_status === 'NEEDS_REVIEW') && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => router.push(`/projects/${projectId}/repos/${repo.id}/docs`)}
                        >
                          {repo.doc_status === 'NEEDS_REVIEW' ? (
                            <>
                              <AlertCircle className="mr-2 h-4 w-4" />
                              Review Docs
                            </>
                          ) : (
                            <>
                              <FileText className="mr-2 h-4 w-4" />
                              View Docs
                            </>
                          )}
                        </Button>
                      )}
                    </>
                  )}

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
