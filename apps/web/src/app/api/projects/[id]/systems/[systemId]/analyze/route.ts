import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import {
  buildSystemAnalysisPrompt,
  buildAgentContextPrompt,
  SYSTEM_ANALYSIS_SYSTEM_PROMPT,
  type SystemAnalysisContext,
} from '@laneshare/shared'

const analyzeSchema = z.object({
  include_repos: z.boolean().optional().default(true),
  include_docs: z.boolean().optional().default(true),
  keywords_override: z.array(z.string()).optional(),
})

// POST /api/projects/[id]/systems/[systemId]/analyze - Analyze system against docs/repos
export async function POST(
  request: Request,
  { params }: { params: { id: string; systemId: string } }
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

  // Get system
  const { data: system, error: systemError } = await supabase
    .from('systems')
    .select('*')
    .eq('id', params.systemId)
    .eq('project_id', params.id)
    .single()

  if (systemError || !system) {
    return NextResponse.json({ error: 'System not found' }, { status: 404 })
  }

  // Get project
  const { data: project } = await supabase
    .from('projects')
    .select('name')
    .eq('id', params.id)
    .single()

  // Parse request
  const body = await request.json().catch(() => ({}))
  const result = analyzeSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { include_repos, include_docs, keywords_override } = result.data
  const keywords = keywords_override || system.keywords || []

  try {
    // Gather relevant docs
    let relevantDocs: Array<{ slug: string; title: string; markdown: string }> = []
    if (include_docs && keywords.length > 0) {
      const { data: docs } = await supabase
        .from('doc_pages')
        .select('slug, title, markdown')
        .eq('project_id', params.id)

      if (docs) {
        // Filter docs by keyword match
        relevantDocs = docs.filter((doc) => {
          const content = `${doc.title} ${doc.markdown}`.toLowerCase()
          return keywords.some((kw: string) => content.includes(kw.toLowerCase()))
        }).slice(0, 10)
      }
    }

    // Gather relevant code chunks
    let relevantChunks: Array<{
      repoId: string
      repoName: string
      filePath: string
      content: string
    }> = []

    if (include_repos && keywords.length > 0) {
      // Get repos to search
      let repoIds = system.repo_ids || []
      if (repoIds.length === 0) {
        const { data: allRepos } = await supabase
          .from('repos')
          .select('id')
          .eq('project_id', params.id)
        repoIds = (allRepos || []).map((r) => r.id)
      }

      if (repoIds.length > 0) {
        // Search chunks by keyword
        for (const keyword of keywords.slice(0, 5)) {
          const { data: chunks } = await supabase
            .from('chunks')
            .select(`
              id,
              repo_id,
              file_path,
              content,
              repos!inner (
                name,
                owner
              )
            `)
            .in('repo_id', repoIds)
            .ilike('content', `%${keyword}%`)
            .limit(5)

          if (chunks) {
            for (const chunk of chunks) {
              const repo = chunk.repos as unknown as { name: string; owner: string }
              relevantChunks.push({
                repoId: chunk.repo_id,
                repoName: `${repo.owner}/${repo.name}`,
                filePath: chunk.file_path,
                content: chunk.content,
              })
            }
          }
        }

        // Dedupe by file path
        const seen = new Set<string>()
        relevantChunks = relevantChunks.filter((chunk) => {
          const key = `${chunk.repoId}:${chunk.filePath}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        }).slice(0, 15)
      }
    }

    // Build analysis context
    const analysisContext: SystemAnalysisContext = {
      system,
      projectName: project?.name || 'Unknown Project',
      relevantDocs,
      relevantChunks,
    }

    // Call AI to analyze
    const anthropic = new Anthropic()
    const analysisPrompt = buildSystemAnalysisPrompt(analysisContext)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: SYSTEM_ANALYSIS_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: analysisPrompt },
      ],
    })

    // Parse AI response
    const aiContent = response.content[0]
    if (aiContent.type !== 'text') {
      throw new Error('Unexpected AI response format')
    }

    let analysisResult: {
      findings: Array<{
        statement: string
        confidence: 'HIGH' | 'MED' | 'LOW'
        citations: Array<{ type: string; ref: string; excerpt: string }>
      }>
      openQuestions: string[]
      componentSuggestions?: Array<{
        type: string
        label: string
        details?: string
        evidenceRefs?: string[]
      }>
      relationshipSuggestions?: Array<{
        from: string
        to: string
        kind: string
        label?: string
        evidenceRefs?: string[]
      }>
    }

    try {
      // Extract JSON from response (may be wrapped in markdown code block)
      let jsonStr = aiContent.text
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) {
        jsonStr = jsonMatch[1]
      }
      analysisResult = JSON.parse(jsonStr.trim())
    } catch {
      console.error('Failed to parse AI analysis response:', aiContent.text)
      return NextResponse.json(
        { error: 'Failed to parse analysis results' },
        { status: 500 }
      )
    }

    // Store grounded findings as artifact
    const { data: findingsArtifact, error: findingsError } = await serviceClient
      .from('system_artifacts')
      .insert({
        project_id: params.id,
        system_id: params.systemId,
        kind: 'GROUNDED_FINDINGS',
        content: JSON.stringify(analysisResult.findings, null, 2),
        content_json: { findings: analysisResult.findings },
        created_by: user.id,
      })
      .select()
      .single()

    if (findingsError) {
      console.error('Failed to store findings:', findingsError)
    }

    // Generate agent prompt
    // Cast findings to GroundedFinding[] - the types are compatible at runtime
    const agentPrompt = buildAgentContextPrompt(
      system,
      project?.name || 'Unknown Project',
      analysisResult.findings as unknown as import('@laneshare/shared').GroundedFinding[],
      analysisResult.openQuestions
    )

    // Store agent prompt as artifact
    const { data: promptArtifact, error: promptError } = await serviceClient
      .from('system_artifacts')
      .insert({
        project_id: params.id,
        system_id: params.systemId,
        kind: 'AGENT_PROMPT',
        content: agentPrompt,
        created_by: user.id,
      })
      .select()
      .single()

    if (promptError) {
      console.error('Failed to store prompt:', promptError)
    }

    // Store evidence records
    const evidenceRecords = []
    for (const finding of analysisResult.findings) {
      for (const citation of finding.citations) {
        evidenceRecords.push({
          project_id: params.id,
          system_id: params.systemId,
          source_type: citation.type === 'REPO' ? 'REPO' : 'DOC',
          source_ref: citation.ref,
          excerpt: citation.excerpt,
          metadata: {},
          confidence: finding.confidence,
        })
      }
    }

    if (evidenceRecords.length > 0) {
      await serviceClient
        .from('system_evidence')
        .insert(evidenceRecords)
    }

    // Update system status
    await serviceClient
      .from('systems')
      .update({ status: 'NEEDS_AGENT_OUTPUT' })
      .eq('id', params.systemId)

    return NextResponse.json({
      groundedFindings: analysisResult.findings,
      openQuestions: analysisResult.openQuestions,
      agentPrompt,
      evidence: evidenceRecords,
      artifactIds: {
        findings: findingsArtifact?.id,
        prompt: promptArtifact?.id,
      },
    })
  } catch (error: unknown) {
    console.error('System analysis error:', error)
    const message = error instanceof Error ? error.message : 'Analysis failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
