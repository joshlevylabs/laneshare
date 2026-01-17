'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useToast } from '@/hooks/use-toast'
import { useDbSession } from '@/hooks/use-db-session'
import { useOrchestratorEvents } from '@/hooks/use-orchestrator-events'
import { WorkspaceTabs, type WorkspaceTab } from './workspace-tabs'
import { WorkspaceTerminal } from './workspace-terminal'
import { WorkspaceOrchestrator } from './workspace-orchestrator'
import { WorkspaceConnectionSetup } from './workspace-connection-setup'
import { ConflictNotification } from './conflict-notification'
import { CrossSessionPanel } from './cross-session-panel'
import { Cloud, Terminal, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Task } from '@laneshare/shared'
import type { GitHubCodespace } from '@/lib/github'

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
  bridge_connected: boolean
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

  // Multi-tab workspace state
  const [tabs, setTabs] = useState<WorkspaceTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [showConnectionSetup, setShowConnectionSetup] = useState(false)
  const [orchestratorExpanded, setOrchestratorExpanded] = useState(false)
  const [dismissedConflicts, setDismissedConflicts] = useState<Set<string>>(new Set())

  const activeTab = tabs.find((t) => t.id === activeTabId)

  // Database session for the active tab
  const {
    session: dbSession,
    sessionId,
    isLoading: sessionLoading,
  } = useDbSession({
    projectId,
    codespaceName: activeTab?.codespace?.name,
    repoId: activeTab?.repoId,
    enabled: !!activeTab,
  })

  // Orchestrator events (file conflicts, cross-session messages)
  const {
    isConnected: eventsConnected,
    conflicts: rawConflicts,
    pendingRequests,
    clearConflict,
    respondToRequest,
    reportFileActivity,
  } = useOrchestratorEvents({
    projectId,
    sessionId,
    enabled: !!sessionId,
    onFileConflict: (conflict) => {
      toast({
        title: 'File Conflict Detected',
        description: `${conflict.filePath} is being edited by another team member`,
        variant: 'destructive',
      })
    },
    onCrossSessionRequest: (request) => {
      toast({
        title: 'Cross-Session Request',
        description: `${request.sourceSession.userName} sent you a ${request.messageType}`,
      })
    },
  })

  // Filter out dismissed conflicts
  const conflicts = useMemo(
    () => rawConflicts.filter((c) => !dismissedConflicts.has(c.filePath)),
    [rawConflicts, dismissedConflicts]
  )

  const handleDismissConflict = useCallback((filePath: string) => {
    setDismissedConflicts((prev) => new Set([...Array.from(prev), filePath]))
    clearConflict(filePath)
  }, [clearConflict])

  const handleDismissAllConflicts = useCallback(() => {
    const allPaths = conflicts.map((c) => c.filePath)
    setDismissedConflicts((prev) => new Set([...Array.from(prev), ...allPaths]))
    allPaths.forEach((path) => clearConflict(path))
  }, [conflicts, clearConflict])

  // Poll for codespace status updates
  const pollCodespaceStatus = useCallback(async () => {
    for (const tab of tabs) {
      try {
        const response = await fetch(
          `/api/projects/${projectId}/codespaces/${tab.codespace.name}`
        )
        if (response.ok) {
          const { codespace } = await response.json()
          setTabs((prev) =>
            prev.map((t) =>
              t.id === tab.id ? { ...t, codespace } : t
            )
          )
        }
      } catch {
        // Ignore polling errors
      }
    }
  }, [tabs, projectId])

  useEffect(() => {
    if (tabs.length === 0) return

    const interval = setInterval(pollCodespaceStatus, 30000)
    return () => clearInterval(interval)
  }, [tabs.length, pollCodespaceStatus])

  const handleAddCodespace = (codespace: GitHubCodespace, repoId: string) => {
    // Check if this codespace is already in tabs
    const existingTab = tabs.find((t) => t.codespace.name === codespace.name)
    if (existingTab) {
      setActiveTabId(existingTab.id)
      setShowConnectionSetup(false)
      toast({
        title: 'Already Connected',
        description: `${codespace.repository.name} is already in your workspace.`,
      })
      return
    }

    const newTab: WorkspaceTab = {
      id: crypto.randomUUID(),
      codespace,
      repoName: codespace.repository.name,
      repoOwner: codespace.repository.owner.login,
      repoId,
    }
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
    setShowConnectionSetup(false)

    toast({
      title: 'Codespace Connected',
      description: `Added ${codespace.repository.name} to your workspace.`,
    })
  }

  const handleCloseTab = (tabId: string) => {
    const closingTab = tabs.find((t) => t.id === tabId)
    setTabs((prev) => prev.filter((t) => t.id !== tabId))

    if (activeTabId === tabId) {
      const remainingTabs = tabs.filter((t) => t.id !== tabId)
      setActiveTabId(remainingTabs[0]?.id ?? null)
    }

    if (closingTab) {
      toast({
        title: 'Workspace Closed',
        description: `Removed ${closingTab.repoName} from your workspace.`,
      })
    }
  }

  // Empty state - no workspaces connected
  if (tabs.length === 0 && !showConnectionSetup) {
    return (
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        {/* Empty state */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-lg">
            <div className="relative mb-8">
              <Cloud className="h-20 w-20 mx-auto text-muted-foreground/30" />
              <Terminal className="h-10 w-10 absolute bottom-0 right-1/2 translate-x-8 text-primary" />
            </div>
            <h2 className="text-2xl font-semibold mb-3">Multi-Repo Workspace</h2>
            <p className="text-muted-foreground mb-6">
              Connect to GitHub Codespaces and work with Claude Code directly in your browser.
              Add multiple repositories and use the Orchestrator to coordinate between them.
            </p>
            <div className="flex flex-col gap-3 items-center">
              <Button size="lg" onClick={() => setShowConnectionSetup(true)}>
                <Cloud className="h-4 w-4 mr-2" />
                Connect to Codespace
              </Button>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="h-4 w-4 text-purple-500" />
                <span>Orchestrator agent helps coordinate cross-repo work</span>
              </div>
            </div>
          </div>
        </div>

        {/* Connection dialog */}
        <WorkspaceConnectionSetup
          open={showConnectionSetup}
          onOpenChange={setShowConnectionSetup}
          projectId={projectId}
          onConnect={handleAddCodespace}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Tab bar */}
      <WorkspaceTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={handleCloseTab}
        onAddTab={() => setShowConnectionSetup(true)}
      />

      {/* Conflict notifications */}
      {conflicts.length > 0 && (
        <div className="px-4 pt-2">
          <ConflictNotification
            conflicts={conflicts}
            onDismiss={handleDismissConflict}
            onDismissAll={handleDismissAllConflicts}
          />
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 min-h-0 flex">
        {/* Terminal panel */}
        <div className="flex-1 p-4">
          {activeTab ? (
            <WorkspaceTerminal
              codespaceUrl={activeTab.codespace.web_url}
              codespaceName={activeTab.codespace.name}
              repoName={`${activeTab.repoOwner}/${activeTab.repoName}`}
              repoId={activeTab.repoId}
              isActive={activeTab.codespace.state === 'Available'}
            />
          ) : tabs.length > 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p>Select a tab to view the terminal</p>
            </div>
          ) : null}
        </div>

        {/* Cross-session panel (right side) */}
        {pendingRequests.length > 0 && (
          <div className="w-80 border-l p-4">
            <CrossSessionPanel
              pendingRequests={pendingRequests}
              onRespond={respondToRequest}
              isConnected={eventsConnected}
            />
          </div>
        )}
      </div>

      {/* Orchestrator panel */}
      <WorkspaceOrchestrator
        tabs={tabs}
        projectId={projectId}
        isExpanded={orchestratorExpanded}
        onToggleExpand={() => setOrchestratorExpanded(!orchestratorExpanded)}
      />

      {/* Connection dialog */}
      <WorkspaceConnectionSetup
        open={showConnectionSetup}
        onOpenChange={setShowConnectionSetup}
        projectId={projectId}
        onConnect={handleAddCodespace}
      />
    </div>
  )
}
