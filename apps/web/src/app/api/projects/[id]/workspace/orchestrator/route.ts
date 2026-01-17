/**
 * Workspace Orchestrator API
 *
 * Uses Claude API to provide a higher-level AI agent that can:
 * - See ALL active workspaces across ALL team members
 * - Help coordinate work across multiple repositories and users
 * - Provide guidance on cross-repo and cross-user tasks
 * - Prevent duplicated effort and merge conflicts
 * - Query other sessions for information (cross-session communication)
 * - Detect and notify about file conflicts
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

// Tool definitions for cross-session communication
const orchestratorTools: Anthropic.Tool[] = [
  {
    name: 'query_session',
    description: 'Send a query to another active Claude Code session. Use this when you need information from a repository that another session is working on. The response will come from that session.',
    input_schema: {
      type: 'object' as const,
      properties: {
        targetRepoName: {
          type: 'string',
          description: 'The repository name to query (e.g., "owner/repo" or just "repo")',
        },
        query: {
          type: 'string',
          description: 'The question or request to send to the session',
        },
        context: {
          type: 'string',
          description: 'Optional additional context for the query',
        },
      },
      required: ['targetRepoName', 'query'],
    },
  },
  {
    name: 'check_file_conflicts',
    description: 'Check if any files are being edited by multiple sessions simultaneously. Use this to identify potential merge conflicts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to check conflicts for (optional - checks all if not provided)',
        },
      },
      required: [],
    },
  },
  {
    name: 'send_notification',
    description: 'Send a notification message to a specific session or all sessions in a repository.',
    input_schema: {
      type: 'object' as const,
      properties: {
        targetSessionId: {
          type: 'string',
          description: 'Specific session ID to notify (optional)',
        },
        targetRepoName: {
          type: 'string',
          description: 'Repository name to notify all sessions (optional)',
        },
        message: {
          type: 'string',
          description: 'The notification message to send',
        },
        priority: {
          type: 'string',
          enum: ['info', 'warning', 'urgent'],
          description: 'Priority level of the notification',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'get_recent_file_activity',
    description: 'Get recent file activity across all sessions to understand what files are being worked on.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repoName: {
          type: 'string',
          description: 'Filter by repository name (optional)',
        },
        activityType: {
          type: 'string',
          enum: ['read', 'write', 'create', 'delete', 'all'],
          description: 'Filter by activity type (optional, defaults to "all")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of activities to return (default 20)',
        },
      },
      required: [],
    },
  },
]

interface WorkspaceContext {
  repoName: string
  codespaceName: string
  state: string
  branch: string
}

interface TeamSession {
  id: string
  userId: string
  userName: string
  userEmail: string
  repoName: string | null
  codespaceName: string | null
  status: string
  taskKey: string | null
  taskTitle: string | null
  lastActivityAt: string | null
  isCurrentUser: boolean
}

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

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

  const body = await request.json()
  const {
    message,
    workspaceContext,
    conversationHistory,
  }: {
    message: string
    workspaceContext: WorkspaceContext[]
    conversationHistory: ConversationMessage[]
  } = body

  if (!message) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }

  // Get project info for context
  const { data: project } = await supabase
    .from('projects')
    .select('name, description')
    .eq('id', projectId)
    .single()

  // Query ALL active workspace sessions across ALL team members
  const { data: allSessions } = await supabase
    .from('workspace_sessions')
    .select(`
      id,
      status,
      codespace_name,
      last_activity_at,
      created_by,
      task:tasks(id, key, title),
      repo:repos(id, owner, name),
      creator:profiles(id, email, full_name)
    `)
    .eq('project_id', projectId)
    .in('status', ['CONNECTED', 'CONNECTING'])
    .order('last_activity_at', { ascending: false })

  // Transform sessions into team context
  const teamSessions: TeamSession[] = (allSessions || []).map((session: any) => ({
    id: session.id,
    userId: session.created_by,
    userName: session.creator?.full_name || session.creator?.email?.split('@')[0] || 'Unknown',
    userEmail: session.creator?.email || '',
    repoName: session.repo ? `${session.repo.owner}/${session.repo.name}` : null,
    codespaceName: session.codespace_name,
    status: session.status,
    taskKey: session.task?.key || null,
    taskTitle: session.task?.title || null,
    lastActivityAt: session.last_activity_at,
    isCurrentUser: session.created_by === user.id,
  }))

  // Group by user for display
  const currentUserSessions = teamSessions.filter(s => s.isCurrentUser)
  const otherUserSessions = teamSessions.filter(s => !s.isCurrentUser)

  // Build rich team workspace context
  const buildWorkspaceSection = (sessions: TeamSession[], label: string) => {
    if (sessions.length === 0) return ''
    return `${label}:\n${sessions
      .map(s => {
        const parts = [`  - [${s.userName}]`]
        if (s.taskKey) parts.push(`Task: ${s.taskKey}`)
        if (s.taskTitle) parts.push(`"${s.taskTitle}"`)
        if (s.repoName) parts.push(`Repo: ${s.repoName}`)
        if (s.codespaceName) parts.push(`(${s.codespaceName})`)
        parts.push(`[${s.status}]`)
        return parts.join(' ')
      })
      .join('\n')}`
  }

  // Build system prompt with TEAM-WIDE visibility
  const systemPrompt = `You are the Workspace Orchestrator, an AI assistant helping coordinate work across ALL team members' workspaces in this project.

PROJECT: ${project?.name || 'Unknown Project'}
${project?.description ? `DESCRIPTION: ${project.description}` : ''}

=== TEAM WORKSPACE ACTIVITY ===

${buildWorkspaceSection(currentUserSessions, 'YOUR ACTIVE WORKSPACES (Current User)')}

${buildWorkspaceSection(otherUserSessions, 'OTHER TEAM MEMBERS WORKING')}

${workspaceContext.length > 0 ? `
CURRENT USER'S LOCAL CODESPACE STATE:
${workspaceContext
  .map(ws => `  - ${ws.repoName} (${ws.codespaceName}, ${ws.state}, branch: ${ws.branch})`)
  .join('\n')}` : ''}

=== YOUR ROLE ===

You are the central coordinator who can see what EVERYONE on the team is working on. Your responsibilities:

1. **Cross-User Coordination**: Alert the user if another team member is working on related code or the same task
2. **Conflict Prevention**: Warn about potential merge conflicts when multiple users edit the same files
3. **Task Deduplication**: Identify if work is being duplicated across team members
4. **Dependency Awareness**: Note when one user's work depends on another's completion
5. **Progress Summary**: Provide an overview of all active work across the team
6. **Smart Routing**: Suggest which team member might be best suited for a specific task

When answering, always consider the TEAM context. If another user is working on something related, mention it!

Keep responses concise but helpful. Reference team members and repositories by name.

=== AVAILABLE TOOLS ===

You have access to tools for cross-session communication:
- **query_session**: Ask another session for information (e.g., "What endpoints does repo B expose?")
- **check_file_conflicts**: Check for files being edited by multiple users
- **send_notification**: Alert team members about important updates
- **get_recent_file_activity**: See what files are being worked on across the team

Use these tools when the user's question requires information from other repositories or when you need to coordinate across sessions.`

  // Tool execution functions
  async function executeQuerySession(
    toolInput: { targetRepoName: string; query: string; context?: string }
  ): Promise<string> {
    // Find a session working on the target repo
    const matchingSessions = teamSessions.filter(s =>
      s.repoName?.toLowerCase().includes(toolInput.targetRepoName.toLowerCase())
    )

    if (matchingSessions.length === 0) {
      return JSON.stringify({
        success: false,
        error: `No active session found for repository "${toolInput.targetRepoName}"`,
        availableRepos: [...new Set(teamSessions.map(s => s.repoName).filter(Boolean))],
      })
    }

    const targetSession = matchingSessions[0]

    // Create cross-session request
    const { data: crossRequest, error: requestError } = await supabase
      .from('workspace_cross_session_messages')
      .insert({
        project_id: projectId,
        source_session_id: currentUserSessions[0]?.id || null,
        target_session_id: targetSession.id,
        message_type: 'query',
        query: toolInput.query,
        context: toolInput.context ? { additionalContext: toolInput.context } : null,
        status: 'pending',
        expires_at: new Date(Date.now() + 30000).toISOString(), // 30 second timeout
      })
      .select('request_id')
      .single()

    if (requestError) {
      return JSON.stringify({
        success: false,
        error: 'Failed to create cross-session request',
      })
    }

    // Note: In a real implementation, we'd wait for the response with polling
    // For now, we return a placeholder indicating the request was sent
    return JSON.stringify({
      success: true,
      message: `Query sent to ${targetSession.userName}'s session on ${targetSession.repoName}`,
      note: 'The user will be notified when a response arrives via SSE',
      requestId: crossRequest.request_id,
      targetSession: {
        userName: targetSession.userName,
        repoName: targetSession.repoName,
      },
    })
  }

  async function executeCheckFileConflicts(
    toolInput: { sessionId?: string }
  ): Promise<string> {
    // Query recent write activity to find conflicts
    let query = supabase
      .from('workspace_file_activity')
      .select(`
        file_path,
        session_id,
        activity_type,
        timestamp,
        session:workspace_sessions!inner(
          id,
          created_by,
          status,
          repo:repos(owner, name),
          creator:profiles(full_name, email)
        )
      `)
      .in('activity_type', ['write', 'create'])
      .gte('timestamp', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order('file_path')
      .order('timestamp', { ascending: false })

    const { data: activity } = await query

    if (!activity || activity.length === 0) {
      return JSON.stringify({
        conflicts: [],
        message: 'No recent file activity found',
      })
    }

    // Group by file path and find conflicts
    const fileMap = new Map<string, any[]>()
    for (const act of activity) {
      const existing = fileMap.get(act.file_path) || []
      existing.push(act)
      fileMap.set(act.file_path, existing)
    }

    const conflicts: any[] = []
    for (const [filePath, activities] of fileMap) {
      // Get unique sessions for this file
      const sessions = new Map<string, any>()
      for (const act of activities) {
        const sess = act.session as any
        if (sess && !sessions.has(sess.id)) {
          sessions.set(sess.id, {
            sessionId: sess.id,
            userName: sess.creator?.full_name || sess.creator?.email?.split('@')[0] || 'Unknown',
            repoName: sess.repo ? `${sess.repo.owner}/${sess.repo.name}` : null,
            lastActivity: act.timestamp,
          })
        }
      }

      // If multiple sessions edited this file, it's a conflict
      if (sessions.size > 1) {
        conflicts.push({
          filePath,
          sessions: Array.from(sessions.values()),
          severity: sessions.size > 2 ? 'critical' : 'warning',
        })
      }
    }

    return JSON.stringify({
      conflicts,
      totalFilesTracked: fileMap.size,
      conflictCount: conflicts.length,
    })
  }

  async function executeSendNotification(
    toolInput: { targetSessionId?: string; targetRepoName?: string; message: string; priority?: string }
  ): Promise<string> {
    const targetSessions: string[] = []

    if (toolInput.targetSessionId) {
      targetSessions.push(toolInput.targetSessionId)
    } else if (toolInput.targetRepoName) {
      const matching = teamSessions.filter(s =>
        s.repoName?.toLowerCase().includes(toolInput.targetRepoName!.toLowerCase())
      )
      targetSessions.push(...matching.map(s => s.id))
    } else {
      // Notify all sessions
      targetSessions.push(...teamSessions.map(s => s.id))
    }

    if (targetSessions.length === 0) {
      return JSON.stringify({
        success: false,
        error: 'No target sessions found',
      })
    }

    // Create events for each target session
    const events = targetSessions.map(sessionId => ({
      project_id: projectId,
      target_session_id: sessionId,
      event_type: 'orchestrator_message',
      event_data: {
        messageId: crypto.randomUUID(),
        content: toolInput.message,
        priority: toolInput.priority || 'info',
        fromOrchestrator: true,
      },
    }))

    const { error } = await supabase.from('workspace_events').insert(events)

    if (error) {
      return JSON.stringify({
        success: false,
        error: 'Failed to send notifications',
      })
    }

    return JSON.stringify({
      success: true,
      notifiedSessions: targetSessions.length,
      message: toolInput.message,
    })
  }

  async function executeGetRecentFileActivity(
    toolInput: { repoName?: string; activityType?: string; limit?: number }
  ): Promise<string> {
    let query = supabase
      .from('workspace_file_activity')
      .select(`
        file_path,
        activity_type,
        lines_changed,
        change_summary,
        timestamp,
        session:workspace_sessions!inner(
          id,
          repo:repos(owner, name),
          creator:profiles(full_name, email)
        )
      `)
      .gte('timestamp', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // Last hour
      .order('timestamp', { ascending: false })
      .limit(toolInput.limit || 20)

    if (toolInput.activityType && toolInput.activityType !== 'all') {
      query = query.eq('activity_type', toolInput.activityType)
    }

    const { data: activity } = await query

    if (!activity || activity.length === 0) {
      return JSON.stringify({
        activity: [],
        message: 'No recent file activity found',
      })
    }

    // Filter by repo if specified
    let filtered = activity
    if (toolInput.repoName) {
      filtered = activity.filter(act => {
        const sess = act.session as any
        const repoName = sess?.repo ? `${sess.repo.owner}/${sess.repo.name}` : ''
        return repoName.toLowerCase().includes(toolInput.repoName!.toLowerCase())
      })
    }

    const formattedActivity = filtered.map(act => {
      const sess = act.session as any
      return {
        filePath: act.file_path,
        activityType: act.activity_type,
        linesChanged: act.lines_changed,
        summary: act.change_summary,
        timestamp: act.timestamp,
        userName: sess?.creator?.full_name || sess?.creator?.email?.split('@')[0] || 'Unknown',
        repoName: sess?.repo ? `${sess.repo.owner}/${sess.repo.name}` : null,
      }
    })

    return JSON.stringify({
      activity: formattedActivity,
      count: formattedActivity.length,
    })
  }

  // Execute a tool call
  async function executeTool(toolName: string, toolInput: any): Promise<string> {
    switch (toolName) {
      case 'query_session':
        return executeQuerySession(toolInput)
      case 'check_file_conflicts':
        return executeCheckFileConflicts(toolInput)
      case 'send_notification':
        return executeSendNotification(toolInput)
      case 'get_recent_file_activity':
        return executeGetRecentFileActivity(toolInput)
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` })
    }
  }

  try {
    // Build messages for Claude
    const messages: Anthropic.MessageParam[] = []

    // Add conversation history (skip system messages, they're in the system prompt)
    for (const msg of conversationHistory.slice(-8)) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: msg.content,
        })
      }
    }

    // Add the current message
    messages.push({
      role: 'user',
      content: message,
    })

    // Multi-turn tool use loop
    let finalResponse = ''
    let toolsUsed: { name: string; result: any }[] = []
    const maxIterations = 5

    for (let i = 0; i < maxIterations; i++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
        tools: orchestratorTools,
      })

      // Check if we need to execute tools
      if (response.stop_reason === 'tool_use') {
        // Find all tool use blocks
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        )

        // Add assistant's response to messages
        messages.push({
          role: 'assistant',
          content: response.content,
        })

        // Execute each tool and collect results
        const toolResults: Anthropic.ToolResultBlockParam[] = []
        for (const toolUse of toolUseBlocks) {
          const result = await executeTool(toolUse.name, toolUse.input)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result,
          })
          toolsUsed.push({ name: toolUse.name, result: JSON.parse(result) })
        }

        // Add tool results to messages
        messages.push({
          role: 'user',
          content: toolResults,
        })

        // Continue the loop to get the final response
        continue
      }

      // No more tools needed, extract final text response
      for (const block of response.content) {
        if (block.type === 'text') {
          finalResponse = block.text
          break
        }
      }

      break
    }

    // Return response along with team sessions and tools used for UI awareness
    return NextResponse.json({
      response: finalResponse,
      teamSessions,
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
    })
  } catch (error) {
    console.error('[Orchestrator] Error:', error)
    return NextResponse.json(
      { error: 'Failed to get orchestrator response' },
      { status: 500 }
    )
  }
}

/**
 * GET - Fetch all active team workspace sessions
 * Used by frontend to display who else is working
 */
