/**
 * Cross-Session Request API
 *
 * Allows Claude Code sessions to send queries/commands to other sessions.
 * The orchestrator routes these requests to appropriate target sessions.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

interface CrossSessionRequestBody {
  sourceSessionId: string          // The session making the request
  targetSessionId?: string         // Specific session, or...
  targetRepoName?: string          // Any session working on this repo
  messageType: 'query' | 'command' | 'sync'
  query: string                    // What to ask/do
  context?: Record<string, any>
  timeoutMs?: number               // Default 30000 (30 seconds)
}

/**
 * POST - Create a cross-session request
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body: CrossSessionRequestBody = await request.json()

  if (!body.sourceSessionId) {
    return NextResponse.json({ error: 'sourceSessionId is required' }, { status: 400 })
  }

  if (!body.query) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }

  if (!body.targetSessionId && !body.targetRepoName) {
    return NextResponse.json(
      { error: 'Either targetSessionId or targetRepoName is required' },
      { status: 400 }
    )
  }

  // Verify source session belongs to user
  const { data: sourceSession, error: sourceError } = await supabase
    .from('workspace_sessions')
    .select('id, created_by, project_id')
    .eq('id', body.sourceSessionId)
    .eq('project_id', projectId)
    .single()

  if (sourceError || !sourceSession) {
    return NextResponse.json({ error: 'Source session not found' }, { status: 404 })
  }

  if (sourceSession.created_by !== user.id) {
    return NextResponse.json({ error: 'Not your session' }, { status: 403 })
  }

  // Find target session
  let targetSessionId = body.targetSessionId
  let targetRepoId: string | null = null

  if (!targetSessionId && body.targetRepoName) {
    // Find the repo first
    const [owner, name] = body.targetRepoName.includes('/')
      ? body.targetRepoName.split('/')
      : [null, body.targetRepoName]

    let repoQuery = supabase
      .from('repos')
      .select('id')
      .eq('name', name || body.targetRepoName)

    if (owner) {
      repoQuery = repoQuery.eq('owner', owner)
    }

    const { data: repo } = await repoQuery.limit(1).single()

    if (repo) {
      targetRepoId = repo.id

      // Find an active session for this repo
      const { data: targetSession } = await supabase
        .from('workspace_sessions')
        .select('id, created_by, creator:profiles(full_name, email), repo:repos(owner, name)')
        .eq('project_id', projectId)
        .eq('repo_id', repo.id)
        .eq('status', 'CONNECTED')
        .neq('id', body.sourceSessionId) // Don't target self
        .order('last_activity_at', { ascending: false })
        .limit(1)
        .single()

      if (targetSession) {
        targetSessionId = targetSession.id
      }
    }
  }

  if (!targetSessionId) {
    return NextResponse.json({
      requestId: null,
      status: 'no_target_available',
      message: 'No active session found for the target repository',
    })
  }

  // Get target session info
  const { data: targetSessionInfo } = await supabase
    .from('workspace_sessions')
    .select(`
      id,
      created_by,
      creator:profiles(full_name, email),
      repo:repos(owner, name)
    `)
    .eq('id', targetSessionId)
    .single()

  // Create the cross-session message
  const timeoutMs = body.timeoutMs || 30000
  const expiresAt = new Date(Date.now() + timeoutMs).toISOString()

  const { data: message, error: insertError } = await supabase
    .from('workspace_cross_session_messages')
    .insert({
      project_id: projectId,
      source_session_id: body.sourceSessionId,
      target_session_id: targetSessionId,
      target_repo_id: targetRepoId,
      message_type: body.messageType || 'query',
      query: body.query,
      context: body.context || null,
      status: 'pending',
      expires_at: expiresAt,
    })
    .select('request_id')
    .single()

  if (insertError) {
    console.error('[CrossSession] Insert error:', insertError)
    return NextResponse.json({ error: 'Failed to create request' }, { status: 500 })
  }

  const targetCreator = targetSessionInfo?.creator as any
  const targetRepo = targetSessionInfo?.repo as any

  return NextResponse.json({
    requestId: message.request_id,
    status: 'pending',
    targetSession: {
      sessionId: targetSessionId,
      userName: targetCreator?.full_name || targetCreator?.email?.split('@')[0] || 'Unknown',
      repoName: targetRepo ? `${targetRepo.owner}/${targetRepo.name}` : null,
    },
    expiresAt,
  })
}

/**
 * GET - Get pending requests for a session or check request status
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('sessionId')
  const requestId = searchParams.get('requestId')

  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check specific request status
  if (requestId) {
    const { data: request } = await supabase
      .from('workspace_cross_session_messages')
      .select(`
        *,
        source_session:workspace_sessions!source_session_id(
          id,
          created_by,
          creator:profiles(full_name, email),
          repo:repos(owner, name)
        ),
        target_session:workspace_sessions!target_session_id(
          id,
          created_by,
          creator:profiles(full_name, email),
          repo:repos(owner, name)
        )
      `)
      .eq('request_id', requestId)
      .eq('project_id', projectId)
      .single()

    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    const sourceSession = request.source_session as any
    const targetSession = request.target_session as any

    return NextResponse.json({
      requestId: request.request_id,
      status: request.status,
      query: request.query,
      response: request.response,
      responseData: request.response_data,
      sourceSession: {
        sessionId: sourceSession?.id,
        userName: sourceSession?.creator?.full_name ||
          sourceSession?.creator?.email?.split('@')[0] || 'Unknown',
        repoName: sourceSession?.repo ?
          `${sourceSession.repo.owner}/${sourceSession.repo.name}` : null,
      },
      targetSession: {
        sessionId: targetSession?.id,
        userName: targetSession?.creator?.full_name ||
          targetSession?.creator?.email?.split('@')[0] || 'Unknown',
        repoName: targetSession?.repo ?
          `${targetSession.repo.owner}/${targetSession.repo.name}` : null,
      },
      createdAt: request.created_at,
      completedAt: request.completed_at,
      expiresAt: request.expires_at,
    })
  }

  // Get pending requests for a session
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId or requestId required' }, { status: 400 })
  }

  // Verify session ownership
  const { data: session } = await supabase
    .from('workspace_sessions')
    .select('id, created_by')
    .eq('id', sessionId)
    .eq('project_id', projectId)
    .single()

  if (!session || session.created_by !== user.id) {
    return NextResponse.json({ error: 'Session not found or not owned by you' }, { status: 404 })
  }

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
    .in('status', ['pending', 'delivered'])
    .order('created_at', { ascending: true })

  return NextResponse.json({
    requests: (pendingRequests || []).map((req) => {
      const sourceSession = req.source_session as any
      return {
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
      }
    }),
  })
}
