import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import OpenAI from 'openai'
import { SIDEQUEST_PLANNING_SYSTEM_PROMPT } from '@laneshare/shared'

// Type definitions for sidequest tables (not yet in generated types)
interface SidequestChatMessage {
  id: string
  sidequest_id: string
  project_id: string
  sender: 'USER' | 'AI'
  content: string
  plan_suggestions?: unknown
  options?: unknown
  created_by: string | null
  created_at: string
}

interface SidequestRow {
  id: string
  title: string
  description: string | null
  status: string
  repo_ids: string[] | null
}

interface SidequestTicketRow {
  id: string
  title: string
  ticket_type: string
  status: string
  parent_ticket_id: string | null
}

const sendMessageSchema = z.object({
  content: z.string().min(1).max(10000),
})

// Parse plan suggestions from AI response
function parsePlanSuggestions(content: string) {
  const suggestions: Array<{
    action: string
    parent_id?: string
    target_id?: string
    data: Record<string, unknown>
  }> = []

  const planRegex = /\[PLAN_UPDATE\]([\s\S]*?)\[\/PLAN_UPDATE\]/g
  let match

  while ((match = planRegex.exec(content)) !== null) {
    try {
      const jsonStr = match[1].trim()
      const suggestion = JSON.parse(jsonStr)
      suggestions.push(suggestion)
    } catch (e) {
      console.error('Failed to parse plan suggestion:', e)
    }
  }

  return suggestions.length > 0 ? suggestions : null
}

// Parse options from AI response
function parseOptions(content: string) {
  const optionsRegex = /\[OPTIONS\]([\s\S]*?)\[\/OPTIONS\]/g
  const match = optionsRegex.exec(content)

  if (!match) return null

  try {
    const jsonStr = match[1].trim()
    return JSON.parse(jsonStr)
  } catch (e) {
    // Try parsing as numbered list
    const lines = match[1].trim().split('\n').filter(Boolean)
    return lines.map((line, index) => {
      const cleaned = line.replace(/^\d+\.\s*/, '').trim()
      return {
        label: cleaned.split(':')[0] || cleaned,
        value: cleaned,
        recommended: index === 0,
      }
    })
  }
}

// Clean response content (remove tags for display)
function cleanContent(content: string) {
  return content
    .replace(/\[PLAN_UPDATE\][\s\S]*?\[\/PLAN_UPDATE\]/g, '')
    .replace(/\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/g, '')
    .trim()
}

