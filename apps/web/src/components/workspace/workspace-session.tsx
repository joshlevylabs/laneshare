'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Loader2,
  AlertCircle,
  Cloud,
  ExternalLink,
  Terminal,
  CheckCircle,
  Copy,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import { WorkspaceMessage } from './workspace-message'
import type { WorkspaceSessionData, WorkspaceMessageData } from './workspace-view'
import type { GitHubCodespace } from '@/lib/github'

interface WorkspaceSessionProps {
  session: WorkspaceSessionData
  codespace: GitHubCodespace | null
  projectId: string
  onStatusChange: (status: WorkspaceSessionData['status']) => void
  onMessagesUpdate: (messages: WorkspaceMessageData[]) => void
}

export function WorkspaceSession({
  session,
  codespace,
  projectId,
  onStatusChange,
  onMessagesUpdate,
}: WorkspaceSessionProps) {
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [session.messages])

  // Poll for new messages/activity from the bridge
  const pollMessages = useCallback(async () => {
    if (!session.bridge_connected) return

    try {
      const response = await fetch(
        `/api/projects/${projectId}/workspace/sessions/${session.id}/messages`
      )
      if (response.ok) {
        const messages = await response.json()
        if (Array.isArray(messages) && messages.length > session.messages.length) {
          const formattedMessages: WorkspaceMessageData[] = messages.map(
            (m: { id: string; role: string; content: string; toolName?: string; toolInput?: Record<string, unknown>; timestamp: string }) => ({
              id: m.id,
              role: m.role as WorkspaceMessageData['role'],
              content: m.content,
              toolName: m.toolName,
              toolInput: m.toolInput,
              timestamp: new Date(m.timestamp),
            })
          )
          onMessagesUpdate(formattedMessages)
        }
      }
    } catch {
      // Ignore polling errors
    }
  }, [session.id, session.bridge_connected, session.messages.length, projectId, onMessagesUpdate])

  // Start polling when bridge is connected
  useEffect(() => {
    if (session.bridge_connected) {
      pollIntervalRef.current = setInterval(pollMessages, 2000)
      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
        }
      }
    }
  }, [session.bridge_connected, pollMessages])

  const handleCopyCommand = async (command: string, id: string) => {
    await navigator.clipboard.writeText(command)
    setCopiedCommand(id)
    setTimeout(() => setCopiedCommand(null), 2000)
  }

  // Check codespace state
  if (!codespace) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <Cloud className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium mb-2">No Codespace Connected</h3>
          <p className="text-sm text-muted-foreground">
            Connect to a GitHub Codespace to start working with Claude Code.
          </p>
        </div>
      </div>
    )
  }

  if (codespace.state !== 'Available') {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
          <h3 className="text-lg font-medium mb-2">
            Codespace {codespace.state === 'Starting' ? 'Starting' : codespace.state}...
          </h3>
          <p className="text-sm text-muted-foreground">
            Please wait for the Codespace to be available. This usually takes 1-2 minutes.
          </p>
        </div>
      </div>
    )
  }

  if (session.status === 'ERROR') {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h3 className="text-lg font-medium text-destructive mb-2">Session Error</h3>
          <p className="text-sm text-muted-foreground">
            {session.error_message || 'Failed to connect to session'}
          </p>
        </div>
      </div>
    )
  }

  // If bridge is connected and we have activity, show the activity log
  if (session.bridge_connected && session.messages.length > 0) {
    return (
      <div className="flex-1 flex flex-col">
        {/* Connected status banner */}
        <div className="px-4 py-3 bg-green-50 dark:bg-green-950/30 border-b border-green-200 dark:border-green-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="font-medium text-green-800 dark:text-green-200">
                Claude Code Active
              </span>
              <span className="text-green-600 dark:text-green-400">
                in {codespace.display_name || codespace.name}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => window.open(codespace.web_url, '_blank')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Open Codespace
            </Button>
          </div>
        </div>

        {/* Activity log */}
        <ScrollArea className="flex-1" ref={scrollRef}>
          <div className="divide-y">
            {session.messages.map((message) => (
              <WorkspaceMessage key={message.id} message={message} />
            ))}
          </div>
        </ScrollArea>
      </div>
    )
  }

  // Main instruction view - Codespace available but Claude Code not yet running
  return (
    <div className="flex-1 flex flex-col">
      {/* Codespace connected banner */}
      <div className="px-4 py-3 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Cloud className="h-4 w-4 text-blue-600" />
            <span className="font-medium text-blue-800 dark:text-blue-200">
              Codespace Ready
            </span>
            <span className="text-blue-600 dark:text-blue-400">
              {codespace.display_name || codespace.name}
            </span>
            {codespace.git_status && (
              <span className="text-blue-500 dark:text-blue-500">
                on {codespace.git_status.ref}
              </span>
            )}
          </div>
          <Button
            variant="default"
            size="sm"
            className="h-8"
            onClick={() => window.open(codespace.web_url, '_blank')}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Open Codespace
          </Button>
        </div>
      </div>

      {/* Getting started instructions */}
      <ScrollArea className="flex-1">
        <div className="p-6 max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <Sparkles className="h-12 w-12 mx-auto mb-4 text-primary" />
            <h2 className="text-xl font-semibold mb-2">Start Coding with Claude</h2>
            <p className="text-muted-foreground">
              Your Codespace is ready. Follow these steps to start using Claude Code.
            </p>
          </div>

          {/* Task context */}
          {session.task && (
            <Alert className="mb-6 border-primary/30 bg-primary/5">
              <Terminal className="h-4 w-4" />
              <AlertDescription>
                <strong>Task:</strong> {session.task.title}
              </AlertDescription>
            </Alert>
          )}

          {/* Steps */}
          <div className="space-y-6">
            {/* Step 1 */}
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
                1
              </div>
              <div className="flex-1 pt-1">
                <h3 className="font-medium mb-2">Open the Codespace</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Click the button above to open your Codespace in VS Code (browser or desktop).
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(codespace.web_url, '_blank')}
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Open in Browser
                </Button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
                2
              </div>
              <div className="flex-1 pt-1">
                <h3 className="font-medium mb-2">Install Claude Code (if needed)</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  In the Codespace terminal, run this command to install Claude Code:
                </p>
                <div className="relative">
                  <pre className="p-3 bg-muted rounded-lg text-sm font-mono pr-12">
                    npm install -g @anthropic/claude-code
                  </pre>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1.5 right-1.5 h-7 w-7 p-0"
                    onClick={() => handleCopyCommand('npm install -g @anthropic/claude-code', 'install')}
                  >
                    {copiedCommand === 'install' ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
                3
              </div>
              <div className="flex-1 pt-1">
                <h3 className="font-medium mb-2">Login to Claude</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Authenticate with your Claude subscription (Max or Pro plan):
                </p>
                <div className="relative">
                  <pre className="p-3 bg-muted rounded-lg text-sm font-mono pr-12">
                    claude login
                  </pre>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1.5 right-1.5 h-7 w-7 p-0"
                    onClick={() => handleCopyCommand('claude login', 'login')}
                  >
                    {copiedCommand === 'login' ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  This uses your personal Claude subscription - you won't be charged API tokens.
                </p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
                4
              </div>
              <div className="flex-1 pt-1">
                <h3 className="font-medium mb-2">Start Claude Code</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Launch Claude Code and start working on your task:
                </p>
                <div className="relative">
                  <pre className="p-3 bg-muted rounded-lg text-sm font-mono pr-12">
                    claude
                  </pre>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1.5 right-1.5 h-7 w-7 p-0"
                    onClick={() => handleCopyCommand('claude', 'start')}
                  >
                    {copiedCommand === 'start' ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Tip for devcontainer */}
          <div className="mt-8 p-4 bg-muted/50 rounded-lg">
            <div className="flex gap-3">
              <ArrowRight className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Pro tip: Auto-setup with devcontainer.json</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Add a devcontainer.json to your repository to automatically install Claude Code
                  when creating new Codespaces. Go to the <strong>Repos</strong> tab and click
                  <strong> Workspace Setup</strong> on your repository to get the configuration.
                </p>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
