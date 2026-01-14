'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import {
  Bot,
  GitBranch,
  GitPullRequest,
  Loader2,
  Check,
  X,
  AlertTriangle,
  MessageSquare,
  RotateCcw,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  FileCode,
  FilePlus,
  FileEdit,
  FileX,
} from 'lucide-react'
import type {
  ImplementationStatusResponse,
  AgentExecutionSession,
  AgentIteration,
  AgentFileOperation,
  AgentFeedback,
  AgentExecutionStatus,
  AgentLoopStage,
  AgentFeedbackType,
  AGENT_STATUS_CONFIG,
  AGENT_STAGE_LABELS,
} from '@laneshare/shared'

interface ImplementationProgressProps {
  projectId: string
  taskId: string
  initialStatus?: ImplementationStatusResponse
}

const STATUS_COLORS: Record<AgentExecutionStatus, { bg: string; text: string }> = {
  PENDING: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' },
  RUNNING: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' },
  WAITING_FEEDBACK: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-600 dark:text-yellow-400' },
  SUCCEEDED: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-600 dark:text-green-400' },
  FAILED: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400' },
  CANCELLED: { bg: 'bg-gray-100 dark:bg-gray-900/30', text: 'text-gray-600 dark:text-gray-400' },
  STUCK: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-600 dark:text-orange-400' },
}

const STAGE_LABELS: Record<AgentLoopStage, string> = {
  INITIALIZING: 'Initializing',
  ANALYZING_TASK: 'Analyzing Task',
  PLANNING: 'Planning',
  IMPLEMENTING: 'Implementing',
  VERIFYING: 'Verifying',
  COMMITTING: 'Committing',
  CREATING_PR: 'Creating PR',
  AWAITING_FEEDBACK: 'Awaiting Feedback',
  ITERATING: 'Iterating',
  FINALIZING: 'Finalizing',
}

const FILE_OP_ICONS = {
  CREATE: FilePlus,
  UPDATE: FileEdit,
  DELETE: FileX,
  RENAME: FileCode,
}

