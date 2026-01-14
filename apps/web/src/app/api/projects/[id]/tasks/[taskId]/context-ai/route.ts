import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import OpenAI from 'openai'
import {
  CONTEXT_AI_SYSTEM_PROMPT,
  buildContextDiscoveryPrompt,
  parseContextDiscoveryResponse,
  type ContextDiscoveryInput,
} from '@laneshare/shared'
import type {
  Task,
  TaskContextMessage,
  ContextAISuggestion,
} from '@laneshare/shared'

const sendMessageSchema = z.object({
  message: z.string().min(1).max(5000),
})

interface TaskRow {
  id: string
  key: string
  title: string
  description: string | null
  type: string
  status: string
  priority: string
  labels: string[] | null
  project_id: string
}

interface MessageRow {
  id: string
  task_id: string
  project_id: string
  sender: string
  content: string
  suggestions: ContextAISuggestion[] | null
  created_by: string | null
  created_at: string
}

interface ServiceConnectionRow {
  id: string
  service: string
  display_name: string
}

interface ServiceAssetRow {
  id: string
  name: string
  asset_type: string
  asset_key: string
  service: string
}

interface RepoRow {
  id: string
  owner: string
  name: string
  default_branch: string
}

interface DocRow {
  id: string
  slug: string
  title: string
  category: string | null
  markdown: string
}

