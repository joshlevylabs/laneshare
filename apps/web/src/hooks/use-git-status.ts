'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface GitFileStatus {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'staged'
  additions?: number
  deletions?: number
}

export interface GitStatus {
  currentBranch: string
  currentSha: string
  remoteSha?: string
  isDirty: boolean
  aheadCount: number
  behindCount: number
  modifiedFiles: GitFileStatus[]
  stagedFiles: GitFileStatus[]
  untrackedFiles: GitFileStatus[]
}

export interface UseGitStatusOptions {
  cloneId: string | null
  projectId: string
  pollInterval?: number
  enabled?: boolean
}

export interface UseGitStatusResult {
  status: GitStatus | null
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Hook for polling git status of a local clone
 */
export function useGitStatus({
  cloneId,
  projectId,
  pollInterval = 5000,
  enabled = true,
}: UseGitStatusOptions): UseGitStatusResult {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mountedRef = useRef(true)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchStatus = useCallback(async () => {
    if (!cloneId || !enabled) return

    setIsLoading(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/workspace/clones/${cloneId}/git/status`
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to fetch git status')
      }

      const data = await response.json()

      if (mountedRef.current) {
        setStatus({
          currentBranch: data.current_branch || 'main',
          currentSha: data.current_sha || '',
          remoteSha: data.remote_sha,
          isDirty: data.is_dirty || false,
          aheadCount: data.ahead_count || 0,
          behindCount: data.behind_count || 0,
          modifiedFiles: data.modified_files || [],
          stagedFiles: data.staged_files || [],
          untrackedFiles: data.untracked_files || [],
        })
        setError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch status')
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [cloneId, projectId, enabled])

  // Initial fetch and polling
  useEffect(() => {
    mountedRef.current = true

    if (!cloneId || !enabled) {
      setStatus(null)
      return
    }

    // Initial fetch
    fetchStatus()

    // Set up polling
    intervalRef.current = setInterval(fetchStatus, pollInterval)

    return () => {
      mountedRef.current = false
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [cloneId, pollInterval, enabled, fetchStatus])

  const refresh = useCallback(async () => {
    await fetchStatus()
  }, [fetchStatus])

  return {
    status,
    isLoading,
    error,
    refresh,
  }
}
