/**
 * Edit Stream API
 *
 * Captures file edits from Claude agents in real-time.
 * Used for conflict detection and semantic merging.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { z } from 'zod'
import crypto from 'crypto'

// Schema for recording an edit
const editSchema = z.object({
  virtualBranchId: z.string().uuid(),
  operation: z.enum(['create', 'edit', 'delete', 'rename']),
  filePath: z.string(),
  oldFilePath: z.string().optional(),
  oldContent: z.string().optional(),
  newContent: z.string().optional(),
  diffHunks: z
    .array(
      z.object({
        startLine: z.number(),
        oldLines: z.array(z.string()),
        newLines: z.array(z.string()),
      })
    )
    .optional(),
  agentReasoning: z.string().optional(),
  relatedTaskId: z.string().uuid().optional(),
})

/**
 * GET /api/projects/[id]/collaboration/edits
 * Get recent edits for conflict detection
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
  const virtualBranchId = searchParams.get('virtual_branch_id')
  const filePath = searchParams.get('file_path')
  const since = searchParams.get('since') // ISO timestamp
  const limit = parseInt(searchParams.get('limit') || '100', 10)

  // Build query
  let query = supabase
    .from('edit_stream')
    .select(
      `
      *,
      virtual_branch:virtual_branches(id, name, status)
    `
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (virtualBranchId) {
    query = query.eq('virtual_branch_id', virtualBranchId)
  }

  if (filePath) {
    query = query.eq('file_path', filePath)
  }

  if (since) {
    query = query.gte('created_at', since)
  }

  const { data: edits, error } = await query

  if (error) {
    console.error('[EditStream] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch edits' }, { status: 500 })
  }

  return NextResponse.json(edits)
}

/**
 * POST /api/projects/[id]/collaboration/edits
 * Record a new edit from an agent
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
  const result = editSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const {
    virtualBranchId,
    operation,
    filePath,
    oldFilePath,
    oldContent,
    newContent,
    diffHunks,
    agentReasoning,
    relatedTaskId,
  } = result.data

  // Verify virtual branch belongs to this project
  const { data: branch } = await supabase
    .from('virtual_branches')
    .select('id, project_id')
    .eq('id', virtualBranchId)
    .single()

  if (!branch || branch.project_id !== projectId) {
    return NextResponse.json({ error: 'Virtual branch not found' }, { status: 404 })
  }

  // Calculate line changes
  const linesAdded = diffHunks?.reduce((sum, h) => sum + h.newLines.length, 0) || 0
  const linesRemoved = diffHunks?.reduce((sum, h) => sum + h.oldLines.length, 0) || 0

  // Calculate content hashes for conflict detection
  const fileHashBefore = oldContent ? hashContent(oldContent) : undefined
  const fileHashAfter = newContent ? hashContent(newContent) : undefined

  // Get next sequence number
  const { data: seqData } = await supabase.rpc('get_next_edit_sequence', {
    branch_id: virtualBranchId,
  })
  const sequenceNum = seqData || 1

  // Insert the edit
  const { data: edit, error } = await supabase
    .from('edit_stream')
    .insert({
      virtual_branch_id: virtualBranchId,
      project_id: projectId,
      operation,
      file_path: filePath,
      old_file_path: oldFilePath,
      old_content: oldContent,
      new_content: newContent,
      diff_hunks: diffHunks,
      lines_added: linesAdded,
      lines_removed: linesRemoved,
      agent_reasoning: agentReasoning,
      related_task_id: relatedTaskId,
      sequence_num: sequenceNum,
      file_hash_before: fileHashBefore,
      file_hash_after: fileHashAfter,
    })
    .select()
    .single()

  if (error) {
    console.error('[EditStream] Error recording edit:', error)
    return NextResponse.json({ error: 'Failed to record edit' }, { status: 500 })
  }

  // Check for potential conflicts
  const conflicts = await checkForConflicts(supabase, projectId, filePath, virtualBranchId)

  // TODO: Re-enable when increment_collaboration_edits function is created
  // await supabase.rpc('increment_collaboration_edits', {
  //   p_branch_id: virtualBranchId,
  // })

  return NextResponse.json({
    edit,
    potentialConflicts: conflicts,
  })
}

/**
 * Hash content for quick comparison
 */
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/**
 * Check if this edit conflicts with recent edits from other branches
 */
async function checkForConflicts(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  projectId: string,
  filePath: string,
  excludeBranchId: string
): Promise<
  Array<{
    branchId: string
    branchName: string
    editId: string
    editedAt: string
  }>
> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('edit_stream')
    .select(
      `
      id,
      virtual_branch_id,
      created_at,
      virtual_branch:virtual_branches(name)
    `
    )
    .eq('project_id', projectId)
    .eq('file_path', filePath)
    .neq('virtual_branch_id', excludeBranchId)
    .gte('created_at', fiveMinutesAgo)

  if (!data) return []

  return data.map((edit) => ({
    branchId: edit.virtual_branch_id,
    branchName: (edit.virtual_branch as { name: string })?.name || 'Unknown',
    editId: edit.id,
    editedAt: edit.created_at || new Date().toISOString(),
  }))
}
