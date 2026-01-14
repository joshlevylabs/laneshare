'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { formatRelativeTime } from '@laneshare/shared'
import { Progress } from '@/components/ui/progress'
import { GitBranch, RefreshCw, Trash2, Loader2, ExternalLink, Bell, BellOff, FileText, Sparkles, CheckCircle, AlertCircle, X, AlertTriangle } from 'lucide-react'
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

interface DocGenProgress {
  stage: 'starting' | 'calling_api' | 'parsing' | 'continuation' | 'complete' | 'error'
  message: string
  pagesGenerated: number
  round: number
  maxRounds: number
  continuationAttempt?: number
  lastUpdated?: string
}

export function ReposList({ repos, projectId }: ReposListProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [syncingRepos, setSyncingRepos] = useState<Set<string>>(new Set())
  const [deletingRepos, setDeletingRepos] = useState<Set<string>>(new Set())
  const [togglingAutoSync, setTogglingAutoSync] = useState<Set<string>>(new Set())
  const [generatingDocs, setGeneratingDocs] = useState<Set<string>>(new Set())
  const [cancellingDocs, setCancellingDocs] = useState<Set<string>>(new Set())
  const [repoProgress, setRepoProgress] = useState<Record<string, SyncProgress>>({})
  const [docGenProgress, setDocGenProgress] = useState<Record<string, DocGenProgress>>({})

  // Check if progress is stale (no update for more than 2 minutes)
  const isProgressStale = (progress: DocGenProgress | undefined): boolean => {
    if (!progress?.lastUpdated) return false
    const lastUpdate = new Date(progress.lastUpdated).getTime()
    const now = Date.now()
    return now - lastUpdate > 2 * 60 * 1000 // 2 minutes
  }

  // Poll for progress on repos that are already generating
  const pollGeneratingRepo = useCallback(async (repoId: string, bundleId: string | null) => {
    if (!bundleId) return

    try {
      const [statusRes, bundleRes] = await Promise.all([
        fetch(`/api/repos/${repoId}`),
        fetch(`/api/projects/${projectId}/repos/${repoId}/docs/bundles/${bundleId}`),
      ])

      if (statusRes.ok) {
        const repo = await statusRes.json()

        // Update progress from bundle if available
        if (bundleRes.ok) {
          const bundle = await bundleRes.json()
          if (bundle.progress_json) {
            setDocGenProgress((prev) => ({
              ...prev,
              [repoId]: bundle.progress_json,
            }))
          }
        }

        // Check if still generating
        if (repo.doc_status === 'GENERATING') {
          setTimeout(() => pollGeneratingRepo(repoId, bundleId), 2000)
        } else {
          // Generation finished - clear state and refresh
          setGeneratingDocs((prev) => {
            const next = new Set(prev)
            next.delete(repoId)
            return next
          })
          setDocGenProgress((prev) => {
            const next = { ...prev }
            delete next[repoId]
            return next
          })
          router.refresh()
        }
      }
    } catch (error) {
      console.error('Error polling repo status:', error)
    }
  }, [projectId, router])

  // Start polling for repos that are already in GENERATING state on mount
  useEffect(() => {
    repos.forEach((repo) => {
      if (repo.doc_status === 'GENERATING' && repo.doc_bundle_id && !generatingDocs.has(repo.id)) {
        // Add to generating set and start polling
        setGeneratingDocs((prev) => new Set(prev).add(repo.id))
        pollGeneratingRepo(repo.id, repo.doc_bundle_id)
      }
    })
  }, [repos, pollGeneratingRepo, generatingDocs])

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

  const getDocStageLabel = (progress: DocGenProgress | undefined): string => {
    if (!progress) return 'Generating documentation...'
    switch (progress.stage) {
      case 'starting':
        return 'Initializing...'
      case 'calling_api':
        return `Round ${progress.round}/${progress.maxRounds}: Analyzing repository...`
      case 'parsing':
        return `Round ${progress.round}/${progress.maxRounds}: Processing response...`
      case 'continuation':
        return `Continuation ${progress.continuationAttempt}: Generating more pages...`
      case 'complete':
        return 'Saving documentation...'
      case 'error':
        return 'Error occurred'
      default:
        return progress.message || 'Generating documentation...'
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

  const handleGenerateDocs = async (repoId: string, force: boolean = false) => {
    setGeneratingDocs((prev) => new Set(prev).add(repoId))

    try {
      const response = await fetch(`/api/projects/${projectId}/repos/${repoId}/docs/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
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

        // Poll for completion and progress
        const checkStatus = async () => {
          // Fetch both repo status and bundle progress
          const [statusRes, bundleRes] = await Promise.all([
            fetch(`/api/repos/${repoId}`),
            data.bundle_id
              ? fetch(`/api/projects/${projectId}/repos/${repoId}/docs/bundles/${data.bundle_id}`)
              : Promise.resolve(null),
          ])

          if (statusRes.ok) {
            const repo = await statusRes.json()

            // Update progress from bundle if available
            if (bundleRes && bundleRes.ok) {
              const bundle = await bundleRes.json()
              if (bundle.progress_json) {
                setDocGenProgress((prev) => ({
                  ...prev,
                  [repoId]: bundle.progress_json,
                }))
              }
            }

            if (repo.doc_status === 'READY' || repo.doc_status === 'NEEDS_REVIEW' || repo.doc_status === 'ERROR') {
              setGeneratingDocs((prev) => {
                const next = new Set(prev)
                next.delete(repoId)
                return next
              })
              setDocGenProgress((prev) => {
                const next = { ...prev }
                delete next[repoId]
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
          setTimeout(checkStatus, 2000) // Poll more frequently for progress updates
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

  const handleCancelDocs = async (repoId: string) => {
    setCancellingDocs((prev) => new Set(prev).add(repoId))

    try {
      const response = await fetch(`/api/projects/${projectId}/repos/${repoId}/docs/cancel`, {
        method: 'POST',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel documentation generation')
      }

      // Clear local state
      setGeneratingDocs((prev) => {
        const next = new Set(prev)
        next.delete(repoId)
        return next
      })
      setDocGenProgress((prev) => {
        const next = { ...prev }
        delete next[repoId]
        return next
      })

      toast({
        title: 'Generation Cancelled',
        description: 'Documentation generation has been stopped.',
      })

      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to cancel',
      })
    } finally {
      setCancellingDocs((prev) => {
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

              {/* Progress bar when generating docs */}
              {(generatingDocs.has(repo.id) || repo.doc_status === 'GENERATING') && (
                <div className="space-y-2 bg-gray-50 dark:bg-gray-900/50 p-3 rounded-md border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-300 flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                      {getDocStageLabel(docGenProgress[repo.id])}
                    </span>
                    <div className="flex items-center gap-2">
                      {docGenProgress[repo.id]?.pagesGenerated !== undefined && docGenProgress[repo.id].pagesGenerated > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {docGenProgress[repo.id].pagesGenerated} pages
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                        onClick={() => handleCancelDocs(repo.id)}
                        disabled={cancellingDocs.has(repo.id)}
                        title="Cancel generation"
                      >
                        {cancellingDocs.has(repo.id) ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  {/* Stale progress warning */}
                  {isProgressStale(docGenProgress[repo.id]) && (
                    <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 p-2 rounded">
                      <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                      <span>Progress appears stale. The process may have stopped.</span>
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs text-amber-700 dark:text-amber-300 underline"
                        onClick={() => handleCancelDocs(repo.id)}
                      >
                        Cancel and retry
                      </Button>
                    </div>
                  )}
                  {docGenProgress[repo.id]?.message && !isProgressStale(docGenProgress[repo.id]) && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {docGenProgress[repo.id].message}
                    </p>
                  )}
                  {/* Progress indicator - indeterminate animated bar */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full animate-progress-indeterminate"
                        style={{ width: '30%' }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap font-medium">
                      Round {docGenProgress[repo.id]?.round || 1}/{docGenProgress[repo.id]?.maxRounds || 3}
                    </span>
                  </div>
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

                      {/* View Docs and Regenerate buttons - when docs are ready */}
                      {(repo.doc_status === 'READY' || repo.doc_status === 'NEEDS_REVIEW') && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleGenerateDocs(repo.id, true)}
                            disabled={generatingDocs.has(repo.id)}
                            title="Regenerate documentation from scratch"
                          >
                            {generatingDocs.has(repo.id) ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Regenerating...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Regenerate
                              </>
                            )}
                          </Button>
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
                        </>
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
