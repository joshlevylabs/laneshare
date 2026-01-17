/**
 * File Activity Tracking API
 *
 * Tracks file read/write activity for Claude Code sessions.
 * Enables conflict detection when multiple sessions edit the same files.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

interface FileActivity {
  type: 'read' | 'write' | 'create' | 'delete' | 'rename'
  filePath: string
  fileHash?: string
  linesChanged?: number
  changeSummary?: string
}

interface FileActivityReport {
  activities: FileActivity[]
}

interface ConflictInfo {
  filePath: string
  otherSessions: {
    sessionId: string
    userName: string
    lastActivity: string
    activityType: string
  }[]
}

/**
 * POST - Report file activity from a Claude Code session
 */
export async function POST(
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

  // Verify session ownership
  const { data: session, error: sessionError } = await supabase
    .from('workspace_sessions')
    .select('id, created_by, project_id')
    .eq('id', sessionId)
    .eq('project_id', projectId)
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (session.created_by !== user.id) {
    return NextResponse.json({ error: 'Not your session' }, { status: 403 })
  }

  const body: FileActivityReport = await request.json()

  if (!body.activities || !Array.isArray(body.activities)) {
    return NextResponse.json({ error: 'Invalid activities array' }, { status: 400 })
  }

  // Insert all activities
  const activitiesToInsert = body.activities.map((activity) => ({
    session_id: sessionId,
    activity_type: activity.type,
    file_path: activity.filePath,
    file_hash: activity.fileHash || null,
    lines_changed: activity.linesChanged || null,
    change_summary: activity.changeSummary || null,
  }))

  const { error: insertError } = await supabase
    .from('workspace_file_activity')
    .insert(activitiesToInsert)

  if (insertError) {
    console.error('[Activity] Insert error:', insertError)
    return NextResponse.json({ error: 'Failed to record activity' }, { status: 500 })
  }

  // Check for conflicts on write/create activities
  const writeActivities = body.activities.filter(
    (a) => a.type === 'write' || a.type === 'create'
  )

  const conflicts: ConflictInfo[] = []

  for (const activity of writeActivities) {
    // Find other sessions that have recently modified this file
    const { data: conflictingActivity } = await supabase
      .from('workspace_file_activity')
      .select(`
        session_id,
        activity_type,
        timestamp,
        session:workspace_sessions!inner(
          id,
          created_by,
          status,
          creator:profiles(full_name, email)
        )
      `)
      .eq('file_path', activity.filePath)
      .neq('session_id', sessionId)
      .in('activity_type', ['write', 'create'])
      .gte('timestamp', new Date(Date.now() - 30 * 60 * 1000).toISOString()) // Last 30 minutes
      .order('timestamp', { ascending: false })

    if (conflictingActivity && conflictingActivity.length > 0) {
      // Get unique sessions
      const sessionMap = new Map<string, any>()
      for (const ca of conflictingActivity) {
        const sess = ca.session as any
        if (sess?.status === 'CONNECTED' && !sessionMap.has(sess.id)) {
          sessionMap.set(sess.id, {
            sessionId: sess.id,
            userName: sess.creator?.full_name || sess.creator?.email?.split('@')[0] || 'Unknown',
            lastActivity: ca.timestamp,
            activityType: ca.activity_type,
          })
        }
      }

      if (sessionMap.size > 0) {
        conflicts.push({
          filePath: activity.filePath,
          otherSessions: Array.from(sessionMap.values()),
        })

        // Create conflict events for both sessions
        const conflictEvent = {
          project_id: projectId,
          target_session_id: sessionId,
          event_type: 'file_conflict',
          event_data: {
            filePath: activity.filePath,
            yourActivity: { type: activity.type, timestamp: new Date().toISOString() },
            otherSessions: Array.from(sessionMap.values()),
            severity: 'warning',
            suggestion: 'Coordinate with other users before committing changes',
          },
        }

        await supabase.from('workspace_events').insert(conflictEvent)

        // Notify other sessions about the conflict
        for (const [otherSessionId, otherInfo] of sessionMap) {
          await supabase.from('workspace_events').insert({
            project_id: projectId,
            target_session_id: otherSessionId,
            event_type: 'file_conflict',
            event_data: {
              filePath: activity.filePath,
              yourActivity: { type: otherInfo.activityType, timestamp: otherInfo.lastActivity },
              otherSessions: [{
                sessionId,
                userName: user.email?.split('@')[0] || 'Unknown',
                lastActivity: new Date().toISOString(),
                activityType: activity.type,
              }],
              severity: 'warning',
              suggestion: 'Another user is also editing this file',
            },
          })
        }
      }
    }
  }

  return NextResponse.json({
    recorded: body.activities.length,
    conflicts,
  })
}

/**
 * GET - Get file activity for a session or check for conflicts
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string; sessionId: string } }
) {
  const { id: projectId, sessionId } = params
  const { searchParams } = new URL(request.url)
  const checkConflicts = searchParams.get('conflicts') === 'true'
  const filePath = searchParams.get('filePath')

  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (checkConflicts) {
    // Get all files this session has recently written to
    const { data: myActivity } = await supabase
      .from('workspace_file_activity')
      .select('file_path, activity_type, timestamp')
      .eq('session_id', sessionId)
      .in('activity_type', ['write', 'create'])
      .gte('timestamp', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order('timestamp', { ascending: false })

    const conflicts: ConflictInfo[] = []
    const checkedFiles = new Set<string>()

    for (const activity of myActivity || []) {
      if (checkedFiles.has(activity.file_path)) continue
      checkedFiles.add(activity.file_path)

      // Check for conflicts on each file
      const { data: conflictingActivity } = await supabase
        .from('workspace_file_activity')
        .select(`
          session_id,
          activity_type,
          timestamp,
          session:workspace_sessions!inner(
            id,
            created_by,
            status,
            creator:profiles(full_name, email)
          )
        `)
        .eq('file_path', activity.file_path)
        .neq('session_id', sessionId)
        .in('activity_type', ['write', 'create'])
        .gte('timestamp', new Date(Date.now() - 30 * 60 * 1000).toISOString())

      if (conflictingActivity && conflictingActivity.length > 0) {
        const sessionMap = new Map<string, any>()
        for (const ca of conflictingActivity) {
          const sess = ca.session as any
          if (sess?.status === 'CONNECTED' && !sessionMap.has(sess.id)) {
            sessionMap.set(sess.id, {
              sessionId: sess.id,
              userName: sess.creator?.full_name || sess.creator?.email?.split('@')[0] || 'Unknown',
              lastActivity: ca.timestamp,
              activityType: ca.activity_type,
            })
          }
        }

        if (sessionMap.size > 0) {
          conflicts.push({
            filePath: activity.file_path,
            otherSessions: Array.from(sessionMap.values()),
          })
        }
      }
    }

    return NextResponse.json({ conflicts })
  }

  // Get recent activity for this session
  let query = supabase
    .from('workspace_file_activity')
    .select('*')
    .eq('session_id', sessionId)
    .order('timestamp', { ascending: false })
    .limit(100)

  if (filePath) {
    query = query.eq('file_path', filePath)
  }

  const { data: activity, error } = await query

  if (error) {
    console.error('[Activity GET] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 })
  }

  return NextResponse.json({ activity })
}
