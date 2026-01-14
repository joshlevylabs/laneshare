import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import OpenAI from 'openai'
import { PRD_PLAN_SYSTEM_PROMPT } from '@laneshare/shared'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const chatMessageSchema = z.object({
  content: z.string().min(1).max(10000),
})

export async function GET(
  request: Request,
  { params }: { params: { id: string; prdId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Get chat messages
  const { data: messages, error } = await supabase
    .from('prd_chat_messages')
    .select('*')
    .eq('prd_id', params.prdId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(messages || [])
}

export async function POST(
  request: Request,
  { params }: { params: { id: string; prdId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const body = await request.json()
  const result = chatMessageSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Get PRD context
  const { data: prd } = await supabase
    .from('project_prds')
    .select('title, description, raw_markdown')
    .eq('id', params.prdId)
    .single()

  // Get project info including settings
  const { data: project } = await supabase
    .from('projects')
    .select('name, description, settings')
    .eq('id', params.id)
    .single()

  // Determine which AI model to use
  const aiModel = (project?.settings as { ai_model?: string } | null)?.ai_model || 'gpt-4o'

  // Get existing chat history
  const { data: existingMessages } = await supabase
    .from('prd_chat_messages')
    .select('sender, content')
    .eq('prd_id', params.prdId)
    .order('created_at', { ascending: true })
    .limit(50)

  // Save user message
  const { data: userMessage, error: userError } = await supabase
    .from('prd_chat_messages')
    .insert({
      prd_id: params.prdId,
      project_id: params.id,
      sender: 'USER',
      content: result.data.content,
    })
    .select()
    .single()

  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 500 })
  }

  // Build context for AI
  const contextInfo = `
PROJECT: ${project?.name || 'Unknown'}
PROJECT DESCRIPTION: ${project?.description || 'No description'}

PRD TITLE: ${prd?.title || 'New PRD'}
PRD DESCRIPTION: ${prd?.description || 'No description yet'}

CURRENT PRD DRAFT:
${prd?.raw_markdown || 'No content yet - starting fresh.'}
`.trim()

  // Build chat history for OpenAI
  const chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = (existingMessages || []).map(msg => ({
    role: msg.sender === 'USER' ? 'user' : 'assistant',
    content: msg.content,
  }))

  // Add current message
  chatHistory.push({ role: 'user', content: result.data.content })

  try {
    const response = await openai.chat.completions.create({
      model: aiModel,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: PRD_PLAN_SYSTEM_PROMPT + '\n\nCONTEXT:\n' + contextInfo },
        ...chatHistory,
      ],
    })

    const aiContent = response.choices[0]?.message?.content || 'I apologize, I could not generate a response.'

    // Check if AI suggested a PRD section (marked with special tags)
    let suggestedSection: { type: string; content: string } | null = null
    const sectionMatch = aiContent.match(/\[PRD_SECTION:(\w+)\]([\s\S]*?)\[\/PRD_SECTION\]/i)
    if (sectionMatch) {
      suggestedSection = {
        type: sectionMatch[1],
        content: sectionMatch[2].trim(),
      }
    }

    // Save AI response
    const { data: aiMessage, error: aiError } = await supabase
      .from('prd_chat_messages')
      .insert({
        prd_id: params.prdId,
        project_id: params.id,
        sender: 'AI',
        content: aiContent,
        suggested_section: suggestedSection,
      })
      .select()
      .single()

    if (aiError) {
      console.error('Error saving AI response:', aiError)
    }

    return NextResponse.json({
      userMessage,
      aiMessage,
    })
  } catch (error) {
    console.error('OpenAI error:', error)
    return NextResponse.json(
      { error: 'Failed to generate AI response' },
      { status: 500 }
    )
  }
}
