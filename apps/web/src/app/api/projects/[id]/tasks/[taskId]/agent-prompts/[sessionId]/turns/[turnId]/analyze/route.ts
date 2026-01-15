import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Json } from '@/lib/supabase/types'
import {
  RESPONSE_ANALYSIS_SYSTEM_PROMPT,
  buildResponseAnalysisPrompt,
  determineTaskStatus,
  type ResponseAnalysisContext,
} from '@laneshare/shared'
import type { ResponseAnalysisResult, AgentTool, PromptMetadata } from '@laneshare/shared'
import Anthropic from '@anthropic-ai/sdk'

const analyzeResponseSchema = z.object({
  agentResponse: z.string().min(1).max(100000),
  agentTool: z.enum(['cursor', 'claude-code', 'copilot', 'aider', 'windsurf', 'other']),
})

interface TurnRow {
  id: string
  session_id: string
  turn_number: number
  status: string
  prompt_content: string
  prompt_metadata: PromptMetadata | null
  agent_response: string | null
  agent_tool: string | null
  analysis_result: ResponseAnalysisResult | null
  created_at: string
  completed_at: string | null
}

interface TaskRow {
  id: string
  title: string
  description: string | null
  status: string
}

/**
 * POST /api/projects/[id]/tasks/[taskId]/agent-prompts/[sessionId]/turns/[turnId]/analyze
 * Analyze the pasted AI agent response
 */
export async function POST(
  request: Request,
  {
    params,
  }: {
    params: { id: string; taskId: string; sessionId: string; turnId: string }
  }
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
  const parseResult = analyzeResponseSchema.safeParse(body)

  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parseResult.error.flatten() },
      { status: 400 }
    )
  }

  // Get the turn
  const { data: turnData, error: turnError } = await supabase
    .from('agent_prompt_turns')
    .select('*')
    .eq('id', params.turnId)
    .eq('session_id', params.sessionId)
    .single()

  if (turnError || !turnData) {
    return NextResponse.json({ error: 'Turn not found' }, { status: 404 })
  }

  const turn = turnData as TurnRow

  if (turn.status !== 'PENDING_RESPONSE') {
    return NextResponse.json(
      { error: 'Turn is not pending a response' },
      { status: 400 }
    )
  }

  // Get the task for context
  const { data: taskData } = await supabase
    .from('tasks')
    .select('id, title, description, status')
    .eq('id', params.taskId)
    .single()

  const task = taskData as TaskRow | null

  // Update turn status to ANALYZING
  await supabase
    .from('agent_prompt_turns')
    .update({
      status: 'ANALYZING',
      agent_response: parseResult.data.agentResponse,
      agent_tool: parseResult.data.agentTool,
      response_pasted_at: new Date().toISOString(),
    })
    .eq('id', params.turnId)

  // Build the analysis context
  const verificationChecklist =
    (turn.prompt_metadata?.verification_checklist as string[]) || []

  const analysisContext: ResponseAnalysisContext = {
    originalPrompt: turn.prompt_content,
    taskTitle: task?.title || 'Unknown Task',
    taskDescription: task?.description ?? undefined,
    verificationChecklist,
    agentResponse: parseResult.data.agentResponse,
    agentTool: parseResult.data.agentTool,
  }

  const analysisPrompt = buildResponseAnalysisPrompt(analysisContext)

  // Call AI to analyze the response
  let analysisResult: ResponseAnalysisResult

  try {
    const anthropic = new Anthropic()

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: RESPONSE_ANALYSIS_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: analysisPrompt,
        },
      ],
    })

    // Parse the JSON response
    const responseText =
      response.content[0].type === 'text' ? response.content[0].text : ''

    // Extract JSON from the response (it might be wrapped in markdown code blocks)
    let jsonStr = responseText
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim()
    }

    const parsed = JSON.parse(jsonStr)

    analysisResult = {
      success: parsed.success ?? false,
      confidence: parsed.confidence ?? 0.5,
      completedItems: parsed.completedItems ?? [],
      failedItems: parsed.failedItems ?? [],
      partialItems: parsed.partialItems ?? [],
      notes: parsed.notes ?? [],
      needsFollowUp: parsed.needsFollowUp ?? false,
      followUpReason: parsed.followUpReason ?? undefined,
    }
  } catch (error) {
    console.error('Error analyzing response:', error)

    // Create a basic analysis result on failure
    analysisResult = {
      success: false,
      confidence: 0.3,
      completedItems: [],
      failedItems: [
        {
          item: 'Analysis',
          reason: 'Failed to analyze the response. Please review manually.',
        },
      ],
      partialItems: [],
      notes: ['Automatic analysis failed - manual review recommended'],
      needsFollowUp: true,
      followUpReason: 'Analysis could not be completed automatically',
    }
  }

  // Determine suggested task status
  const suggestedStatus = determineTaskStatus(analysisResult, task?.status || 'TODO')

  // Determine turn status based on analysis
  const turnStatus = analysisResult.needsFollowUp ? 'NEEDS_FOLLOW_UP' : 'COMPLETED'

  // Update the turn with analysis results
  const { data: updatedTurn, error: updateError } = await supabase
    .from('agent_prompt_turns')
    .update({
      status: turnStatus,
      analysis_result: analysisResult as unknown as Json,
      suggested_status_update: suggestedStatus,
      completed_at: new Date().toISOString(),
    })
    .eq('id', params.turnId)
    .select()
    .single()

  if (updateError) {
    console.error('Error updating turn:', updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Log activity
  await supabase.from('task_activity').insert({
    task_id: params.taskId,
    project_id: params.id,
    actor_id: user.id,
    kind: 'UPDATED',
    field_name: 'agent_response_analyzed',
    after_value: {
      session_id: params.sessionId,
      turn_id: params.turnId,
      success: analysisResult.success,
      confidence: analysisResult.confidence,
      needs_follow_up: analysisResult.needsFollowUp,
      suggested_status: suggestedStatus,
    },
  })

  return NextResponse.json({
    turn: updatedTurn,
    analysis: analysisResult,
    suggestedStatus,
  })
}