export async function GET(
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

  // Query ALL active workspace sessions across ALL team members
  const { data: allSessions, error } = await supabase
    .from('workspace_sessions')
    .select(`
      id,
      status,
      codespace_name,
      last_activity_at,
      created_by,
      task:tasks(id, key, title),
      repo:repos(id, owner, name),
      creator:profiles(id, email, full_name)
    `)
    .eq('project_id', projectId)
    .in('status', ['CONNECTED', 'CONNECTING'])
    .order('last_activity_at', { ascending: false })

  if (error) {
    console.error('[Orchestrator GET] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 })
  }

  // Transform sessions
  const teamSessions: TeamSession[] = (allSessions || []).map((session: any) => ({
    id: session.id,
    userId: session.created_by,
    userName: session.creator?.full_name || session.creator?.email?.split('@')[0] || 'Unknown',
    userEmail: session.creator?.email || '',
    repoName: session.repo ? `${session.repo.owner}/${session.repo.name}` : null,
    codespaceName: session.codespace_name,
    status: session.status,
    taskKey: session.task?.key || null,
    taskTitle: session.task?.title || null,
    lastActivityAt: session.last_activity_at,
    isCurrentUser: session.created_by === user.id,
  }))

  return NextResponse.json({
    sessions: teamSessions,
    currentUserId: user.id,
    totalActive: teamSessions.length,
    otherUsersActive: teamSessions.filter(s => !s.isCurrentUser).length,
  })
}
