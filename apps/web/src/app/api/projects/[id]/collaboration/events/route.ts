/**
 * Collaboration Events SSE Endpoint
 *
 * Streams real-time collaboration events to connected clients.
 * Used for live updates on edits, conflicts, merges, and agent activity.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { CollaborationEvent, CollaborationEventType } from '@laneshare/shared/types/collaborative-editing'

export const dynamic = 'force-dynamic'

/**
 * GET /api/projects/[id]/collaboration/events
 * SSE endpoint for real-time collaboration events
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id: projectId } = params
  const supabase = createServerSupabaseClient()

  // Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return new Response('Forbidden', { status: 403 })
  }

  // Get optional session filter
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('session_id')

  // Create SSE stream
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection event
      const connectEvent: CollaborationEvent = {
        type: 'agent_joined',
        timestamp: new Date().toISOString(),
        sessionId: sessionId || 'all',
        data: {
          agentId: user.id,
          agentName: 'You',
        },
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(connectEvent)}\n\n`))

      // Set up polling interval (Supabase Realtime could be used here too)
      let lastCheckTime = new Date().toISOString()
      const pollInterval = 1000 // 1 second

      const poll = async () => {
        try {
          // Check for new edits
          const { data: newEdits } = await supabase
            .from('edit_stream')
            .select(
              `
              *,
              virtual_branch:virtual_branches(id, name)
            `
            )
            .eq('project_id', projectId)
            .gt('created_at', lastCheckTime)
            .order('created_at', { ascending: true })

          if (newEdits && newEdits.length > 0) {
            for (const edit of newEdits) {
              const event: CollaborationEvent = {
                type: 'edit_received',
                timestamp: edit.created_at,
                sessionId: sessionId || 'all',
                data: {
                  edit: {
                    id: edit.id,
                    virtualBranchId: edit.virtual_branch_id,
                    projectId: edit.project_id,
                    operation: edit.operation,
                    filePath: edit.file_path,
                    linesAdded: edit.lines_added,
                    linesRemoved: edit.lines_removed,
                    sequenceNum: edit.sequence_num,
                    createdAt: edit.created_at,
                  },
                  branchId: edit.virtual_branch_id,
                },
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
            }
            lastCheckTime = newEdits[newEdits.length - 1].created_at
          }

          // Check for conflicts
          const { data: conflicts } = await supabase.rpc('detect_file_conflicts', {
            p_project_id: projectId,
            p_since: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          })

          if (conflicts && conflicts.length > 0) {
            for (const conflict of conflicts) {
              if (conflict.branch_ids.length > 1) {
                const event: CollaborationEvent = {
                  type: 'conflict_detected',
                  timestamp: new Date().toISOString(),
                  sessionId: sessionId || 'all',
                  data: {
                    filePath: conflict.file_path,
                    conflictingBranches: conflict.branch_ids,
                  },
                }
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
              }
            }
          }

          // Check for merge events
          const { data: mergeEvents } = await supabase
            .from('merge_events')
            .select('*')
            .eq('project_id', projectId)
            .gt('created_at', lastCheckTime)

          if (mergeEvents && mergeEvents.length > 0) {
            for (const merge of mergeEvents) {
              const eventType: CollaborationEventType = merge.completed_at
                ? 'merge_completed'
                : 'merge_started'

              const event: CollaborationEvent = {
                type: eventType,
                timestamp: merge.completed_at || merge.started_at,
                sessionId: sessionId || 'all',
                data: {
                  mergeEventId: merge.id,
                  filesAffected: merge.files_merged?.map((f: { path: string }) => f.path) || [],
                },
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
            }
          }
        } catch (error) {
          console.error('[CollaborationEvents] Poll error:', error)
        }
      }

      // Start polling
      const intervalId = setInterval(poll, pollInterval)

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(intervalId)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
