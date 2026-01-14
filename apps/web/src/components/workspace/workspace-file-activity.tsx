'use client'

import { useState, useCallback, useMemo } from 'react'
import { useFileActivity, FileActivityEvent } from '@/hooks/use-sse'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  FileIcon,
  FileTextIcon,
  FilePlusIcon,
  FileMinusIcon,
  FileEditIcon,
  FolderIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  EyeIcon,
  RefreshCwIcon,
  XIcon,
  ActivityIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'

export interface WorkspaceFileActivityProps {
  sessionId: string | null
  projectId: string
  maxActivities?: number
}

interface ActivityWithId extends FileActivityEvent {
  id: string
}

interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children: Map<string, FileNode>
  activities: ActivityWithId[]
  latestActivity?: ActivityWithId
}

function getActivityIcon(type: FileActivityEvent['type']) {
  switch (type) {
    case 'file_created':
      return <FilePlusIcon className="h-3.5 w-3.5 text-green-500" />
    case 'file_deleted':
      return <FileMinusIcon className="h-3.5 w-3.5 text-red-500" />
    case 'file_modified':
      return <FileEditIcon className="h-3.5 w-3.5 text-yellow-500" />
    case 'file_read':
      return <EyeIcon className="h-3.5 w-3.5 text-blue-400" />
    case 'file_renamed':
      return <RefreshCwIcon className="h-3.5 w-3.5 text-purple-500" />
    default:
      return <FileTextIcon className="h-3.5 w-3.5 text-muted-foreground" />
  }
}

function getActivityColor(type: FileActivityEvent['type']) {
  switch (type) {
    case 'file_created':
      return 'bg-green-500/10 text-green-600 border-green-500/30'
    case 'file_deleted':
      return 'bg-red-500/10 text-red-600 border-red-500/30'
    case 'file_modified':
      return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30'
    case 'file_read':
      return 'bg-blue-500/10 text-blue-600 border-blue-500/30'
    case 'file_renamed':
      return 'bg-purple-500/10 text-purple-600 border-purple-500/30'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function getActivityLabel(type: FileActivityEvent['type']) {
  switch (type) {
    case 'file_created':
      return 'Created'
    case 'file_deleted':
      return 'Deleted'
    case 'file_modified':
      return 'Modified'
    case 'file_read':
      return 'Read'
    case 'file_renamed':
      return 'Renamed'
    default:
      return 'Activity'
  }
}

function FileTreeNode({
  node,
  depth = 0,
  onSelectActivity,
}: {
  node: FileNode
  depth?: number
  onSelectActivity: (activity: ActivityWithId) => void
}) {
  const [isOpen, setIsOpen] = useState(true)

  if (node.isDirectory) {
    const hasChildren = node.children.size > 0
    const childNodes = Array.from(node.children.values())

    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <button
            className={cn(
              'flex items-center gap-1.5 w-full px-2 py-1 text-sm hover:bg-muted/50 rounded text-left',
              'focus:outline-none focus:ring-1 focus:ring-ring'
            )}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            {hasChildren ? (
              isOpen ? (
                <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
              )
            ) : (
              <span className="w-3.5" />
            )}
            <FolderIcon className="h-4 w-4 text-blue-400" />
            <span className="truncate flex-1">{node.name}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {childNodes
            .sort((a, b) => {
              // Directories first, then by name
              if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1
              }
              return a.name.localeCompare(b.name)
            })
            .map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                onSelectActivity={onSelectActivity}
              />
            ))}
        </CollapsibleContent>
      </Collapsible>
    )
  }

  // File node
  const latestActivity = node.latestActivity
  return (
    <button
      className={cn(
        'flex items-center gap-1.5 w-full px-2 py-1 text-sm hover:bg-muted/50 rounded text-left',
        'focus:outline-none focus:ring-1 focus:ring-ring'
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => latestActivity && onSelectActivity(latestActivity)}
    >
      <span className="w-3.5" />
      {latestActivity ? getActivityIcon(latestActivity.type) : <FileIcon className="h-4 w-4" />}
      <span className="truncate flex-1">{node.name}</span>
      {latestActivity && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn('text-[10px] px-1 py-0', getActivityColor(latestActivity.type))}
              >
                {getActivityLabel(latestActivity.type)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p className="text-xs">
                {formatDistanceToNow(new Date(latestActivity.timestamp), { addSuffix: true })}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </button>
  )
}

function buildFileTree(activities: ActivityWithId[]): FileNode {
  const root: FileNode = {
    name: '',
    path: '',
    isDirectory: true,
    children: new Map(),
    activities: [],
  }

  for (const activity of activities) {
    const parts = activity.path.split('/').filter(Boolean)
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const currentPath = parts.slice(0, i + 1).join('/')

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: currentPath,
          isDirectory: !isLast,
          children: new Map(),
          activities: [],
        })
      }

      current = current.children.get(part)!
      if (isLast) {
        current.activities.push(activity)
        if (!current.latestActivity || new Date(activity.timestamp) > new Date(current.latestActivity.timestamp)) {
          current.latestActivity = activity
        }
      }
    }
  }

  return root
}

