import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getEmbeddingProvider } from '@/lib/embeddings'
import { buildLanePilotSystemPrompt, buildLanePilotUserPrompt } from '@laneshare/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import OpenAI from 'openai'

const sendMessageSchema = z.object({
  content: z.string().min(1).max(10000),
  task_id: z.string().uuid().nullable().optional(),
})

export async function GET(
  request: Request,
  { params }: { params: { id: string; threadId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: messages, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('thread_id', params.threadId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(messages)
}

export async function POST(
  request: Request,
  { params }: { params: { id: string; threadId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify thread belongs to project and user has access
  const { data: thread } = await supabase
    .from('chat_threads')
    .select('*, projects!inner(name)')
    .eq('id', params.threadId)
    .eq('project_id', params.id)
    .single()

  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  }

  const body = await request.json()
  const result = sendMessageSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { content, task_id } = result.data

  // Save user message
  const { data: userMessage, error: userMsgError } = await supabase
    .from('chat_messages')
    .insert({
      thread_id: params.threadId,
      sender: 'USER',
      content,
    })
    .select()
    .single()

  if (userMsgError) {
    return NextResponse.json({ error: userMsgError.message }, { status: 500 })
  }

  // Update thread title if it's the first message
  const { count } = await supabase
    .from('chat_messages')
    .select('*', { count: 'exact', head: true })
    .eq('thread_id', params.threadId)

  if (count === 1) {
    await supabase
      .from('chat_threads')
      .update({ title: content.slice(0, 50) + (content.length > 50 ? '...' : '') })
      .eq('id', params.threadId)
  }

  try {
    // Generate LanePilot response
    const assistantContent = await generateLanePilotResponse(
      supabase,
      params.id,
      params.threadId,
      content,
      task_id || thread.task_id,
      (thread as any).projects.name
    )

    // Save assistant message
    const { data: assistantMessage, error: assistantMsgError } = await supabase
      .from('chat_messages')
      .insert({
        thread_id: params.threadId,
        sender: 'LANEPILOT',
        content: assistantContent,
      })
      .select()
      .single()

    if (assistantMsgError) {
      return NextResponse.json({ error: assistantMsgError.message }, { status: 500 })
    }

    // Update thread timestamp
    await supabase
      .from('chat_threads')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', params.threadId)

    return NextResponse.json({
      userMessage,
      assistantMessage,
    })
  } catch (error) {
    console.error('LanePilot error:', error)

    // Save error message
    const { data: errorMessage } = await supabase
      .from('chat_messages')
      .insert({
        thread_id: params.threadId,
        sender: 'LANEPILOT',
        content: `I encountered an error while processing your request. Please try again.\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}`,
      })
      .select()
      .single()

    return NextResponse.json({
      userMessage,
      assistantMessage: errorMessage,
    })
  }
}

async function generateLanePilotResponse(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  projectId: string,
  threadId: string,
  userMessage: string,
  taskId: string | null,
  projectName: string
): Promise<string> {
  // Fetch context
  const [reposResult, taskResult, historyResult, docsResult] = await Promise.all([
    supabase.from('repos').select('*').eq('project_id', projectId).eq('status', 'SYNCED'),
    taskId
      ? supabase.from('tasks').select('*').eq('id', taskId).single()
      : Promise.resolve({ data: null }),
    supabase
      .from('chat_messages')
      .select('sender, content')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('doc_pages')
      .select('slug, title, markdown')
      .eq('project_id', projectId)
      .limit(5),
  ])

  const repos = reposResult.data || []
  const task = taskResult.data
  const chatHistory = (historyResult.data || [])
    .reverse()
    .map((m: any) => ({
      role: m.sender === 'USER' ? 'user' as const : 'assistant' as const,
      content: m.content,
    }))
  const docs = docsResult.data || []

  // Perform semantic search to find relevant code chunks
  let relevantChunks: any[] = []
  try {
    const embeddingProvider = getEmbeddingProvider()
    const queryEmbedding = await embeddingProvider.embed(
      task ? `${task.title} ${task.description || ''} ${userMessage}` : userMessage
    )

    const { data: chunks } = await supabase.rpc('search_chunks', {
      p_project_id: projectId,
      p_query_embedding: queryEmbedding,
      p_match_count: 10,
      p_match_threshold: 0.5,
    })

    relevantChunks = (chunks || []).map((c: any) => ({
      id: c.id,
      repo_id: c.repo_id,
      file_path: c.file_path,
      content: c.content,
      chunk_index: c.chunk_index,
      similarity: c.similarity,
      repo: {
        owner: c.repo_owner,
        name: c.repo_name,
      },
    }))
  } catch (error) {
    console.error('Search error:', error)
  }

  // Build prompts
  const systemPrompt = buildLanePilotSystemPrompt()
  const userPrompt = buildLanePilotUserPrompt({
    task,
    projectName,
    repos,
    relevantChunks,
    relevantDocs: docs,
    chatHistory,
    userMessage,
  })

  // Call OpenAI
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })

  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 4000,
  })

  return response.choices[0].message.content || 'I was unable to generate a response.'
}
