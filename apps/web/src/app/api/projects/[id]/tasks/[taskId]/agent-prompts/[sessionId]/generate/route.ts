import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Json } from '@/lib/supabase/types'
import {
  buildTaskAgentPrompt,
  buildFollowUpPrompt,
  type TaskPromptContext,
  type FollowUpContext,
  type LinkedContextForPrompt,
} from '@laneshare/shared'
import type {
  Task,
  Repo,
  SearchResult,
  DocPage,
  ResponseAnalysisResult,
  PromptMetadata,
} from '@laneshare/shared'

const generatePromptSchema = z.object({
  additionalInstructions: z.string().max(5000).optional(),
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
  story_points: number | null
  assignee_id: string | null
  reporter_id: string | null
  sprint_id: string | null
  repo_scope: string[] | null
  due_date: string | null
  start_date: string | null
  parent_task_id: string | null
  rank: number
  project_id: string
  created_at: string
  updated_at: string
}

interface RepoRow {
  id: string
  owner: string
  name: string
  default_branch: string
  provider: string
  status: string
  last_synced_at: string | null
}

interface ChunkRow {
  id: string
  repo_id: string
  file_path: string
  content: string
  chunk_index: number
  metadata: Record<string, unknown> | null
}

interface DocRow {
  id: string
  slug: string
  title: string
  markdown: string
  category: string
}

interface TurnRow {
  id: string
  session_id: string
  turn_number: number
  status: string
  prompt_content: string
  prompt_metadata: Record<string, unknown>
  agent_response: string | null
  agent_tool: string | null
  analysis_result: ResponseAnalysisResult | null
  created_at: string
  completed_at: string | null
}

interface ProjectRow {
  id: string
  name: string
}

/**
 * POST /api/projects/[id]/tasks/[taskId]/agent-prompts/[sessionId]/generate
 * Generate an agent prompt (initial or follow-up)
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string; taskId: string; sessionId: string } }
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
  const parseResult = generatePromptSchema.safeParse(body)

  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parseResult.error.flatten() },
      { status: 400 }
    )
  }

  // Get the session
  const { data: session, error: sessionError } = await supabase
    .from('agent_prompt_sessions')
    .select(`
      *,
      repo:repos!repo_id(id, owner, name, default_branch, provider, status, last_synced_at),
      turns:agent_prompt_turns(*)
    `)
    .eq('id', params.sessionId)
    .eq('task_id', params.taskId)
    .eq('project_id', params.id)
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Get the task
  const { data: taskData, error: taskError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', params.taskId)
    .eq('project_id', params.id)
    .single()

  if (taskError || !taskData) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  // Get the project name
  const { data: projectData } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', params.id)
    .single()

  const projectName = (projectData as ProjectRow | null)?.name || 'Unknown Project'

  // Transform to Task type
  const taskRow = taskData as TaskRow
  const task: Task = {
    id: taskRow.id,
    key: taskRow.key || `TASK-${taskRow.id.slice(0, 4).toUpperCase()}`,
    title: taskRow.title,
    description: taskRow.description ?? undefined,
    type: (taskRow.type as Task['type']) || 'TASK',
    status: taskRow.status as Task['status'],
    priority: taskRow.priority as Task['priority'],
    labels: taskRow.labels || [],
    story_points: taskRow.story_points ?? undefined,
    assignee_id: taskRow.assignee_id ?? undefined,
    reporter_id: taskRow.reporter_id ?? undefined,
    sprint_id: taskRow.sprint_id ?? undefined,
    repo_scope: taskRow.repo_scope ?? undefined,
    due_date: taskRow.due_date ?? undefined,
    start_date: taskRow.start_date ?? undefined,
    parent_task_id: taskRow.parent_task_id ?? undefined,
    rank: taskRow.rank,
    project_id: taskRow.project_id,
    created_at: taskRow.created_at,
    updated_at: taskRow.updated_at,
  }

  // Transform repo
  const repoRow = session.repo as RepoRow
  const repo: Repo = {
    id: repoRow.id,
    project_id: params.id,
    provider: repoRow.provider as 'github',
    owner: repoRow.owner,
    name: repoRow.name,
    default_branch: repoRow.default_branch,
    installed_at: '', // Not needed for prompt generation
    last_synced_at: repoRow.last_synced_at ?? undefined,
    status: repoRow.status as Repo['status'],
  }

  // Get relevant code chunks using semantic search
  // First, try to get embeddings for the task title and description
  const searchQuery = `${task.title} ${task.description || ''}`.trim()

  // Get relevant chunks from this repo
  const { data: chunksData } = await supabase
    .from('chunks')
    .select('id, repo_id, file_path, content, chunk_index, metadata')
    .eq('repo_id', repo.id)
    .limit(10)

  const relevantChunks: SearchResult[] = (chunksData as ChunkRow[] | null)?.map((chunk) => ({
    id: chunk.id,
    repo_id: chunk.repo_id,
    file_path: chunk.file_path,
    content: chunk.content,
    chunk_index: chunk.chunk_index,
    repo: repo,
  })) || []

  // Get relevant documentation
  const { data: docsData } = await supabase
    .from('doc_pages')
    .select('id, slug, title, markdown, category')
    .eq('project_id', params.id)
    .limit(5)

  const relevantDocs: Pick<DocPage, 'slug' | 'title' | 'markdown'>[] =
    (docsData as DocRow[] | null)?.map((doc) => ({
      slug: doc.slug,
      title: doc.title,
      markdown: doc.markdown,
    })) || []

  // Fetch linked context for this task
  const [serviceLinksResult, assetLinksResult, repoLinksResult, docLinksResult, featureLinksResult, ticketLinksResult] =
    await Promise.all([
      supabase
        .from('task_service_links')
        .select(`
          connection:project_service_connections(id, service, display_name)
        `)
        .eq('task_id', params.taskId),

      supabase
        .from('task_asset_links')
        .select(`
          asset:service_assets(id, name, asset_type, asset_key, service, data_json, connection_id)
        `)
        .eq('task_id', params.taskId),

      supabase
        .from('task_repo_links')
        .select(`
          repo:repos(id, owner, name, default_branch)
        `)
        .eq('task_id', params.taskId),

      supabase
        .from('task_doc_links')
        .select(`
          doc:doc_pages(id, slug, title, markdown, category)
        `)
        .eq('task_id', params.taskId),

      supabase
        .from('task_feature_links')
        .select(`
          feature:architecture_features(id, feature_slug, feature_name, description, flow_json, screens, endpoints, tables)
        `)
        .eq('task_id', params.taskId),

      supabase
        .from('task_ticket_links')
        .select(`
          link_type,
          linked_task:tasks!linked_task_id(id, key, title, description, type, status, priority)
        `)
        .eq('task_id', params.taskId),
    ])

  // Build linked context for prompt
  const linkedContext: LinkedContextForPrompt = {
    services: [],
    repos: [],
    docs: [],
    features: [],
    tickets: [],
  }

  // Process service links and group assets by service
  interface ServiceWithAssets {
    service: string
    display_name: string
    assets: Array<{
      name: string
      asset_type: string
      asset_key: string
      data_json?: Record<string, unknown>
    }>
  }
  const serviceMap = new Map<string, ServiceWithAssets>()

  // Add services from service links
  if (serviceLinksResult.data) {
    for (const link of serviceLinksResult.data as any[]) {
      const conn = link.connection
      if (conn && !serviceMap.has(conn.id)) {
        serviceMap.set(conn.id, {
          service: conn.service,
          display_name: conn.display_name,
          assets: [],
        })
      }
    }
  }

  // Add assets and their parent services
  if (assetLinksResult.data) {
    for (const link of assetLinksResult.data as any[]) {
      const asset = link.asset
      if (asset) {
        // If we don't have this service yet, add a placeholder
        if (!serviceMap.has(asset.connection_id)) {
          serviceMap.set(asset.connection_id, {
            service: asset.service,
            display_name: asset.service,
            assets: [],
          })
        }
        const serviceEntry = serviceMap.get(asset.connection_id)!
        serviceEntry.assets.push({
          name: asset.name,
          asset_type: asset.asset_type,
          asset_key: asset.asset_key,
          data_json: asset.data_json,
        })
      }
    }
  }

  linkedContext.services = Array.from(serviceMap.values())

  // Add linked repos
  if (repoLinksResult.data) {
    for (const link of repoLinksResult.data as any[]) {
      const r = link.repo
      if (r) {
        linkedContext.repos.push({
          owner: r.owner,
          name: r.name,
          default_branch: r.default_branch,
        })
      }
    }
  }

  // Add linked docs
  if (docLinksResult.data) {
    for (const link of docLinksResult.data as any[]) {
      const d = link.doc
      if (d) {
        linkedContext.docs.push({
          slug: d.slug,
          title: d.title,
          markdown: d.markdown,
          category: d.category ?? undefined,
        })
      }
    }
  }

  // Add linked features
  if (featureLinksResult.data) {
    for (const link of featureLinksResult.data as any[]) {
      const f = link.feature
      if (f) {
        linkedContext.features!.push({
          feature_slug: f.feature_slug,
          feature_name: f.feature_name,
          description: f.description ?? undefined,
          flow_json: f.flow_json,
          screens: f.screens,
          endpoints: f.endpoints,
          tables: f.tables,
        })
      }
    }
  }

  // Add linked tickets
  if (ticketLinksResult.data) {
    for (const link of ticketLinksResult.data as any[]) {
      const t = link.linked_task
      if (t) {
        linkedContext.tickets!.push({
          link_type: link.link_type,
          key: t.key,
          title: t.title,
          description: t.description ?? undefined,
          type: t.type,
          status: t.status,
          priority: t.priority,
        })
      }
    }
  }

  // Get existing turns sorted by turn_number
  const turns = (session.turns as TurnRow[] | null)?.sort(
    (a, b) => a.turn_number - b.turn_number
  ) || []

  // Find the last completed turn with an analysis result
  const lastCompletedTurn = turns
    .filter((t) => t.status === 'COMPLETED' || t.status === 'NEEDS_FOLLOW_UP')
    .pop()

  let promptResult: { prompt: string; metadata: PromptMetadata }

  if (lastCompletedTurn?.analysis_result && lastCompletedTurn.analysis_result.needsFollowUp) {
    // Generate follow-up prompt
    const followUpContext: FollowUpContext = {
      task,
      repo,
      projectName,
      previousPrompt: lastCompletedTurn.prompt_content,
      previousResponse: lastCompletedTurn.agent_response || '',
      analysisResult: lastCompletedTurn.analysis_result,
      relevantChunks,
      additionalInstructions: parseResult.data.additionalInstructions,
    }

    promptResult = buildFollowUpPrompt(followUpContext)
  } else {
    // Generate initial prompt
    const taskContext: TaskPromptContext = {
      task,
      repo,
      projectName,
      relevantChunks,
      relevantDocs,
      additionalInstructions: parseResult.data.additionalInstructions,
      linkedContext:
        linkedContext.services.length > 0 ||
        linkedContext.repos.length > 0 ||
        linkedContext.docs.length > 0 ||
        (linkedContext.features?.length ?? 0) > 0 ||
        (linkedContext.tickets?.length ?? 0) > 0
          ? linkedContext
          : undefined,
    }

    promptResult = buildTaskAgentPrompt(taskContext)
  }

  // Calculate the next turn number
  const nextTurnNumber = turns.length > 0 ? Math.max(...turns.map((t) => t.turn_number)) + 1 : 1

  // Create the new turn
  const { data: newTurn, error: turnError } = await supabase
    .from('agent_prompt_turns')
    .insert({
      session_id: params.sessionId,
      turn_number: nextTurnNumber,
      status: 'PENDING_RESPONSE',
      prompt_content: promptResult.prompt,
      prompt_metadata: promptResult.metadata as unknown as Json,
    })
    .select()
    .single()

  if (turnError) {
    console.error('Error creating prompt turn:', turnError)
    return NextResponse.json({ error: turnError.message }, { status: 500 })
  }

  // Log activity
  await supabase.from('task_activity').insert({
    task_id: params.taskId,
    project_id: params.id,
    actor_id: user.id,
    kind: 'UPDATED',
    field_name: 'agent_prompt_generated',
    after_value: {
      session_id: params.sessionId,
      turn_id: newTurn.id,
      turn_number: nextTurnNumber,
      repo: `${repo.owner}/${repo.name}`,
    },
  })

  return NextResponse.json(newTurn, { status: 201 })
}
