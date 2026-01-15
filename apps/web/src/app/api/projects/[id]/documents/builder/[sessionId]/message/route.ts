import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'

const sendMessageSchema = z.object({
  content: z.string().min(1).max(4000),
})

// System prompt for document builder interview
const INTERVIEW_SYSTEM_PROMPT = `You are LanePilot, an AI assistant helping users plan documentation for their software project.

Your role is to interview the user about the document they want to create. Ask focused, practical questions to understand:
1. The goal and purpose of the document
2. The target audience (developers, ops, stakeholders, new team members)
3. Key sections or topics to cover
4. What project context is needed (repos, services, APIs, systems)
5. Any constraints or preferences (tone, format, length)

Guidelines:
- Keep questions concise and focused (1-2 questions at a time)
- Provide helpful suggestions based on the document category
- After 3-5 exchanges, summarize what you've learned and suggest moving to context selection
- Be conversational but efficient

The user is creating a document. Help them clarify their requirements.`

// POST /api/projects/[id]/documents/builder/[sessionId]/message - Send a chat message
export async function POST(
  request: Request,
  { params }: { params: { id: string; sessionId: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify user owns this session
  const { data: session } = await supabase
    .from('document_builder_sessions')
    .select('*')
    .eq('id', params.sessionId)
    .eq('project_id', params.id)
    .single()

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (session.created_by !== user.id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Parse request body
  const body = await request.json()
  const result = sendMessageSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const userContent = result.data.content

  // Build context from existing messages
  const existingMessages: Array<{ id: string; sender: 'USER' | 'AI'; content: string; timestamp: string }> =
    (session.interview_messages || []) as Array<{ id: string; sender: 'USER' | 'AI'; content: string; timestamp: string }>

  // Add user message
  const userMessage = {
    id: `msg-${Date.now()}-user`,
    sender: 'USER' as const,
    content: userContent,
    timestamp: new Date().toISOString(),
  }

  // Build Anthropic messages
  const anthropicMessages: Anthropic.MessageParam[] = existingMessages.map((msg) => ({
    role: msg.sender === 'USER' ? 'user' : 'assistant',
    content: msg.content,
  }))
  anthropicMessages.push({ role: 'user', content: userContent })

  // Context for the AI
  const documentContext = `
Document being planned:
- Title: ${session.title || '(not set)'}
- Category: ${session.category || '(not set)'}
- Description: ${session.description || '(not set)'}
`

  try {
    const anthropic = new Anthropic()

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: INTERVIEW_SYSTEM_PROMPT + '\n\n' + documentContext,
      messages: anthropicMessages,
    })

    const assistantContent =
      response.content[0].type === 'text' ? response.content[0].text : ''

    // Add AI message
    const aiMessage = {
      id: `msg-${Date.now()}-ai`,
      sender: 'AI' as const,
      content: assistantContent,
      timestamp: new Date().toISOString(),
    }

    // Update session with new messages
    const updatedMessages = [...existingMessages, userMessage, aiMessage]

    const { error: updateError } = await serviceClient
      .from('document_builder_sessions')
      .update({
        interview_messages: updatedMessages,
        status: 'INTERVIEW',
      })
      .eq('id', params.sessionId)

    if (updateError) {
      console.error('Failed to update session:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      userMessage,
      aiMessage,
    })
  } catch (error) {
    console.error('Failed to generate AI response:', error)
    return NextResponse.json(
      { error: 'Failed to generate response' },
      { status: 500 }
    )
  }
}
