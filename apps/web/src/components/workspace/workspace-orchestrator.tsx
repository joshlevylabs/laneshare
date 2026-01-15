'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  Send,
  Loader2,
  Bot,
  User,
  Sparkles,
  Eye,
  ChevronDown,
  ChevronUp,
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
      content: 'I am the Workspace Orchestrator. I can see all your active Codespaces and help coordinate work across multiple repositories. Ask me anything about your workspaces or request help with cross-repo tasks.',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

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
          conversationHistory: messages.slice(-10), // Last 10 messages for context
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get response from orchestrator')
      }

      const data = await response.json()

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
          </div>
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Monitoring all workspaces</span>
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </div>
    )
  }

  // Expanded view
  return (
    <div className="border-t flex flex-col h-80 bg-gradient-to-r from-purple-50/50 to-blue-50/50 dark:from-purple-950/20 dark:to-blue-950/20">
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

      {/* Active workspaces */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30 overflow-x-auto">
        <Eye className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs text-muted-foreground flex-shrink-0">Watching:</span>
        {tabs.map((tab) => (
          <Badge key={tab.id} variant="secondary" className="text-xs whitespace-nowrap">
            {tab.repoName}
          </Badge>
        ))}
        {tabs.length === 0 && (
          <span className="text-xs text-muted-foreground italic">No active workspaces</span>
        )}
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
            placeholder="Ask the orchestrator about your workspaces..."
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
