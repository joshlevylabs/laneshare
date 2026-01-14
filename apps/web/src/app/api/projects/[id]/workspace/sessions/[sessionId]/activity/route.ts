/**
 * GET /api/projects/[id]/workspace/sessions/[sessionId]/activity
 *
 * Server-Sent Events (SSE) endpoint for real-time file activity streaming.
 * Proxies events from the local server and logs them to the database.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: { id: string; sessionId: string } }
) {
  const { id: projectId, sessionId } = params
  const supabase = createServerSupabaseClient()

  // Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Get session with clone info
  const { data: session, error: sessionError } = await supabase
    .from('workspace_sessions')
    .select(`
      id,
      local_session_id,
      local_clone_id,
      local_clone:local_repo_clones (
        id,
        local_server_host
      )
    `)
    .eq('id', sessionId)
    .eq('project_id', projectId)
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Get local server host from clone or use default
  const localServerHost =
    (session.local_clone as { local_server_host?: string })?.local_server_host ||
    'localhost:7890'
  const localSessionId = session.local_session_id

  if (!localSessionId) {
    return NextResponse.json(
      { error: 'Session not connected to local server' },
      { status: 400 }
    )
  }

  // Create SSE stream
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let eventSource: EventSource | null = null
      let closed = false

      const cleanup = () => {
        closed = true
        if (eventSource) {
          eventSource.close()
          eventSource = null
        }
      }

      // Handle client disconnect
      request.signal.addEventListener('abort', cleanup)

      try {
        // Connect to local server's activity stream
        const localUrl = `http://${localServerHost}/sessions/${localSessionId}/file-activity`

        // Note: EventSource is not available in Node.js runtime
        // We'll use fetch with a streaming response instead
        const localResponse = await fetch(localUrl, {
          headers: { Accept: 'text/event-stream' },
          signal: request.signal,
        })

        if (!localResponse.ok || !localResponse.body) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', message: 'Failed to connect to local server' })}\n\n`
            )
          )
          controller.close()
          return
        }

        const reader = localResponse.body.getReader()
        const decoder = new TextDecoder()

        // Send initial connection event
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`
          )
        )

        // Read and forward events
        while (!closed) {
          const { done, value } = await reader.read()

          if (done) {
            break
          }

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data:')) {
              try {
                const data = JSON.parse(line.slice(5).trim())

                // Log activity to database (fire and forget)
                logActivity(supabase, sessionId, data).catch(console.error)

                // Forward to client
                controller.enqueue(encoder.encode(`${line}\n\n`))
              } catch {
                // Forward raw line if not JSON
                controller.enqueue(encoder.encode(`${line}\n\n`))
              }
            } else if (line.trim()) {
              controller.enqueue(encoder.encode(`${line}\n`))
            }
          }
        }
      } catch (error) {
        if (!closed) {
          console.error('[SSE Activity] Error:', error)
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', message: 'Connection error' })}\n\n`
            )
          )
        }
      } finally {
        cleanup()
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/**
 * Log file activity to the database
 */
async function logActivity(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  sessionId: string,
  data: {
    type: string
    path?: string
    details?: {
      lines_changed?: number
      lines_read?: number
      preview?: string
    }
  }
) {
  // Map event type to activity type
  const activityTypeMap: Record<string, string> = {
    file_read: 'read',
    file_modified: 'write',
    file_created: 'create',
    file_deleted: 'delete',
    file_renamed: 'rename',
  }

  const activityType = activityTypeMap[data.type]
  if (!activityType || !data.path) return

  await supabase.from('workspace_file_activity').insert({
    session_id: sessionId,
    activity_type: activityType,
    file_path: data.path,
    lines_read: data.details?.lines_read,
    lines_added: data.details?.lines_changed,
    change_preview: data.details?.preview?.slice(0, 500),
  })
}
