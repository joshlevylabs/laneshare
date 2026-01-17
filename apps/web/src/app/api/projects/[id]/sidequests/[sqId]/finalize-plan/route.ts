import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// Type definitions for sidequest tables (not yet in generated types)
interface SidequestRow {
  id: string
  title: string
  description: string | null
  status: string
  repo_ids: string[] | null
  project_id: string
}

interface SidequestTicketRow {
  id: string
  title: string
  description: string | null
  ticket_type: string
  status: string
  parent_ticket_id: string | null
  task_id: string | null
  acceptance_criteria: string[] | null
  priority: string | null
  story_points: number | null
  sprint_group: number | null
  linked_repo_ids: string[] | null
  linked_doc_ids: string[] | null
  linked_feature_ids: string[] | null
}

const finalizeSchema = z.object({
  create_sprint: z.boolean().optional().default(true),
  sprint_name: z.string().min(1).max(100).optional(),
  sprint_goal: z.string().max(500).optional(),
  default_assignee_id: z.string().uuid().nullable().optional(),
})

// Map sidequest ticket types to task types
const TICKET_TYPE_TO_TASK_TYPE: Record<string, string> = {
  EPIC: 'EPIC',
  STORY: 'STORY',
  TASK: 'TASK',
  SUBTASK: 'SUBTASK',
}

