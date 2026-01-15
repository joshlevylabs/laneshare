/**
 * Bridge Stream API (SSE)
 *
 * Long-lived SSE connection that streams prompts and commands to the bridge agent.
 * The bridge calls this endpoint and keeps the connection open to receive updates.
 */

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { verifyBridgeApiKey } from '@/lib/bridge/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // Verify API key
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing authorization' }, { status: 401 })
  }

  const apiKey = authHeader.substring(7)
  const keyInfo = await verifyBridgeApiKey(apiKey)

  if (!keyInfo) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  }

  // Get query parameters
  const url = new URL(request.url)
  const connectionId = url.searchParams.get('connectionId')
  const sessionId = url.searchParams.get('sessionId')

  if (!connectionId || !sessionId) {
    return NextResponse.json({ error: 'Missing connectionId or sessionId' }, { status: 400 })
  }

  const supabase = createServiceRoleClient()

  // Verify connection
  const { data: connection, error: connectionError } = await supabase
    .from('bridge_connections')
    .select('id, session_id, project_id')
    .eq('id', connectionId)
    .eq('project_id', keyInfo.projectId)
    .single()

  if (connectionError || !connection) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  // Create SSE stream
  const encoder = new TextEncoder()
  let isConnectionClosed = false

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connected event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ connectionId })}\n\n`)
      )

      // Poll for new prompts
      const pollInterval = setInterval(async () => {
        if (isConnectionClosed) {
          clearInterval(pollInterval)
          return
        }

        try {
          // Check for pending prompts
          const { data: prompts } = await supabase
            .from('bridge_prompt_queue')
            .select('id, prompt, session_message_id')
            .eq('session_id', sessionId)
            .eq('status', 'PENDING')
            .order('created_at', { ascending: true })
            .limit(1)

          if (prompts && prompts.length > 0) {
            const prompt = prompts[0]

            // Mark as sent
            await supabase
              .from('bridge_prompt_queue')
              .update({
                status: 'SENT',
                sent_at: new Date().toISOString(),
                connection_id: connectionId,
              })
              .eq('id', prompt.id)

            // Send to bridge
            controller.enqueue(
              encoder.encode(
                `event: prompt\ndata: ${JSON.stringify({
                  prompt: prompt.prompt,
                  sessionMessageId: prompt.session_message_id,
                })}\n\n`
              )
            )
          }

          // Update last ping
          await supabase
            .from('bridge_connections')
            .update({ last_ping_at: new Date().toISOString() })
            .eq('id', connectionId)

          // Send keepalive
          controller.enqueue(encoder.encode(`: keepalive\n\n`))
        } catch (err) {
          console.error('[Bridge] Stream poll error:', err)
        }
      }, 2000) // Poll every 2 seconds

      // Handle client disconnect
      request.signal.addEventListener('abort', async () => {
        isConnectionClosed = true
        clearInterval(pollInterval)

        try {
          // Mark connection as disconnected
          await supabase
            .from('bridge_connections')
            .update({
              status: 'DISCONNECTED',
              disconnected_at: new Date().toISOString(),
            })
            .eq('id', connectionId)

          // Update session status
          await supabase
            .from('workspace_sessions')
            .update({
              bridge_connected: false,
            })
            .eq('id', sessionId)
        } catch (err) {
          console.error('[Bridge] Error updating disconnect status:', err)
        }
      })
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