export function ImplementationProgress({
  projectId,
  taskId,
  initialStatus,
}: ImplementationProgressProps) {
  const { toast } = useToast()
  const router = useRouter()

  const [status, setStatus] = useState<ImplementationStatusResponse | null>(initialStatus || null)
  const [isLoading, setIsLoading] = useState(!initialStatus)
  const [error, setError] = useState<string | null>(null)

  // Feedback form state
  const [feedbackContent, setFeedbackContent] = useState('')
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false)
  const [isRollingBack, setIsRollingBack] = useState(false)

  // Collapsible sections
  const [expandedIterations, setExpandedIterations] = useState<Set<number>>(new Set())

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/tasks/${taskId}/implement/status`
      )

      if (response.status === 404) {
        setStatus(null)
        setError('No implementation session found for this task.')
        return
      }

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch status')
      }

      const data: ImplementationStatusResponse = await response.json()
      setStatus(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status')
    } finally {
      setIsLoading(false)
    }
  }, [projectId, taskId])

  // Initial fetch and polling
  useEffect(() => {
    fetchStatus()

    // Poll while running
    const interval = setInterval(() => {
      if (
        status?.session?.status === 'RUNNING' ||
        status?.session?.status === 'PENDING'
      ) {
        fetchStatus()
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [fetchStatus, status?.session?.status])

  // Handle feedback submission
  const handleSubmitFeedback = async (feedbackType: AgentFeedbackType) => {
    if (feedbackType !== 'abort' && feedbackType !== 'approval' && !feedbackContent.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please enter feedback content',
      })
      return
    }

    setIsSubmittingFeedback(true)

    try {
      const response = await fetch(
        `/api/projects/${projectId}/agent-sessions/${status?.session.id}/feedback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            feedbackType,
            content: feedbackContent.trim() || `User submitted ${feedbackType}`,
          }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to submit feedback')
      }

      toast({
        title: 'Feedback submitted',
        description: feedbackType === 'abort' ? 'Session cancelled' : 'The agent will continue with your feedback',
      })

      setFeedbackContent('')
      fetchStatus()
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to submit feedback',
      })
    } finally {
      setIsSubmittingFeedback(false)
    }
  }

  // Handle rollback
  const handleRollback = async () => {
    if (!confirm('Are you sure you want to cancel and rollback this implementation? The branch will be deleted.')) {
      return
    }

    setIsRollingBack(true)

    try {
      const response = await fetch(
        `/api/projects/${projectId}/agent-sessions/${status?.session.id}/rollback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: 'User requested rollback',
          }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to rollback')
      }

      toast({
        title: 'Implementation rolled back',
        description: 'Branch deleted and session cancelled',
      })

      fetchStatus()
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to rollback',
      })
    } finally {
      setIsRollingBack(false)
    }
  }

  // Toggle iteration expansion
  const toggleIteration = (num: number) => {
    setExpandedIterations((prev) => {
      const next = new Set(prev)
      if (next.has(num)) {
        next.delete(num)
      } else {
        next.add(num)
      }
      return next
    })
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (error || !status) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <AlertTriangle className="h-8 w-8 text-muted-foreground" />
          <p className="text-muted-foreground">{error || 'No implementation session found'}</p>
          <Button variant="outline" onClick={() => router.back()}>
            Go Back
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { session, currentIteration, fileOperations, feedback } = status
  const statusColor = STATUS_COLORS[session.status]
  const progressPercent = session.progress_json?.criteriaTotal
    ? (session.progress_json.criteriaPassed / session.progress_json.criteriaTotal) * 100
    : 0

  const isActive = session.status === 'RUNNING' || session.status === 'PENDING'
  const needsFeedback = session.status === 'WAITING_FEEDBACK' || session.status === 'STUCK'
  const isComplete = session.status === 'SUCCEEDED' || session.status === 'FAILED' || session.status === 'CANCELLED'

  return (
    <div className="space-y-6">
      {/* Main Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                AI Implementation
              </CardTitle>
              <CardDescription className="mt-1">
                {session.task?.title || 'Task implementation'}
              </CardDescription>
            </div>
            <Badge className={cn(statusColor.bg, statusColor.text, 'border-0')}>
              {session.status.replace('_', ' ')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Progress Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {session.stage ? STAGE_LABELS[session.stage] : 'Initializing'}
              </span>
              <span className="text-muted-foreground">
                Iteration {session.current_iteration} / {session.max_iterations}
              </span>
            </div>
            <Progress value={progressPercent} />
            {session.progress_json?.message && (
              <p className="text-xs text-muted-foreground">{session.progress_json.message}</p>
            )}
          </div>

          <Separator />

          {/* Branch & File Info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-1">
              <Label className="text-muted-foreground">Branch</Label>
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <code className="text-xs">{session.implementation_branch}</code>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Files Changed</Label>
              <div className="flex items-center gap-2">
                <FileCode className="h-4 w-4 text-muted-foreground" />
                <span>{session.total_files_changed || fileOperations.length}</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Repository</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs">
                  {session.repo?.owner}/{session.repo?.name}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Criteria Progress</Label>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-muted-foreground" />
                <span>
                  {session.progress_json?.criteriaPassed || 0} / {session.progress_json?.criteriaTotal || 0}
                </span>
              </div>
            </div>
          </div>

          {/* PR Link if available */}
          {session.pr_url && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitPullRequest className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium">Pull Request #{session.pr_number}</span>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a href={session.pr_url} target="_blank" rel="noopener noreferrer">
                    View PR
                    <ExternalLink className="h-4 w-4 ml-2" />
                  </a>
                </Button>
              </div>
            </>
          )}

          {/* Error Message */}
          {session.error_message && (
            <>
              <Separator />
              <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-md">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                <div className="text-sm text-red-800 dark:text-red-200">
                  <p className="font-medium">Error</p>
                  <p className="text-xs mt-1">{session.error_message}</p>
                </div>
              </div>
            </>
          )}

          {/* Stuck Reason */}
          {session.stuck_reason && (
            <>
              <Separator />
              <div className="flex items-start gap-2 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-md">
                <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
                <div className="text-sm text-orange-800 dark:text-orange-200">
                  <p className="font-medium">Agent is stuck</p>
                  <p className="text-xs mt-1">{session.stuck_reason}</p>
                </div>
              </div>
            </>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 justify-end">
            {!isComplete && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRollback}
                disabled={isRollingBack}
              >
                {isRollingBack ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-2" />
                )}
                Rollback
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Feedback Card - shown when waiting for feedback */}
      {needsFeedback && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageSquare className="h-5 w-5" />
              Provide Feedback
            </CardTitle>
            <CardDescription>
              The agent needs your input to continue
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="Enter your guidance or instructions..."
              value={feedbackContent}
              onChange={(e) => setFeedbackContent(e.target.value)}
              rows={3}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={() => handleSubmitFeedback('guidance')}
                disabled={isSubmittingFeedback || !feedbackContent.trim()}
              >
                {isSubmittingFeedback && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Send Guidance
              </Button>
              <Button
                variant="outline"
                onClick={() => handleSubmitFeedback('approval')}
                disabled={isSubmittingFeedback}
              >
                <Check className="h-4 w-4 mr-2" />
                Approve & Complete
              </Button>
              <Button
                variant="outline"
                onClick={() => handleSubmitFeedback('rejection')}
                disabled={isSubmittingFeedback || !feedbackContent.trim()}
              >
                <X className="h-4 w-4 mr-2" />
                Reject & Retry
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleSubmitFeedback('abort')}
                disabled={isSubmittingFeedback}
              >
                Abort
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Iterations History */}
      {session.iterations && session.iterations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Iteration History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {session.iterations.map((iteration) => (
                <div
                  key={iteration.id}
                  className="border rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => toggleIteration(iteration.iteration_number)}
                    className="w-full flex items-center justify-between p-3 hover:bg-muted/50 text-left"
                  >
                    <div className="flex items-center gap-3">
                      {expandedIterations.has(iteration.iteration_number) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <span className="font-medium">
                        Iteration {iteration.iteration_number}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {iteration.criteria_passed}/{iteration.criteria_total} passed
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(iteration.started_at), { addSuffix: true })}
                    </span>
                  </button>

                  {expandedIterations.has(iteration.iteration_number) && (
                    <div className="p-3 pt-0 border-t bg-muted/20">
                      {/* File changes */}
                      {iteration.changes_made && iteration.changes_made.length > 0 && (
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Files Changed</Label>
                          <div className="space-y-1">
                            {iteration.changes_made.map((change, idx) => {
                              const Icon = FILE_OP_ICONS[change.operation] || FileCode
                              return (
                                <div
                                  key={idx}
                                  className="flex items-center gap-2 text-xs font-mono"
                                >
                                  <Icon className="h-3 w-3" />
                                  <span>{change.file}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Verification results */}
                      {iteration.verification_results && (
                        <div className="mt-3 space-y-2">
                          <Label className="text-xs text-muted-foreground">Verification</Label>
                          <div className="space-y-1">
                            {iteration.verification_results.items?.map((item, idx) => (
                              <div
                                key={idx}
                                className="flex items-start gap-2 text-xs"
                              >
                                {item.passed ? (
                                  <Check className="h-3 w-3 text-green-600 mt-0.5" />
                                ) : (
                                  <X className="h-3 w-3 text-red-600 mt-0.5" />
                                )}
                                <span className={item.passed ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
                                  {item.criterion}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Commit info */}
                      {iteration.commit_sha && (
                        <div className="mt-3 text-xs text-muted-foreground">
                          Commit: <code>{iteration.commit_sha.slice(0, 7)}</code>
                          {iteration.commit_message && ` - ${iteration.commit_message}`}
                        </div>
                      )}

                      {/* Blocked reason */}
                      {iteration.blocked_reason && (
                        <div className="mt-3 p-2 bg-orange-50 dark:bg-orange-900/20 rounded text-xs text-orange-800 dark:text-orange-200">
                          Blocked: {iteration.blocked_reason}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* File Operations */}
      {fileOperations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">File Operations</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              <div className="space-y-2">
                {fileOperations.map((op) => {
                  const Icon = FILE_OP_ICONS[op.operation] || FileCode
                  return (
                    <div
                      key={op.id}
                      className="flex items-center justify-between p-2 rounded border text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <code className="text-xs">{op.file_path}</code>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="text-green-600">+{op.lines_added}</span>
                        <span className="text-red-600">-{op.lines_removed}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Feedback History */}
      {feedback.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Feedback History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {feedback.map((fb) => (
                <div key={fb.id} className="flex gap-3 p-3 border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">
                        {fb.feedback_type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {fb.creator?.full_name || fb.creator?.email}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(fb.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm">{fb.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-sm font-medium', className)}>{children}</p>
}
