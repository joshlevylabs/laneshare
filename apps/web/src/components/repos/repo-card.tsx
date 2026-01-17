'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { formatRelativeTime } from '@laneshare/shared'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  GitBranch,
  RefreshCw,
  Trash2,
  Loader2,
  ExternalLink,
  Bell,
  BellOff,
  FileText,
  Sparkles,
  CheckCircle,
  AlertCircle,
  X,
  AlertTriangle,
  Cloud,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Settings,
  Play,
  Wand2,
  Rocket,
} from 'lucide-react'
import { RepoCodespacesPanel } from './repo-codespaces-panel'
import { DocGenerationProgress } from '../repo-docs/doc-generation-progress'
import type { DocType, DocJobStatus, DocGenerationPhase } from '@laneshare/shared'

export interface Repo {
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
  has_codespaces_token: boolean
}

interface SyncProgress {
  progress: number
  total: number
  stage: string | null
}

// Legacy mode progress
interface LegacyDocGenProgress {
  mode?: 'legacy'
  stage: 'starting' | 'calling_api' | 'parsing' | 'continuation' | 'complete' | 'error'
  message: string
  pagesGenerated: number
  round: number
  maxRounds: number
  continuationAttempt?: number
  lastUpdated?: string
}

// Parallel mode progress (matches DocGenerationSession)
interface ParallelDocGenProgress {
  mode?: 'parallel'
  phase: 'context' | 'agents_summary' | 'parallel' | 'assembly' | 'complete' | 'error'
  jobs: Record<string, {
    status: 'pending' | 'running' | 'completed' | 'failed'
    startedAt?: string
    completedAt?: string
    error?: string
  }>
  pagesGenerated: number
  totalPages: number
  startedAt?: string
  lastUpdated?: string
}

type DocGenProgress = LegacyDocGenProgress | ParallelDocGenProgress

// Type guard for parallel progress
function isParallelProgress(progress: DocGenProgress | null): progress is ParallelDocGenProgress {
  return progress !== null && 'phase' in progress
}

interface RepoCardProps {
  repo: Repo
  projectId: string
}

