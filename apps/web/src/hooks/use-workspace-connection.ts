'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface UseWorkspaceConnectionOptions {
  url: string
  onStatusChange?: (status: ConnectionStatus) => void
  healthCheckInterval?: number
}

interface UseWorkspaceConnectionResult {
  status: ConnectionStatus
  error: string | null
  checkConnection: () => Promise<boolean>
  isConnected: boolean
}

export function useWorkspaceConnection({
  url,
  onStatusChange,
  healthCheckInterval = 30000,
}: UseWorkspaceConnectionOptions): UseWorkspaceConnectionResult {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const updateStatus = useCallback((newStatus: ConnectionStatus) => {
    setStatus(newStatus)
    onStatusChange?.(newStatus)
  }, [onStatusChange])

  const checkConnection = useCallback(async (): Promise<boolean> => {
    if (!url) {
      setError('No server URL configured')
      updateStatus('error')
      return false
    }

    updateStatus('connecting')
    setError(null)

    try {
      const response = await fetch(`${url}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })

      if (response.ok) {
        updateStatus('connected')
        return true
      } else {
        setError(`Server responded with status ${response.status}`)
        updateStatus('error')
        return false
      }
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          setError('Connection timed out')
        } else if (err.message.includes('fetch')) {
          setError('Could not reach server. Is it running?')
        } else {
          setError(err.message)
        }
      } else {
        setError('Unknown error occurred')
      }
      updateStatus('error')
      return false
    }
  }, [url, updateStatus])

  // Initial connection check and periodic health checks
  useEffect(() => {
    if (url) {
      checkConnection()

      // Set up periodic health checks
      intervalRef.current = setInterval(() => {
        checkConnection()
      }, healthCheckInterval)

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
        }
      }
    }
  }, [url, healthCheckInterval, checkConnection])

  return {
    status,
    error,
    checkConnection,
    isConnected: status === 'connected',
  }
}
