import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  analyzeArchitecture,
  computeFingerprint,
  ANALYZER_VERSION,
  type AnalysisContext,
  type RepoContext,
} from '@laneshare/shared'

const regenerateSchema = z.object({
  force: z.boolean().optional().default(false),
})

// POST /api/projects/[id]/map/regenerate - Regenerate architecture map
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check project admin access
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Parse request body
  const body = await request.json().catch(() => ({}))
  const result = regenerateSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { force } = result.data

  try {
    // Get project repos
    const { data: repos, error: reposError } = await supabase
      .from('repos')
      .select('*')
      .eq('project_id', params.id)

    if (reposError) {
      return NextResponse.json({ error: reposError.message }, { status: 500 })
    }

    if (!repos || repos.length === 0) {
      return NextResponse.json(
        { error: 'No repositories connected. Add repos first.' },
        { status: 400 }
      )
    }

    // Build analysis context
    const repoContexts: RepoContext[] = []
    const existingChunks = new Map<string, string>()

    for (const repo of repos) {
      // Get repo files
      const { data: files } = await supabase
        .from('repo_files')
        .select('path, sha, language')
        .eq('repo_id', repo.id)

      // Get chunks for content
      const { data: chunks } = await supabase
        .from('chunks')
        .select('file_path, content')
        .eq('repo_id', repo.id)

      // Build file list
      const fileList = (files || []).map((f) => ({
        path: f.path,
        sha: f.sha,
        language: f.language || undefined,
      }))

      repoContexts.push({
        id: repo.id,
        projectId: params.id,
        owner: repo.owner,
        name: repo.name,
        provider: repo.provider,
        defaultBranch: repo.default_branch,
        files: fileList,
      })

      // Add chunks to content map
      for (const chunk of chunks || []) {
        const existing = existingChunks.get(chunk.file_path)
        if (existing) {
          existingChunks.set(chunk.file_path, existing + '\n' + chunk.content)
        } else {
          existingChunks.set(chunk.file_path, chunk.content)
        }
      }
    }

    const context: AnalysisContext = {
      projectId: params.id,
      repos: repoContexts,
      existingChunks,
    }

    // Compute fingerprint
    const fingerprint = computeFingerprint(context)

    // Check if we can use cached result
    if (!force) {
      const { data: cachedSnapshot } = await supabase
        .from('architecture_snapshots')
        .select('id, source_fingerprint')
        .eq('project_id', params.id)
        .eq('status', 'completed')
        .eq('source_fingerprint', fingerprint)
        .order('generated_at', { ascending: false })
        .limit(1)
        .single()

      if (cachedSnapshot) {
        return NextResponse.json({
          message: 'Using cached snapshot (no changes detected)',
          snapshotId: cachedSnapshot.id,
          cached: true,
        })
      }
    }

    // Create pending snapshot
    const { data: snapshot, error: createError } = await serviceClient
      .from('architecture_snapshots')
      .insert({
        project_id: params.id,
        analyzer_version: '1.0.0',
        source_fingerprint: fingerprint,
        status: 'analyzing',
        created_by: user.id,
        graph_json: {},
        summary_json: {},
      })
      .select()
      .single()

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 500 })
    }

    try {
      // Run analysis
      const analysisResult = await analyzeArchitecture(context)

      // Update snapshot with results
      const { error: updateError } = await serviceClient
        .from('architecture_snapshots')
        .update({
          status: 'completed',
          graph_json: analysisResult.graph,
          summary_json: analysisResult.summary,
          generated_at: new Date().toISOString(),
        })
        .eq('id', snapshot.id)

      if (updateError) {
        throw updateError
      }

      // Insert evidence records
      if (analysisResult.evidence.length > 0) {
        const evidenceRecords = analysisResult.evidence.map((e) => ({
          project_id: params.id,
          snapshot_id: snapshot.id,
          kind: e.kind,
          node_id: e.nodeId,
          edge_id: e.edgeId || null,
          repo_id: e.repoId || null,
          file_path: e.filePath || null,
          symbol: e.symbol || null,
          line_start: e.lineStart || null,
          line_end: e.lineEnd || null,
          excerpt: e.excerpt || null,
          url: e.url || null,
          confidence: e.confidence,
          metadata: e.metadata || {},
        }))

        // Insert in batches of 100
        for (let i = 0; i < evidenceRecords.length; i += 100) {
          const batch = evidenceRecords.slice(i, i + 100)
          await serviceClient.from('architecture_evidence').insert(batch)
        }
      }

      // Insert feature records
      if (analysisResult.graph.features.length > 0) {
        const featureRecords = analysisResult.graph.features.map((f) => ({
          snapshot_id: snapshot.id,
          project_id: params.id,
          feature_slug: f.slug,
          feature_name: f.name,
          description: f.description || null,
          flow_json: f.flow,
          screens: f.screens,
          endpoints: f.endpoints,
          tables: f.tables,
          services: f.services,
        }))

        await serviceClient.from('architecture_features').insert(featureRecords)
      }

      return NextResponse.json({
        message: 'Architecture map generated successfully',
        snapshotId: snapshot.id,
        summary: analysisResult.summary,
        cached: false,
      })
    } catch (analysisError: any) {
      // Update snapshot with error
      await serviceClient
        .from('architecture_snapshots')
        .update({
          status: 'error',
          error_message: analysisError.message || 'Analysis failed',
        })
        .eq('id', snapshot.id)

      throw analysisError
    }
  } catch (error: any) {
    console.error('Architecture analysis error:', error)
    return NextResponse.json(
      { error: error.message || 'Analysis failed' },
      { status: 500 }
    )
  }
}
