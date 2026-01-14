'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { WorkspaceTabBar } from './workspace-tab-bar'
import { WorkspaceSession } from './workspace-session'
import { WorkspaceConnectionSetup } from './workspace-connection-setup'
import { WorkspaceTaskSelector } from './workspace-task-selector'
import { WorkspaceFileActivity } from './workspace-file-activity'
import { WorkspaceGitControls } from './workspace-git-controls'
import { WorkspaceGitStatus } from './workspace-git-status'
import { Plus, Terminal, PanelRightClose, PanelRight, Cloud, ExternalLink } from 'lucide-react'
import type { Task } from '@laneshare/shared'
import type { GitHubCodespace } from '@/lib/github'
import { cn } from '@/lib/utils'

export interface WorkspaceMessageData {
  id: string
  role: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system'
  content: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  timestamp: Date
}

export interface WorkspaceSessionData {
  id: string
  project_id: string
  task_id: string
  local_session_id: string | null
  local_clone_id: string | null
  codespace_name: string | null
  status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR'
  connection_config: Record<string, unknown>
  error_message: string | null
  created_by: string
  created_at: string
  updated_at: string
  messages: WorkspaceMessageData[]
  task?: {
    id: string
    key: string
    title: string
    status: string
    type: string
  }
}

export interface WorkspaceViewProps {
  projectId: string
  initialSessions?: WorkspaceSessionData[]
  tasks?: Task[]
}

