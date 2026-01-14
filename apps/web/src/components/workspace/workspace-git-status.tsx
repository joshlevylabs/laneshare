'use client'

import { useState } from 'react'
import { useGitStatus, GitFileStatus } from '@/hooks/use-git-status'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  FileIcon,
  FilePlusIcon,
  FileMinusIcon,
  FileEditIcon,
  FileQuestionIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  GitBranchIcon,
  DiffIcon,
  Loader2Icon,
  Cloud,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GitHubCodespace } from '@/lib/github'

export interface WorkspaceGitStatusProps {
  cloneId: string | null
  projectId: string
  codespace?: GitHubCodespace | null
}

function getStatusIcon(status: GitFileStatus['status']) {
  switch (status) {
    case 'added':
    case 'staged':
      return <FilePlusIcon className="h-3.5 w-3.5 text-green-500" />
    case 'deleted':
      return <FileMinusIcon className="h-3.5 w-3.5 text-red-500" />
    case 'modified':
      return <FileEditIcon className="h-3.5 w-3.5 text-yellow-500" />
    case 'renamed':
      return <FileIcon className="h-3.5 w-3.5 text-purple-500" />
    case 'untracked':
      return <FileQuestionIcon className="h-3.5 w-3.5 text-gray-400" />
    default:
      return <FileIcon className="h-3.5 w-3.5 text-muted-foreground" />
  }
}

function getStatusColor(status: GitFileStatus['status']) {
  switch (status) {
    case 'added':
    case 'staged':
      return 'text-green-600'
    case 'deleted':
      return 'text-red-600'
    case 'modified':
      return 'text-yellow-600'
    case 'renamed':
      return 'text-purple-600'
    case 'untracked':
      return 'text-gray-500'
    default:
      return 'text-muted-foreground'
  }
}

