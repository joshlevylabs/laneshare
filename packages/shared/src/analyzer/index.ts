// Architecture Analyzer Pipeline
// Orchestrates multiple analysis passes to build a complete architecture graph

import type {
  ArchitectureGraph,
  ArchitectureSummary,
  ArchNode,
  ArchEdge,
  Evidence,
  Feature,
  AnalysisContext,
  AnalyzerPassResult,
  NodeType,
  EdgeType,
  Confidence,
  ANALYZER_VERSION,
} from '../types/architecture'

import { analyzeInventory } from './passes/inventory'
import { analyzeRoutes } from './passes/routes'
import { analyzeEndpoints } from './passes/endpoints'
import { analyzeSupabase } from './passes/supabase'
import { analyzeDeployment } from './passes/deployment'
import { analyzePython } from './passes/python'
import { extractFeatures } from './passes/features'
import { computeFingerprint } from './utils/fingerprint'

export { computeFingerprint }

export interface AnalyzerOptions {
  force?: boolean
  includePackages?: boolean
  minConfidence?: Confidence
}

export interface AnalyzerResult {
  graph: ArchitectureGraph
  summary: ArchitectureSummary
  evidence: Evidence[]
  fingerprint: string
}

/**
 * Main analyzer pipeline that orchestrates all analysis passes
 */
export async function analyzeArchitecture(
  context: AnalysisContext,
  options: AnalyzerOptions = {}
): Promise<AnalyzerResult> {
  const allNodes: ArchNode[] = []
  const allEdges: ArchEdge[] = []
  const allEvidence: Evidence[] = []

  // Pass 1: Inventory & Metadata
  const inventoryResult = await analyzeInventory(context)
  mergeResults(allNodes, allEdges, allEvidence, inventoryResult)

  // Pass 2: Frontend Routes & Screens
  const routesResult = await analyzeRoutes(context)
  mergeResults(allNodes, allEdges, allEvidence, routesResult)

  // Pass 3: Backend API Endpoints
  const endpointsResult = await analyzeEndpoints(context)
  mergeResults(allNodes, allEdges, allEvidence, endpointsResult)

  // Pass 4: Supabase Model (tables, functions, RLS)
  const supabaseResult = await analyzeSupabase(context)
  mergeResults(allNodes, allEdges, allEvidence, supabaseResult)

  // Pass 5: Deployment & External Services
  const deploymentResult = await analyzeDeployment(context)
  mergeResults(allNodes, allEdges, allEvidence, deploymentResult)

  // Pass 6: Python Projects (FastAPI, Django, Flask)
  const pythonResult = await analyzePython(context)
  mergeResults(allNodes, allEdges, allEvidence, pythonResult)

  // Pass 7: Feature Extraction
  const features = extractFeatures(allNodes, allEdges, allEvidence, context)

  // Filter by confidence if requested
  const filteredEdges = options.minConfidence
    ? allEdges.filter((e) => meetsConfidence(e.confidence, options.minConfidence!))
    : allEdges

  // Build the graph
  const graph: ArchitectureGraph = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    nodes: allNodes,
    edges: filteredEdges,
    features,
  }

  // Compute summary statistics
  const summary = computeSummary(graph)

  // Compute fingerprint for cache invalidation
  const fingerprint = computeFingerprint(context)

  return {
    graph,
    summary,
    evidence: allEvidence,
    fingerprint,
  }
}

function mergeResults(
  nodes: ArchNode[],
  edges: ArchEdge[],
  evidence: Evidence[],
  result: AnalyzerPassResult
): void {
  // Deduplicate nodes by ID
  for (const node of result.nodes) {
    if (!nodes.find((n) => n.id === node.id)) {
      nodes.push(node)
    }
  }

  // Deduplicate edges by ID
  for (const edge of result.edges) {
    if (!edges.find((e) => e.id === edge.id)) {
      edges.push(edge)
    }
  }

  // Add all evidence
  evidence.push(...result.evidence)
}

function meetsConfidence(actual: Confidence, minimum: Confidence): boolean {
  const levels: Record<Confidence, number> = { high: 3, medium: 2, low: 1 }
  return levels[actual] >= levels[minimum]
}

function computeSummary(graph: ArchitectureGraph): ArchitectureSummary {
  const nodesByType: Record<NodeType, number> = {
    repo: 0,
    app: 0,
    screen: 0,
    endpoint: 0,
    worker: 0,
    table: 0,
    function: 0,
    storage: 0,
    auth: 0,
    external_service: 0,
    deployment: 0,
    package: 0,
  }

  const edgesByType: Record<EdgeType, number> = {
    contains: 0,
    navigates_to: 0,
    calls: 0,
    reads: 0,
    writes: 0,
    uses_function: 0,
    authenticates: 0,
    stores: 0,
    deploys_to: 0,
    depends_on: 0,
    calls_external: 0,
  }

  const edgesByConfidence: Record<Confidence, number> = {
    high: 0,
    medium: 0,
    low: 0,
  }

  for (const node of graph.nodes) {
    nodesByType[node.type]++
  }

  for (const edge of graph.edges) {
    edgesByType[edge.type]++
    edgesByConfidence[edge.confidence]++
  }

  // Compute coverage stats
  const screens = graph.nodes.filter((n) => n.type === 'screen')
  const endpoints = graph.nodes.filter((n) => n.type === 'endpoint')
  const tables = graph.nodes.filter((n) => n.type === 'table')

  const screensWithEndpoints = screens.filter((s) =>
    graph.edges.some((e) => e.source === s.id && e.type === 'calls')
  ).length

  const endpointsWithTables = endpoints.filter((ep) =>
    graph.edges.some((e) => e.source === ep.id && (e.type === 'reads' || e.type === 'writes'))
  ).length

  const tablesWithRls = tables.filter(
    (t) => t.type === 'table' && (t.metadata as any).hasRls
  ).length

  // Repo stats
  const repos = graph.nodes
    .filter((n) => n.type === 'repo')
    .map((r) => ({
      id: r.id,
      name: r.label,
      nodeCount: graph.nodes.filter((n) => n.repoId === r.id).length,
    }))

  return {
    nodeCount: {
      total: graph.nodes.length,
      byType: nodesByType,
    },
    edgeCount: {
      total: graph.edges.length,
      byType: edgesByType,
      byConfidence: edgesByConfidence,
    },
    featureCount: graph.features.length,
    coverageStats: {
      screensWithEndpoints,
      endpointsWithTables,
      tablesWithRls,
    },
    repos,
  }
}

// Re-export utilities
export { generateNodeId, generateEdgeId, generateEvidenceId } from './utils/ids'
