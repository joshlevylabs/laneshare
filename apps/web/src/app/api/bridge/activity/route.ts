/**
 * Bridge Activity API
 *
 * Called by the bridge agent to report file activity and git status.
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
    const { connectionId, type, payload } = body

    if (!connectionId || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
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

    if (type === 'file_activity') {
      // TODO: Enable when workspace_file_activity table is created via migration
      // For now, just acknowledge the activity without persisting
      console.log('[Bridge] File activity:', payload)
    } else if (type === 'git_status') {
      // Update git status on the connection
      await supabase
        .from('bridge_connections')
        .update({
          git_branch: payload.branch,
          last_ping_at: new Date().toISOString(),
        })
        .eq('id', connectionId)

      // Also update the session with git status info (stored as connection_config)
      await supabase
        .from('workspace_sessions')
        .update({
          connection_config: {
            gitStatus: payload,
          },
        })
        .eq('id', connection.session_id)
    }

    // Update last ping
    await supabase
      .from('bridge_connections')
      .update({ last_ping_at: new Date().toISOString() })
      .eq('id', connectionId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Bridge] Activity error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
