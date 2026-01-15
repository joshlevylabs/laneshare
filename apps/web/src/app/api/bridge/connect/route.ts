/**
 * Bridge Connect API
 *
 * Called by the bridge agent to establish a connection and register itself.
 * Returns pending prompts and connection details.
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
    const { sessionId, bridgeVersion, workDir, gitBranch, gitRemote, codespaceName } = body

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
    }

    const supabase = createServiceRoleClient()

    // Verify session belongs to the project
    const { data: session, error: sessionError } = await supabase
      .from('workspace_sessions')
      .select('id, project_id')
      .eq('id', sessionId)
      .eq('project_id', keyInfo.projectId)
      .single()

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Mark any existing connections as disconnected
    await supabase
      .from('bridge_connections')
      .update({
        status: 'DISCONNECTED',
        disconnected_at: new Date().toISOString(),
      })
      .eq('session_id', sessionId)
      .eq('status', 'CONNECTED')

    // Create new connection
    const { data: connection, error: connectionError } = await supabase
      .from('bridge_connections')
      .insert({
        project_id: keyInfo.projectId,
        session_id: sessionId,
        bridge_version: bridgeVersion || '1.0.0',
        work_dir: workDir || '.',
        git_branch: gitBranch,
        git_remote: gitRemote,
        codespace_name: codespaceName,
        status: 'CONNECTED',
        connected_at: new Date().toISOString(),
        last_ping_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (connectionError) {
      console.error('[Bridge] Error creating connection:', connectionError)
      return NextResponse.json({ error: 'Failed to create connection' }, { status: 500 })
    }

    // Update session status
    await supabase
      .from('workspace_sessions')
      .update({
        status: 'CONNECTED',
        bridge_connected: true,
        codespace_name: codespaceName,
      })
      .eq('id', sessionId)

    // Get any pending prompts
    const { data: pendingPrompts } = await supabase
      .from('bridge_prompt_queue')
      .select('id, prompt, session_message_id')
      .eq('session_id', sessionId)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true })
      .limit(1)

    // Update API key last used
    await supabase
      .from('bridge_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyInfo.keyId)

    return NextResponse.json({
      connectionId: connection.id,
      pendingPrompt: pendingPrompts?.[0] || null,
    })
  } catch (error) {
    console.error('[Bridge] Connect error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
