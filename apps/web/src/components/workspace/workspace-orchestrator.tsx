'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Send,
  Loader2,
  Bot,
  User,
  Sparkles,
  Eye,
  ChevronDown,
  ChevronUp,
  Users,
  Circle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkspaceTab } from './workspace-tabs'

interface OrchestratorMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  workspaceContext?: {
    tabId: string
    repoName: string
    activity: string
  }
}

interface TeamSession {
  id: string
  userId: string
  userName: string
  userEmail: string
  repoName: string | null
  codespaceName: string | null
  status: string
  taskKey: string | null
  taskTitle: string | null
  lastActivityAt: string | null
  isCurrentUser: boolean
}

interface WorkspaceOrchestratorProps {
  tabs: WorkspaceTab[]
  projectId: string
  isExpanded: boolean
  onToggleExpand: () => void
}

export function WorkspaceOrchestrator({
  tabs,
  projectId,
  isExpanded,
  onToggleExpand,
}: WorkspaceOrchestratorProps) {
  const [messages, setMessages] = useState<OrchestratorMessage[]>([
    {
      id: 'system-1',
      role: 'system',
      content: 'I am the Workspace Orchestrator. I can see all active workspaces across your entire team and help coordinate work. Ask me about team activity or request help with cross-repo tasks.',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [teamSessions, setTeamSessions] = useState<TeamSession[]>([])
  const [isLoadingTeam, setIsLoadingTeam] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Fetch team sessions
  const fetchTeamSessions = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/workspace/orchestrator`)
      if (response.ok) {
        const data = await response.json()
        setTeamSessions(data.sessions || [])
      }
    } catch (error) {
      console.error('Failed to fetch team sessions:', error)
    }
  }, [projectId])

  // Initial fetch and polling for team sessions
  useEffect(() => {
    fetchTeamSessions()
    const interval = setInterval(fetchTeamSessions, 10000) // Poll every 10 seconds
    return () => clearInterval(interval)
  }, [fetchTeamSessions])

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Group sessions
  const mySessions = teamSessions.filter(s => s.isCurrentUser)
  const otherSessions = teamSessions.filter(s => !s.isCurrentUser)
  const otherUsersCount = new Set(otherSessions.map(s => s.userId)).size

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: OrchestratorMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      // Build context about active workspaces
      const workspaceContext = tabs.map((tab) => ({
        repoName: `${tab.repoOwner}/${tab.repoName}`,
        codespaceName: tab.codespace.name,
        state: tab.codespace.state,
        branch: tab.codespace.git_status?.ref || 'unknown',
      }))

      // Call orchestrator API
      const response = await fetch(`/api/projects/${projectId}/workspace/orchestrator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input.trim(),
          workspaceContext,
          conversationHistory: messages.slice(-10),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get response from orchestrator')
      }

      const data = await response.json()

      // Update team sessions from response
      if (data.teamSessions) {
        setTeamSessions(data.teamSessions)
      }

      const assistantMessage: OrchestratorMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error('Orchestrator error:', error)
      const errorMessage: OrchestratorMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Collapsed view
  if (!isExpanded) {
    return (
      <div
        className="border-t bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 cursor-pointer"
        onClick={onToggleExpand}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            <span className="text-sm font-medium">Workspace Orchestrator</span>
            <Badge variant="outline" className="text-xs">
              {tabs.length} workspace{tabs.length !== 1 ? 's' : ''}
            </Badge>
            {otherUsersCount > 0 && (
              <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                <Users className="h-3 w-3 mr-1" />
                {otherUsersCount} teammate{otherUsersCount !== 1 ? 's' : ''} active
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Watching all workspaces</span>
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </div>
    )
  }

  // Expanded view
  return (
    <div className="border-t flex flex-col h-96 bg-gradient-to-r from-purple-50/50 to-blue-50/50 dark:from-purple-950/20 dark:to-blue-950/20">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b cursor-pointer"
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-medium">Workspace Orchestrator</span>
          <Badge variant="outline" className="text-xs">
            {tabs.length} active
          </Badge>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Team Activity Bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30 overflow-x-auto">
        <TooltipProvider>
          {/* Your workspaces */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">You:</span>
            {tabs.map((tab) => (
              <Badge key={tab.id} variant="secondary" className="text-xs whitespace-nowrap">
                {tab.repoName}
              </Badge>
            ))}
            {tabs.length === 0 && (
              <span className="text-xs text-muted-foreground italic">No active workspaces</span>
            )}
          </div>

          {/* Divider if other users exist */}
          {otherUsersCount > 0 && (
            <>
              <div className="w-px h-4 bg-border flex-shrink-0" />

              {/* Other team members */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Users className="h-3.5 w-3.5 text-green-500" />
                <span className="text-xs text-muted-foreground">Team:</span>
                {otherSessions.map((session) => (
                  <Tooltip key={session.id}>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className="text-xs whitespace-nowrap border-green-500/50 bg-green-50 dark:bg-green-950/30 cursor-help"
                      >
                        <Circle className="h-2 w-2 mr-1 fill-green-500 text-green-500" />
                        {session.userName}
                        {session.repoName && `: ${session.repoName.split('/')[1]}`}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs space-y-1">
                        <p className="font-medium">{session.userName}</p>
                        {session.repoName && <p>Repo: {session.repoName}</p>}
                        {session.taskKey && <p>Task: {session.taskKey}</p>}
                        {session.codespaceName && <p>Codespace: {session.codespaceName}</p>}
                        <p className="text-muted-foreground">Status: {session.status}</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </>
          )}
        </TooltipProvider>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'flex gap-3',
                message.role === 'user' && 'flex-row-reverse'
              )}
            >
              <div
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : message.role === 'system'
                    ? 'bg-purple-500 text-white'
                    : 'bg-gradient-to-br from-purple-500 to-blue-500 text-white'
                )}
              >
                {message.role === 'user' ? (
                  <User className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
              </div>
              <div
                className={cn(
                  'flex-1 rounded-lg px-3 py-2 text-sm',
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground ml-12'
                    : 'bg-muted mr-12'
                )}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.workspaceContext && (
                  <div className="mt-2 text-xs opacity-70">
                    From: {message.workspaceContext.repoName}
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                <Loader2 className="h-4 w-4 text-white animate-spin" />
              </div>
              <div className="flex-1 rounded-lg bg-muted px-3 py-2 mr-12">
                <span className="text-sm text-muted-foreground">Thinking...</span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={otherUsersCount > 0
              ? `Ask about team activity (${otherUsersCount} teammate${otherUsersCount !== 1 ? 's' : ''} working)...`
              : 'Ask the orchestrator about your workspaces...'}
            className="min-h-[60px] max-h-[100px] resize-none text-sm"
            disabled={isLoading}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="self-end bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
