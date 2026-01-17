'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// Event types from the SSE stream
export interface FileConflictEvent {
  eventId?: string
  filePath: string
  yourActivity: { type: string; timestamp: string }
  otherSessions: {
    sessionId: string
    userName: string
    lastActivity: string
    activityType: string
  }[]
  severity: 'warning' | 'critical'
  suggestion: string
  createdAt?: string
}

export interface SessionJoinedEvent {
  eventId?: string
  sessionId: string
  userName: string
  repoName: string
  codespaceName: string
  createdAt?: string
}

export interface SessionLeftEvent {
  eventId?: string
  sessionId: string
  userName: string
  createdAt?: string
}

export interface OrchestratorMessageEvent {
  eventId?: string
  messageId: string
  content: string
  priority: 'info' | 'warning' | 'urgent'
  action?: {
    type: 'acknowledge' | 'respond' | 'sync'
    endpoint: string
  }
  createdAt?: string
}

export interface CrossSessionRequestEvent {
  eventId?: string
  requestId: string
  messageType: 'query' | 'command' | 'sync'
  query: string
  context?: Record<string, any>
  sourceSession: {
    sessionId: string
    userName: string
    repoName: string | null
  }
  createdAt: string
  expiresAt: string
}

export interface CrossSessionResponseEvent {
  eventId?: string
  requestId: string
  response: string
  responseData?: Record<string, any>
  completedAt: string
}

export interface HeartbeatEvent {
  timestamp: string
}

export type OrchestratorEvent =
  | { type: 'connected'; data: { sessionId: string; timestamp: string } }
  | { type: 'file_conflict'; data: FileConflictEvent }
  | { type: 'session_joined'; data: SessionJoinedEvent }
  | { type: 'session_left'; data: SessionLeftEvent }
  | { type: 'orchestrator_message'; data: OrchestratorMessageEvent }
  | { type: 'cross_session_request'; data: CrossSessionRequestEvent }
  | { type: 'cross_session_response'; data: CrossSessionResponseEvent }
  | { type: 'heartbeat'; data: HeartbeatEvent }

interface UseOrchestratorEventsOptions {
  projectId: string
  sessionId: string | null
  onFileConflict?: (event: FileConflictEvent) => void
  onCrossSessionRequest?: (event: CrossSessionRequestEvent) => void
  onCrossSessionResponse?: (event: CrossSessionResponseEvent) => void
  onOrchestratorMessage?: (event: OrchestratorMessageEvent) => void
  onSessionJoined?: (event: SessionJoinedEvent) => void
  onSessionLeft?: (event: SessionLeftEvent) => void
  enabled?: boolean
}

