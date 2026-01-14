'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { WorkspaceTabBar } from './workspace-tab-bar'
import { WorkspaceSession } from './workspace-session'
import { WorkspaceConnectionSetup } from './workspace-connection-setup'
import { WorkspaceTaskSelector } from './workspace-task-selector'
import { Plus, Terminal } from 'lucide-react'
import type { Task } from '@laneshare/shared'

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

export interface WorkspaceConnectionConfig {
  host: string
  port: number
  apiKey?: string
}

export interface WorkspaceViewProps {
  projectId: string
  initialSessions?: WorkspaceSessionData[]
  tasks?: Task[]
}

const DEFAULT_CONFIG: WorkspaceConnectionConfig = {
  host: 'localhost',
  port: 7890,
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
  const [connectionConfig, setConnectionConfig] = useState<WorkspaceConnectionConfig>(DEFAULT_CONFIG)
  const [isConnected, setIsConnected] = useState(false)
  const [isCheckingConnection, setIsCheckingConnection] = useState(false)

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  // Check connection on mount
  useEffect(() => {
    checkConnection()
    const interval = setInterval(checkConnection, 30000)
    return () => clearInterval(interval)
  }, [connectionConfig])

  const checkConnection = async () => {
    setIsCheckingConnection(true)
    try {
      const response = await fetch(
        `http://${connectionConfig.host}:${connectionConfig.port}/health`,
        {
          method: 'GET',
          signal: AbortSignal.timeout(3000),
        }
      )
      setIsConnected(response.ok)
    } catch {
      setIsConnected(false)
    } finally {
      setIsCheckingConnection(false)
    }
  }

  const handleCreateSession = async (taskId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/workspace/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
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
    } catch (error) {
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

  const localServerUrl = `http://${connectionConfig.host}:${connectionConfig.port}`

  // Get tasks that don't have an active session
  const availableTasks = tasks.filter(
    (t) => !sessions.some((s) => s.task_id === t.id)
  )

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Connection status banner */}
      {!isConnected && (
        <div className="bg-yellow-50 dark:bg-yellow-950 border-b border-yellow-200 dark:border-yellow-800 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-200">
            <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            <span>Local Claude Code server not connected</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowConnectionSetup(true)}
            className="text-xs"
          >
            Configure Connection
          </Button>
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

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {activeSession ? (
          <WorkspaceSession
            session={activeSession}
            localServerUrl={localServerUrl}
            onStatusChange={(status) => handleStatusChange(activeSession.id, status)}
            onMessagesUpdate={(messages) => handleMessagesUpdate(activeSession.id, messages)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
            <Terminal className="h-12 w-12" />
            <div className="text-center">
              <h3 className="font-medium text-lg">No Active Sessions</h3>
              <p className="text-sm">Start a new Claude Code session for a task</p>
            </div>
            <Button onClick={() => setShowTaskSelector(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Start New Session
            </Button>
          </div>
        )}
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
        currentUrl={localServerUrl}
        onConnect={(url) => {
          const urlParts = url.replace('http://', '').split(':')
          setConnectionConfig({
            host: urlParts[0] || 'localhost',
            port: parseInt(urlParts[1] || '7890', 10),
          })
          checkConnection()
          setShowConnectionSetup(false)
        }}
      />
    </div>
  )
}
