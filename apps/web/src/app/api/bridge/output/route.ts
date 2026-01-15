/**
 * Bridge Output API
 *
 * Called by the bridge agent to send Claude Code output back to LaneShare.
 * Stores messages in the database for real-time sync to the UI.
 */

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { verifyBridgeApiKey } from '@/lib/bridge/auth'

export async function POST(request: Request) {
  try {
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

    const body = await request.json()
    const { connectionId, sessionMessageId, content, isComplete, toolUse } = body

    if (!connectionId) {
      return NextResponse.json({ error: 'Connection ID is required' }, { status: 400 })
    }

    const supabase = createServiceRoleClient()

    // Verify connection belongs to project
    const { data: connection, error: connectionError } = await supabase
      .from('bridge_connections')
      .select('id, session_id, project_id')
      .eq('id', connectionId)
      .eq('project_id', keyInfo.projectId)
      .single()

    if (connectionError || !connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    // If there's a tool use, create a tool_use message
    if (toolUse) {
      await supabase.from('workspace_messages').insert({
        session_id: connection.session_id,
        role: 'tool_use',
        content: `Using tool: ${toolUse.tool}`,
        tool_name: toolUse.tool,
        tool_input: toolUse.input,
        timestamp: new Date().toISOString(),
      })
    }

    // If there's content, append to or create assistant message
    if (content) {
      if (sessionMessageId) {
        // Update existing message (streaming append)
        const { data: existingMessage } = await supabase
          .from('workspace_messages')
          .select('id, content')
          .eq('local_message_id', sessionMessageId)
          .single()

        if (existingMessage) {
          await supabase
            .from('workspace_messages')
            .update({
              content: existingMessage.content + content,
            })
            .eq('id', existingMessage.id)
        } else {
          // Create new message
          await supabase.from('workspace_messages').insert({
            session_id: connection.session_id,
            local_message_id: sessionMessageId,
            role: 'assistant',
            content,
            timestamp: new Date().toISOString(),
          })
        }
      } else {
        // Create new message without ID
        await supabase.from('workspace_messages').insert({
          session_id: connection.session_id,
          role: 'assistant',
          content,
          timestamp: new Date().toISOString(),
        })
      }
    }

    // If complete, update the prompt queue status
    if (isComplete && sessionMessageId) {
      await supabase
        .from('bridge_prompt_queue')
        .update({
          status: 'COMPLETED',
          completed_at: new Date().toISOString(),
        })
        .eq('session_message_id', sessionMessageId)
    }

    // Update connection last ping
    await supabase
      .from('bridge_connections')
      .update({ last_ping_at: new Date().toISOString() })
      .eq('id', connectionId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Bridge] Output error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