export async function GET(
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

  // Get chat messages (using type assertion since sidequest tables aren't in generated types)
  const { data: messages, error } = await (supabase as any)
    .from('sidequest_chat_messages')
    .select('*')
    .eq('sidequest_id', params.sqId)
    .order('created_at', { ascending: true }) as { data: SidequestChatMessage[] | null; error: any }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(messages || [])
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
  const result = sendMessageSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Fetch sidequest context (using type assertion)
  const { data: sidequest, error: sqError } = await (supabase as any)
    .from('sidequests')
    .select('*')
    .eq('id', params.sqId)
    .eq('project_id', params.id)
    .single() as { data: SidequestRow | null; error: any }

  if (sqError || !sidequest) {
    return NextResponse.json({ error: 'Sidequest not found' }, { status: 404 })
  }

  // Fetch project context
  const { data: project } = await supabase
    .from('projects')
    .select('name, description, settings')
    .eq('id', params.id)
    .single()

  // Fetch repos context
  let reposContext = ''
  if (sidequest.repo_ids && sidequest.repo_ids.length > 0) {
    const { data: repos } = await supabase
      .from('repos')
      .select('id, owner, name, default_branch, doc_status')
      .in('id', sidequest.repo_ids)

    if (repos && repos.length > 0) {
      reposContext = repos
        .map((r) => `- ${r.owner}/${r.name} (branch: ${r.default_branch || 'main'})`)
        .join('\n')
    }
  }

  // Fetch documents context
  const { data: docs } = await supabase
    .from('documents')
    .select('id, title, slug, category, description')
    .eq('project_id', params.id)
    .limit(20)

  const docsContext = docs
    ? docs.map((d) => `- ${d.title} (${d.category}): ${d.description || 'No description'}`).join('\n')
    : ''

  // Fetch other sidequests for context (using type assertion)
  const { data: otherSidequests } = await (supabase as any)
    .from('sidequests')
    .select('id, title, description, status')
    .eq('project_id', params.id)
    .neq('id', params.sqId)
    .limit(10) as { data: SidequestRow[] | null; error: any }

  const otherSidequestsContext = otherSidequests
    ? otherSidequests
        .map((s) => `- "${s.title}" (${s.status}): ${s.description || 'No description'}`)
        .join('\n')
    : ''

  // Fetch existing tickets for this sidequest (using type assertion)
  const { data: existingTickets } = await (supabase as any)
    .from('sidequest_tickets')
    .select('id, title, ticket_type, status, parent_ticket_id')
    .eq('sidequest_id', params.sqId)
    .order('hierarchy_level', { ascending: true })
    .order('sort_order', { ascending: true }) as { data: SidequestTicketRow[] | null; error: any }

  const existingPlanContext = existingTickets && existingTickets.length > 0
    ? existingTickets
        .map((t) => `- [${t.ticket_type}] ${t.title} (${t.status})${t.parent_ticket_id ? ` (child of ${t.parent_ticket_id})` : ''}`)
        .join('\n')
    : 'No tickets created yet.'

  // Fetch chat history (using type assertion)
  const { data: history } = await (supabase as any)
    .from('sidequest_chat_messages')
    .select('sender, content')
    .eq('sidequest_id', params.sqId)
    .order('created_at', { ascending: true })
    .limit(50) as { data: Array<{ sender: string; content: string }> | null; error: any }

  // Save user message (using type assertion)
  const { data: userMessage, error: userMsgError } = await (supabase as any)
    .from('sidequest_chat_messages')
    .insert({
      sidequest_id: params.sqId,
      project_id: params.id,
      sender: 'USER',
      content: result.data.content,
      created_by: user.id,
    })
    .select()
    .single() as { data: SidequestChatMessage | null; error: any }

  if (userMsgError) {
    console.error('Failed to save user message:', userMsgError)
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
  }

  // Build context for AI
  const contextPrompt = `
## PROJECT CONTEXT
Project: ${project?.name || 'Unknown'}
Description: ${project?.description || 'No description'}

## SIDEQUEST CONTEXT
Title: ${sidequest.title}
Description: ${sidequest.description || 'No description provided'}
Status: ${sidequest.status}

## CONNECTED REPOSITORIES
${reposContext || 'No repositories connected.'}

## PROJECT DOCUMENTATION
${docsContext || 'No documentation available.'}

## OTHER SIDEQUESTS IN PROJECT
${otherSidequestsContext || 'No other sidequests.'}

## CURRENT PLAN
${existingPlanContext}
`

  // Build messages for OpenAI
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    {
      role: 'system',
      content: SIDEQUEST_PLANNING_SYSTEM_PROMPT + '\n\n' + contextPrompt,
    },
  ]

  // Add chat history
  if (history) {
    for (const msg of history) {
      if (msg.sender === 'USER') {
        messages.push({ role: 'user', content: msg.content })
      } else if (msg.sender === 'AI') {
        messages.push({ role: 'assistant', content: msg.content })
      }
      // Skip SYSTEM messages in history (they're part of context)
    }
  }

  // Add current user message
  messages.push({ role: 'user', content: result.data.content })

  // Call OpenAI
  const openai = new OpenAI()
  const settings = project?.settings as { ai_model?: string } | null
  const model = settings?.ai_model || 'gpt-4o'

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages,
      max_tokens: 2000,
      temperature: 0.7,
    })

    const aiContent = completion.choices[0]?.message?.content || 'I apologize, but I was unable to generate a response. Please try again.'

    // Parse plan suggestions and options
    const planSuggestions = parsePlanSuggestions(aiContent)
    const options = parseOptions(aiContent)
    const cleanedContent = cleanContent(aiContent)

    // Save AI message (using type assertion)
    const { data: aiMessage, error: aiMsgError } = await (supabase as any)
      .from('sidequest_chat_messages')
      .insert({
        sidequest_id: params.sqId,
        project_id: params.id,
        sender: 'AI',
        content: cleanedContent || aiContent,
        plan_suggestions: planSuggestions,
        options,
        created_by: null,
      })
      .select()
      .single() as { data: SidequestChatMessage | null; error: any }

    if (aiMsgError) {
      console.error('Failed to save AI message:', aiMsgError)
    }

    // If there are plan suggestions, apply them to create tickets
    if (planSuggestions && planSuggestions.length > 0) {
      for (const suggestion of planSuggestions) {
        await applyPlanSuggestion(supabase, params.sqId, params.id, suggestion)
      }
    }

    return NextResponse.json({
      user_message: userMessage,
      ai_message: aiMessage || {
        id: 'temp',
        sidequest_id: params.sqId,
        project_id: params.id,
        sender: 'AI',
        content: cleanedContent || aiContent,
        plan_suggestions: planSuggestions,
        options,
        created_at: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('OpenAI API error:', error)
    return NextResponse.json(
      { error: 'Failed to generate AI response' },
      { status: 500 }
    )
  }
}

// Helper function to apply plan suggestions
async function applyPlanSuggestion(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  sidequestId: string,
  projectId: string,
  suggestion: {
    action: string
    parent_id?: string
    target_id?: string
    data: Record<string, unknown>
  }
) {
  const { action, parent_id, target_id, data } = suggestion

  try {
    switch (action) {
      case 'add_epic':
      case 'add_story':
      case 'add_task':
      case 'add_subtask':
      case 'add_test': {
        let ticketType = action.replace('add_', '').toUpperCase()
        // Handle TEST type separately
        if (ticketType === 'TEST') {
          ticketType = 'TEST'
        }
        const hierarchyLevel =
          ticketType === 'EPIC' ? 1 : ticketType === 'STORY' ? 2 : (ticketType === 'TASK' || ticketType === 'TEST') ? 3 : 4

        // Get the max sort_order for this parent (using type assertion)
        const { data: existingTickets } = await (supabase as any)
          .from('sidequest_tickets')
          .select('sort_order')
          .eq('sidequest_id', sidequestId)
          .eq('parent_ticket_id', parent_id || null)
          .order('sort_order', { ascending: false })
          .limit(1) as { data: Array<{ sort_order: number }> | null; error: any }

        const nextSortOrder = existingTickets && existingTickets.length > 0
          ? existingTickets[0].sort_order + 1
          : 0

        // Calculate confidence score based on specificity of the data
        let confidence = data.confidence as number | undefined
        if (confidence === undefined || confidence === null) {
          // Auto-calculate confidence based on data completeness
          let score = 0.5 // Base score
          if (data.title && (data.title as string).length > 20) score += 0.1
          if (data.description && (data.description as string).length > 50) score += 0.15
          if (data.acceptance_criteria && (data.acceptance_criteria as string[]).length >= 2) score += 0.15
          if (data.priority) score += 0.05
          if (data.story_points) score += 0.05
          confidence = Math.min(score, 1.0)
        }

        await (supabase as any).from('sidequest_tickets').insert({
          sidequest_id: sidequestId,
          project_id: projectId,
          parent_ticket_id: parent_id || null,
          ticket_type: ticketType,
          hierarchy_level: hierarchyLevel,
          sort_order: nextSortOrder,
          title: data.title as string,
          description: data.description as string | undefined,
          acceptance_criteria: (data.acceptance_criteria as string[]) || [],
          priority: data.priority as string | undefined,
          story_points: data.story_points as number | undefined,
          sprint_group: data.sprint_group as number | undefined,
          confidence_score: confidence,
          status: 'PENDING',
        })
        break
      }

      case 'modify': {
        if (!target_id) break

        const updateData: Record<string, unknown> = {}
        if (data.title) updateData.title = data.title
        if (data.description !== undefined) updateData.description = data.description
        if (data.acceptance_criteria) updateData.acceptance_criteria = data.acceptance_criteria
        if (data.priority) updateData.priority = data.priority
        if (data.story_points !== undefined) updateData.story_points = data.story_points
        if (data.sprint_group !== undefined) updateData.sprint_group = data.sprint_group

        if (Object.keys(updateData).length > 0) {
          await (supabase as any)
            .from('sidequest_tickets')
            .update(updateData)
            .eq('id', target_id)
            .eq('sidequest_id', sidequestId)
        }
        break
      }

      case 'remove': {
        if (!target_id) break

        await (supabase as any)
          .from('sidequest_tickets')
          .delete()
          .eq('id', target_id)
          .eq('sidequest_id', sidequestId)
        break
      }
    }
  } catch (error) {
    console.error(`Failed to apply plan suggestion (${action}):`, error)
  }
}
