// @ts-nocheck
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const migrateSchema = z.object({
  prd_id: z.string().uuid(),
})

// Map PRD priority (1-5) to sidequest priority
function mapPriority(priority: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' {
  if (priority === 1) return 'URGENT'
  if (priority === 2) return 'HIGH'
  if (priority === 3) return 'MEDIUM'
  return 'LOW'
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
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
  const result = migrateSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Fetch the PRD
  const { data: prd, error: prdError } = await supabase
    .from('project_prds')
    .select('*')
    .eq('id', result.data.prd_id)
    .eq('project_id', params.id)
    .single()

  if (prdError || !prd) {
    return NextResponse.json({ error: 'PRD not found' }, { status: 404 })
  }

  // Check if already migrated
  const { data: existing } = await supabase
    .from('sidequests')
    .select('id')
    .eq('migrated_from_prd_id', prd.id)
    .single()

  if (existing) {
    return NextResponse.json(
      { error: 'PRD has already been migrated', sidequest_id: existing.id },
      { status: 409 }
    )
  }

  // Fetch project repos for sidequest
  const { data: repos } = await supabase
    .from('repos')
    .select('id')
    .eq('project_id', params.id)

  const repoIds = repos?.map((r) => r.id) || []

  // Create the sidequest
  const { data: sidequest, error: sqError } = await supabase
    .from('sidequests')
    .insert({
      project_id: params.id,
      title: prd.title,
      description: prd.description,
      repo_ids: repoIds,
      status: prd.prd_json ? 'READY' : 'PLANNING',
      migrated_from_prd_id: prd.id,
      created_by: user.id,
    })
    .select()
    .single()

  if (sqError) {
    console.error('Sidequest creation error:', sqError)
    return NextResponse.json({ error: sqError.message }, { status: 500 })
  }

  let ticketsCreated = 0
  let chatMessagesMigrated = 0

  // Migrate chat messages
  const { data: chatMessages } = await supabase
    .from('prd_chat_messages')
    .select('*')
    .eq('prd_id', prd.id)
    .order('created_at', { ascending: true })

  if (chatMessages && chatMessages.length > 0) {
    const migratedMessages = chatMessages.map((msg) => ({
      sidequest_id: sidequest.id,
      project_id: params.id,
      sender: msg.sender === 'USER' ? 'USER' : 'AI',
      content: msg.content,
      created_by: msg.sender === 'USER' ? user.id : null,
      created_at: msg.created_at,
    }))

    const { error: msgError } = await supabase
      .from('sidequest_chat_messages')
      .insert(migratedMessages)

    if (!msgError) {
      chatMessagesMigrated = chatMessages.length
    }
  }

  // Migrate user stories to tickets if PRD has prd_json
  if (prd.prd_json && prd.prd_json.userStories) {
    // Create a default Epic for the PRD
    const { data: epic, error: epicError } = await supabase
      .from('sidequest_tickets')
      .insert({
        sidequest_id: sidequest.id,
        project_id: params.id,
        ticket_type: 'EPIC',
        hierarchy_level: 1,
        sort_order: 0,
        title: prd.title,
        description: prd.prd_json.description || prd.description,
        status: 'APPROVED',
        approved_at: new Date().toISOString(),
        approved_by: user.id,
      })
      .select()
      .single()

    if (!epicError && epic) {
      ticketsCreated++

      // Create Story tickets for each user story
      for (let i = 0; i < prd.prd_json.userStories.length; i++) {
        const story = prd.prd_json.userStories[i]

        const { data: storyTicket, error: storyError } = await supabase
          .from('sidequest_tickets')
          .insert({
            sidequest_id: sidequest.id,
            project_id: params.id,
            parent_ticket_id: epic.id,
            ticket_type: 'STORY',
            hierarchy_level: 2,
            sort_order: i,
            title: story.title,
            description: story.description,
            acceptance_criteria: story.acceptanceCriteria || [],
            priority: mapPriority(story.priority || 3),
            story_points: story.estimatedPoints || null,
            sprint_group: Math.ceil((story.priority || 3) / 2),
            linked_repo_ids: story.linkedRepoIds || [],
            linked_doc_ids: story.linkedDocIds || [],
            linked_feature_ids: story.linkedFeatureIds || [],
            status: story.passes ? 'COMPLETED' : 'APPROVED',
            approved_at: new Date().toISOString(),
            approved_by: user.id,
          })
          .select()
          .single()

        if (!storyError && storyTicket) {
          ticketsCreated++

          // Create a default Task for each story
          const { error: taskError } = await supabase.from('sidequest_tickets').insert({
            sidequest_id: sidequest.id,
            project_id: params.id,
            parent_ticket_id: storyTicket.id,
            ticket_type: 'TASK',
            hierarchy_level: 3,
            sort_order: 0,
            title: `Implement: ${story.title}`,
            description: `Implement the functionality described in this story.`,
            acceptance_criteria: story.acceptanceCriteria || [],
            status: story.passes ? 'COMPLETED' : 'APPROVED',
            approved_at: new Date().toISOString(),
            approved_by: user.id,
          })

          if (!taskError) {
            ticketsCreated++
          }
        }
      }
    }
  }

  // Update sidequest ticket counts
  await supabase
    .from('sidequests')
    .update({ total_tickets: ticketsCreated })
    .eq('id', sidequest.id)

  // Fetch the complete sidequest with relations
  const { data: completeSidequest } = await supabase
    .from('sidequests')
    .select(`
      *,
      creator:profiles!created_by(id, email, full_name, avatar_url)
    `)
    .eq('id', sidequest.id)
    .single()

  return NextResponse.json({
    sidequest: completeSidequest,
    tickets_created: ticketsCreated,
    chat_messages_migrated: chatMessagesMigrated,
  })
}
