'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Loader2, Sparkles, ExternalLink, Cloud, GitBranch, Terminal, MessageSquare, Wand2, FileText, Box } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { ImplementPanel, type AutomationControlRef } from '@/components/sidequests/implementation/implement-panel'
import { WorkspaceTerminal } from '@/components/workspace/workspace-terminal'
import type { Sidequest, SidequestTicket, SidequestImplementationSession } from '@laneshare/shared'
import type { GitHubCodespace } from '@/lib/github'
import type { TicketContextResponse } from '@/app/api/projects/[id]/sidequests/[sqId]/tickets/[ticketId]/context/route'

// Format a ticket with full context as a task prompt for Claude
function formatTicketAsPrompt(
  ticket: SidequestTicket,
  context?: TicketContextResponse | null
): string {
  const parts = [
    `# Task: ${ticket.title}`,
    '',
  ]

  if (ticket.description) {
    parts.push(`## Description`)
    parts.push(ticket.description)
    parts.push('')
  }

  if (ticket.acceptance_criteria && ticket.acceptance_criteria.length > 0) {
    parts.push('## Acceptance Criteria')
    ticket.acceptance_criteria.forEach((criteria, i) => {
      parts.push(`${i + 1}. ${criteria}`)
    })
    parts.push('')
  }

  if (ticket.priority) {
    parts.push(`**Priority:** ${ticket.priority}`)
    parts.push('')
  }

  // Add context information
  if (context) {
    // Add sidequest context
    if (context.sidequest) {
      parts.push('## Project Context')
      parts.push(`This task is part of: **${context.sidequest.title}**`)
      if (context.sidequest.description) {
        parts.push(context.sidequest.description)
      }
      parts.push('')
    }

    // Add linked repos
    if (context.repos && context.repos.length > 0) {
      parts.push('## Related Repositories')
      context.repos.forEach(repo => {
        parts.push(`- **${repo.fullName}** (branch: ${repo.defaultBranch || 'main'})`)
        if (repo.description) {
          parts.push(`  ${repo.description}`)
        }
      })
      parts.push('')
    }

    // Add linked architecture features
    if (context.features && context.features.length > 0) {
      parts.push('## Related Architecture Features')
      context.features.forEach(feature => {
        parts.push(`### ${feature.name}`)
        if (feature.description) {
          parts.push(feature.description)
        }
        parts.push('')
      })
    }

    // Add linked documents with their full content
    if (context.documents && context.documents.length > 0) {
      parts.push('## Reference Documentation')
      parts.push('')
      context.documents.forEach(doc => {
        parts.push(`### ${doc.title}`)
        if (doc.description) {
          parts.push(`*${doc.description}*`)
          parts.push('')
        }
        if (doc.markdown) {
          // Include the full document content
          parts.push(doc.markdown)
        }
        parts.push('')
        parts.push('---')
        parts.push('')
      })
    }

    // Add key files from context analysis if available
    const analysis = context.ticket.context_analysis as {
      key_files?: Array<{ path: string; repo_id?: string; relevance?: string }>
    } | null
    if (analysis?.key_files && analysis.key_files.length > 0) {
      parts.push('## Key Files to Consider')
      analysis.key_files.forEach(file => {
        parts.push(`- \`${file.path}\`${file.relevance ? ` - ${file.relevance}` : ''}`)
      })
      parts.push('')
    }
  }

  parts.push('---')
  parts.push('')
  parts.push('Please implement this task based on the context above. When you\'re done, summarize what you did.')

  return parts.filter(p => p !== undefined).join('\n')
}

