'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  AlertTriangle,
  X,
  ChevronDown,
  ChevronUp,
  FileWarning,
  Users,
  Clock,
} from 'lucide-react'
import type { FileConflictEvent } from '@/hooks/use-orchestrator-events'

interface ConflictNotificationProps {
  conflicts: FileConflictEvent[]
  onDismiss: (filePath: string) => void
  onDismissAll: () => void
}

export function ConflictNotification({
  conflicts,
  onDismiss,
  onDismissAll,
}: ConflictNotificationProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  if (conflicts.length === 0) {
    return null
  }

  const criticalCount = conflicts.filter((c) => c.severity === 'critical').length
  const warningCount = conflicts.filter((c) => c.severity === 'warning').length

  return (
    <Alert
      variant="destructive"
      className="border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100"
    >
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600" />
            <div>
              <AlertTitle className="text-amber-800 dark:text-amber-200">
                File Conflicts Detected
              </AlertTitle>
              <AlertDescription className="text-amber-700 dark:text-amber-300 text-sm">
                {conflicts.length} file{conflicts.length !== 1 ? 's are' : ' is'} being edited by
                other team members
              </AlertDescription>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {criticalCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {criticalCount} critical
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge
                variant="outline"
                className="text-xs border-amber-500 text-amber-700 dark:text-amber-300"
              >
                {warningCount} warning
              </Badge>
            )}
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-amber-600 hover:text-amber-800"
              onClick={onDismissAll}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <CollapsibleContent className="mt-3">
          <div className="space-y-2">
            {conflicts.map((conflict) => (
              <ConflictItem
                key={conflict.filePath}
                conflict={conflict}
                onDismiss={() => onDismiss(conflict.filePath)}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Alert>
  )
}

interface ConflictItemProps {
  conflict: FileConflictEvent
  onDismiss: () => void
}

function ConflictItem({ conflict, onDismiss }: ConflictItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div
      className={`rounded-md border p-2 ${
        conflict.severity === 'critical'
          ? 'border-red-500/50 bg-red-50 dark:bg-red-950/20'
          : 'border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <FileWarning
            className={`h-4 w-4 flex-shrink-0 ${
              conflict.severity === 'critical' ? 'text-red-500' : 'text-amber-500'
            }`}
          />
          <span className="text-sm font-mono truncate">{conflict.filePath}</span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? 'Hide' : 'Details'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={onDismiss}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-2 pl-6 space-y-2">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Also editing:</span>
          </div>
          {conflict.otherSessions.map((session) => (
            <div
              key={session.sessionId}
              className="flex items-center gap-2 text-xs bg-white/50 dark:bg-black/20 rounded px-2 py-1"
            >
              <Users className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium">{session.userName}</span>
              <Badge variant="secondary" className="text-xs px-1 py-0">
                {session.activityType}
              </Badge>
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(session.lastActivity).toLocaleTimeString()}
              </span>
            </div>
          ))}
          {conflict.suggestion && (
            <div className="text-xs text-muted-foreground italic mt-2">
              {conflict.suggestion}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
