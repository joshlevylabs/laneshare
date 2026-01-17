/**
 * Server-Sent Events (SSE) for Real-Time Orchestrator Notifications
 *
 * Provides push notifications for:
 * - File conflicts when multiple sessions edit the same file
 * - Session join/leave events
 * - Orchestrator messages
 * - Cross-session communication requests/responses
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * GET - Establish SSE connection for real-time events
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string; sessionId: string } }
) {
  const { id: projectId, sessionId } = params
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify session exists and belongs to user
  const { data: session, error: sessionError } = await supabase
    .from('workspace_sessions')
    .select('id, created_by, project_id, status')
    .eq('id', sessionId)
    .eq('project_id', projectId)
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (session.created_by !== user.id) {
    return NextResponse.json({ error: 'Not your session' }, { status: 403 })
  }

  // Create SSE stream
  const encoder = new TextEncoder()
  let isStreamClosed = false

  const stream = new ReadableStream({
    async start(controller) {
      // Helper to send SSE event
      const sendEvent = (type: string, data: any) => {
        if (isStreamClosed) return
        try {
          const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(event))
        } catch (e) {
          console.error('[SSE] Error sending event:', e)
        }
      }

      // Send initial connection event
      sendEvent('connected', {
        sessionId,
        timestamp: new Date().toISOString(),
      })

      // Fetch and send any pending events
      const fetchPendingEvents = async () => {
        if (isStreamClosed) return

        const { data: pendingEvents } = await supabase
          .from('workspace_events')
          .select('*')
          .or(`target_session_id.eq.${sessionId},target_user_id.eq.${user.id}`)
          .eq('delivered', false)
          .order('created_at', { ascending: true })
          .limit(50)

        if (pendingEvents && pendingEvents.length > 0) {
          // Mark events as delivered
          const eventIds = pendingEvents.map((e) => e.id)
          await supabase
            .from('workspace_events')
            .update({ delivered: true, delivered_at: new Date().toISOString() })
            .in('id', eventIds)

          // Send each event
          for (const event of pendingEvents) {
            sendEvent(event.event_type, {
              eventId: event.id,
              ...event.event_data,
              createdAt: event.created_at,
            })
          }
        }
      }

      // Fetch pending cross-session requests
      const fetchPendingRequests = async () => {
        if (isStreamClosed) return

        const { data: pendingRequests } = await supabase
          .from('workspace_cross_session_messages')
          .select(`
            *,
            source_session:workspace_sessions!source_session_id(
              id,
              created_by,
              creator:profiles(full_name, email),
              repo:repos(owner, name)
            )
          `)
          .eq('target_session_id', sessionId)
          .eq('status', 'pending')
          .order('created_at', { ascending: true })

        if (pendingRequests && pendingRequests.length > 0) {
          // Mark as delivered
          await supabase
            .from('workspace_cross_session_messages')
            .update({ status: 'delivered', delivered_at: new Date().toISOString() })
            .in('id', pendingRequests.map((r) => r.id))

          // Send each request as an event
          for (const req of pendingRequests) {
            const sourceSession = req.source_session as any
            sendEvent('cross_session_request', {
              requestId: req.request_id,
              messageType: req.message_type,
              query: req.query,
              context: req.context,
              sourceSession: {
                sessionId: sourceSession?.id,
                userName: sourceSession?.creator?.full_name ||
                  sourceSession?.creator?.email?.split('@')[0] || 'Unknown',
                repoName: sourceSession?.repo ?
                  `${sourceSession.repo.owner}/${sourceSession.repo.name}` : null,
              },
              createdAt: req.created_at,
              expiresAt: req.expires_at,
            })
          }
        }
      }

      // Fetch pending responses to this session's requests
      const fetchPendingResponses = async () => {
        if (isStreamClosed) return

        const { data: completedRequests } = await supabase
          .from('workspace_cross_session_messages')
          .select('*')
          .eq('source_session_id', sessionId)
          .eq('status', 'completed')
          .is('response', 'not.null')

        if (completedRequests && completedRequests.length > 0) {
          for (const req of completedRequests) {
            sendEvent('cross_session_response', {
              requestId: req.request_id,
              response: req.response,
              responseData: req.response_data,
              completedAt: req.completed_at,
            })
          }

          // Mark these as acknowledged (could also delete them)
          await supabase
            .from('workspace_cross_session_messages')
            .delete()
            .in('id', completedRequests.map((r) => r.id))
        }
      }

      // Initial fetch
      await fetchPendingEvents()
      await fetchPendingRequests()
      await fetchPendingResponses()

      // Poll for new events every 2 seconds
      const pollInterval = setInterval(async () => {
        if (isStreamClosed) {
          clearInterval(pollInterval)
          return
        }

        try {
          await fetchPendingEvents()
          await fetchPendingRequests()
          await fetchPendingResponses()

          // Send heartbeat
          sendEvent('heartbeat', { timestamp: new Date().toISOString() })
        } catch (e) {
          console.error('[SSE] Poll error:', e)
        }
      }, 2000)

      // Keep connection alive with heartbeat every 30 seconds
      const heartbeatInterval = setInterval(() => {
        if (isStreamClosed) {
          clearInterval(heartbeatInterval)
          return
        }
        sendEvent('heartbeat', { timestamp: new Date().toISOString() })
      }, 30000)

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        isStreamClosed = true
        clearInterval(pollInterval)
        clearInterval(heartbeatInterval)
        controller.close()
      })
    },

    cancel() {
      isStreamClosed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
}
