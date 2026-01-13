'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowRight,
  Loader2,
  FileText,
  RefreshCw,
} from 'lucide-react'
import type { AgentPromptTurn, TaskStatus } from '@laneshare/shared'

interface AnalysisResultsProps {
  turn: AgentPromptTurn
  sessionId: string
  taskId: string
  projectId: string
  onTurnUpdate: (turn: AgentPromptTurn) => void
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  BLOCKED: 'Blocked',
  DONE: 'Done',
}

export function AnalysisResults({
  turn,
  sessionId,
  taskId,
  projectId,
  onTurnUpdate,
}: AnalysisResultsProps) {
  const { toast } = useToast()
  const [isApplying, setIsApplying] = useState(false)

  const analysis = turn.analysis_result
  if (!analysis) return null

  const confidencePercent = Math.round(analysis.confidence * 100)
  const suggestedStatus = turn.suggested_status_update as TaskStatus | null

  const handleApplyStatusUpdate = async () => {
    if (!suggestedStatus) return

    setIsApplying(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/tasks/${taskId}/agent-prompts/${sessionId}/apply-updates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            applyStatusUpdate: true,
            newStatus: suggestedStatus,
          }),
        }
      )

      if (!response.ok) {
        throw new Error('Failed to apply status update')
      }

      toast({
        title: 'Status updated',
        description: `Task status changed to ${STATUS_LABELS[suggestedStatus]}`,
      })

      // Clear the suggestion since it's been applied
      onTurnUpdate({
        ...turn,
        suggested_status_update: undefined,
      })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to apply status update',
      })
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Summary header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {analysis.success ? (
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          ) : (
            <AlertCircle className="h-5 w-5 text-orange-500" />
          )}
          <span className="font-medium">
            {analysis.success ? 'Implementation Successful' : 'Implementation Incomplete'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Confidence:</span>
          <div className="flex items-center gap-1.5">
            <Progress value={confidencePercent} className="w-16 h-2" />
            <span className="text-xs font-medium">{confidencePercent}%</span>
          </div>
        </div>
      </div>

      {/* Completed items */}
      {analysis.completedItems.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-sm font-medium text-green-700">Completed</h5>
          <ul className="space-y-1">
            {analysis.completedItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Failed items */}
      {analysis.failedItems.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-sm font-medium text-red-700">Failed</h5>
          <ul className="space-y-2">
            {analysis.failedItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium">{item.item}</span>
                  <p className="text-xs text-muted-foreground">{item.reason}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Partial items */}
      {analysis.partialItems.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-sm font-medium text-orange-700">Partial</h5>
          <ul className="space-y-2">
            {analysis.partialItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium">{item.item}</span>
                  <p className="text-xs text-muted-foreground">{item.status}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Notes */}
      {analysis.notes.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-sm font-medium">Notes</h5>
          <ul className="space-y-1">
            {analysis.notes.map((note, i) => (
              <li key={i} className="text-sm text-muted-foreground">
                • {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Follow-up reason */}
      {analysis.needsFollowUp && analysis.followUpReason && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-orange-800">
            <RefreshCw className="h-4 w-4" />
            <span className="text-sm font-medium">Follow-up Needed</span>
          </div>
          <p className="text-sm text-orange-700 mt-1">{analysis.followUpReason}</p>
        </div>
      )}

      {/* Suggested status update */}
      {suggestedStatus && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowRight className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-800">
                Suggested Status Update
              </span>
            </div>
            <Badge variant="outline" className="bg-white">
              {STATUS_LABELS[suggestedStatus]}
            </Badge>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              onClick={handleApplyStatusUpdate}
              disabled={isApplying}
            >
              {isApplying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Apply Status Update
            </Button>
          </div>
        </div>
      )}

      {/* Doc update suggestions */}
      {turn.suggested_doc_updates && turn.suggested_doc_updates.length > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4 text-purple-600" />
            <span className="text-sm font-medium text-purple-800">
              Suggested Documentation Updates
            </span>
          </div>
          <ul className="space-y-1">
            {turn.suggested_doc_updates.map((doc, i) => (
              <li key={i} className="text-sm text-purple-700">
                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs mr-2',
                    doc.action === 'create'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-blue-100 text-blue-700'
                  )}
                >
                  {doc.action}
                </Badge>
                {doc.slug}: {doc.description}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
