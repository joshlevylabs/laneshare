import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { TaskStatus, DocUpdateSuggestion } from '@laneshare/shared'

const applyUpdatesSchema = z.object({
  applyStatusUpdate: z.boolean().optional(),
  newStatus: z
    .enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'])
    .optional(),
  applyDocUpdates: z.boolean().optional(),
  docUpdates: z
    .array(
      z.object({
        slug: z.string(),
        action: z.enum(['create', 'update']),
        title: z.string().optional(),
        description: z.string(),
        generatedContent: z.string().optional(),
      })
    )
    .optional(),
  completeSession: z.boolean().optional(),
})

/**
 * POST /api/projects/[id]/tasks/[taskId]/agent-prompts/[sessionId]/apply-updates
 * Apply suggested task status and documentation updates
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
  const parseResult = applyUpdatesSchema.safeParse(body)

  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parseResult.error.flatten() },
      { status: 400 }
    )
  }

  // Verify session exists and belongs to this task
  const { data: session, error: sessionError } = await supabase
    .from('agent_prompt_sessions')
    .select('id, status')
    .eq('id', params.sessionId)
    .eq('task_id', params.taskId)
    .eq('project_id', params.id)
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const results: {
    statusUpdated?: boolean
    previousStatus?: string
    newStatus?: string
    docsCreated?: number
    docsUpdated?: number
    sessionCompleted?: boolean
  } = {}

  // Apply status update if requested
  if (parseResult.data.applyStatusUpdate && parseResult.data.newStatus) {
    // Get current task status
    const { data: currentTask } = await supabase
      .from('tasks')
      .select('status')
      .eq('id', params.taskId)
      .single()

    const previousStatus = currentTask?.status

    // Update task status
    const { error: statusError } = await supabase
      .from('tasks')
      .update({
        status: parseResult.data.newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.taskId)
      .eq('project_id', params.id)

    if (statusError) {
      console.error('Error updating task status:', statusError)
      return NextResponse.json({ error: statusError.message }, { status: 500 })
    }

    // Log activity
    await supabase.from('task_activity').insert({
      task_id: params.taskId,
      project_id: params.id,
      actor_id: user.id,
      kind: 'STATUS_CHANGED',
      field_name: 'status',
      before_value: previousStatus,
      after_value: parseResult.data.newStatus,
    })

    results.statusUpdated = true
    results.previousStatus = previousStatus
    results.newStatus = parseResult.data.newStatus
  }

  // Apply doc updates if requested
  if (parseResult.data.applyDocUpdates && parseResult.data.docUpdates) {
    let docsCreated = 0
    let docsUpdated = 0

    for (const docUpdate of parseResult.data.docUpdates) {
      if (docUpdate.action === 'create') {
        // Create new doc page
        const { error: createError } = await supabase.from('doc_pages').insert({
          project_id: params.id,
          slug: docUpdate.slug,
          title: docUpdate.title || docUpdate.slug.split('/').pop() || 'Untitled',
          markdown:
            docUpdate.generatedContent ||
            `# ${docUpdate.title || docUpdate.slug}\n\n${docUpdate.description}`,
          category: getCategoryFromSlug(docUpdate.slug),
          updated_at: new Date().toISOString(),
        })

        if (!createError) {
          docsCreated++
        } else {
          console.error('Error creating doc:', createError)
        }
      } else if (docUpdate.action === 'update') {
        // Update existing doc page
        const updateData: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        }

        if (docUpdate.generatedContent) {
          updateData.markdown = docUpdate.generatedContent
        }

        const { error: updateError } = await supabase
          .from('doc_pages')
          .update(updateData)
          .eq('project_id', params.id)
          .eq('slug', docUpdate.slug)

        if (!updateError) {
          docsUpdated++
        } else {
          console.error('Error updating doc:', updateError)
        }
      }
    }

    results.docsCreated = docsCreated
    results.docsUpdated = docsUpdated

    // Log doc update activity
    if (docsCreated > 0 || docsUpdated > 0) {
      await supabase.from('task_activity').insert({
        task_id: params.taskId,
        project_id: params.id,
        actor_id: user.id,
        kind: 'UPDATED',
        field_name: 'documentation',
        after_value: {
          docs_created: docsCreated,
          docs_updated: docsUpdated,
          from_session: params.sessionId,
        },
      })
    }
  }

  // Complete session if requested
  if (parseResult.data.completeSession) {
    const { error: completeError } = await supabase
      .from('agent_prompt_sessions')
      .update({
        status: 'COMPLETED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.sessionId)

    if (!completeError) {
      results.sessionCompleted = true
    }
  }

  return NextResponse.json({
    success: true,
    ...results,
  })
}

function getCategoryFromSlug(
  slug: string
): 'architecture' | 'features' | 'decisions' | 'status' {
  if (slug.startsWith('architecture/')) return 'architecture'
  if (slug.startsWith('decisions/')) return 'decisions'
  if (slug.startsWith('status/')) return 'status'
  return 'features'
}
