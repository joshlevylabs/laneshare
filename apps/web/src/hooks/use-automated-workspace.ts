'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { GitHubCodespace } from '@/lib/github'
import type { SidequestTicket } from '@laneshare/shared'

export type AutomationStep =
  | 'idle'
  | 'finding_codespace'
  | 'creating_codespace'
  | 'starting_codespace'
  | 'waiting_codespace'
  | 'connecting_terminal'
  | 'installing_claude'
  | 'sending_task'
  | 'ready'
  | 'error'

export interface AutomationState {
  step: AutomationStep
  message: string
  progress: number
  error?: string
  codespace?: GitHubCodespace
  repoId?: string
  repoName?: string
  terminalReady?: boolean
  claudeReady?: boolean
}

interface UseAutomatedWorkspaceOptions {
  projectId: string
  sidequestId: string
  repoIds?: string[]
  currentTicket?: SidequestTicket | null
  onReady?: (codespace: GitHubCodespace, repoId: string) => void
  onError?: (error: string) => void
  onTaskSent?: () => void
}

const STEP_MESSAGES: Record<AutomationStep, string> = {
  idle: 'Ready to start',
  finding_codespace: 'Looking for existing codespace...',
  creating_codespace: 'Creating new codespace...',
  starting_codespace: 'Starting codespace...',
  waiting_codespace: 'Waiting for codespace to be available...',
  connecting_terminal: 'Connecting to terminal...',
  installing_claude: 'Setting up Claude Code...',
  sending_task: 'Sending ticket to Claude...',
  ready: 'Ready for implementation',
  error: 'An error occurred',
}

const STEP_PROGRESS: Record<AutomationStep, number> = {
  idle: 0,
  finding_codespace: 10,
  creating_codespace: 20,
  starting_codespace: 30,
  waiting_codespace: 50,
  connecting_terminal: 70,
  installing_claude: 80,
  sending_task: 90,
  ready: 100,
  error: 0,
}