export function WorkspaceFileActivity({
  sessionId,
  projectId,
  maxActivities = 100,
}: WorkspaceFileActivityProps) {
  const [activities, setActivities] = useState<ActivityWithId[]>([])
  const [selectedActivity, setSelectedActivity] = useState<ActivityWithId | null>(null)
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('list')

  const handleActivity = useCallback((activity: FileActivityEvent) => {
    setActivities((prev) => {
      const newActivity: ActivityWithId = {
        ...activity,
        id: `${activity.timestamp}-${activity.path}-${Math.random().toString(36).slice(2)}`,
      }
      const updated = [newActivity, ...prev]
      return updated.slice(0, maxActivities)
    })
  }, [maxActivities])

  const { isConnected, error, reconnectAttempts } = useFileActivity(
    sessionId,
    projectId,
    handleActivity
  )

  const fileTree = useMemo(() => buildFileTree(activities), [activities])

  const handleClear = () => {
    setActivities([])
    setSelectedActivity(null)
  }

  if (!sessionId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-muted-foreground">
        <ActivityIcon className="h-8 w-8 mb-2" />
        <p className="text-sm text-center">Select a session to view file activity</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <ActivityIcon className="h-4 w-4" />
          <span className="font-medium text-sm">File Activity</span>
          <Badge variant="secondary" className="text-xs">
            {activities.length}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          {/* Connection status */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    'w-2 h-2 rounded-full',
                    isConnected ? 'bg-green-500' : error ? 'bg-red-500' : 'bg-yellow-500'
                  )}
                />
              </TooltipTrigger>
              <TooltipContent side="left">
                <p className="text-xs">
                  {isConnected
                    ? 'Connected'
                    : error
                    ? `Error: ${error}`
                    : `Reconnecting (${reconnectAttempts})...`}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* View mode toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setViewMode(viewMode === 'tree' ? 'list' : 'tree')}
          >
            {viewMode === 'tree' ? (
              <FileTextIcon className="h-3.5 w-3.5" />
            ) : (
              <FolderIcon className="h-3.5 w-3.5" />
            )}
          </Button>
          {/* Clear button */}
          {activities.length > 0 && (
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleClear}>
              <XIcon className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
            <ActivityIcon className="h-6 w-6 mb-2 opacity-50" />
            <p className="text-xs text-center">
              {isConnected ? 'Waiting for file activity...' : 'Connecting...'}
            </p>
          </div>
        ) : viewMode === 'tree' ? (
          <div className="py-1">
            {Array.from(fileTree.children.values())
              .sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) {
                  return a.isDirectory ? -1 : 1
                }
                return a.name.localeCompare(b.name)
              })
              .map((node) => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  onSelectActivity={setSelectedActivity}
                />
              ))}
          </div>
        ) : (
          <div className="divide-y">
            {activities.map((activity) => (
              <button
                key={activity.id}
                className={cn(
                  'flex items-start gap-2 w-full px-3 py-2 text-left hover:bg-muted/50',
                  selectedActivity?.id === activity.id && 'bg-muted'
                )}
                onClick={() => setSelectedActivity(activity)}
              >
                <div className="mt-0.5">{getActivityIcon(activity.type)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono truncate">{activity.path}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge
                      variant="outline"
                      className={cn('text-[10px] px-1 py-0', getActivityColor(activity.type))}
                    >
                      {getActivityLabel(activity.type)}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                    </span>
                  </div>
                  {activity.details?.lines_changed !== undefined && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {activity.details.lines_changed} lines changed
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Preview panel */}
      {selectedActivity?.details?.preview && (
        <div className="border-t">
          <div className="flex items-center justify-between px-3 py-1 bg-muted/50">
            <span className="text-xs font-medium truncate">{selectedActivity.path}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={() => setSelectedActivity(null)}
            >
              <XIcon className="h-3 w-3" />
            </Button>
          </div>
          <ScrollArea className="h-32">
            <pre className="p-2 text-xs font-mono whitespace-pre-wrap">
              {selectedActivity.details.preview}
            </pre>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
