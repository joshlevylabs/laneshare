/**
 * Collaboration Sessions API
 *
 * Manages collaborative editing sessions where multiple Claude agents
 * work on the same codebase simultaneously.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { z } from 'zod'

// Schema for creating a collaboration session
const createSessionSchema = z.object({
  codespaceId: z.string().optional(),
  virtualBranchIds: z.array(z.string()).min(1),
  mergeFrequencyMs: z.number().default(30000),
  autoMergeEnabled: z.boolean().default(true),
  requireTests: z.boolean().default(true),
})

/**
 * GET /api/projects/[id]/collaboration/sessions
 * List collaboration sessions for a project
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id: projectId } = params
  const supabase = createServerSupabaseClient()

  // Authenticate
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
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Get query params
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')

  // Fetch sessions
  let query = supabase
    .from('collaboration_sessions')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  const { data: sessions, error } = await query

  if (error) {
    console.error('[CollaborationSessions] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 })
  }

  return NextResponse.json(sessions)
}

/**
 * POST /api/projects/[id]/collaboration/sessions
 * Create a new collaboration session
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id: projectId } = params
  const supabase = createServerSupabaseClient()

  // Authenticate
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
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Parse request body
  const body = await request.json()
  const result = createSessionSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { codespaceId, virtualBranchIds, mergeFrequencyMs, autoMergeEnabled, requireTests } =
    result.data

  // Create collaboration session
  const { data: session, error } = await supabase
    .from('collaboration_sessions')
    .insert({
      project_id: projectId,
      codespace_id: codespaceId,
      virtual_branch_ids: virtualBranchIds,
      merge_frequency_ms: mergeFrequencyMs,
      auto_merge_enabled: autoMergeEnabled,
      require_tests: requireTests,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('[CollaborationSessions] Error creating session:', error)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }

  // Initialize canonical state if not exists
  const { error: stateError } = await supabase
    .from('canonical_state')
    .upsert(
      {
        project_id: projectId,
        codespace_id: codespaceId,
        current_sha: 'HEAD', // Will be updated when first merge happens
      },
      {
        onConflict: 'project_id,codespace_id',
      }
    )

  if (stateError) {
    console.error('[CollaborationSessions] Error initializing state:', stateError)
  }

  return NextResponse.json(session, { status: 201 })
}