export function useAutomatedWorkspace({
  projectId,
  sidequestId,
  repoIds,
  currentTicket,
  onReady,
  onError,
  onTaskSent,
}: UseAutomatedWorkspaceOptions) {
  const [state, setState] = useState<AutomationState>({
    step: 'idle',
    message: STEP_MESSAGES.idle,
    progress: 0,
  })

  const abortControllerRef = useRef<AbortController | null>(null)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const setStep = useCallback((step: AutomationStep, extra?: Partial<AutomationState>) => {
    setState(prev => ({
      ...prev,
      step,
      message: STEP_MESSAGES[step],
      progress: STEP_PROGRESS[step],
      ...extra,
    }))
  }, [])

  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return cleanup
  }, [cleanup])

  // Poll for codespace status until available
  const pollCodespaceStatus = useCallback(async (codespaceName: string): Promise<GitHubCodespace> => {
    return new Promise((resolve, reject) => {
      let attempts = 0
      const maxAttempts = 60 // 5 minutes max

      pollingIntervalRef.current = setInterval(async () => {
        attempts++
        if (attempts >= maxAttempts) {
          clearInterval(pollingIntervalRef.current!)
          reject(new Error('Timeout waiting for codespace to be available'))
          return
        }

        try {
          const response = await fetch(`/api/projects/${projectId}/codespaces/${codespaceName}`)
          if (!response.ok) throw new Error('Failed to get codespace status')

          const data = await response.json()
          const codespace = data.codespace as GitHubCodespace

          // Update message with current state
          setState(prev => ({
            ...prev,
            message: `Codespace status: ${codespace.state}...`,
          }))

          if (codespace.state === 'Available') {
            clearInterval(pollingIntervalRef.current!)
            resolve(codespace)
          } else if (codespace.state === 'Failed') {
            clearInterval(pollingIntervalRef.current!)
            reject(new Error('Codespace failed to start'))
          }
        } catch (error) {
          // Continue polling on error
          console.error('[AutomatedWorkspace] Poll error:', error)
        }
      }, 5000) // Poll every 5 seconds
    })
  }, [projectId])

  // Find or create a codespace for the sidequest repos
  const findOrCreateCodespace = useCallback(async (): Promise<{ codespace: GitHubCodespace; repoId: string }> => {
    setStep('finding_codespace')

    // Fetch existing codespaces
    const response = await fetch(`/api/projects/${projectId}/codespaces`)
    if (!response.ok) {
      throw new Error('Failed to fetch codespaces')
    }

    const data = await response.json()
    const existingCodespaces = data.codespaces as Array<{
      codespace: GitHubCodespace
      repoId: string
      repoFullName: string
    }>
    const repos = data.repos as Array<{ id: string; fullName: string; hasToken: boolean }>

    // Find a codespace for one of the sidequest repos
    if (repoIds && repoIds.length > 0) {
      for (const repoId of repoIds) {
        const found = existingCodespaces.find(c => c.repoId === repoId)
        if (found) {
          return { codespace: found.codespace, repoId: found.repoId }
        }
      }
    }

    // Check if there's any existing codespace we can use
    if (existingCodespaces.length > 0) {
      // Prefer running codespaces
      const running = existingCodespaces.find(c => c.codespace.state === 'Available')
      if (running) {
        return { codespace: running.codespace, repoId: running.repoId }
      }
      // Use first available
      return { codespace: existingCodespaces[0].codespace, repoId: existingCodespaces[0].repoId }
    }

    // Need to create a new codespace
    setStep('creating_codespace')

    // Find a repo with a token
    const targetRepoId = repoIds?.find(id => repos.find(r => r.id === id && r.hasToken))
      || repos.find(r => r.hasToken)?.id

    if (!targetRepoId) {
      throw new Error('No repository with GitHub token found. Please configure a GitHub token for your repository.')
    }

    const createResponse = await fetch(`/api/projects/${projectId}/codespaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoId: targetRepoId,
        displayName: `sidequest-${sidequestId.slice(0, 8)}`,
      }),
    })

    if (!createResponse.ok) {
      const errorData = await createResponse.json()
      throw new Error(errorData.error || 'Failed to create codespace')
    }

    const createData = await createResponse.json()
    return { codespace: createData.codespace, repoId: targetRepoId }
  }, [projectId, sidequestId, repoIds])

  // Start the automation process
  const startAutomation = useCallback(async () => {
    cleanup()
    abortControllerRef.current = new AbortController()

    try {
      // Step 1: Find or create codespace
      const { codespace, repoId } = await findOrCreateCodespace()

      setState(prev => ({
        ...prev,
        codespace,
        repoId,
      }))

      // Step 2: Start codespace if not running
      let currentCodespace = codespace
      if (currentCodespace.state !== 'Available') {
        if (currentCodespace.state === 'Shutdown') {
          setStep('starting_codespace')
          const startResponse = await fetch(`/api/projects/${projectId}/codespaces/${currentCodespace.name}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'start' }),
          })

          if (!startResponse.ok) {
            throw new Error('Failed to start codespace')
          }
        }

        // Step 3: Wait for codespace to be available
        setStep('waiting_codespace')
        currentCodespace = await pollCodespaceStatus(currentCodespace.name)
      }

      // Update state with running codespace
      setState(prev => ({
        ...prev,
        codespace: currentCodespace,
        step: 'connecting_terminal',
        message: STEP_MESSAGES.connecting_terminal,
        progress: STEP_PROGRESS.connecting_terminal,
      }))

      // Step 4: Terminal connection happens in the WorkspaceTerminal component
      // We signal readiness and let the terminal component handle the rest
      onReady?.(currentCodespace, repoId)

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An error occurred'
      setStep('error', { error: errorMessage })
      onError?.(errorMessage)
    }
  }, [cleanup, findOrCreateCodespace, pollCodespaceStatus, projectId, onReady, onError])

  // Step order for comparison (higher index = further along)
  const stepOrderMap: Record<AutomationStep, number> = {
    'idle': 0,
    'finding_codespace': 1,
    'creating_codespace': 2,
    'starting_codespace': 3,
    'waiting_codespace': 4,
    'connecting_terminal': 5,
    'installing_claude': 6,
    'sending_task': 7,
    'ready': 8,
    'error': -1, // error can happen at any time
  }

  // Mark terminal as connected
  const markTerminalReady = useCallback(() => {
    setState(prev => {
      // Only go forward, never backwards
      if (stepOrderMap[prev.step] >= stepOrderMap['installing_claude']) {
        return { ...prev, terminalReady: true }
      }
      return {
        ...prev,
        terminalReady: true,
        step: 'installing_claude' as const,
        message: STEP_MESSAGES.installing_claude,
        progress: STEP_PROGRESS.installing_claude,
      }
    })
  }, [])

  // Mark Claude as ready
  const markClaudeReady = useCallback(() => {
    const nextStep = currentTicket ? 'sending_task' : 'ready'
    setState(prev => {
      // Only go forward, never backwards
      if (stepOrderMap[prev.step] >= stepOrderMap[nextStep]) {
        return { ...prev, claudeReady: true }
      }
      return {
        ...prev,
        claudeReady: true,
        step: nextStep as AutomationStep,
        message: currentTicket ? STEP_MESSAGES.sending_task : STEP_MESSAGES.ready,
        progress: currentTicket ? STEP_PROGRESS.sending_task : STEP_PROGRESS.ready,
      }
    })
  }, [currentTicket])

  // Mark task as sent
  const markTaskSent = useCallback(() => {
    setState(prev => ({
      ...prev,
      step: 'ready',
      message: 'Claude is working on the task',
      progress: 100,
    }))
    onTaskSent?.()
  }, [onTaskSent])

  // Format ticket as a prompt for Claude
  const formatTicketAsPrompt = useCallback((ticket: SidequestTicket): string => {
    const parts = [
      `## Task: ${ticket.title}`,
      '',
      ticket.description ? `### Description\n${ticket.description}` : '',
      '',
    ]

    if (ticket.acceptance_criteria && ticket.acceptance_criteria.length > 0) {
      parts.push('### Acceptance Criteria')
      ticket.acceptance_criteria.forEach((criteria, i) => {
        parts.push(`${i + 1}. ${criteria}`)
      })
      parts.push('')
    }

    parts.push('Please implement this task. When you\'re done, summarize what you did.')

    return parts.filter(Boolean).join('\n')
  }, [])

  // Reset to idle state
  const reset = useCallback(() => {
    cleanup()
    setState({
      step: 'idle',
      message: STEP_MESSAGES.idle,
      progress: 0,
    })
  }, [cleanup])

  return {
    state,
    startAutomation,
    markTerminalReady,
    markClaudeReady,
    markTaskSent,
    formatTicketAsPrompt,
    reset,
    isRunning: !['idle', 'ready', 'error'].includes(state.step),
  }
}