export function WorkspaceView({
  projectId,
  initialSessions = [],
  tasks = [],
}: WorkspaceViewProps) {
  const { toast } = useToast()
  const [sessions, setSessions] = useState<WorkspaceSessionData[]>(initialSessions)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    initialSessions[0]?.id ?? null
  )
  const [showTaskSelector, setShowTaskSelector] = useState(false)
  const [showConnectionSetup, setShowConnectionSetup] = useState(false)
  const [showActivityPanel, setShowActivityPanel] = useState(true)

  // Codespace state
  const [connectedCodespace, setConnectedCodespace] = useState<GitHubCodespace | null>(null)
  const [isPollingCodespace, setIsPollingCodespace] = useState(false)

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const activeCloneId = activeSession?.local_clone_id ?? null

  // Poll codespace status when connected
  const pollCodespaceStatus = useCallback(async () => {
    if (!connectedCodespace) return

    try {
      const response = await fetch(
        `/api/projects/${projectId}/codespaces/${connectedCodespace.name}`
      )
      if (response.ok) {
        const { codespace } = await response.json()
        setConnectedCodespace(codespace)

        // If codespace stopped, clear connection
        if (codespace.state === 'Shutdown' || codespace.state === 'Failed') {
          toast({
            variant: 'destructive',
            title: 'Codespace stopped',
            description: 'The connected codespace has been stopped.',
          })
        }
      }
    } catch {
      // Ignore polling errors
    }
  }, [connectedCodespace, projectId, toast])

  useEffect(() => {
    if (!connectedCodespace) return

    // Poll every 30 seconds
    const interval = setInterval(pollCodespaceStatus, 30000)
    return () => clearInterval(interval)
  }, [connectedCodespace, pollCodespaceStatus])

  const handleConnectCodespace = (codespace: GitHubCodespace) => {
    setConnectedCodespace(codespace)
    setShowConnectionSetup(false)
    toast({
      title: 'Connected to Codespace',
      description: `Now connected to ${codespace.display_name || codespace.name}`,
    })
  }

  const handleDisconnectCodespace = () => {
    setConnectedCodespace(null)
    toast({
      title: 'Disconnected',
      description: 'Codespace has been disconnected.',
    })
  }

  const handleCreateSession = async (taskId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/workspace/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: taskId,
          codespace_name: connectedCodespace?.name,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create session')
      }

      const newSession = await response.json()
      setSessions((prev) => [...prev, newSession])
      setActiveSessionId(newSession.id)
      setShowTaskSelector(false)
      toast({ title: 'Session created' })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create session',
      })
    }
  }

  const handleCloseSession = async (sessionId: string) => {
    try {
      await fetch(`/api/projects/${projectId}/workspace/sessions/${sessionId}`, {
        method: 'DELETE',
      })
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      if (activeSessionId === sessionId) {
        setActiveSessionId(sessions.find((s) => s.id !== sessionId)?.id ?? null)
      }
      toast({ title: 'Session closed' })
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to close session',
      })
    }
  }

  const handleStatusChange = (sessionId: string, status: WorkspaceSessionData['status']) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, status } : s))
    )
  }

  const handleMessagesUpdate = (sessionId: string, messages: WorkspaceMessageData[]) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, messages } : s))
    )
  }

  const isCodespaceAvailable = connectedCodespace?.state === 'Available'

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Connection status banner */}
      {!connectedCodespace ? (
        <div className="bg-yellow-50 dark:bg-yellow-950 border-b border-yellow-200 dark:border-yellow-800 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-200">
            <Cloud className="h-4 w-4" />
            <span>No Codespace connected</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowConnectionSetup(true)}
            className="text-xs"
          >
            Connect to Codespace
          </Button>
        </div>
      ) : (
        <div className={cn(
          'border-b px-4 py-2 flex items-center justify-between',
          isCodespaceAvailable
            ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800'
            : 'bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800'
        )}>
          <div className="flex items-center gap-2 text-sm">
            <div className={cn(
              'w-2 h-2 rounded-full',
              isCodespaceAvailable ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'
            )} />
            <Cloud className="h-4 w-4" />
            <span className="font-medium">
              {connectedCodespace.display_name || connectedCodespace.name}
            </span>
            <Badge variant="outline" className="text-xs">
              {connectedCodespace.state}
            </Badge>
            {connectedCodespace.git_status && (
              <span className="text-xs text-muted-foreground">
                on {connectedCodespace.git_status.ref}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => window.open(connectedCodespace.web_url, '_blank')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Open in Browser
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowConnectionSetup(true)}
            >
              Change
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={handleDisconnectCodespace}
            >
              Disconnect
            </Button>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <WorkspaceTabBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onCloseSession={handleCloseSession}
        onNewSession={() => setShowTaskSelector(true)}
      />

      {/* Main content - split pane layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Session chat */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {activeSession ? (
            <WorkspaceSession
              session={activeSession}
              codespace={connectedCodespace}
              onStatusChange={(status) => handleStatusChange(activeSession.id, status)}
              onMessagesUpdate={(messages) => handleMessagesUpdate(activeSession.id, messages)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
              <Terminal className="h-12 w-12" />
              <div className="text-center">
                <h3 className="font-medium text-lg">No Active Sessions</h3>
                <p className="text-sm">
                  {connectedCodespace
                    ? 'Start a new Claude Code session for a task'
                    : 'Connect to a Codespace to get started'}
                </p>
              </div>
              {connectedCodespace ? (
                <Button onClick={() => setShowTaskSelector(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Start New Session
                </Button>
              ) : (
                <Button onClick={() => setShowConnectionSetup(true)}>
                  <Cloud className="h-4 w-4 mr-2" />
                  Connect to Codespace
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Activity panel toggle button */}
        <Button
          variant="ghost"
          size="sm"
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-12 w-6 rounded-l-md rounded-r-none border border-r-0 bg-background shadow-sm"
          onClick={() => setShowActivityPanel(!showActivityPanel)}
        >
          {showActivityPanel ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRight className="h-4 w-4" />
          )}
        </Button>

        {/* Right: Activity panel (collapsible) */}
        <Collapsible open={showActivityPanel} className="relative">
          <CollapsibleContent
            className={cn(
              'w-80 border-l bg-background flex flex-col h-full overflow-hidden',
              'data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down'
            )}
          >
            {/* Git controls bar */}
            <WorkspaceGitControls
              cloneId={activeCloneId}
              projectId={projectId}
              codespace={connectedCodespace}
            />

            {/* File activity - upper section */}
            <div className="flex-1 min-h-0 border-b overflow-hidden">
              <WorkspaceFileActivity
                sessionId={activeSessionId}
                projectId={projectId}
              />
            </div>

            {/* Git status - lower section */}
            <div className="h-64 min-h-0 overflow-hidden">
              <WorkspaceGitStatus
                cloneId={activeCloneId}
                projectId={projectId}
                codespace={connectedCodespace}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Dialogs */}
      <WorkspaceTaskSelector
        open={showTaskSelector}
        onOpenChange={setShowTaskSelector}
        projectId={projectId}
        existingTaskIds={sessions.map((s) => s.task_id)}
        onSelectTask={(task) => handleCreateSession(task.id)}
      />

      <WorkspaceConnectionSetup
        open={showConnectionSetup}
        onOpenChange={setShowConnectionSetup}
        projectId={projectId}
        onConnect={handleConnectCodespace}
        selectedCodespace={connectedCodespace}
      />
    </div>
  )
}