export function RepoCard({ repo, projectId }: RepoCardProps) {
  const { toast } = useToast()
  const router = useRouter()

  // Local state
  const [isSyncing, setIsSyncing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isTogglingAutoSync, setIsTogglingAutoSync] = useState(false)
  const [isGeneratingDocs, setIsGeneratingDocs] = useState(false)
  const [isCancellingDocs, setIsCancellingDocs] = useState(false)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)
  const [docGenProgress, setDocGenProgress] = useState<DocGenProgress | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showCodespaceRequiredDialog, setShowCodespaceRequiredDialog] = useState(false)
  const [pendingForceGenerate, setPendingForceGenerate] = useState(false)

  // Collapsible sections
  const [isDocsOpen, setIsDocsOpen] = useState(
    repo.doc_status === 'GENERATING' ||
    repo.doc_status === 'NEEDS_REVIEW' ||
    repo.status === 'SYNCED' && !repo.doc_status
  )
  const [isCodespacesOpen, setIsCodespacesOpen] = useState(repo.has_codespaces_token)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)

  const branch = repo.selected_branch || repo.default_branch
  const isCurrentlySyncing = isSyncing || repo.status === 'SYNCING'
  const isCurrentlyGenerating = isGeneratingDocs || repo.doc_status === 'GENERATING'

  // Check if progress is stale (no update for more than 3 minutes for parallel mode)
  const isProgressStale = (progress: DocGenProgress | null): boolean => {
    if (!progress) return false
    const lastUpdated = isParallelProgress(progress) ? progress.lastUpdated : progress.lastUpdated
    if (!lastUpdated) return false
    const lastUpdate = new Date(lastUpdated).getTime()
    const now = Date.now()
    // 3 minutes for parallel (since requests are staggered), 2 minutes for legacy
    const staleThreshold = isParallelProgress(progress) ? 3 * 60 * 1000 : 2 * 60 * 1000
    return now - lastUpdate > staleThreshold
  }

  // Convert progress to the format expected by DocGenerationProgress component
  const getParallelProgressForUI = (): {
    phase: DocGenerationPhase
    jobs: Record<DocType, { status: DocJobStatus; startedAt?: string; completedAt?: string; error?: string }>
    pagesGenerated: number
    totalPages: number
    startedAt?: string
    lastUpdated?: string
  } | null => {
    if (!docGenProgress || !isParallelProgress(docGenProgress)) return null
    return {
      phase: docGenProgress.phase as DocGenerationPhase,
      jobs: docGenProgress.jobs as Record<DocType, { status: DocJobStatus; startedAt?: string; completedAt?: string; error?: string }>,
      pagesGenerated: docGenProgress.pagesGenerated,
      totalPages: docGenProgress.totalPages,
      startedAt: docGenProgress.startedAt,
      lastUpdated: docGenProgress.lastUpdated,
    }
  }

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

  const getDocStageLabel = (progress: DocGenProgress | null): string => {
    if (!progress) return 'Generating documentation...'

    // Handle parallel mode
    if (isParallelProgress(progress)) {
      switch (progress.phase) {
        case 'context':
          return 'Gathering context...'
        case 'agents_summary':
          return 'Generating Agents Summary...'
        case 'parallel':
          const completed = progress.pagesGenerated
          const running = Object.values(progress.jobs).filter(j => j.status === 'running').length
          return `Generating ${running > 0 ? `(${running} in progress)` : ''}... ${completed}/${progress.totalPages}`
        case 'assembly':
          return 'Saving documentation...'
        case 'complete':
          return 'Complete'
        case 'error':
          return 'Error occurred'
        default:
          return 'Generating documentation...'
      }
    }

    // Handle legacy mode
    const legacyProgress = progress as LegacyDocGenProgress
    switch (legacyProgress.stage) {
      case 'starting':
        return 'Initializing...'
      case 'calling_api':
        return `Round ${legacyProgress.round}/${legacyProgress.maxRounds}: Analyzing...`
      case 'parsing':
        return `Round ${legacyProgress.round}/${legacyProgress.maxRounds}: Processing...`
      case 'continuation':
        return `Generating more pages...`
      case 'complete':
        return 'Saving documentation...'
      case 'error':
        return 'Error occurred'
      default:
        return legacyProgress.message || 'Generating documentation...'
    }
  }

  // Poll for doc generation progress
  const pollDocProgress = useCallback(async (bundleId: string | null) => {
    if (!bundleId) return

    try {
      const [statusRes, bundleRes] = await Promise.all([
        fetch(`/api/repos/${repo.id}`),
        fetch(`/api/projects/${projectId}/repos/${repo.id}/docs/bundles/${bundleId}`),
      ])

      if (statusRes.ok) {
        const repoData = await statusRes.json()

        if (bundleRes.ok) {
          const bundle = await bundleRes.json()
          if (bundle.progress_json) {
            setDocGenProgress(bundle.progress_json)
          }
        }

        if (repoData.doc_status === 'GENERATING') {
          setTimeout(() => pollDocProgress(bundleId), 2000)
        } else {
          setIsGeneratingDocs(false)
          setDocGenProgress(null)
          router.refresh()
        }
      }
    } catch (error) {
      console.error('Error polling doc progress:', error)
    }
  }, [repo.id, projectId, router])

  // Start polling if already generating on mount
  useEffect(() => {
    if (repo.doc_status === 'GENERATING' && repo.doc_bundle_id) {
      setIsGeneratingDocs(true)
      pollDocProgress(repo.doc_bundle_id)
    }
  }, [repo.doc_status, repo.doc_bundle_id, pollDocProgress])

  const handleSync = async () => {
    setIsSyncing(true)

    try {
      const response = await fetch(`/api/repos/${repo.id}/sync`, { method: 'POST' })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to sync repository')
      }

      toast({
        title: 'Sync Started',
        description: 'Repository sync has been initiated.',
      })

      // Poll for completion
      const checkStatus = async () => {
        const statusRes = await fetch(`/api/repos/${repo.id}`)
        if (statusRes.ok) {
          const repoData = await statusRes.json()

          if (repoData.status === 'SYNCING') {
            setSyncProgress({
              progress: repoData.sync_progress || 0,
              total: repoData.sync_total || 0,
              stage: repoData.sync_stage,
            })
            setTimeout(checkStatus, 1500)
          } else {
            setIsSyncing(false)
            setSyncProgress(null)
            router.refresh()
            if (repoData.status === 'ERROR') {
              toast({
                variant: 'destructive',
                title: 'Sync Failed',
                description: repoData.sync_error || 'An error occurred during sync',
              })
            }
          }
        }
      }
      checkStatus()
    } catch (error) {
      setIsSyncing(false)
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to sync',
      })
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/repos/${repo.id}`, { method: 'DELETE' })
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
        description: error instanceof Error ? error.message : 'Failed to delete',
      })
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
    }
  }

  const handleToggleAutoSync = async () => {
    setIsTogglingAutoSync(true)
    try {
      const response = await fetch(`/api/repos/${repo.id}/auto-sync`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSyncEnabled: !repo.auto_sync_enabled }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to update auto-sync')
      }
      toast({
        title: !repo.auto_sync_enabled ? 'Auto-sync Enabled' : 'Auto-sync Disabled',
        description: !repo.auto_sync_enabled
          ? 'Repository will automatically sync on new commits.'
          : 'Manual sync required for updates.',
      })
      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update',
      })
    } finally {
      setIsTogglingAutoSync(false)
    }
  }

  const handleGenerateDocs = async (force: boolean = false, allowApiFallback: boolean = false) => {
    setIsGeneratingDocs(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/repos/${repo.id}/docs/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force, mode: 'parallel', allowApiFallback }),
      })
      const data = await response.json()

      if (!response.ok) {
        // Check if this is a "needs Codespace" error
        if (data.needsCodespace) {
          setPendingForceGenerate(force)
          setShowCodespaceRequiredDialog(true)
          setIsGeneratingDocs(false)
          return
        }
        throw new Error(data.error || 'Failed to generate documentation')
      }

      if (data.skipped) {
        toast({
          title: 'Documentation Up to Date',
          description: 'No changes detected since last generation.',
        })
        setIsGeneratingDocs(false)
      } else {
        toast({
          title: 'Generation Started',
          description: allowApiFallback
            ? 'Documentation generation started using API mode (uses API credits).'
            : 'Documentation generation is in progress.',
        })
        pollDocProgress(data.bundle_id)
      }
    } catch (error) {
      setIsGeneratingDocs(false)
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to generate docs',
      })
    }
  }

  const handleUseApiFallback = () => {
    setShowCodespaceRequiredDialog(false)
    handleGenerateDocs(pendingForceGenerate, true)
  }

  const handleCancelDocs = async () => {
    setIsCancellingDocs(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/repos/${repo.id}/docs/cancel`, {
        method: 'POST',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to cancel')
      }
      setIsGeneratingDocs(false)
      setDocGenProgress(null)
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
      setIsCancellingDocs(false)
    }
  }

  return (
    <Card className="overflow-hidden">
      {/* Main Header */}
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          {/* Left: Repo info */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center flex-shrink-0">
              <GitBranch className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <a
                  href={`https://github.com/${repo.owner}/${repo.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-base hover:underline truncate inline-flex items-center gap-1"
                >
                  {repo.owner}/{repo.name}
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                </a>
              </div>
              <p className="text-sm text-muted-foreground">
                {branch} • Added {formatRelativeTime(repo.installed_at)}
              </p>
            </div>
          </div>

          {/* Right: Status badges and actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Status badges */}
            {repo.has_updates && !isCurrentlySyncing && (
              <Badge variant="outline" className="border-blue-500 text-blue-500">
                Update available
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
              {isCurrentlySyncing ? 'Syncing...' : repo.status}
            </Badge>

            {/* Quick actions dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleSync} disabled={isCurrentlySyncing}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${isCurrentlySyncing ? 'animate-spin' : ''}`} />
                  Sync Now
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleToggleAutoSync} disabled={isTogglingAutoSync}>
                  {repo.auto_sync_enabled ? (
                    <>
                      <BellOff className="h-4 w-4 mr-2" />
                      Disable Auto-sync
                    </>
                  ) : (
                    <>
                      <Bell className="h-4 w-4 mr-2" />
                      Enable Auto-sync
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remove Repository
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {/* Sync Progress */}
        {isCurrentlySyncing && (
          <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {getStageLabel(syncProgress?.stage || repo.sync_stage)}
              </span>
              {(syncProgress?.total || repo.sync_total || 0) > 0 && (
                <span className="text-muted-foreground">
                  {syncProgress?.progress || repo.sync_progress || 0} / {syncProgress?.total || repo.sync_total} files
                </span>
              )}
            </div>
            <Progress
              value={syncProgress?.progress || repo.sync_progress || 0}
              max={syncProgress?.total || repo.sync_total || 100}
              className="h-2"
            />
          </div>
        )}

        {/* Quick Action Buttons Row - only show essential actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Open Workspace button - prominent if codespaces configured */}
          {repo.has_codespaces_token && (
            <Button
              variant="default"
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => router.push(`/projects/${projectId}/workspace`)}
            >
              <Wand2 className="h-4 w-4 mr-2" />
              Open Workspace
            </Button>
          )}

          {/* Sync button for non-synced or error states */}
          {(repo.status === 'PENDING' || repo.status === 'ERROR') && (
            <Button variant="outline" size="sm" onClick={handleSync} disabled={isCurrentlySyncing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isCurrentlySyncing ? 'animate-spin' : ''}`} />
              {repo.status === 'ERROR' ? 'Retry Sync' : 'Start Sync'}
            </Button>
          )}
        </div>

        {/* Collapsible: Documentation */}
        {repo.status === 'SYNCED' && (
          <Collapsible open={isDocsOpen} onOpenChange={setIsDocsOpen}>
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2">
                  <FileText className={`h-4 w-4 ${
                    repo.doc_status === 'READY' ? 'text-green-500' :
                    repo.doc_status === 'NEEDS_REVIEW' ? 'text-yellow-500' :
                    repo.doc_status === 'GENERATING' || isCurrentlyGenerating ? 'text-purple-500' :
                    repo.doc_status === 'ERROR' ? 'text-red-500' :
                    'text-muted-foreground'
                  }`} />
                  <span className="text-sm font-medium">Documentation</span>
                  {repo.doc_status === 'READY' && (
                    <Badge variant="outline" className="text-xs border-green-500 text-green-600">
                      Ready
                    </Badge>
                  )}
                  {repo.doc_status === 'NEEDS_REVIEW' && (
                    <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-600">
                      Needs Review
                    </Badge>
                  )}
                  {(repo.doc_status === 'GENERATING' || isCurrentlyGenerating) && (
                    <Badge variant="outline" className="text-xs border-purple-500 text-purple-600 flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Generating
                    </Badge>
                  )}
                  {repo.doc_status === 'ERROR' && (
                    <Badge variant="destructive" className="text-xs">
                      Error
                    </Badge>
                  )}
                </div>
                {isDocsOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="p-3 bg-muted/30 rounded-lg space-y-3">
                {/* Generation Progress - Parallel Mode */}
                {isCurrentlyGenerating && isParallelProgress(docGenProgress) && (
                  <DocGenerationProgress
                    progress={getParallelProgressForUI()}
                    isGenerating={isCurrentlyGenerating}
                    onCancel={handleCancelDocs}
                    isCancelling={isCancellingDocs}
                  />
                )}

                {/* Generation Progress - Legacy Mode or no detailed progress */}
                {isCurrentlyGenerating && (!docGenProgress || !isParallelProgress(docGenProgress)) && (
                  <div className="space-y-2 p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg border border-purple-200 dark:border-purple-800">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-purple-700 dark:text-purple-300 flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {getDocStageLabel(docGenProgress)}
                      </span>
                      <div className="flex items-center gap-2">
                        {docGenProgress?.pagesGenerated !== undefined && docGenProgress.pagesGenerated > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {docGenProgress.pagesGenerated} pages
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-gray-500 hover:text-red-600"
                          onClick={handleCancelDocs}
                          disabled={isCancellingDocs}
                        >
                          {isCancellingDocs ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Stale Progress Warning */}
                {isCurrentlyGenerating && isProgressStale(docGenProgress) && (
                  <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/20 p-2 rounded">
                    <AlertTriangle className="h-3 w-3" />
                    <span>Progress appears stale.</span>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs underline"
                      onClick={handleCancelDocs}
                    >
                      Cancel and retry
                    </Button>
                  </div>
                )}

                {/* Action Buttons when not generating */}
                {!isCurrentlyGenerating && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* View/Review docs button - links to unified documents page */}
                    {(repo.doc_status === 'READY' || repo.doc_status === 'NEEDS_REVIEW') && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => router.push(`/projects/${projectId}/documents?repo=${repo.id}`)}
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        {repo.doc_status === 'NEEDS_REVIEW' ? 'Review Docs' : 'View Docs'}
                      </Button>
                    )}

                    {/* Generate or Regenerate */}
                    {repo.doc_status === 'READY' || repo.doc_status === 'NEEDS_REVIEW' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleGenerateDocs(true)}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Regenerate
                      </Button>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleGenerateDocs()}
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        Generate Docs
                      </Button>
                    )}
                  </div>
                )}

                {/* Error state */}
                {repo.doc_status === 'ERROR' && !isCurrentlyGenerating && (
                  <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/20 p-2 rounded flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    <span>Documentation generation failed.</span>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-sm underline text-red-600"
                      onClick={() => handleGenerateDocs(true)}
                    >
                      Retry
                    </Button>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Collapsible: Codespaces Setup */}
        <Collapsible open={isCodespacesOpen} onOpenChange={setIsCodespacesOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <Cloud className={`h-4 w-4 ${repo.has_codespaces_token ? 'text-green-500' : 'text-muted-foreground'}`} />
                <span className="text-sm font-medium">Codespaces & Workspace</span>
                {repo.has_codespaces_token && (
                  <Badge variant="outline" className="text-xs border-green-500 text-green-600">
                    Ready
                  </Badge>
                )}
              </div>
              {isCodespacesOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <RepoCodespacesPanel
              repo={repo}
              projectId={projectId}
              onTokenUpdated={() => router.refresh()}
            />
          </CollapsibleContent>
        </Collapsible>

        {/* Collapsible: Details & Settings */}
        <Collapsible open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Details & Settings</span>
              </div>
              {isDetailsOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="p-3 bg-muted/30 rounded-lg space-y-3">
              {/* Sync info */}
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
                  onCheckedChange={handleToggleAutoSync}
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

              {/* Doc status */}
              {repo.doc_status && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Documentation:</span>
                  {repo.doc_status === 'READY' && (
                    <Badge variant="outline" className="border-green-500 text-green-500 gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Ready
                    </Badge>
                  )}
                  {repo.doc_status === 'NEEDS_REVIEW' && (
                    <Badge variant="outline" className="border-yellow-500 text-yellow-500 gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Needs Review
                    </Badge>
                  )}
                  {repo.doc_status === 'ERROR' && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Error
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
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
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
              {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Codespace Required Dialog */}
      <AlertDialog open={showCodespaceRequiredDialog} onOpenChange={setShowCodespaceRequiredDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5" />
              Codespace Required
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Documentation generation uses Claude Code in headless mode, which requires an active
                Codespace with Claude Code running. This uses your Claude subscription instead of API credits.
              </p>
              <p className="text-sm">
                <strong>To use Claude Code:</strong> Open the "Codespaces & Workspace" section below
                and create a Codespace. Once Claude Code is running, try generating docs again.
              </p>
              <p className="text-sm text-muted-foreground">
                Alternatively, you can use API mode which will use API credits instead.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel onClick={() => setIsCodespacesOpen(true)}>
              Set Up Codespace
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleUseApiFallback}>
              Use API Mode (uses credits)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
