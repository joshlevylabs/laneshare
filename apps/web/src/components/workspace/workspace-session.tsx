'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Send, Loader2, AlertCircle, Cloud, ExternalLink } from 'lucide-react'
import { WorkspaceMessage } from './workspace-message'
import type { WorkspaceSessionData, WorkspaceMessageData } from './workspace-view'
import type { GitHubCodespace } from '@/lib/github'

interface WorkspaceSessionProps {
  session: WorkspaceSessionData
  codespace: GitHubCodespace | null
  onStatusChange: (status: WorkspaceSessionData['status']) => void
  onMessagesUpdate: (messages: WorkspaceMessageData[]) => void
}

export function WorkspaceSession({
  session,
  codespace,
  onStatusChange,
  onMessagesUpdate,
}: WorkspaceSessionProps) {
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [session.messages])

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return

    if (!codespace || codespace.state !== 'Available') {
      setError('Codespace is not available. Please start or connect to a running codespace.')
      return
    }

    const userMessage: WorkspaceMessageData = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }

    onMessagesUpdate([...session.messages, userMessage])
    setInput('')
    setError(null)
    setIsStreaming(true)

    try {
      // For now, we'll simulate the interaction
      // In a full implementation, this would connect to the Codespace via VS Code Server API
      // or GitHub Codespaces REST API for executing commands

      // Add a system message indicating the codespace connection
      const systemMessage: WorkspaceMessageData = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Connected to Codespace: ${codespace.display_name || codespace.name}\nBranch: ${codespace.git_status?.ref || 'unknown'}\n\nTo run Claude Code in this codespace, open the codespace in VS Code and use the Claude Code extension.`,
        timestamp: new Date(),
      }

      onMessagesUpdate([...session.messages, userMessage, systemMessage])
      setIsStreaming(false)
    } catch (e) {
      setError('Failed to communicate with codespace.')
      setIsStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Check codespace state
  if (!codespace) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Cloud className="h-8 w-8 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground font-medium">No Codespace Connected</p>
          <p className="text-sm text-muted-foreground mt-2">
            Connect to a GitHub Codespace to start a Claude Code session.
          </p>
        </div>
      </div>
    )
  }

  if (codespace.state !== 'Available') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground font-medium">
            Codespace is {codespace.state.toLowerCase()}...
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Please wait for the codespace to be available.
          </p>
        </div>
      </div>
    )
  }

  if (session.status === 'ERROR') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 mx-auto mb-4 text-destructive" />
          <p className="text-destructive font-medium">Session Error</p>
          <p className="text-sm text-muted-foreground mt-2">
            {session.error_message || 'Failed to connect to session'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Codespace info banner */}
      <div className="px-4 py-2 bg-muted/30 border-b text-sm flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cloud className="h-4 w-4 text-green-500" />
          <span>
            Running in <strong>{codespace.display_name || codespace.name}</strong>
          </span>
          {codespace.git_status && (
            <span className="text-muted-foreground">
              on {codespace.git_status.ref}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => window.open(codespace.web_url, '_blank')}
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          Open Codespace
        </Button>
      </div>

      {/* Messages area */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="divide-y">
          {session.messages.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p>No messages yet.</p>
              <p className="text-sm mt-2">
                Send a message to start working on: <strong>{session.task?.title || 'this task'}</strong>
              </p>
              <div className="mt-4 p-4 bg-muted/50 rounded-lg text-left text-sm max-w-md mx-auto">
                <p className="font-medium mb-2">Getting Started:</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>Open the codespace in VS Code (button above)</li>
                  <li>Install the Claude Code extension</li>
                  <li>Start Claude Code in the terminal</li>
                  <li>Work on your task in the codespace</li>
                </ol>
              </div>
            </div>
          ) : (
            session.messages.map((message) => (
              <WorkspaceMessage key={message.id} message={message} />
            ))
          )}
          {isStreaming && (
            <div className="p-4 flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Processing...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Input area */}
      <div className="border-t p-4">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message or describe your task..."
            className="min-h-[80px] resize-none"
            disabled={isStreaming}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="self-end"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
