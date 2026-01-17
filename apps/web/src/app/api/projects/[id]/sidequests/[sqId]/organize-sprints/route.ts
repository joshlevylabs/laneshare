// @ts-nocheck
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import OpenAI from 'openai'

const organizeSchema = z.object({
  strategy: z.enum(['balanced', 'priority_first', 'dependency_aware']).default('balanced'),
  max_points_per_sprint: z.number().int().min(5).max(100).default(20),
  max_tickets_per_sprint: z.number().int().min(3).max(50).default(10),
})

const SPRINT_ORGANIZATION_PROMPT = `You are organizing software development tickets into sprints.

Given a list of tickets with their details, organize them into logical sprint groups following the specified strategy.

Strategies:
- balanced: Distribute work evenly across sprints by story points
- priority_first: Put highest priority items in earlier sprints
- dependency_aware: Consider parent-child relationships and order accordingly

Rules:
1. Each sprint should not exceed the max_points_per_sprint limit
2. Each sprint should not exceed the max_tickets_per_sprint limit
3. Child tickets should generally be in the same or later sprint as their parent
4. Higher priority tickets should be in earlier sprints (especially for priority_first)
5. Aim for cohesive sprints where related tickets are grouped together

Output format (JSON):
{
  "sprints": [
    {
      "sprint_number": 1,
      "theme": "Brief description of sprint focus",
      "ticket_ids": ["uuid1", "uuid2"],
      "total_points": 15,
      "rationale": "Why these tickets are grouped together"
    }
  ]
}`

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

  const body = await request.json().catch(() => ({}))
  const result = organizeSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Get all tickets for this sidequest
  const { data: tickets, error: ticketsError } = await supabase
    .from('sidequest_tickets')
    .select('*')
    .eq('sidequest_id', params.sqId)
    .order('hierarchy_level', { ascending: true })
    .order('sort_order', { ascending: true })

  if (ticketsError) {
    return NextResponse.json({ error: ticketsError.message }, { status: 500 })
  }

  if (!tickets || tickets.length === 0) {
    return NextResponse.json({ error: 'No tickets to organize' }, { status: 400 })
  }

  // Get sidequest context
  const { data: sidequest } = await supabase
    .from('sidequests')
    .select('title, description')
    .eq('id', params.sqId)
    .single()

  // Build ticket context for AI
  const ticketContext = tickets.map(t => ({
    id: t.id,
    type: t.ticket_type,
    title: t.title,
    description: t.description?.substring(0, 200) || '',
    priority: t.priority || 'MEDIUM',
    story_points: t.story_points || estimatePoints(t),
    parent_id: t.parent_ticket_id,
    status: t.status,
  }))

  const prompt = `
## SIDEQUEST
Title: ${sidequest?.title || 'Unknown'}
Description: ${sidequest?.description || 'No description'}

## ORGANIZATION SETTINGS
Strategy: ${result.data.strategy}
Max points per sprint: ${result.data.max_points_per_sprint}
Max tickets per sprint: ${result.data.max_tickets_per_sprint}

## TICKETS TO ORGANIZE
${JSON.stringify(ticketContext, null, 2)}

Organize these tickets into sprints following the ${result.data.strategy} strategy.
`

  // Try OpenAI first, fallback to basic algorithm
  let organization: {
    sprints: Array<{
      sprint_number: number
      theme?: string
      ticket_ids: string[]
      total_points: number
      rationale?: string
    }>
  }

  const useAI = process.env.OPENAI_API_KEY

  if (useAI) {
    try {
      const openai = new OpenAI()
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SPRINT_ORGANIZATION_PROMPT },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 2000,
        temperature: 0.3,
      })

      const content = completion.choices[0]?.message?.content
      if (content) {
        try {
          organization = JSON.parse(content)
        } catch (e) {
          console.error('Failed to parse AI organization, falling back to basic algorithm:', e)
          organization = organizeBasic(tickets, result.data)
        }
      } else {
        organization = organizeBasic(tickets, result.data)
      }
    } catch (error) {
      console.error('OpenAI error, falling back to basic algorithm:', error)
      organization = organizeBasic(tickets, result.data)
    }
  } else {
    // No OpenAI key, use basic algorithm
    organization = organizeBasic(tickets, result.data)
  }

  // Validate ticket IDs
  const validTicketIds = new Set(tickets.map(t => t.id))
  const seenIds = new Set<string>()

  for (const sprint of organization.sprints) {
    sprint.ticket_ids = sprint.ticket_ids.filter(id => {
      if (!validTicketIds.has(id) || seenIds.has(id)) return false
      seenIds.add(id)
      return true
    })
  }

  // Add any unassigned tickets to the last sprint or create a new one
  const assignedIds = new Set(organization.sprints.flatMap(s => s.ticket_ids))
  const unassignedIds = tickets
    .filter(t => !assignedIds.has(t.id))
    .map(t => t.id)

  if (unassignedIds.length > 0) {
    const lastSprint = organization.sprints[organization.sprints.length - 1]
    if (lastSprint && lastSprint.ticket_ids.length < result.data.max_tickets_per_sprint) {
      lastSprint.ticket_ids.push(...unassignedIds.slice(0, result.data.max_tickets_per_sprint - lastSprint.ticket_ids.length))
      const stillUnassigned = unassignedIds.slice(result.data.max_tickets_per_sprint - lastSprint.ticket_ids.length)
      if (stillUnassigned.length > 0) {
        organization.sprints.push({
          sprint_number: organization.sprints.length + 1,
          theme: 'Additional work',
          ticket_ids: stillUnassigned,
          total_points: stillUnassigned.reduce((sum, id) => {
            const ticket = tickets.find(t => t.id === id)
            return sum + (ticket?.story_points || estimatePoints(ticket))
          }, 0),
        })
      }
    } else {
      organization.sprints.push({
        sprint_number: organization.sprints.length + 1,
        theme: 'Additional work',
        ticket_ids: unassignedIds,
        total_points: unassignedIds.reduce((sum, id) => {
          const ticket = tickets.find(t => t.id === id)
          return sum + (ticket?.story_points || estimatePoints(ticket))
        }, 0),
      })
    }
  }

  // Update tickets with their sprint assignments
  try {
    for (const sprint of organization.sprints) {
      for (const ticketId of sprint.ticket_ids) {
        await supabase
          .from('sidequest_tickets')
          .update({ sprint_group: sprint.sprint_number })
          .eq('id', ticketId)
      }
    }
  } catch (dbError) {
    console.error('Database update error:', dbError)
    return NextResponse.json(
      { error: 'Failed to save sprint assignments' },
      { status: 500 }
    )
  }

  // Build response
  const sprintGroups = organization.sprints.map(sprint => ({
    sprint_number: sprint.sprint_number,
    theme: sprint.theme,
    ticket_ids: sprint.ticket_ids,
    total_points: sprint.total_points,
    priority_tickets: sprint.ticket_ids.filter(id => {
      const ticket = tickets.find(t => t.id === id)
      return ticket?.priority === 'URGENT' || ticket?.priority === 'HIGH'
    }).length,
    rationale: sprint.rationale,
  }))

  return NextResponse.json({
    sprint_groups: sprintGroups,
    total_sprints: sprintGroups.length,
    strategy_used: result.data.strategy,
    used_ai: !!useAI,
  })
}