/**
 * GET /api/projects/[id]/tasks/[taskId]/context-ai
 * Get context AI chat history
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string; taskId: string } }
) {
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
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Get chat history
  const { data: messages, error } = await supabase
    .from('task_context_messages')
    .select('*')
    .eq('task_id', params.taskId)
    .eq('project_id', params.id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching context messages:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    messages: (messages as MessageRow[]) || [],
  })
}

/**
 * POST /api/projects/[id]/tasks/[taskId]/context-ai
 * Send a message to the Context AI
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string; taskId: string } }
) {
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
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const body = await request.json()
  const parseResult = sendMessageSchema.safeParse(body)

  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parseResult.error.flatten() },
      { status: 400 }
    )
  }

  // Get the task
  const { data: taskData, error: taskError } = await supabase
    .from('tasks')
    .select('id, key, title, description, type, status, priority, labels, project_id')
    .eq('id', params.taskId)
    .eq('project_id', params.id)
    .single()

  if (taskError || !taskData) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const taskRow = taskData as TaskRow
  const task: Task = {
    id: taskRow.id,
    key: taskRow.key,
    title: taskRow.title,
    description: taskRow.description ?? undefined,
    type: taskRow.type as Task['type'],
    status: taskRow.status as Task['status'],
    priority: taskRow.priority as Task['priority'],
    labels: taskRow.labels || [],
    project_id: taskRow.project_id,
    rank: 0,
    created_at: '',
    updated_at: '',
  }

  // Get project name
  const { data: projectData } = await supabase
    .from('projects')
    .select('name')
    .eq('id', params.id)
    .single()

  const projectName = projectData?.name || 'Unknown Project'

  // Get the latest architecture snapshot ID for features
  const { data: latestSnapshot } = await supabase
    .from('architecture_snapshots')
    .select('id')
    .eq('project_id', params.id)
    .eq('status', 'completed')
    .order('generated_at', { ascending: false })
    .limit(1)
    .single()

  // Fetch available context in parallel
  const [servicesResult, assetsResult, reposResult, docsResult, historyResult, featuresResult, ticketsResult] =
    await Promise.all([
      supabase
        .from('project_service_connections')
        .select('id, service, display_name')
        .eq('project_id', params.id)
        .eq('status', 'CONNECTED'),

      supabase
        .from('service_assets')
        .select('id, name, asset_type, asset_key, service')
        .eq('project_id', params.id)
        .limit(100),

      supabase
        .from('repos')
        .select('id, owner, name, default_branch')
        .eq('project_id', params.id)
        .in('status', ['SYNCED', 'SYNCING']),

      supabase
        .from('doc_pages')
        .select('id, slug, title, category, markdown')
        .eq('project_id', params.id),

      supabase
        .from('task_context_messages')
        .select('*')
        .eq('task_id', params.taskId)
        .eq('project_id', params.id)
        .order('created_at', { ascending: true })
        .limit(20),

      // Fetch architecture features from latest snapshot
      latestSnapshot
        ? supabase
            .from('architecture_features')
            .select('id, feature_slug, feature_name, description')
            .eq('snapshot_id', latestSnapshot.id)
        : Promise.resolve({ data: [] }),

      // Fetch other tasks in the project (excluding current task)
      supabase
        .from('tasks')
        .select('id, key, title, status, type')
        .eq('project_id', params.id)
        .neq('id', params.taskId)
        .limit(50),
    ])

  // Save the user's message first
  const { data: userMessage, error: userMsgError } = await supabase
    .from('task_context_messages')
    .insert({
      task_id: params.taskId,
      project_id: params.id,
      sender: 'USER',
      content: parseResult.data.message,
      created_by: user.id,
    })
    .select()
    .single()

  if (userMsgError) {
    console.error('Error saving user message:', userMsgError)
    return NextResponse.json({ error: userMsgError.message }, { status: 500 })
  }

  // Build conversation history
  const history = (historyResult.data as MessageRow[] | null) || []
  const conversationHistory = history.map((msg) => ({
    role: msg.sender === 'USER' ? 'user' as const : 'ai' as const,
    content: msg.content,
  }))

  // Build available docs with excerpts
  const availableDocs = ((docsResult.data as DocRow[] | null) || []).map((doc) => ({
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    category: doc.category ?? undefined,
    excerpt: doc.markdown.slice(0, 200),
  }))

  // Build available features
  const availableFeatures = ((featuresResult.data as any[] | null) || []).map((f) => ({
    id: f.id,
    feature_slug: f.feature_slug,
    feature_name: f.feature_name,
    description: f.description ?? undefined,
  }))

  // Build available tickets
  const availableTickets = ((ticketsResult.data as any[] | null) || []).map((t) => ({
    id: t.id,
    key: t.key,
    title: t.title,
    status: t.status,
    type: t.type,
  }))

  // Build the prompt context
  const discoveryInput: ContextDiscoveryInput = {
    task,
    projectName,
    availableServices: (servicesResult.data as ServiceConnectionRow[] | null) || [],
    availableAssets: (assetsResult.data as ServiceAssetRow[] | null) || [],
    availableRepos: (reposResult.data as RepoRow[] | null) || [],
    availableDocs,
    availableFeatures,
    availableTickets,
    conversationHistory,
    userMessage: parseResult.data.message,
  }

  const prompt = buildContextDiscoveryPrompt(discoveryInput)

  // Call AI
  let aiResponse: string
  let suggestions: ContextAISuggestion[] = []

  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const response = await openai.chat.completions.create({
      model: 'gpt-5',
      max_tokens: 2048,
      messages: [
        {
          role: 'system',
          content: CONTEXT_AI_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    const responseText = response.choices[0]?.message?.content || ''

    // Parse the response
    const parsed = parseContextDiscoveryResponse(responseText)

    if (parsed) {
      aiResponse = parsed.response
      suggestions = parsed.suggestions
    } else {
      // Fallback if parsing fails
      aiResponse = responseText
    }
  } catch (error: unknown) {
    console.error('Error calling Context AI:', error)

    // Check for specific error types
    if (error instanceof OpenAI.APIError) {
      const errorMessage = error.message || ''
      if (errorMessage.includes('insufficient_quota') || errorMessage.includes('rate_limit')) {
        aiResponse = "The AI service is currently unavailable due to API limits. Please contact your administrator to resolve this issue."
      } else {
        aiResponse = `I'm sorry, the AI service returned an error: ${errorMessage || 'Unknown error'}. Please try again later.`
      }
    } else {
      aiResponse = "I'm sorry, I encountered an error while analyzing the context. Please try again."
    }
  }

  // Save the AI's response
  const { data: aiMessage, error: aiMsgError } = await supabase
    .from('task_context_messages')
    .insert({
      task_id: params.taskId,
      project_id: params.id,
      sender: 'AI',
      content: aiResponse,
      suggestions: suggestions.length > 0 ? suggestions : null,
    })
    .select()
    .single()

  if (aiMsgError) {
    console.error('Error saving AI message:', aiMsgError)
    // Still return the response even if we can't save it
    return NextResponse.json({
      userMessage,
      aiMessage: {
        id: 'temp',
        task_id: params.taskId,
        project_id: params.id,
        sender: 'AI',
        content: aiResponse,
        suggestions,
        created_at: new Date().toISOString(),
      },
    })
  }

  return NextResponse.json({
    userMessage,
    aiMessage,
  })
}

/**
 * DELETE /api/projects/[id]/tasks/[taskId]/context-ai
 * Clear context AI chat history
 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; taskId: string } }
) {
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
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const { error } = await supabase
    .from('task_context_messages')
    .delete()
    .eq('task_id', params.taskId)
    .eq('project_id', params.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