export function useOrchestratorEvents({
  projectId,
  sessionId,
  onFileConflict,
  onCrossSessionRequest,
  onCrossSessionResponse,
  onOrchestratorMessage,
  onSessionJoined,
  onSessionLeft,
  enabled = true,
}: UseOrchestratorEventsOptions) {
  const [isConnected, setIsConnected] = useState(false)
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(null)
  const [events, setEvents] = useState<OrchestratorEvent[]>([])
  const [conflicts, setConflicts] = useState<FileConflictEvent[]>([])
  const [pendingRequests, setPendingRequests] = useState<CrossSessionRequestEvent[]>([])
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Clear a conflict (e.g., after user acknowledges it)
  const clearConflict = useCallback((filePath: string) => {
    setConflicts((prev) => prev.filter((c) => c.filePath !== filePath))
  }, [])

  // Clear a pending request (e.g., after responding)
  const clearPendingRequest = useCallback((requestId: string) => {
    setPendingRequests((prev) => prev.filter((r) => r.requestId !== requestId))
  }, [])

  // Respond to a cross-session request
  const respondToRequest = useCallback(
    async (requestId: string, response: string, responseData?: Record<string, any>) => {
      if (!sessionId) return { success: false, error: 'No session' }

      try {
        const res = await fetch(`/api/projects/${projectId}/workspace/cross-session/response`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            sessionId,
            response,
            responseData,
            status: 'completed',
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          return { success: false, error: data.error }
        }

        clearPendingRequest(requestId)
        return { success: true }
      } catch (error) {
        return { success: false, error: 'Network error' }
      }
    },
    [projectId, sessionId, clearPendingRequest]
  )

  // Send a cross-session request
  const sendCrossSessionRequest = useCallback(
    async (
      targetRepoName: string,
      query: string,
      messageType: 'query' | 'command' | 'sync' = 'query',
      context?: Record<string, any>
    ) => {
      if (!sessionId) return { success: false, error: 'No session' }

      try {
        const res = await fetch(`/api/projects/${projectId}/workspace/cross-session/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceSessionId: sessionId,
            targetRepoName,
            messageType,
            query,
            context,
          }),
        })

        const data = await res.json()

        if (!res.ok) {
          return { success: false, error: data.error }
        }

        if (data.status === 'no_target_available') {
          return { success: false, error: data.message, noTarget: true }
        }

        return { success: true, requestId: data.requestId, targetSession: data.targetSession }
      } catch (error) {
        return { success: false, error: 'Network error' }
      }
    },
    [projectId, sessionId]
  )

  // Report file activity
  const reportFileActivity = useCallback(
    async (
      activities: {
        type: 'read' | 'write' | 'create' | 'delete' | 'rename'
        filePath: string
        fileHash?: string
        linesChanged?: number
        changeSummary?: string
      }[]
    ) => {
      if (!sessionId) return { success: false, error: 'No session' }

      try {
        const res = await fetch(
          `/api/projects/${projectId}/workspace/sessions/${sessionId}/activity`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activities }),
          }
        )

        const data = await res.json()

        if (!res.ok) {
          return { success: false, error: data.error }
        }

        // If conflicts were detected, add them to state
        if (data.conflicts && data.conflicts.length > 0) {
          setConflicts((prev) => {
            const newConflicts = data.conflicts.filter(
              (c: FileConflictEvent) => !prev.some((p) => p.filePath === c.filePath)
            )
            return [...prev, ...newConflicts]
          })
        }

        return { success: true, recorded: data.recorded, conflicts: data.conflicts }
      } catch (error) {
        return { success: false, error: 'Network error' }
      }
    },
    [projectId, sessionId]
  )

  // Connect to SSE stream
  useEffect(() => {
    if (!enabled || !sessionId || !projectId) {
      return
    }

    const connect = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }

      const url = `/api/projects/${projectId}/workspace/sessions/${sessionId}/events`
      const eventSource = new EventSource(url)
      eventSourceRef.current = eventSource

      eventSource.onopen = () => {
        setIsConnected(true)
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
          reconnectTimeoutRef.current = null
        }
      }

      eventSource.onerror = () => {
        setIsConnected(false)
        eventSource.close()
        eventSourceRef.current = null

        // Reconnect after 3 seconds
        if (!reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(connect, 3000)
        }
      }

      // Handle specific event types
      eventSource.addEventListener('connected', (e) => {
        const data = JSON.parse(e.data)
        setEvents((prev) => [...prev.slice(-99), { type: 'connected', data }])
      })

      eventSource.addEventListener('heartbeat', (e) => {
        const data = JSON.parse(e.data)
        setLastHeartbeat(new Date(data.timestamp))
      })

      eventSource.addEventListener('file_conflict', (e) => {
        const data: FileConflictEvent = JSON.parse(e.data)
        setEvents((prev) => [...prev.slice(-99), { type: 'file_conflict', data }])
        setConflicts((prev) => {
          if (prev.some((c) => c.filePath === data.filePath)) {
            return prev.map((c) => (c.filePath === data.filePath ? data : c))
          }
          return [...prev, data]
        })
        onFileConflict?.(data)
      })

      eventSource.addEventListener('session_joined', (e) => {
        const data: SessionJoinedEvent = JSON.parse(e.data)
        setEvents((prev) => [...prev.slice(-99), { type: 'session_joined', data }])
        onSessionJoined?.(data)
      })

      eventSource.addEventListener('session_left', (e) => {
        const data: SessionLeftEvent = JSON.parse(e.data)
        setEvents((prev) => [...prev.slice(-99), { type: 'session_left', data }])
        onSessionLeft?.(data)
      })

      eventSource.addEventListener('orchestrator_message', (e) => {
        const data: OrchestratorMessageEvent = JSON.parse(e.data)
        setEvents((prev) => [...prev.slice(-99), { type: 'orchestrator_message', data }])
        onOrchestratorMessage?.(data)
      })

      eventSource.addEventListener('cross_session_request', (e) => {
        const data: CrossSessionRequestEvent = JSON.parse(e.data)
        setEvents((prev) => [...prev.slice(-99), { type: 'cross_session_request', data }])
        setPendingRequests((prev) => {
          if (prev.some((r) => r.requestId === data.requestId)) {
            return prev
          }
          return [...prev, data]
        })
        onCrossSessionRequest?.(data)
      })

      eventSource.addEventListener('cross_session_response', (e) => {
        const data: CrossSessionResponseEvent = JSON.parse(e.data)
        setEvents((prev) => [...prev.slice(-99), { type: 'cross_session_response', data }])
        onCrossSessionResponse?.(data)
      })
    }

    connect()

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
    }
  }, [
    enabled,
    sessionId,
    projectId,
    onFileConflict,
    onCrossSessionRequest,
    onCrossSessionResponse,
    onOrchestratorMessage,
    onSessionJoined,
    onSessionLeft,
  ])

  return {
    isConnected,
    lastHeartbeat,
    events,
    conflicts,
    pendingRequests,
    clearConflict,
    clearPendingRequest,
    respondToRequest,
    sendCrossSessionRequest,
    reportFileActivity,
  }
}
