/**
 * Workspace Orchestrator API
 *
 * Uses Claude API to provide a higher-level AI agent that can:
 * - See all active workspaces/Codespaces
 * - Help coordinate work across multiple repositories
 * - Provide guidance on cross-repo tasks
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

interface WorkspaceContext {
  repoName: string
  codespaceName: string
  state: string
  branch: string
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

  // Build system prompt
  const systemPrompt = `You are the Workspace Orchestrator, an AI assistant helping coordinate work across multiple GitHub Codespaces and repositories.

PROJECT: ${project?.name || 'Unknown Project'}
${project?.description ? `DESCRIPTION: ${project.description}` : ''}

ACTIVE WORKSPACES:
${
  workspaceContext.length > 0
    ? workspaceContext
        .map(
          (ws) =>
            `- ${ws.repoName} (Codespace: ${ws.codespaceName}, State: ${ws.state}, Branch: ${ws.branch})`
        )
        .join('\n')
    : 'No active workspaces currently.'
}

Your responsibilities:
1. Help users understand what's happening across their workspaces
2. Suggest how work in one repository might affect or relate to another
3. Provide guidance on cross-repository coordination
4. Answer questions about the overall project architecture
5. Help users decide which workspace to focus on for specific tasks

Keep responses concise but helpful. When referencing specific repositories, mention them by name.`

  try {
    // Build messages for Claude
    const messages: { role: 'user' | 'assistant'; content: string }[] = []

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

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    })

    const assistantResponse =
      response.content[0].type === 'text' ? response.content[0].text : ''

    return NextResponse.json({ response: assistantResponse })
  } catch (error) {
    console.error('[Orchestrator] Error:', error)
    return NextResponse.json(
      { error: 'Failed to get orchestrator response' },
      { status: 500 }
    )
  }
}
