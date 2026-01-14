'use client'

import { useState } from 'react'
import { useCollaboration } from '@/hooks/use-collaboration'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  UsersIcon,
  GitBranchIcon,
  GitMergeIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  Loader2Icon,
  RefreshCwIcon,
  FileEditIcon,
  ZapIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'

export interface WorkspaceCollaborationPanelProps {
  projectId: string
  sessionId?: string
}

export function WorkspaceCollaborationPanel({
  projectId,
  sessionId,
}: WorkspaceCollaborationPanelProps) {
  const {
    session,
    branches,
    recentEdits,
    pendingConflicts,
    activeMerge,
    isConnected,
    error,
    triggerMerge,
    refresh,
  } = useCollaboration({ projectId, sessionId })

  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const [isMerging, setIsMerging] = useState(false)

  const handleMerge = async () => {
    setIsMerging(true)
    try {
      await triggerMerge()
      setShowMergeDialog(false)
    } finally {
      setIsMerging(false)
    }
  }

  const activeBranches = branches.filter((b) => b.status === 'ACTIVE')
  const hasConflicts = pendingConflicts.length > 0

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="flex items-center gap-2">
            <UsersIcon className="h-4 w-4" />
            <span className="font-medium text-sm">Collaboration</span>
            {/* Connection status */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      'w-2 h-2 rounded-full',
                      isConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{isConnected ? 'Connected' : 'Reconnecting...'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={refresh}>
                    <RefreshCwIcon className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Active agents section */}
        <div className="px-3 py-2 border-b">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">Active Agents</span>
            <Badge variant="secondary" className="text-[10px]">
              {activeBranches.length}
            </Badge>
          </div>
          {activeBranches.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active agents</p>
          ) : (
            <div className="space-y-1">
              {activeBranches.map((branch) => (
                <div
                  key={branch.id}
                  className="flex items-center gap-2 p-1.5 rounded bg-muted/50"
                >
                  <GitBranchIcon className="h-3 w-3 text-blue-500" />
                  <span className="text-xs truncate flex-1">{branch.name}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] px-1 py-0',
                      branch.status === 'ACTIVE'
                        ? 'bg-green-500/10 text-green-600'
                        : branch.status === 'MERGING'
                        ? 'bg-yellow-500/10 text-yellow-600'
                        : ''
                    )}
                  >
                    {branch.status.toLowerCase()}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Conflicts section */}
        {hasConflicts && (
          <div className="px-3 py-2 border-b bg-yellow-50 dark:bg-yellow-950/30">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangleIcon className="h-4 w-4 text-yellow-600" />
              <span className="text-xs font-medium text-yellow-700 dark:text-yellow-400">
                Conflicts Detected
              </span>
              <Badge variant="destructive" className="text-[10px] ml-auto">
                {pendingConflicts.length}
              </Badge>
            </div>
            <div className="space-y-1">
              {pendingConflicts.slice(0, 3).map((conflict, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <FileEditIcon className="h-3 w-3 text-yellow-600" />
                  <span className="truncate text-yellow-700 dark:text-yellow-400">
                    {conflict.filePath.split('/').pop()}
                  </span>
                  <span className="text-yellow-600 text-[10px]">
                    ({conflict.branches.length} agents)
                  </span>
                </div>
              ))}
              {pendingConflicts.length > 3 && (
                <p className="text-[10px] text-yellow-600">
                  +{pendingConflicts.length - 3} more files
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2 h-7 text-xs bg-yellow-100 dark:bg-yellow-900/50 border-yellow-300 dark:border-yellow-700"
              onClick={() => setShowMergeDialog(true)}
              disabled={isMerging}
            >
              {isMerging ? (
                <>
                  <Loader2Icon className="h-3 w-3 mr-1 animate-spin" />
                  Merging...
                </>
              ) : (
                <>
                  <GitMergeIcon className="h-3 w-3 mr-1" />
                  Resolve with Integrator
                </>
              )}
            </Button>
          </div>
        )}

        {/* Active merge indicator */}
        {activeMerge && (
          <div className="px-3 py-2 border-b bg-blue-50 dark:bg-blue-950/30">
            <div className="flex items-center gap-2">
              <Loader2Icon className="h-4 w-4 text-blue-600 animate-spin" />
              <span className="text-xs font-medium text-blue-700 dark:text-blue-400">
                Integrator merging {activeMerge.filesMerged?.length || 0} files...
              </span>
            </div>
          </div>
        )}

        {/* Recent edits */}
        <div className="flex-1 overflow-hidden">
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Recent Activity</span>
            <Badge variant="secondary" className="text-[10px]">
              {recentEdits.length}
            </Badge>
          </div>
          <ScrollArea className="h-[calc(100%-2rem)]">
            <div className="px-3 space-y-1">
              {recentEdits.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No recent activity
                </p>
              ) : (
                recentEdits.slice(0, 20).map((edit) => (
                  <div
                    key={edit.id}
                    className="flex items-start gap-2 p-1.5 rounded hover:bg-muted/50"
                  >
                    <ZapIcon className="h-3 w-3 text-purple-500 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono truncate">{edit.filePath}</p>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{edit.operation}</span>
                        {edit.linesAdded > 0 && (
                          <span className="text-green-600">+{edit.linesAdded}</span>
                        )}
                        {edit.linesRemoved > 0 && (
                          <span className="text-red-600">-{edit.linesRemoved}</span>
                        )}
                        <span>
                          {formatDistanceToNow(new Date(edit.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Error display */}
        {error && (
          <div className="px-3 py-2 border-t bg-red-50 dark:bg-red-950/30">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}
      </div>

      {/* Merge confirmation dialog */}
      <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitMergeIcon className="h-5 w-5" />
              Run Integrator Agent
            </DialogTitle>
            <DialogDescription>
              The Integrator Agent will analyze conflicting changes from{' '}
              {activeBranches.length} agents and semantically merge them.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <h4 className="text-sm font-medium mb-2">Files with conflicts:</h4>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {pendingConflicts.map((conflict, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded bg-muted">
                  <FileEditIcon className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm font-mono truncate flex-1">
                    {conflict.filePath}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {conflict.branches.length} versions
                  </Badge>
                </div>
              ))}
            </div>

            <div className="mt-4 p-3 rounded bg-blue-50 dark:bg-blue-950/30">
              <h4 className="text-sm font-medium text-blue-700 dark:text-blue-400 mb-1">
                What the Integrator will do:
              </h4>
              <ul className="text-xs text-blue-600 dark:text-blue-400 space-y-1">
                <li>• Analyze each agent's changes and understand their intent</li>
                <li>• Merge changes semantically (not just line-by-line)</li>
                <li>• Refactor code if needed to accommodate all changes</li>
                <li>• Explain its merge decisions</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMergeDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleMerge} disabled={isMerging}>
              {isMerging ? (
                <>
                  <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                  Merging...
                </>
              ) : (
                <>
                  <CheckCircleIcon className="h-4 w-4 mr-2" />
                  Run Integrator
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
