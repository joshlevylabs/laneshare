'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface DbSession {
  id: string
  project_id: string
  task_id: string | null
  repo_id: string | null
  codespace_name: string | null
  status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR'
  created_by: string
  created_at: string
  last_activity_at: string
  task?: {
    id: string
    key: string
    title: string
    type: string
    status: string
  } | null
  repo?: {
    id: string
    owner: string
    name: string
  } | null
}

interface UseDbSessionOptions {
  projectId: string
  codespaceName?: string
  repoId?: string
  taskId?: string
  enabled?: boolean
  onSessionCreated?: (session: DbSession) => void
  onSessionError?: (error: string) => void
}

export function useDbSession({
  projectId,
  codespaceName,
  repoId,
  taskId,
  enabled = true,
  onSessionCreated,
  onSessionError,
}: UseDbSessionOptions) {
  const [session, setSession] = useState<DbSession | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionCreatedRef = useRef(false)

  // Create or retrieve session when codespace connects
  const createOrRetrieveSession = useCallback(async () => {
    if (!enabled || (!codespaceName && !taskId)) return null

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}/workspace/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codespaceName,
          repoId,
          taskId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        // If session already exists, fetch it
        if (response.status === 409 && data.sessionId) {
          const fetchRes = await fetch(
            `/api/projects/${projectId}/workspace/sessions/${data.sessionId}`
          )
          if (fetchRes.ok) {
            const existingSession = await fetchRes.json()
            setSession(existingSession)
            return existingSession
          }
        }
        throw new Error(data.error || 'Failed to create session')
      }

      setSession(data)
      onSessionCreated?.(data)
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create session'
      setError(message)
      onSessionError?.(message)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [projectId, codespaceName, repoId, taskId, enabled, onSessionCreated, onSessionError])

  // Disconnect session
  const disconnectSession = useCallback(async () => {
    if (!session) return

    try {
      await fetch(`/api/projects/${projectId}/workspace/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'DISCONNECTED' }),
      })
      setSession((prev) => (prev ? { ...prev, status: 'DISCONNECTED' } : null))
    } catch (err) {
      console.error('Failed to disconnect session:', err)
    }
  }, [projectId, session])

  // Update session activity
  const updateActivity = useCallback(async () => {
    if (!session) return

    try {
      await fetch(`/api/projects/${projectId}/workspace/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastActivityAt: new Date().toISOString() }),
      })
    } catch (err) {
      // Silently fail activity updates
    }
  }, [projectId, session])

  // Auto-create session when dependencies change
  useEffect(() => {
    if (!enabled || sessionCreatedRef.current) return
    if (!codespaceName && !taskId) return

    sessionCreatedRef.current = true
    createOrRetrieveSession()
  }, [enabled, codespaceName, taskId, createOrRetrieveSession])

  // Reset session created flag when codespace changes
  useEffect(() => {
    sessionCreatedRef.current = false
  }, [codespaceName])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (session && session.status === 'CONNECTED') {
        // Fire and forget disconnect
        fetch(`/api/projects/${projectId}/workspace/sessions/${session.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'DISCONNECTED' }),
        }).catch(() => {})
      }
    }
  }, [projectId, session])

  return {
    session,
    sessionId: session?.id || null,
    isLoading,
    error,
    createOrRetrieveSession,
    disconnectSession,
    updateActivity,
  }
}
