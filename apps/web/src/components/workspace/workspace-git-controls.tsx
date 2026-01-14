'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { useGitStatus } from '@/hooks/use-git-status'
import {
  GitBranchIcon,
  GitCommitIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  RefreshCwIcon,
  Loader2Icon,
  CheckIcon,
  AlertCircleIcon,
  Cloud,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GitHubCodespace } from '@/lib/github'

export interface WorkspaceGitControlsProps {
  cloneId: string | null
  projectId: string
  codespace?: GitHubCodespace | null
  onRefresh?: () => void
}

export function WorkspaceGitControls({
  cloneId,
  projectId,
  codespace,
  onRefresh,
}: WorkspaceGitControlsProps) {
  const { toast } = useToast()

  // Use local clone status if available, otherwise use codespace status
  const { status, isLoading, error, refresh } = useGitStatus({
    cloneId,
    projectId,
    enabled: !!cloneId,
  })

  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [isPulling, setIsPulling] = useState(false)
  const [showCommitDialog, setShowCommitDialog] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')

  const handleCommit = async () => {
    if (!cloneId || !commitMessage.trim()) return

    setIsCommitting(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/workspace/clones/${cloneId}/git/commit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: commitMessage.trim() }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to commit')
      }

      const result = await response.json()
      toast({
        title: 'Committed successfully',
        description: `SHA: ${result.commit_sha?.slice(0, 7)}`,
      })
      setCommitMessage('')
      setShowCommitDialog(false)
      refresh()
      onRefresh?.()
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Commit failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setIsCommitting(false)
    }
  }

  const handlePush = async () => {
    if (!cloneId) return

    setIsPushing(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/workspace/clones/${cloneId}/git/push`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to push')
      }

      const result = await response.json()
      toast({
        title: 'Pushed successfully',
        description: result.message || 'Changes pushed to remote',
      })
      refresh()
      onRefresh?.()
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Push failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setIsPushing(false)
    }
  }

  const handlePull = async () => {
    if (!cloneId) return

    setIsPulling(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/workspace/clones/${cloneId}/git/pull`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to pull')
      }

      const result = await response.json()
      toast({
        title: 'Pulled successfully',
        description: `${result.updated_files?.length || 0} files updated`,
      })
      refresh()
      onRefresh?.()
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Pull failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setIsPulling(false)
    }
  }

  // If using codespace without local clone
  if (!cloneId && codespace) {
    const gitStatus = codespace.git_status
    const hasUncommittedChanges = gitStatus?.has_uncommitted_changes
    const hasUnpushedChanges = gitStatus?.has_unpushed_changes
    const ahead = gitStatus?.ahead || 0
    const behind = gitStatus?.behind || 0

    return (
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        {/* Codespace indicator */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5">
                <Cloud className="h-3.5 w-3.5 text-green-500" />
                <GitBranchIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium truncate max-w-[100px]">
                  {gitStatus?.ref || 'main'}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Codespace: {codespace.display_name || codespace.name}</p>
              <p className="text-xs text-muted-foreground">Branch: {gitStatus?.ref}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Status badges */}
        <div className="flex items-center gap-1">
          {hasUncommittedChanges && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
              uncommitted
            </Badge>
          )}
          {hasUnpushedChanges && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 bg-blue-500/10 text-blue-600 border-blue-500/30">
              unpushed
            </Badge>
          )}
          {ahead > 0 && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 bg-green-500/10 text-green-600 border-green-500/30">
              <ArrowUpIcon className="h-2.5 w-2.5 mr-0.5" />
              {ahead}
            </Badge>
          )}
          {behind > 0 && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 bg-orange-500/10 text-orange-600 border-orange-500/30">
              <ArrowDownIcon className="h-2.5 w-2.5 mr-0.5" />
              {behind}
            </Badge>
          )}
        </div>

        <div className="flex-1" />

        {/* Open in browser */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => window.open(codespace.web_url, '_blank')}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Open
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open codespace in browser to manage git</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    )
  }

  // No clone and no codespace
  if (!cloneId) {
    return (
      <div className="flex items-center justify-center px-3 py-2 border-b bg-muted/30">
        <span className="text-xs text-muted-foreground">No repository connected</span>
      </div>
    )
  }

  // Using local clone
  const canCommit = status?.isDirty
  const canPush = status && status.aheadCount > 0
  const canPull = status && status.behindCount > 0

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        {/* Branch info */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5">
                <GitBranchIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium truncate max-w-[100px]">
                  {status?.currentBranch || 'loading...'}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Current branch: {status?.currentBranch}</p>
              {status?.currentSha && (
                <p className="text-xs text-muted-foreground">
                  SHA: {status.currentSha.slice(0, 7)}
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Status badges */}
        <div className="flex items-center gap-1">
          {status?.isDirty && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
              dirty
            </Badge>
          )}
          {status && status.aheadCount > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-[10px] px-1 py-0 bg-green-500/10 text-green-600 border-green-500/30">
                    <ArrowUpIcon className="h-2.5 w-2.5 mr-0.5" />
                    {status.aheadCount}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{status.aheadCount} commits ahead of remote</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {status && status.behindCount > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-[10px] px-1 py-0 bg-blue-500/10 text-blue-600 border-blue-500/30">
                    <ArrowDownIcon className="h-2.5 w-2.5 mr-0.5" />
                    {status.behindCount}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{status.behindCount} commits behind remote</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        <div className="flex-1" />

        {/* Error indicator */}
        {error && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertCircleIcon className="h-3.5 w-3.5 text-red-500" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs text-red-500">{error}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {/* Refresh */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => refresh()}
                  disabled={isLoading}
                >
                  <RefreshCwIcon className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh status</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Pull */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-6 px-2 text-xs',
                    canPull && 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'
                  )}
                  onClick={handlePull}
                  disabled={isPulling || !status}
                >
                  {isPulling ? (
                    <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <ArrowDownIcon className="h-3.5 w-3.5 mr-1" />
                      Pull
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {canPull
                  ? `Pull ${status?.behindCount} commits from remote`
                  : 'Up to date with remote'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Commit */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-6 px-2 text-xs',
                    canCommit && 'text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50'
                  )}
                  onClick={() => setShowCommitDialog(true)}
                  disabled={!canCommit}
                >
                  <GitCommitIcon className="h-3.5 w-3.5 mr-1" />
                  Commit
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {canCommit ? 'Commit local changes' : 'No changes to commit'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Push */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-6 px-2 text-xs',
                    canPush && 'text-green-600 hover:text-green-700 hover:bg-green-50'
                  )}
                  onClick={handlePush}
                  disabled={isPushing || !canPush}
                >
                  {isPushing ? (
                    <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <ArrowUpIcon className="h-3.5 w-3.5 mr-1" />
                      Push
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {canPush
                  ? `Push ${status?.aheadCount} commits to remote`
                  : 'No commits to push'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Commit dialog */}
      <Dialog open={showCommitDialog} onOpenChange={setShowCommitDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Commit Changes</DialogTitle>
            <DialogDescription>
              Enter a commit message for your changes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Changed files summary */}
            {status && (
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">
                  {(status.modifiedFiles?.length || 0) +
                    (status.stagedFiles?.length || 0) +
                    (status.untrackedFiles?.length || 0)}{' '}
                  files
                </span>{' '}
                will be committed
              </div>
            )}
            <Input
              placeholder="Commit message..."
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && commitMessage.trim()) {
                  handleCommit()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCommitDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCommit}
              disabled={isCommitting || !commitMessage.trim()}
            >
              {isCommitting ? (
                <>
                  <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                  Committing...
                </>
              ) : (
                <>
                  <CheckIcon className="h-4 w-4 mr-2" />
                  Commit
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
