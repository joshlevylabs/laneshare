'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  CollaborationEvent,
  CollaborationSession,
  VirtualBranch,
  EditStreamEntry,
  MergeEvent,
  EditConflict,
} from '@laneshare/shared'

export interface UseCollaborationOptions {
  projectId: string
  sessionId?: string
  enabled?: boolean
}

export interface CollaborationState {
  session: CollaborationSession | null
  branches: VirtualBranch[]
  recentEdits: EditStreamEntry[]
  pendingConflicts: Array<{
    filePath: string
    branches: string[]
  }>
  activeMerge: MergeEvent | null
  isConnected: boolean
  error: string | null
}

export interface UseCollaborationResult extends CollaborationState {
  // Actions
  startSession: (branchIds: string[]) => Promise<CollaborationSession | null>
  endSession: () => Promise<void>
  triggerMerge: (branchIds?: string[]) => Promise<MergeEvent | null>
  createBranch: (name: string, baseSha: string) => Promise<VirtualBranch | null>
  recordEdit: (edit: Omit<EditStreamEntry, 'id' | 'sequenceNum' | 'createdAt'>) => Promise<void>
  refresh: () => Promise<void>
}

/**
 * Hook for managing collaborative editing sessions
 */
export function useCollaboration({
  projectId,
  sessionId,
  enabled = true,
}: UseCollaborationOptions): UseCollaborationResult {
  const [state, setState] = useState<CollaborationState>({
    session: null,
    branches: [],
    recentEdits: [],
    pendingConflicts: [],
    activeMerge: null,
    isConnected: false,
    error: null,
  })

  const eventSourceRef = useRef<EventSource | null>(null)
  const mountedRef = useRef(true)

  // Fetch initial state
  const fetchState = useCallback(async () => {
    if (!enabled) return

    try {
      // Fetch session
      if (sessionId) {
        const sessionRes = await fetch(
          `/api/projects/${projectId}/collaboration/sessions?id=${sessionId}`
        )
        if (sessionRes.ok) {
          const sessions = await sessionRes.json()
          if (sessions.length > 0) {
            setState((prev) => ({ ...prev, session: sessions[0] }))
          }
        }
      }

      // Fetch virtual branches
      const branchesRes = await fetch(`/api/projects/${projectId}/collaboration/branches`)
      if (branchesRes.ok) {
        const branches = await branchesRes.json()
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, branches }))
        }
      }

      // Fetch recent edits
      const editsRes = await fetch(
        `/api/projects/${projectId}/collaboration/edits?limit=50`
      )
      if (editsRes.ok) {
        const edits = await editsRes.json()
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, recentEdits: edits }))
        }
      }
    } catch (error) {
      if (mountedRef.current) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to fetch state',
        }))
      }
    }
  }, [projectId, sessionId, enabled])

  // Set up SSE connection for real-time updates
  useEffect(() => {
    if (!enabled) return

    mountedRef.current = true

    const url = sessionId
      ? `/api/projects/${projectId}/collaboration/events?session_id=${sessionId}`
      : `/api/projects/${projectId}/collaboration/events`

    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, isConnected: true, error: null }))
      }
    }

    eventSource.onmessage = (event) => {
      if (!mountedRef.current) return

      try {
        const data: CollaborationEvent = JSON.parse(event.data)

        switch (data.type) {
          case 'edit_received':
            if (data.data.edit) {
              setState((prev) => ({
                ...prev,
                recentEdits: [data.data.edit!, ...prev.recentEdits.slice(0, 49)],
              }))
            }
            break

          case 'conflict_detected':
            if (data.data.filePath && data.data.conflictingBranches) {
              setState((prev) => ({
                ...prev,
                pendingConflicts: [
                  {
                    filePath: data.data.filePath!,
                    branches: data.data.conflictingBranches!,
                  },
                  ...prev.pendingConflicts.filter(
                    (c) => c.filePath !== data.data.filePath
                  ),
                ],
              }))
            }
            break

          case 'merge_started':
            // Fetch the merge event details
            fetch(`/api/projects/${projectId}/collaboration/merge?id=${data.data.mergeEventId}`)
              .then((res) => res.json())
              .then((merges) => {
                if (mountedRef.current && merges.length > 0) {
                  setState((prev) => ({ ...prev, activeMerge: merges[0] }))
                }
              })
            break

          case 'merge_completed':
            setState((prev) => ({
              ...prev,
              activeMerge: null,
              pendingConflicts: prev.pendingConflicts.filter(
                (c) => !data.data.filesAffected?.includes(c.filePath)
              ),
            }))
            // Refresh edits after merge
            fetchState()
            break

          case 'sync_required':
            // Notify that branches need to sync
            fetchState()
            break
        }
      } catch {
        // Ignore parse errors
      }
    }

    eventSource.onerror = () => {
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, isConnected: false }))
      }
    }

    // Initial fetch
    fetchState()

    return () => {
      mountedRef.current = false
      eventSource.close()
      eventSourceRef.current = null
    }
  }, [projectId, sessionId, enabled, fetchState])

  // Start a collaboration session
  const startSession = useCallback(
    async (branchIds: string[]): Promise<CollaborationSession | null> => {
      try {
        const response = await fetch(`/api/projects/${projectId}/collaboration/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ virtualBranchIds: branchIds }),
        })

        if (!response.ok) {
          throw new Error('Failed to start session')
        }

        const session = await response.json()
        setState((prev) => ({ ...prev, session }))
        return session
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to start session',
        }))
        return null
      }
    },
    [projectId]
  )

  // End the current session
  const endSession = useCallback(async (): Promise<void> => {
    if (!state.session) return

    try {
      await fetch(
        `/api/projects/${projectId}/collaboration/sessions/${state.session.id}`,
        { method: 'DELETE' }
      )
      setState((prev) => ({ ...prev, session: null }))
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to end session',
      }))
    }
  }, [projectId, state.session])

  // Trigger a merge
  const triggerMerge = useCallback(
    async (branchIds?: string[]): Promise<MergeEvent | null> => {
      const branches = branchIds || state.session?.virtualBranchIds || []

      if (branches.length < 2) {
        setState((prev) => ({ ...prev, error: 'Need at least 2 branches to merge' }))
        return null
      }

      try {
        const response = await fetch(`/api/projects/${projectId}/collaboration/merge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branchIds: branches }),
        })

        if (!response.ok) {
          throw new Error('Failed to trigger merge')
        }

        const result = await response.json()
        return result
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to trigger merge',
        }))
        return null
      }
    },
    [projectId, state.session]
  )

  // Create a new virtual branch
  const createBranch = useCallback(
    async (name: string, baseSha: string): Promise<VirtualBranch | null> => {
      try {
        const response = await fetch(`/api/projects/${projectId}/collaboration/branches`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, baseSha }),
        })

        if (!response.ok) {
          throw new Error('Failed to create branch')
        }

        const branch = await response.json()
        setState((prev) => ({ ...prev, branches: [...prev.branches, branch] }))
        return branch
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to create branch',
        }))
        return null
      }
    },
    [projectId]
  )

  // Record an edit
  const recordEdit = useCallback(
    async (
      edit: Omit<EditStreamEntry, 'id' | 'sequenceNum' | 'createdAt'>
    ): Promise<void> => {
      try {
        const response = await fetch(`/api/projects/${projectId}/collaboration/edits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(edit),
        })

        if (!response.ok) {
          throw new Error('Failed to record edit')
        }
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to record edit',
        }))
      }
    },
    [projectId]
  )

  return {
    ...state,
    startSession,
    endSession,
    triggerMerge,
    createBranch,
    recordEdit,
    refresh: fetchState,
  }
}
