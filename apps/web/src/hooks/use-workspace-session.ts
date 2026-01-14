'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { WorkspaceMessageData } from '@/components/workspace'

export type SessionStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR'

interface UseWorkspaceSessionOptions {
  serverUrl: string
  sessionId: string | null
  onMessage?: (message: WorkspaceMessageData) => void
  onStatusChange?: (status: SessionStatus) => void
  onError?: (error: string) => void
}

interface UseWorkspaceSessionResult {
  status: SessionStatus
  isStreaming: boolean
  error: string | null
  sendMessage: (content: string) => Promise<void>
  createSession: (taskId: string, projectPath: string) => Promise<string | null>
  closeSession: () => void
}

export function useWorkspaceSession({
  serverUrl,
  sessionId,
  onMessage,
  onStatusChange,
  onError,
}: UseWorkspaceSessionOptions): UseWorkspaceSessionResult {
  const [status, setStatus] = useState<SessionStatus>('DISCONNECTED')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const updateStatus = useCallback((newStatus: SessionStatus) => {
    setStatus(newStatus)
    onStatusChange?.(newStatus)
  }, [onStatusChange])

  const handleError = useCallback((message: string) => {
    setError(message)
    onError?.(message)
  }, [onError])

  // WebSocket connection management
  useEffect(() => {
    if (!sessionId || !serverUrl) {
      return
    }

    updateStatus('CONNECTING')

    const wsUrl = `${serverUrl.replace('http', 'ws')}/sessions/${sessionId}/stream`

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        console.log('WebSocket connected:', sessionId)
        updateStatus('CONNECTED')
        setError(null)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          switch (data.type) {
            case 'message':
              const message: WorkspaceMessageData = {
                id: data.id || crypto.randomUUID(),
                role: data.role,
                content: data.content,
                toolName: data.tool_name,
                toolInput: data.tool_input,
                toolResult: data.tool_result,
                timestamp: new Date(data.timestamp || Date.now()),
              }
              onMessage?.(message)
              break

            case 'stream_start':
              setIsStreaming(true)
              break

            case 'stream_end':
              setIsStreaming(false)
              break

            case 'error':
              handleError(data.message || 'An error occurred')
              setIsStreaming(false)
              break
          }
        } catch (e) {
          console.error('Error parsing WebSocket message:', e)
        }
      }

      ws.onerror = (event) => {
        console.error('WebSocket error:', event)
        handleError('WebSocket connection error')
      }

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason)
        updateStatus('DISCONNECTED')
        wsRef.current = null
      }

      return () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close()
        }
      }
    } catch (e) {
      console.error('Failed to create WebSocket:', e)
      handleError('Failed to connect to session')
      updateStatus('ERROR')
    }
  }, [sessionId, serverUrl, onMessage, updateStatus, handleError])

  const sendMessage = useCallback(async (content: string): Promise<void> => {
    if (!sessionId || !serverUrl) {
      throw new Error('No active session')
    }

    const response = await fetch(`${serverUrl}/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || 'Failed to send message')
    }
  }, [sessionId, serverUrl])

  const createSession = useCallback(async (
    taskId: string,
    projectPath: string
  ): Promise<string | null> => {
    if (!serverUrl) {
      handleError('No server URL configured')
      return null
    }

    try {
      const response = await fetch(`${serverUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: taskId,
          project_path: projectPath,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to create session')
      }

      const data = await response.json()
      return data.session_id
    } catch (e) {
      handleError(e instanceof Error ? e.message : 'Failed to create session')
      return null
    }
  }, [serverUrl, handleError])

  const closeSession = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    updateStatus('DISCONNECTED')
  }, [updateStatus])

  return {
    status,
    isStreaming,
    error,
    sendMessage,
    createSession,
    closeSession,
  }
}
