import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import type { Task, ContextAISuggestion, ContextSuggestionType } from '@laneshare/shared'

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

const SUGGEST_SYSTEM_PROMPT = `You are a context discovery assistant for a software development task tracker. Your job is to analyze a task and suggest relevant context items that would help developers understand and implement the task.

You will be given:
- Task details (title, description, type, status)
- Available context items (services, assets, repos, docs, other tickets)

Return your suggestions as a JSON array with the following structure:
{
  "suggestions": [
    {
      "type": "service" | "asset" | "repo" | "doc" | "feature" | "ticket",
      "id": "the UUID of the item",
      "name": "display name",
      "reason": "brief explanation of why this is relevant",
      "confidence": 0.0-1.0 (how confident you are this is relevant)
    }
  ]
}

Guidelines:
- Only suggest items that are genuinely relevant to the task
- Prioritize higher confidence suggestions
- Include 3-8 suggestions maximum
- Focus on context that would help a developer understand or implement the task
- Consider both direct relevance (mentioned in description) and indirect relevance (related functionality)
- Return ONLY the JSON, no other text`

/**
 * POST /api/projects/[id]/tasks/[taskId]/context-ai/suggest
 * Get one-shot AI suggestions for context items
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

  // Get project name
  const { data: projectData } = await supabase
    .from('projects')
    .select('name')
    .eq('id', params.id)
    .single()

  const projectName = projectData?.name || 'Unknown Project'

  // Fetch available context in parallel
  const [servicesResult, assetsResult, reposResult, docsResult, ticketsResult] =
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

      // Fetch other tasks in the project (excluding current task)
      supabase
        .from('tasks')
        .select('id, key, title, status, type')
        .eq('project_id', params.id)
        .neq('id', params.taskId)
        .limit(50),
    ])

  // Build the prompt
  const services = (servicesResult.data as ServiceConnectionRow[] | null) || []
  const assets = (assetsResult.data as ServiceAssetRow[] | null) || []
  const repos = (reposResult.data as RepoRow[] | null) || []
  const docs = (docsResult.data as DocRow[] | null) || []
  const tickets = (ticketsResult.data as any[] | null) || []

  const prompt = `
# Task to Analyze
- Key: ${taskRow.key}
- Title: ${taskRow.title}
- Type: ${taskRow.type}
- Status: ${taskRow.status}
- Priority: ${taskRow.priority}
- Description: ${taskRow.description || 'No description'}

# Project: ${projectName}

# Available Services (${services.length})
${services.map(s => `- [${s.id}] ${s.display_name} (${s.service})`).join('\n') || 'None'}

# Available Assets (${assets.length})
${assets.slice(0, 30).map(a => `- [${a.id}] ${a.name} (${a.asset_type} - ${a.service})`).join('\n') || 'None'}

# Available Repositories (${repos.length})
${repos.map(r => `- [${r.id}] ${r.owner}/${r.name}`).join('\n') || 'None'}

# Available Documentation (${docs.length})
${docs.map(d => `- [${d.id}] ${d.title} (${d.category || 'general'}) - ${d.markdown.slice(0, 100)}...`).join('\n') || 'None'}

# Related Tickets (${tickets.length})
${tickets.slice(0, 20).map(t => `- [${t.id}] ${t.key}: ${t.title} (${t.type}, ${t.status})`).join('\n') || 'None'}

Based on the task details, suggest relevant context items that would help developers understand and implement this task.
`

  // Call AI
  let suggestions: ContextAISuggestion[] = []

  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: SUGGEST_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    const responseText = response.choices[0]?.message?.content || ''

    // Parse JSON response
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
          suggestions = parsed.suggestions.map((s: any) => ({
            type: s.type as ContextSuggestionType,
            id: s.id,
            name: s.name,
            reason: s.reason,
            confidence: s.confidence || 0.5,
          }))
        }
      }
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError)
    }
  } catch (error: unknown) {
    console.error('Error calling AI for suggestions:', error)
    return NextResponse.json(
      { error: 'Failed to generate suggestions. Please try again.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ suggestions })
}