function FileStatusItem({
  file,
  onViewDiff,
}: {
  file: GitFileStatus
  onViewDiff: (path: string) => void
}) {
  const fileName = file.path.split('/').pop() || file.path
  const dirPath = file.path.slice(0, file.path.length - fileName.length - 1)

  return (
    <div className="group flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50">
      {getStatusIcon(file.status)}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className={cn('text-sm font-medium truncate', getStatusColor(file.status))}>
            {fileName}
          </span>
          {(file.additions !== undefined || file.deletions !== undefined) && (
            <span className="text-[10px] text-muted-foreground ml-1">
              {file.additions !== undefined && (
                <span className="text-green-600">+{file.additions}</span>
              )}
              {file.additions !== undefined && file.deletions !== undefined && ' '}
              {file.deletions !== undefined && (
                <span className="text-red-600">-{file.deletions}</span>
              )}
            </span>
          )}
        </div>
        {dirPath && (
          <p className="text-[10px] text-muted-foreground truncate">{dirPath}</p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
        onClick={() => onViewDiff(file.path)}
      >
        <DiffIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

function FileSection({
  title,
  files,
  defaultOpen = true,
  onViewDiff,
}: {
  title: string
  files: GitFileStatus[]
  defaultOpen?: boolean
  onViewDiff: (path: string) => void
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  if (files.length === 0) return null

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 w-full px-3 py-1.5 text-sm font-medium hover:bg-muted/50">
          {isOpen ? (
            <ChevronDownIcon className="h-3.5 w-3.5" />
          ) : (
            <ChevronRightIcon className="h-3.5 w-3.5" />
          )}
          {title}
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {files.length}
          </Badge>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {files.map((file) => (
          <FileStatusItem key={file.path} file={file} onViewDiff={onViewDiff} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function WorkspaceGitStatus({
  cloneId,
  projectId,
  codespace,
}: WorkspaceGitStatusProps) {
  const { status, isLoading, error } = useGitStatus({
    cloneId,
    projectId,
    enabled: !!cloneId,
  })

  const [showDiff, setShowDiff] = useState(false)
  const [diffPath, setDiffPath] = useState<string | null>(null)
  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [isDiffLoading, setIsDiffLoading] = useState(false)

  const handleViewDiff = async (path: string) => {
    if (!cloneId) return

    setDiffPath(path)
    setShowDiff(true)
    setIsDiffLoading(true)

    try {
      const response = await fetch(
        `/api/projects/${projectId}/workspace/clones/${cloneId}/git/diff?file_path=${encodeURIComponent(path)}`
      )

      if (!response.ok) {
        throw new Error('Failed to fetch diff')
      }

      const data = await response.json()
      setDiffContent(data.files?.[0]?.diff_content || 'No changes')
    } catch {
      setDiffContent('Failed to load diff')
    } finally {
      setIsDiffLoading(false)
    }
  }

  // Show codespace git status if no local clone
  if (!cloneId && codespace) {
    const gitStatus = codespace.git_status
    const hasChanges = gitStatus?.has_uncommitted_changes || gitStatus?.has_unpushed_changes

    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-green-500" />
            <span className="font-medium text-sm">Codespace Status</span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <GitBranchIcon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                Branch: <strong>{gitStatus?.ref || 'unknown'}</strong>
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {gitStatus?.has_uncommitted_changes && (
                <Badge variant="outline" className="text-yellow-600">
                  Uncommitted changes
                </Badge>
              )}
              {gitStatus?.has_unpushed_changes && (
                <Badge variant="outline" className="text-blue-600">
                  Unpushed commits
                </Badge>
              )}
              {gitStatus && gitStatus.ahead > 0 && (
                <Badge variant="outline" className="text-green-600">
                  {gitStatus.ahead} ahead
                </Badge>
              )}
              {gitStatus && gitStatus.behind > 0 && (
                <Badge variant="outline" className="text-orange-600">
                  {gitStatus.behind} behind
                </Badge>
              )}
              {!hasChanges && gitStatus?.ahead === 0 && gitStatus?.behind === 0 && (
                <Badge variant="secondary">Up to date</Badge>
              )}
            </div>

            <div className="pt-4">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => window.open(codespace.web_url, '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Codespace to manage changes
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Git operations are performed directly in the codespace
            </p>
          </div>
        </div>
      </div>
    )
  }

  // No clone and no codespace
  if (!cloneId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-muted-foreground">
        <GitBranchIcon className="h-8 w-8 mb-2" />
        <p className="text-sm text-center">No repository connected</p>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-red-500">
        <p className="text-sm text-center">{error}</p>
      </div>
    )
  }

  const hasChanges =
    (status?.modifiedFiles?.length || 0) +
      (status?.stagedFiles?.length || 0) +
      (status?.untrackedFiles?.length || 0) >
    0

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="flex items-center gap-2">
            <GitBranchIcon className="h-4 w-4" />
            <span className="font-medium text-sm">Changes</span>
          </div>
          {isLoading && <Loader2Icon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          {!status ? (
            <div className="flex items-center justify-center p-8">
              <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !hasChanges ? (
            <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
              <FileIcon className="h-6 w-6 mb-2 opacity-50" />
              <p className="text-xs text-center">No uncommitted changes</p>
            </div>
          ) : (
            <div className="py-1">
              <FileSection
                title="Staged"
                files={status.stagedFiles || []}
                onViewDiff={handleViewDiff}
              />
              <FileSection
                title="Modified"
                files={status.modifiedFiles || []}
                onViewDiff={handleViewDiff}
              />
              <FileSection
                title="Untracked"
                files={status.untrackedFiles || []}
                defaultOpen={false}
                onViewDiff={handleViewDiff}
              />
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Diff dialog */}
      <Dialog open={showDiff} onOpenChange={setShowDiff}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{diffPath}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 -mx-6 px-6">
            {isDiffLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2Icon className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <pre className="text-xs font-mono whitespace-pre-wrap p-4 bg-muted rounded">
                {diffContent?.split('\n').map((line, i) => {
                  let className = ''
                  if (line.startsWith('+') && !line.startsWith('+++')) {
                    className = 'bg-green-500/20 text-green-700'
                  } else if (line.startsWith('-') && !line.startsWith('---')) {
                    className = 'bg-red-500/20 text-red-700'
                  } else if (line.startsWith('@@')) {
                    className = 'text-blue-600'
                  }
                  return (
                    <div key={i} className={cn('px-2 -mx-2', className)}>
                      {line}
                    </div>
                  )
                })}
              </pre>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}