export default function ImplementPage() {
  const router = useRouter()
  const params = useParams()
  const projectId = params.id as string
  const sqId = params.sqId as string
  const { toast } = useToast()

  const [sidequest, setSidequest] = useState<Sidequest | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [currentSession, setCurrentSession] = useState<SidequestImplementationSession | null>(null)
  const [ticketContext, setTicketContext] = useState<TicketContextResponse | null>(null)
  const [isLoadingContext, setIsLoadingContext] = useState(false)
  const [activeCodespace, setActiveCodespace] = useState<{
    codespace: GitHubCodespace
    repoId: string
    repoName: string
    repoOwner: string
  } | null>(null)
  const [claudeReady, setClaudeReady] = useState(false)
  const [taskSent, setTaskSent] = useState(false)

  // Ref to control the terminal
  const sendToClaudeRef = useRef<((message: string) => void) | null>(null)
  // Ref to control automation state in the panel
  const automationControlRef = useRef<AutomationControlRef | null>(null)

  // Fetch sidequest
  useEffect(() => {
    const fetchSidequest = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/sidequests/${sqId}`)
        if (!response.ok) throw new Error('Failed to fetch sidequest')
        const data = await response.json()
        setSidequest(data)
      } catch (error) {
        console.error('Fetch error:', error)
        toast({ title: 'Error', description: 'Failed to load sidequest', variant: 'destructive' })
      } finally {
        setIsLoading(false)
      }
    }

    fetchSidequest()
  }, [projectId, sqId, toast])

  // Fetch current implementation session
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/sidequests/${sqId}/implement`)
        if (response.ok) {
          const data = await response.json()
          setCurrentSession(data)
        }
      } catch (error) {
        console.error('Failed to fetch session:', error)
      }
    }

    fetchSession()
    // Poll for updates
    const interval = setInterval(fetchSession, 5000)
    return () => clearInterval(interval)
  }, [projectId, sqId])

  // Fetch ticket context when current ticket changes
  useEffect(() => {
    const ticketId = currentSession?.current_ticket?.id
    if (!ticketId) {
      setTicketContext(null)
      return
    }

    const fetchContext = async () => {
      setIsLoadingContext(true)
      try {
        const response = await fetch(
          `/api/projects/${projectId}/sidequests/${sqId}/tickets/${ticketId}/context`
        )
        if (response.ok) {
          const data = await response.json()
          setTicketContext(data)
        } else {
          console.error('Failed to fetch ticket context:', response.status)
          setTicketContext(null)
        }
      } catch (error) {
        console.error('Error fetching ticket context:', error)
        setTicketContext(null)
      } finally {
        setIsLoadingContext(false)
      }
    }

    fetchContext()
  }, [currentSession?.current_ticket?.id, projectId, sqId])

  // Format current ticket as initial task with full context
  // Note: Don't make this dependent on taskSent - the task content should be stable
  // The taskSent flag is tracked separately to prevent duplicate sends
  // Wait for context to be loaded before creating the task
  const initialTask = useMemo(() => {
    if (currentSession?.current_ticket && !isLoadingContext) {
      return formatTicketAsPrompt(currentSession.current_ticket, ticketContext)
    }
    return undefined
  }, [currentSession?.current_ticket, ticketContext, isLoadingContext])

  // Handle codespace ready from automation
  const handleCodespaceReady = useCallback((codespace: GitHubCodespace, repoId: string) => {
    setActiveCodespace({
      codespace,
      repoId,
      repoName: codespace.repository.name,
      repoOwner: codespace.repository.owner.login,
    })
    toast({
      title: 'Codespace Ready',
      description: `Connected to ${codespace.repository.name}`,
    })
  }, [toast])

  // Handle disconnect
  const handleDisconnect = useCallback(() => {
    setActiveCodespace(null)
    setClaudeReady(false)
    setTaskSent(false)
  }, [])

  // Handle Claude ready
  const handleClaudeReady = useCallback(() => {
    setClaudeReady(true)
    // Update the automation state in the panel
    automationControlRef.current?.markClaudeReady()
    toast({
      title: 'Claude Ready',
      description: 'Claude Code is ready to receive tasks',
    })
  }, [toast])

  // Handle terminal connected
  const handleTerminalConnected = useCallback(() => {
    // Update the automation state in the panel
    automationControlRef.current?.markTerminalReady()
    toast({
      title: 'Terminal Connected',
      description: 'Connected to the codespace terminal',
    })
  }, [toast])

  // Track when task is sent
  useEffect(() => {
    if (claudeReady && initialTask && !taskSent) {
      // The WorkspaceTerminal will auto-send via initialTask prop
      setTaskSent(true)
      // Update the automation state in the panel
      automationControlRef.current?.markTaskSent()
    }
  }, [claudeReady, initialTask, taskSent])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!sidequest) {
    return (
      <div className="container max-w-6xl py-6">
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">Sidequest not found</p>
          <Button
            variant="outline"
            onClick={() => router.push(`/projects/${projectId}/sidequests`)}
            className="mt-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Sidequests
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="container max-w-7xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push(`/projects/${projectId}/sidequests/${sqId}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-bold">{sidequest.title}</h1>
              <Badge variant="default">Implementation</Badge>
            </div>
            {sidequest.description && (
              <p className="text-muted-foreground mt-1">{sidequest.description}</p>
            )}
          </div>
        </div>

        <Button
          variant="outline"
          onClick={() => router.push(`/projects/${projectId}/workspace`)}
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Full Workspace
        </Button>
      </div>

      {/* Implementation layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Implementation panel */}
        <ImplementPanel
          sidequestId={sqId}
          projectId={projectId}
          repoIds={sidequest.repo_ids}
          onClose={() => router.push(`/projects/${projectId}/sidequests/${sqId}`)}
          onCodespaceReady={handleCodespaceReady}
          automationControlRef={automationControlRef}
        />

        {/* Right: Workspace Terminal */}
        <Card className="h-[700px] flex flex-col">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Wand2 className="h-4 w-4" />
                Claude Code Workspace
              </CardTitle>
              {activeCodespace && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {activeCodespace.repoOwner}/{activeCodespace.repoName}
                  </Badge>
                  {claudeReady && (
                    <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                      Claude Ready
                    </Badge>
                  )}
                  <Button variant="ghost" size="sm" onClick={handleDisconnect}>
                    Disconnect
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            {activeCodespace ? (
              // Show workspace terminal
              <div className="h-full flex flex-col">
                <WorkspaceTerminal
                  codespaceUrl={activeCodespace.codespace.web_url}
                  codespaceName={activeCodespace.codespace.name}
                  repoName={`${activeCodespace.repoOwner}/${activeCodespace.repoName}`}
                  repoId={activeCodespace.repoId}
                  isActive={activeCodespace.codespace.state === 'Available'}
                  onTerminalConnected={handleTerminalConnected}
                  onClaudeReady={handleClaudeReady}
                  initialTask={initialTask}
                  sendChatMessageRef={sendToClaudeRef}
                />
              </div>
            ) : (
              // Show waiting for automation
              <div className="h-full flex flex-col items-center justify-center bg-muted/50 p-6">
                <Cloud className="h-16 w-16 text-muted-foreground/30 mb-4" />
                <h3 className="text-lg font-medium mb-2">Workspace Connecting</h3>
                <p className="text-muted-foreground text-center text-sm mb-4 max-w-md">
                  Click "Start Implementation" in the panel to the left.
                  The workspace will automatically:
                </p>
                <ul className="text-sm text-muted-foreground space-y-2 mb-6">
                  <li className="flex items-center gap-2">
                    <Cloud className="h-4 w-4" />
                    Find or create a GitHub Codespace
                  </li>
                  <li className="flex items-center gap-2">
                    <Terminal className="h-4 w-4" />
                    Connect to the terminal
                  </li>
                  <li className="flex items-center gap-2">
                    <Wand2 className="h-4 w-4" />
                    Set up Claude Code
                  </li>
                  <li className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Send the current ticket for implementation
                  </li>
                </ul>

                {/* Sidequest repos */}
                {sidequest.repos && sidequest.repos.length > 0 && (
                  <div className="border-t pt-4 w-full max-w-sm">
                    <h4 className="font-medium mb-2 text-sm text-center">Linked Repositories</h4>
                    <div className="space-y-1">
                      {sidequest.repos.map((repo) => (
                        <div
                          key={repo.id}
                          className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
                        >
                          <GitBranch className="h-3 w-3" />
                          <span className="font-mono text-xs">
                            {repo.owner}/{repo.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Context info when ticket is loaded */}
      {currentSession?.current_ticket && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Box className="h-4 w-4" />
              Task Context
              {isLoadingContext && <Loader2 className="h-4 w-4 animate-spin" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Linked Documents */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-500" />
                  Documents ({ticketContext?.documents?.length || 0})
                </h4>
                {ticketContext?.documents && ticketContext.documents.length > 0 ? (
                  <div className="space-y-1">
                    {ticketContext.documents.map(doc => (
                      <div key={doc.id} className="text-xs bg-blue-50 text-blue-700 rounded px-2 py-1">
                        {doc.title}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No documents linked</p>
                )}
              </div>

              {/* Linked Repos */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-green-500" />
                  Repositories ({ticketContext?.repos?.length || 0})
                </h4>
                {ticketContext?.repos && ticketContext.repos.length > 0 ? (
                  <div className="space-y-1">
                    {ticketContext.repos.map(repo => (
                      <div key={repo.id} className="text-xs bg-green-50 text-green-700 rounded px-2 py-1 font-mono">
                        {repo.fullName}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No repos linked</p>
                )}
              </div>

              {/* Linked Features */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Box className="h-4 w-4 text-purple-500" />
                  Features ({ticketContext?.features?.length || 0})
                </h4>
                {ticketContext?.features && ticketContext.features.length > 0 ? (
                  <div className="space-y-1">
                    {ticketContext.features.map(feature => (
                      <div key={feature.id} className="text-xs bg-purple-50 text-purple-700 rounded px-2 py-1">
                        {feature.name}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No features linked</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress info when connected */}
      {activeCodespace && (
        <Card>
          <CardContent className="py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{sidequest.total_tickets}</div>
                <div className="text-xs text-muted-foreground">Total Tickets</div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{sidequest.completed_tickets}</div>
                <div className="text-xs text-muted-foreground">Completed</div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {sidequest.total_tickets - sidequest.completed_tickets}
                </div>
                <div className="text-xs text-muted-foreground">Remaining</div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-amber-600">
                  {Math.round((sidequest.completed_tickets / Math.max(sidequest.total_tickets, 1)) * 100)}%
                </div>
                <div className="text-xs text-muted-foreground">Progress</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
