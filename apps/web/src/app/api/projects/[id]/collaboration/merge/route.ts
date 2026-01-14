/**
 * Merge API
 *
 * Triggers the Integrator Agent to semantically merge concurrent edits
 * from multiple Claude agents.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { runIntegratorAgent, detectConflicts, analyzeConflictType } from '@/lib/integrator-agent'
import type {
  IntegratorInput,
  FileConflictContext,
  ConflictingEdit,
  EditStreamEntry,
} from '@laneshare/shared/types/collaborative-editing'

// Schema for merge request
const mergeSchema = z.object({
  sessionId: z.string().uuid().optional(),
  branchIds: z.array(z.string().uuid()).min(2),
  filePaths: z.array(z.string()).optional(), // Specific files to merge, or all if not specified
  runTests: z.boolean().default(true),
  dryRun: z.boolean().default(false), // Preview merge without applying
})

/**
 * POST /api/projects/[id]/collaboration/merge
 * Trigger a merge operation
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
  const result = mergeSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { sessionId, branchIds, filePaths, runTests, dryRun } = result.data

  // Get project info for context
  const { data: project } = await supabase
    .from('projects')
    .select('name, description')
    .eq('id', projectId)
    .single()

  // Fetch virtual branches
  const { data: branches } = await supabase
    .from('virtual_branches')
    .select('*')
    .in('id', branchIds)

  if (!branches || branches.length !== branchIds.length) {
    return NextResponse.json({ error: 'One or more branches not found' }, { status: 404 })
  }

  // Fetch recent edits from these branches
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  let editsQuery = supabase
    .from('edit_stream')
    .select('*')
    .in('virtual_branch_id', branchIds)
    .gte('created_at', fiveMinutesAgo)
    .order('created_at', { ascending: true })

  if (filePaths && filePaths.length > 0) {
    editsQuery = editsQuery.in('file_path', filePaths)
  }

  const { data: edits } = await editsQuery

  if (!edits || edits.length === 0) {
    return NextResponse.json({
      message: 'No recent edits to merge',
      conflicts: [],
    })
  }

  // Detect conflicts
  const conflictMap = detectConflicts(edits as EditStreamEntry[])

  if (conflictMap.size === 0) {
    return NextResponse.json({
      message: 'No conflicts detected',
      autoMerged: true,
    })
  }

  // Build file conflict contexts for the integrator
  const conflicts: FileConflictContext[] = []

  for (const [filePath, fileEdits] of conflictMap) {
    // Get original content (from the first edit's old_content or fetch from canonical state)
    const originalContent = fileEdits[0].oldContent || ''

    const conflictingEdits: ConflictingEdit[] = fileEdits.map((edit) => {
      const branch = branches.find((b) => b.id === edit.virtualBranchId)
      return {
        branchId: edit.virtualBranchId,
        branchName: branch?.name || 'Unknown',
        edit: edit as EditStreamEntry,
      }
    })

    conflicts.push({
      filePath,
      originalContent,
      edits: conflictingEdits,
      language: detectLanguage(filePath),
    })
  }

  // Create merge event record
  const { data: mergeEvent, error: mergeError } = await supabase
    .from('merge_events')
    .insert({
      project_id: projectId,
      source_branches: branchIds,
      files_merged: conflicts.map((c) => ({
        path: c.filePath,
        strategy: 'PENDING',
        had_conflict: c.edits.length > 1,
      })),
      merge_strategy: 'SEMANTIC',
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (mergeError) {
    console.error('[Merge] Error creating merge event:', mergeError)
    return NextResponse.json({ error: 'Failed to create merge event' }, { status: 500 })
  }

  // Prepare integrator input
  const integratorInput: IntegratorInput = {
    projectContext: {
      name: project?.name || 'Unknown',
      description: project?.description,
    },
    conflicts,
    preferences: {
      preferRefactoring: true,
      runTests,
      explainDecisions: true,
    },
  }

  // If dry run, just return the analysis without executing
  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      conflicts: conflicts.map((c) => ({
        filePath: c.filePath,
        editCount: c.edits.length,
        branches: c.edits.map((e) => e.branchName),
      })),
      mergeEventId: mergeEvent.id,
    })
  }

  // Run the integrator agent
  const integrationResult = await runIntegratorAgent(integratorInput)

  // Update merge event with results
  const { error: updateError } = await supabase
    .from('merge_events')
    .update({
      merge_strategy: integrationResult.output?.mergedFiles[0]?.strategy || 'FAILED',
      integrator_reasoning: integrationResult.output?.overallReasoning,
      integrator_response: JSON.stringify(integrationResult.output),
      conflicts_detected: integrationResult.output?.conflicts.length || 0,
      conflicts_resolved: integrationResult.output?.conflicts.filter(
        (c) => c.resolution !== 'MANUAL'
      ).length || 0,
      completed_at: new Date().toISOString(),
      duration_ms: integrationResult.durationMs,
      files_merged: integrationResult.output?.mergedFiles.map((f) => ({
        path: f.path,
        strategy: f.strategy,
        had_conflict: true,
      })) || [],
    })
    .eq('id', mergeEvent.id)

  if (updateError) {
    console.error('[Merge] Error updating merge event:', updateError)
  }

  // Record individual conflicts
  if (integrationResult.output?.conflicts) {
    for (const conflict of integrationResult.output.conflicts) {
      await supabase.from('edit_conflicts').insert({
        merge_event_id: mergeEvent.id,
        project_id: projectId,
        file_path: conflict.path,
        conflict_type: conflict.type,
        resolution_strategy: conflict.resolution,
        resolution_reasoning: conflict.reasoning,
        resolved_at: new Date().toISOString(),
        resolved_by: 'integrator',
      })
    }
  }

  // Update virtual branches status
  await supabase
    .from('virtual_branches')
    .update({ status: 'MERGING' })
    .in('id', branchIds)

  return NextResponse.json({
    success: integrationResult.success,
    mergeEventId: mergeEvent.id,
    result: integrationResult.output,
    durationMs: integrationResult.durationMs,
    tokensUsed: integrationResult.tokensUsed,
  })
}

/**
 * GET /api/projects/[id]/collaboration/merge
 * Get merge history
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
  const limit = parseInt(searchParams.get('limit') || '20', 10)

  const { data: merges, error } = await supabase
    .from('merge_events')
    .select(
      `
      *,
      conflicts:edit_conflicts(*)
    `
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[Merge] Error fetching history:', error)
    return NextResponse.json({ error: 'Failed to fetch merge history' }, { status: 500 })
  }

  return NextResponse.json(merges)
}

/**
 * Detect programming language from file path
 */
function detectLanguage(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    cpp: 'cpp',
    c: 'c',
    cs: 'csharp',
    php: 'php',
    vue: 'vue',
    svelte: 'svelte',
  }
  return ext ? langMap[ext] : undefined
}