// Basic sprint organization algorithm (fallback when AI not available)
function organizeBasic(
  tickets: Array<{
    id: string
    ticket_type: string
    priority?: string | null
    story_points?: number | null
    parent_ticket_id?: string | null
  }>,
  config: { strategy: string; max_points_per_sprint: number; max_tickets_per_sprint: number }
) {
  const { strategy, max_points_per_sprint, max_tickets_per_sprint } = config

  // Sort tickets by priority and type
  const priorityOrder: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
  const typeOrder: Record<string, number> = { EPIC: 0, STORY: 1, TASK: 2, TEST: 2, SUBTASK: 3 }

  const sortedTickets = [...tickets].sort((a, b) => {
    if (strategy === 'priority_first') {
      const pA = priorityOrder[a.priority || 'MEDIUM'] ?? 2
      const pB = priorityOrder[b.priority || 'MEDIUM'] ?? 2
      if (pA !== pB) return pA - pB
    }

    // Then by type (epics first)
    const tA = typeOrder[a.ticket_type] ?? 2
    const tB = typeOrder[b.ticket_type] ?? 2
    return tA - tB
  })

  const sprints: Array<{
    sprint_number: number
    theme: string
    ticket_ids: string[]
    total_points: number
  }> = []

  let currentSprint: typeof sprints[0] = {
    sprint_number: 1,
    theme: 'Sprint 1',
    ticket_ids: [],
    total_points: 0,
  }

  for (const ticket of sortedTickets) {
    const points = ticket.story_points || estimatePoints(ticket)

    // Check if we need a new sprint
    if (
      currentSprint.ticket_ids.length >= max_tickets_per_sprint ||
      currentSprint.total_points + points > max_points_per_sprint
    ) {
      if (currentSprint.ticket_ids.length > 0) {
        sprints.push(currentSprint)
      }
      currentSprint = {
        sprint_number: sprints.length + 1,
        theme: `Sprint ${sprints.length + 1}`,
        ticket_ids: [],
        total_points: 0,
      }
    }

    currentSprint.ticket_ids.push(ticket.id)
    currentSprint.total_points += points
  }

  // Push the last sprint if it has tickets
  if (currentSprint.ticket_ids.length > 0) {
    sprints.push(currentSprint)
  }

  return { sprints }
}

// Helper to estimate story points based on ticket type
function estimatePoints(ticket: { ticket_type?: string } | undefined): number {
  if (!ticket) return 2
  switch (ticket.ticket_type) {
    case 'EPIC':
      return 13
    case 'STORY':
      return 5
    case 'TASK':
      return 3
    case 'SUBTASK':
      return 1
    default:
      return 2
  }
}
