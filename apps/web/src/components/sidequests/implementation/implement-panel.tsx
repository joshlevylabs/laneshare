'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  Play,
  Pause,
  SkipForward,
  Check,
  X,
  Loader2,
  RefreshCw,
  ChevronRight,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Clock,
  Cloud,
  Terminal,
  Wand2,
  Send,
  Circle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import { useAutomatedWorkspace, type AutomationStep } from '@/hooks/use-automated-workspace'
import type { SidequestImplementationSession, SidequestTicket } from '@laneshare/shared'
import type { GitHubCodespace } from '@/lib/github'

export interface AutomationControlRef {
  markTerminalReady: () => void
  markClaudeReady: () => void
  markTaskSent: () => void
}

interface ImplementPanelProps {
  sidequestId: string
  projectId: string
  repoIds?: string[]
  onClose?: () => void
  onCodespaceReady?: (codespace: GitHubCodespace, repoId: string) => void
  onSendToClaudeRef?: React.MutableRefObject<((ticket: SidequestTicket) => void) | null>
  // Ref to expose automation controls to parent
  automationControlRef?: React.MutableRefObject<AutomationControlRef | null>
}

const SESSION_STATUS_LABELS: Record<string, string> = {
  IDLE: 'Not Started',
  IMPLEMENTING: 'Implementing',
  AWAITING_REVIEW: 'Awaiting Review',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
}

// Status step display
interface StatusStep {
  id: AutomationStep
  label: string
  icon: React.ReactNode
}

const AUTOMATION_STEPS: StatusStep[] = [
  { id: 'finding_codespace', label: 'Find Codespace', icon: <Cloud className="h-4 w-4" /> },
  { id: 'starting_codespace', label: 'Start Codespace', icon: <Play className="h-4 w-4" /> },
  { id: 'connecting_terminal', label: 'Connect Terminal', icon: <Terminal className="h-4 w-4" /> },
  { id: 'installing_claude', label: 'Setup Claude', icon: <Wand2 className="h-4 w-4" /> },
  { id: 'sending_task', label: 'Send Task', icon: <Send className="h-4 w-4" /> },
]

function getStepStatus(currentStep: AutomationStep, stepId: AutomationStep): 'completed' | 'current' | 'pending' {
  const stepOrder: AutomationStep[] = [
    'idle',
    'finding_codespace',
    'creating_codespace',
    'starting_codespace',
    'waiting_codespace',
    'connecting_terminal',
    'installing_claude',
    'sending_task',
    'ready',
  ]

  const currentIdx = stepOrder.indexOf(currentStep)
  const stepIdx = stepOrder.indexOf(stepId)

  // Handle special cases
  if (stepId === 'finding_codespace') {
    if (currentStep === 'creating_codespace') return 'current'
    if (currentIdx > stepOrder.indexOf('creating_codespace')) return 'completed'
  }
  if (stepId === 'starting_codespace') {
    if (currentStep === 'waiting_codespace') return 'current'
    if (currentIdx > stepOrder.indexOf('waiting_codespace')) return 'completed'
  }

  if (stepIdx < currentIdx) return 'completed'
  if (stepIdx === currentIdx) return 'current'
  return 'pending'
}

