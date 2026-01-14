'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

export interface UseSSEOptions<T = unknown> {
  url: string | null
  onMessage: (data: T) => void
  onError?: (error: Event) => void
  onOpen?: () => void
  reconnectInterval?: number
  maxReconnectAttempts?: number
}

export interface UseSSEResult {
  isConnected: boolean
  error: string | null
  reconnectAttempts: number
  close: () => void
}

/**
 * Hook for Server-Sent Events (SSE) connections with auto-reconnect
 */
export function useSSE<T = unknown>({
  url,
  onMessage,
  onError,
  onOpen,
  reconnectInterval = 3000,
  maxReconnectAttempts = 10,
}: UseSSEOptions<T>): UseSSEResult {
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)

  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const mountedRef = useRef(true)

  const close = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setIsConnected(false)
  }, [])

  useEffect(() => {
    mountedRef.current = true

    if (!url) {
      close()
      return
    }

    const connect = () => {
      if (!mountedRef.current) return

      try {
        const es = new EventSource(url)
        eventSourceRef.current = es

        es.onopen = () => {
          if (!mountedRef.current) return
          setIsConnected(true)
          setError(null)
          setReconnectAttempts(0)
          onOpen?.()
        }

        es.onmessage = (event) => {
          if (!mountedRef.current) return
          try {
            const data = JSON.parse(event.data) as T
            onMessage(data)
          } catch {
            // If not JSON, pass as-is
            onMessage(event.data as T)
          }
        }

        es.onerror = (e) => {
          if (!mountedRef.current) return
          setIsConnected(false)
          setError('Connection lost')
          onError?.(e)

          // Close current connection
          es.close()
          eventSourceRef.current = null

          // Attempt reconnect if under max attempts
          setReconnectAttempts((prev) => {
            const newAttempts = prev + 1
            if (newAttempts < maxReconnectAttempts) {
              reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval)
            } else {
              setError('Max reconnection attempts reached')
            }
            return newAttempts
          })
        }
      } catch (err) {
        if (!mountedRef.current) return
        setError(err instanceof Error ? err.message : 'Failed to connect')
        setIsConnected(false)
      }
    }

    connect()

    return () => {
      mountedRef.current = false
      close()
    }
  }, [url, onMessage, onError, onOpen, reconnectInterval, maxReconnectAttempts, close])

  return {
    isConnected,
    error,
    reconnectAttempts,
    close,
  }
}

/**
 * Type for file activity events
 */
export interface FileActivityEvent {
  type: 'file_read' | 'file_modified' | 'file_created' | 'file_deleted' | 'file_renamed'
  path: string
  timestamp: string
  details?: {
    lines_changed?: number
    lines_read?: number
    size_change?: number
    preview?: string
    old_path?: string  // For renames
  }
}

/**
 * Hook specifically for file activity SSE streams
 */
export function useFileActivity(
  sessionId: string | null,
  projectId: string,
  onActivity: (activity: FileActivityEvent) => void
) {
  const url = sessionId
    ? `/api/projects/${projectId}/workspace/sessions/${sessionId}/activity`
    : null

  return useSSE<FileActivityEvent>({
    url,
    onMessage: onActivity,
    reconnectInterval: 2000,
    maxReconnectAttempts: 20,
  })
}
