import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import {
  buildAgentOutputParsePrompt,
  AGENT_OUTPUT_PARSE_SYSTEM_PROMPT,
  validateSystemGraph,
  normalizeNodeId,
  normalizeEdgeId,
  type SystemGraph,
  type SystemNode,
  type SystemEdge,
  type EvidenceConfidence,
  type SystemNodeType,
  type SystemEdgeKind,
} from '@laneshare/shared'

const agentOutputSchema = z.object({
  agentTool: z.enum(['cursor', 'claude-code', 'copilot', 'aider', 'windsurf', 'other']),
  output: z.string().min(1).max(100000),
})

// POST /api/projects/[id]/systems/[systemId]/agent-output - Process agent output
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

  // Get system with existing findings
  const { data: system, error: systemError } = await supabase
    .from('systems')
    .select(`
      *,
      system_artifacts (
        id,
        kind,
        content_json
      )
    `)
    .eq('id', params.systemId)
    .eq('project_id', params.id)
    .single()

  if (systemError || !system) {
    return NextResponse.json({ error: 'System not found' }, { status: 404 })
  }

  // Parse request
  const body = await request.json()
  const result = agentOutputSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { agentTool, output } = result.data

  try {
    // Get existing findings
    const findingsArtifact = system.system_artifacts?.find(
      (a: { kind: string }) => a.kind === 'GROUNDED_FINDINGS'
    )
    const existingFindings = findingsArtifact?.content_json?.findings || []

    // Build parse context
    const parseContext = {
      system,
      agentOutput: output,
      agentTool,
      existingFindings,
    }

    // Call AI to parse agent output
    const anthropic = new Anthropic()
    const parsePrompt = buildAgentOutputParsePrompt(parseContext)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: AGENT_OUTPUT_PARSE_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: parsePrompt },
      ],
    })

    // Parse AI response
    const aiContent = response.content[0]
    if (aiContent.type !== 'text') {
      throw new Error('Unexpected AI response format')
    }

    let parsedSpec: {
      systemId: string
      title: string
      nodes: Array<{
        id: string
        type: SystemNodeType
        label: string
        details?: string
        children?: string[]
        refs: Array<{ evidenceId: string }>
        confidence: EvidenceConfidence
      }>
      edges: Array<{
        id: string
        from: string
        to: string
        kind: SystemEdgeKind
        label?: string
        refs: Array<{ evidenceId: string }>
        confidence: EvidenceConfidence
      }>
      evidence: Array<{
        tempId: string
        sourceType: string
        sourceRef: string
        excerpt: string
        metadata?: {
          file_path?: string
          symbol?: string
          line_start?: number
          line_end?: number
        }
      }>
      openQuestions?: string[]
      notes?: string[]
    }

    try {
      // Extract JSON from response
      let jsonStr = aiContent.text
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) {
        jsonStr = jsonMatch[1]
      }
      parsedSpec = JSON.parse(jsonStr.trim())
    } catch {
      console.error('Failed to parse agent output response:', aiContent.text)
      return NextResponse.json(
        { error: 'Failed to parse agent output' },
        { status: 500 }
      )
    }

    // Store agent output as artifact
    const { data: outputArtifact } = await serviceClient
      .from('system_artifacts')
      .insert({
        project_id: params.id,
        system_id: params.systemId,
        kind: 'AGENT_OUTPUT',
        content: output,
        content_json: { agentTool, parsedSpec },
        created_by: user.id,
      })
      .select()
      .single()

    // Create evidence records and build ID map
    const evidenceIdMap = new Map<string, string>()
    const evidenceRecords = []

    for (const ev of parsedSpec.evidence || []) {
      evidenceRecords.push({
        project_id: params.id,
        system_id: params.systemId,
        source_type: 'AGENT',
        source_ref: ev.sourceRef || 'agent_output',
        excerpt: ev.excerpt,
        metadata: ev.metadata || {},
        confidence: 'MED' as EvidenceConfidence,
      })
    }

    if (evidenceRecords.length > 0) {
      const { data: insertedEvidence } = await serviceClient
        .from('system_evidence')
        .insert(evidenceRecords)
        .select()

      if (insertedEvidence) {
        for (let i = 0; i < parsedSpec.evidence.length; i++) {
          const tempId = parsedSpec.evidence[i].tempId
          const realId = insertedEvidence[i]?.id
          if (tempId && realId) {
            evidenceIdMap.set(tempId, realId)
          }
        }
      }
    }

    // Build normalized nodes
    const normalizedNodes: SystemNode[] = parsedSpec.nodes.map((node) => ({
      id: normalizeNodeId(node.type, node.label),
      type: node.type,
      label: node.label,
      details: node.details,
      children: node.children,
      refs: node.refs.map((ref) => ({
        evidenceId: evidenceIdMap.get(ref.evidenceId) || ref.evidenceId,
      })),
      confidence: node.confidence,
    }))

    // Build normalized edges
    const normalizedEdges: SystemEdge[] = parsedSpec.edges.map((edge) => {
      const fromNode = parsedSpec.nodes.find((n) => n.id === edge.from || n.label === edge.from)
      const toNode = parsedSpec.nodes.find((n) => n.id === edge.to || n.label === edge.to)

      const fromId = fromNode ? normalizeNodeId(fromNode.type, fromNode.label) : edge.from
      const toId = toNode ? normalizeNodeId(toNode.type, toNode.label) : edge.to

      return {
        id: normalizeEdgeId(fromId, toId, edge.kind),
        from: fromId,
        to: toId,
        kind: edge.kind,
        label: edge.label,
        refs: edge.refs.map((ref) => ({
          evidenceId: evidenceIdMap.get(ref.evidenceId) || ref.evidenceId,
        })),
        confidence: edge.confidence,
      }
    })

    // Build system graph
    const systemGraph: SystemGraph = {
      systemId: params.systemId,
      title: system.name,
      nodes: normalizedNodes,
      edges: normalizedEdges,
      openQuestions: parsedSpec.openQuestions,
      notes: parsedSpec.notes,
    }

    // Validate graph
    if (!validateSystemGraph(systemGraph)) {
      console.error('Invalid system graph generated')
      return NextResponse.json(
        { error: 'Generated system graph is invalid' },
        { status: 500 }
      )
    }

    // Get current version number
    const { data: latestSnapshot } = await supabase
      .from('system_flow_snapshots')
      .select('version')
      .eq('system_id', params.systemId)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    const nextVersion = (latestSnapshot?.version || 0) + 1

    // Create flow snapshot
    const { data: snapshot, error: snapshotError } = await serviceClient
      .from('system_flow_snapshots')
      .insert({
        project_id: params.id,
        system_id: params.systemId,
        version: nextVersion,
        graph_json: systemGraph,
        generated_by: user.id,
        notes: `Generated from ${agentTool} agent output`,
      })
      .select()
      .single()

    if (snapshotError) {
      console.error('Failed to create snapshot:', snapshotError)
      return NextResponse.json(
        { error: 'Failed to create flow snapshot' },
        { status: 500 }
      )
    }

    // Store system spec artifact
    await serviceClient
      .from('system_artifacts')
      .insert({
        project_id: params.id,
        system_id: params.systemId,
        kind: 'SYSTEM_SPEC',
        content: JSON.stringify(systemGraph, null, 2),
        content_json: systemGraph,
        created_by: user.id,
      })

    // Update system status
    await serviceClient
      .from('systems')
      .update({ status: 'NEEDS_REVIEW' })
      .eq('id', params.systemId)

    // Build candidate lists for review
    const candidateNodes = normalizedNodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      details: node.details,
      source: 'agent' as const,
      confidence: node.confidence,
      evidenceIds: node.refs.map((r) => r.evidenceId),
      accepted: true,
    }))

    const candidateEdges = normalizedEdges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      label: edge.label,
      source: 'agent' as const,
      confidence: edge.confidence,
      evidenceIds: edge.refs.map((r) => r.evidenceId),
      accepted: true,
    }))

    return NextResponse.json({
      artifactId: outputArtifact?.id,
      systemSpec: systemGraph,
      snapshotId: snapshot.id,
      candidateNodes,
      candidateEdges,
    })
  } catch (error: unknown) {
    console.error('Agent output processing error:', error)
    const message = error instanceof Error ? error.message : 'Processing failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