export function ImplementPanel({
  sidequestId,
  projectId,
  repoIds,
  onClose,
  onCodespaceReady,
  onSendToClaudeRef,
  automationControlRef,
}: ImplementPanelProps) {
  const { toast } = useToast()
  const [session, setSession] = useState<SidequestImplementationSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isActioning, setIsActioning] = useState(false)
  const [notes, setNotes] = useState('')
  const [autoStartTriggered, setAutoStartTriggered] = useState(false)

  // Automated workspace hook
  const {
    state: automationState,
    startAutomation,
    markTerminalReady,
    markClaudeReady,
    markTaskSent,
    formatTicketAsPrompt,
    reset: resetAutomation,
    isRunning: isAutomating,
  } = useAutomatedWorkspace({
    projectId,
    sidequestId,
    repoIds,
    currentTicket: session?.current_ticket || null,
    onReady: (codespace, repoId) => {
      onCodespaceReady?.(codespace, repoId)
    },
    onError: (error) => {
      toast({ title: 'Automation Error', description: error, variant: 'destructive' })
    },
    onTaskSent: () => {
      toast({ title: 'Task Sent', description: 'Claude is now working on the task' })
    },
  })

  // Store latest callbacks in refs to avoid stale closures
  // We use individual refs that are always kept up-to-date
  const markTerminalReadyRef = useRef(markTerminalReady)
  const markClaudeReadyRef = useRef(markClaudeReady)
  const markTaskSentRef = useRef(markTaskSent)

  // Update refs synchronously during render (safe for refs)
  markTerminalReadyRef.current = markTerminalReady
  markClaudeReadyRef.current = markClaudeReady
  markTaskSentRef.current = markTaskSent

  // Set up the automation control ref synchronously
  // This ensures it's always available when the parent tries to use it
  if (automationControlRef) {
    // Only create new wrapper functions if the ref isn't set yet
    // (avoids creating new objects every render)
    if (!automationControlRef.current) {
      automationControlRef.current = {
        markTerminalReady: () => markTerminalReadyRef.current(),
        markClaudeReady: () => markClaudeReadyRef.current(),
        markTaskSent: () => markTaskSentRef.current(),
      }
    }
  }

  // Expose send to claude function
  useEffect(() => {
    if (onSendToClaudeRef) {
      onSendToClaudeRef.current = (ticket: SidequestTicket) => {
        // This will be called by the parent when Claude is ready
        const prompt = formatTicketAsPrompt(ticket)
        return prompt
      }
    }
  }, [onSendToClaudeRef, formatTicketAsPrompt])

  // Fetch session
  const fetchSession = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/sidequests/${sidequestId}/implement`
      )
      if (!response.ok) {
        if (response.status === 404) {
          setSession(null)
          return
        }
        throw new Error('Failed to fetch session')
      }
      const data = await response.json()
      setSession(data)
    } catch (error) {
      console.error('Fetch session error:', error)
      toast({ title: 'Error', description: 'Failed to fetch implementation session', variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }, [projectId, sidequestId, toast])

  useEffect(() => {
    fetchSession()
    // Poll for updates every 5 seconds when implementing
    const interval = setInterval(fetchSession, 5000)
    return () => clearInterval(interval)
  }, [fetchSession])

  // Auto-start automation when session starts
  useEffect(() => {
    if (session && session.status === 'IMPLEMENTING' && !autoStartTriggered && automationState.step === 'idle') {
      setAutoStartTriggered(true)
      startAutomation()
    }
  }, [session, autoStartTriggered, automationState.step, startAutomation])

  // Start implementation
  const handleStart = async () => {
    setIsActioning(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/sidequests/${sidequestId}/implement`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto_advance: false }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to start')
      }

      const data = await response.json()
      setSession(data)
      setAutoStartTriggered(false) // Reset so auto-start triggers
      toast({ title: 'Started', description: 'Implementation started' })
    } catch (error) {
      console.error('Start error:', error)
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to start', variant: 'destructive' })
    } finally {
      setIsActioning(false)
    }
  }

  // Pause implementation
  const handlePause = async () => {
    setIsActioning(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/sidequests/${sidequestId}/implement/pause`,
        { method: 'POST' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to pause')
      }

      const data = await response.json()
      setSession(data)
      toast({ title: 'Paused', description: 'Implementation paused' })
    } catch (error) {
      console.error('Pause error:', error)
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to pause', variant: 'destructive' })
    } finally {
      setIsActioning(false)
    }
  }

  // Resume implementation
  const handleResume = async () => {
    setIsActioning(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/sidequests/${sidequestId}/implement/resume`,
        { method: 'POST' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to resume')
      }

      const data = await response.json()
      setSession(data)
      toast({ title: 'Resumed', description: 'Implementation resumed' })
    } catch (error) {
      console.error('Resume error:', error)
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to resume', variant: 'destructive' })
    } finally {
      setIsActioning(false)
    }
  }

  // Advance (approve/skip)
  const handleAdvance = async (action: 'approve' | 'skip') => {
    setIsActioning(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/sidequests/${sidequestId}/implement/advance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            notes: notes.trim() || undefined,
          }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to advance')
      }

      const data = await response.json()
      setSession(data.session)
      setNotes('')

      if (data.is_complete) {
        toast({ title: 'Completed', description: 'All tickets completed!' })
      } else {
        toast({ title: action === 'approve' ? 'Approved' : 'Skipped', description: action === 'approve' ? 'Ticket approved' : 'Ticket skipped' })
      }
    } catch (error) {
      console.error('Advance error:', error)
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to advance', variant: 'destructive' })
    } finally {
      setIsActioning(false)
    }
  }

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  // No active session
  if (!session) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Implementation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Clock className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">No active implementation session</p>
          <Button onClick={handleStart} disabled={isActioning}>
            {isActioning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Start Implementation
          </Button>
        </CardContent>
      </Card>
    )
  }

  const progress =
    session.sidequest && session.sidequest.total_tickets > 0
      ? Math.round(
          ((session.tickets_implemented + session.tickets_skipped) /
            session.sidequest.total_tickets) *
            100
        )
      : 0

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Implementation</CardTitle>
          <Badge
            variant={
              session.status === 'IMPLEMENTING'
                ? 'default'
                : session.status === 'COMPLETED'
                ? 'secondary'
                : 'outline'
            }
          >
            {SESSION_STATUS_LABELS[session.status] || session.status}
          </Badge>
        </div>

        {/* Progress */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Tickets Progress</span>
            <span>
              {session.tickets_implemented + session.tickets_skipped} /{' '}
              {session.sidequest?.total_tickets || 0}
            </span>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              {session.tickets_implemented} implemented
            </span>
            <span className="flex items-center gap-1">
              <SkipForward className="h-3 w-3" />
              {session.tickets_skipped} skipped
            </span>
          </div>
        </div>
      </CardHeader>

      <Separator />

      {/* Automation Status Steps */}
      {(isAutomating || automationState.step !== 'idle') && (
        <>
          <div className="px-4 py-3 bg-muted/30">
            <div className="flex items-center gap-2 mb-3">
              <Wand2 className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Workspace Setup</span>
              {automationState.step === 'error' && (
                <Badge variant="destructive" className="ml-auto">Error</Badge>
              )}
              {automationState.step === 'ready' && (
                <Badge variant="secondary" className="ml-auto bg-green-100 text-green-700">Ready</Badge>
              )}
            </div>

            {/* Step indicators */}
            <div className="flex items-center justify-between gap-1">
              {AUTOMATION_STEPS.map((step, idx) => {
                const status = getStepStatus(automationState.step, step.id)
                return (
                  <div key={step.id} className="flex-1 flex flex-col items-center">
                    <div
                      className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors',
                        status === 'completed' && 'bg-green-100 border-green-500 text-green-600',
                        status === 'current' && 'bg-primary/10 border-primary text-primary animate-pulse',
                        status === 'pending' && 'bg-muted border-muted-foreground/30 text-muted-foreground'
                      )}
                    >
                      {status === 'completed' ? (
                        <Check className="h-4 w-4" />
                      ) : status === 'current' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        step.icon
                      )}
                    </div>
                    <span className={cn(
                      'text-xs mt-1 text-center',
                      status === 'current' && 'text-primary font-medium',
                      status === 'pending' && 'text-muted-foreground'
                    )}>
                      {step.label}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Current message */}
            <p className="text-xs text-muted-foreground mt-3 text-center">
              {automationState.message}
            </p>

            {/* Error message */}
            {automationState.error && (
              <div className="mt-2 p-2 bg-destructive/10 rounded text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{automationState.error}</span>
              </div>
            )}

            {/* Retry button on error */}
            {automationState.step === 'error' && (
              <div className="mt-2 flex justify-center">
                <Button size="sm" variant="outline" onClick={startAutomation}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </div>
            )}
          </div>
          <Separator />
        </>
      )}

      {/* Current ticket */}
      <CardContent className="flex-1 py-4 overflow-auto">
        {session.current_ticket ? (
          <div className="space-y-4">
            <div>
              <h4 className="font-medium mb-1 flex items-center gap-2">
                <Circle className="h-3 w-3 fill-primary text-primary" />
                Current Ticket
              </h4>
              <div className="bg-muted rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="shrink-0">
                    {session.current_ticket.ticket_type}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{session.current_ticket.title}</p>
                    {session.current_ticket.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-3">
                        {session.current_ticket.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Acceptance criteria */}
                {session.current_ticket.acceptance_criteria &&
                  session.current_ticket.acceptance_criteria.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-sm font-medium mb-2">Acceptance Criteria</p>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        {session.current_ticket.acceptance_criteria.map((c, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <ChevronRight className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>{c}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {/* Implementation result if available */}
                {session.current_ticket.implementation_result && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-sm font-medium mb-2">Result</p>
                    <div className="flex items-center gap-2">
                      {session.current_ticket.implementation_result.success ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      )}
                      <span className="text-sm">
                        {session.current_ticket.implementation_result.success
                          ? 'Success'
                          : 'Failed'}
                      </span>
                      {session.current_ticket.implementation_result.pr_url && (
                        <a
                          href={session.current_ticket.implementation_result.pr_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary flex items-center gap-1 ml-auto"
                        >
                          View PR
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Notes input for review */}
            {session.status === 'AWAITING_REVIEW' && (
              <div>
                <label className="text-sm font-medium">Notes (optional)</label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any notes about this implementation..."
                  className="mt-1"
                  rows={3}
                />
              </div>
            )}
          </div>
        ) : session.status === 'COMPLETED' ? (
          <div className="flex flex-col items-center justify-center py-8">
            <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
            <p className="font-medium">All Done!</p>
            <p className="text-sm text-muted-foreground mt-1">
              Implementation completed successfully
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8">
            <Clock className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No ticket in progress</p>
          </div>
        )}
      </CardContent>

      <Separator />

      {/* Controls */}
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          {/* Left controls */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={fetchSession}
              disabled={isActioning}
            >
              <RefreshCw className={`h-4 w-4 ${isActioning ? 'animate-spin' : ''}`} />
            </Button>

            {session.status === 'IMPLEMENTING' && (
              <Button variant="outline" onClick={handlePause} disabled={isActioning}>
                <Pause className="h-4 w-4 mr-2" />
                Pause
              </Button>
            )}

            {session.status === 'PAUSED' && (
              <Button onClick={handleResume} disabled={isActioning}>
                <Play className="h-4 w-4 mr-2" />
                Resume
              </Button>
            )}
          </div>

          {/* Right controls - review actions */}
          {session.status === 'AWAITING_REVIEW' && session.current_ticket && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => handleAdvance('skip')}
                disabled={isActioning}
              >
                <SkipForward className="h-4 w-4 mr-2" />
                Skip
              </Button>
              <Button onClick={() => handleAdvance('approve')} disabled={isActioning}>
                {isActioning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Approve
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Export functions for external control
export { useAutomatedWorkspace }
export type { AutomationStep, AutomationState } from '@/hooks/use-automated-workspace'