export async function POST(
  request: Request,
  { params }: { params: { id: string; sqId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check membership (only OWNER and MAINTAINER can finalize)
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const result = finalizeSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Get the sidequest (using type assertion)
  const { data: sidequest, error: sqError } = await (supabase as any)
    .from('sidequests')
    .select('*')
    .eq('id', params.sqId)
    .eq('project_id', params.id)
    .single() as { data: SidequestRow | null; error: any }

  if (sqError || !sidequest) {
    return NextResponse.json({ error: 'Sidequest not found' }, { status: 404 })
  }

  // Check status
  if (sidequest.status !== 'PLANNING' && sidequest.status !== 'READY') {
    return NextResponse.json(
      { error: 'Sidequest must be in PLANNING or READY status to finalize' },
      { status: 400 }
    )
  }

  // Get all approved tickets (using type assertion)
  const { data: tickets, error: ticketsError } = await (supabase as any)
    .from('sidequest_tickets')
    .select('*')
    .eq('sidequest_id', params.sqId)
    .in('status', ['APPROVED', 'PENDING']) // Include pending so they can still be created
    .order('hierarchy_level', { ascending: true })
    .order('sort_order', { ascending: true }) as { data: SidequestTicketRow[] | null; error: any }

  if (ticketsError) {
    return NextResponse.json({ error: ticketsError.message }, { status: 500 })
  }

  if (!tickets || tickets.length === 0) {
    return NextResponse.json({ error: 'No tickets to finalize' }, { status: 400 })
  }

  // Get the next task key counter
  const { data: counter } = await supabase
    .from('project_counters')
    .select('task_counter')
    .eq('project_id', params.id)
    .single()

  let taskCounter = counter?.task_counter || 0

  // Get project key prefix (using type assertion)
  const { data: project } = await (supabase as any)
    .from('projects')
    .select('key')
    .eq('id', params.id)
    .single() as { data: { key?: string } | null; error: any }

  const projectKey = project?.key || 'SQ'

  // Create sprint if requested
  let sprintId: string | undefined
  if (result.data.create_sprint) {
    const sprintName = result.data.sprint_name || `${sidequest.title} Sprint`

    const { data: sprint, error: sprintError } = await supabase
      .from('sprints')
      .insert({
        project_id: params.id,
        name: sprintName,
        goal: result.data.sprint_goal || `Implement ${sidequest.title}`,
        status: 'PLANNED',
      })
      .select()
      .single()

    if (sprintError) {
      console.error('Sprint creation error:', sprintError)
      // Continue without sprint
    } else {
      sprintId = sprint.id
    }
  }

  // Create tasks from tickets
  const taskMapping = new Map<string, string>() // ticket_id -> task_id
  const errors: string[] = []
  let tasksCreated = 0

  for (const ticket of tickets) {
    // Skip if already has a task
    if (ticket.task_id) {
      taskMapping.set(ticket.id, ticket.task_id)
      continue
    }

    taskCounter++
    const taskKey = `${projectKey}-${taskCounter}`

    // Get parent task ID if exists
    let parentTaskId: string | null = null
    if (ticket.parent_ticket_id && taskMapping.has(ticket.parent_ticket_id)) {
      parentTaskId = taskMapping.get(ticket.parent_ticket_id) || null
    }

    // Build description with acceptance criteria
    let description = ticket.description || ''
    if (ticket.acceptance_criteria && ticket.acceptance_criteria.length > 0) {
      description += '\n\n## Acceptance Criteria\n'
      description += ticket.acceptance_criteria.map((c: string) => `- [ ] ${c}`).join('\n')
    }

    // Map priority
    const priority = ticket.priority || 'MEDIUM'

    try {
      // Create the task (using type assertion)
      const { data: task, error: taskError } = await (supabase as any)
        .from('tasks')
        .insert({
          project_id: params.id,
          key: taskKey,
          title: ticket.title,
          description,
          type: TICKET_TYPE_TO_TASK_TYPE[ticket.ticket_type] || 'TASK',
          status: 'TODO',
          priority,
          story_points: ticket.story_points,
          assignee_id: result.data.default_assignee_id || null,
          reporter_id: user.id,
          sprint_id: sprintId || null,
          parent_task_id: parentTaskId,
          labels: ['sidequest', `sq-${params.sqId.substring(0, 8)}`],
          rank: tasksCreated + 1,
        })
        .select()
        .single() as { data: { id: string } | null; error: any }

      if (taskError || !task) {
        console.error(`Task creation error for ticket ${ticket.id}:`, taskError)
        errors.push(`Failed to create task for "${ticket.title}": ${taskError?.message || 'Unknown error'}`)
        continue
      }

      taskMapping.set(ticket.id, task.id)
      tasksCreated++

      // Update ticket with task link (using type assertion)
      await (supabase as any)
        .from('sidequest_tickets')
        .update({
          task_id: task.id,
          status: 'APPROVED',
        })
        .eq('id', ticket.id)

      // Create context links for the task (ignore duplicates)
      if (ticket.linked_repo_ids && ticket.linked_repo_ids.length > 0) {
        for (const repoId of ticket.linked_repo_ids) {
          try {
            await supabase.from('task_repo_links').insert({
              task_id: task.id,
              project_id: params.id,
              repo_id: repoId,
              created_by: user.id,
            })
          } catch {
            // Ignore duplicates
          }
        }
      }

      if (ticket.linked_doc_ids && ticket.linked_doc_ids.length > 0) {
        for (const docId of ticket.linked_doc_ids) {
          try {
            await supabase.from('task_doc_links').insert({
              task_id: task.id,
              project_id: params.id,
              doc_id: docId,
              created_by: user.id,
            })
          } catch {
            // Ignore duplicates
          }
        }
      }

      if (ticket.linked_feature_ids && ticket.linked_feature_ids.length > 0) {
        for (const featureId of ticket.linked_feature_ids) {
          try {
            await supabase.from('task_feature_links').insert({
              task_id: task.id,
              project_id: params.id,
              feature_id: featureId,
              created_by: user.id,
            })
          } catch {
            // Ignore duplicates
          }
        }
      }
    } catch (error) {
      console.error(`Unexpected error for ticket ${ticket.id}:`, error)
      errors.push(`Unexpected error for "${ticket.title}"`)
    }
  }

  // Update task counter
  await supabase
    .from('project_counters')
    .upsert({
      project_id: params.id,
      task_counter: taskCounter,
    })

  // Update sidequest status (using type assertion)
  await (supabase as any)
    .from('sidequests')
    .update({
      status: 'READY',
      total_tickets: tickets.length,
    })
    .eq('id', params.sqId)

  return NextResponse.json({
    tasks_created: tasksCreated,
    sprint_id: sprintId,
    errors: errors.length > 0 ? errors : undefined,
  })
}
