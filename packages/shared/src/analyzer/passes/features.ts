// Pass 6: Feature Extraction
// Identifies feature clusters and builds user flow maps

import type {
  ArchNode,
  ArchEdge,
  Evidence,
  Feature,
  FlowStep,
  AnalysisContext,
} from '../../types/architecture'

interface FeatureDefinition {
  slug: string
  name: string
  routePatterns: string[]
  endpointPatterns: string[]
  tables: string[]
  description: string
}

// Predefined feature definitions based on common patterns
const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  {
    slug: 'auth',
    name: 'Authentication',
    routePatterns: ['/login', '/signup', '/auth'],
    endpointPatterns: ['/api/auth'],
    tables: ['profiles', 'github_connections'],
    description: 'User authentication and session management',
  },
  {
    slug: 'projects',
    name: 'Project Management',
    routePatterns: ['/projects'],
    endpointPatterns: ['/api/projects'],
    tables: ['projects', 'project_members'],
    description: 'Create and manage projects',
  },
  {
    slug: 'repositories',
    name: 'Repository Management',
    routePatterns: ['/repos', '/projects/[id]/repos'],
    endpointPatterns: ['/api/repos', '/api/projects/[id]/repos'],
    tables: ['repos', 'repo_files', 'chunks'],
    description: 'Connect and sync GitHub repositories',
  },
  {
    slug: 'tasks',
    name: 'Task Management',
    routePatterns: ['/tasks', '/projects/[id]/tasks'],
    endpointPatterns: ['/api/projects/[id]/tasks'],
    tables: ['tasks', 'task_updates', 'sprints'],
    description: 'Kanban board for task tracking',
  },
  {
    slug: 'chat',
    name: 'LanePilot Chat',
    routePatterns: ['/chat', '/projects/[id]/chat'],
    endpointPatterns: ['/api/projects/[id]/chat'],
    tables: ['chat_threads', 'chat_messages', 'prompt_artifacts'],
    description: 'AI-powered chat for generating context packs',
  },
  {
    slug: 'documentation',
    name: 'Documentation',
    routePatterns: ['/docs', '/projects/[id]/docs'],
    endpointPatterns: ['/api/projects/[id]/docs'],
    tables: ['doc_pages', 'decision_logs'],
    description: 'Project documentation and decision logs',
  },
  {
    slug: 'search',
    name: 'Code Search',
    routePatterns: ['/search', '/projects/[id]/search'],
    endpointPatterns: ['/api/projects/[id]/search'],
    tables: ['chunks'],
    description: 'Semantic and keyword search across repos',
  },
  {
    slug: 'invitations',
    name: 'Team Invitations',
    routePatterns: ['/invite', '/settings'],
    endpointPatterns: ['/api/invitations', '/api/projects/[id]/invitations'],
    tables: ['project_invitations', 'project_members'],
    description: 'Invite team members to projects',
  },
  {
    slug: 'architecture-map',
    name: 'Architecture Map',
    routePatterns: ['/map', '/projects/[id]/map'],
    endpointPatterns: ['/api/projects/[id]/map'],
    tables: ['architecture_snapshots', 'architecture_evidence'],
    description: 'Visual architecture discovery and mapping',
  },
]

/**
 * Extract features from the analyzed nodes and edges
 * Builds feature flows with evidence links
 */
export function extractFeatures(
  nodes: ArchNode[],
  edges: ArchEdge[],
  evidence: Evidence[],
  context: AnalysisContext
): Feature[] {
  const features: Feature[] = []

  for (const def of FEATURE_DEFINITIONS) {
    // Find matching screens
    const screens = findMatchingNodes(nodes, 'screen', def.routePatterns)
    if (screens.length === 0) continue // Skip if no screens found

    // Find matching endpoints
    const endpoints = findMatchingNodes(nodes, 'endpoint', def.endpointPatterns)

    // Find matching tables
    const tables = nodes.filter(
      (n) => n.type === 'table' && def.tables.includes(n.label)
    )

    // Find related services
    const services = findRelatedServices(nodes, edges, [...screens, ...endpoints])

    // Build flow
    const flow = buildFeatureFlow(def, screens, endpoints, tables, edges, evidence)

    features.push({
      slug: def.slug,
      name: def.name,
      description: def.description,
      flow,
      screens: screens.map((s) => s.id),
      endpoints: endpoints.map((e) => e.id),
      tables: tables.map((t) => t.id),
      services: services.map((s) => s.id),
    })
  }

  // Detect additional features from route patterns
  const additionalFeatures = detectAdditionalFeatures(nodes, edges, evidence, features)
  features.push(...additionalFeatures)

  return features
}

function findMatchingNodes(
  nodes: ArchNode[],
  type: string,
  patterns: string[]
): ArchNode[] {
  return nodes.filter((n) => {
    if (n.type !== type) return false

    const route = (n.metadata as any).route as string
    if (!route) return false

    return patterns.some((pattern) => matchesPattern(route, pattern))
  })
}

function matchesPattern(route: string, pattern: string): boolean {
  // Convert pattern to regex
  const regexStr = pattern
    .replace(/\[\.\.\.?\w+\]/g, '[^/]+') // Dynamic segments
    .replace(/\//g, '\\/') // Escape slashes

  try {
    const regex = new RegExp(`^${regexStr}`)
    return regex.test(route)
  } catch {
    return route.includes(pattern)
  }
}

function findRelatedServices(
  nodes: ArchNode[],
  edges: ArchEdge[],
  sourceNodes: ArchNode[]
): ArchNode[] {
  const serviceIds = new Set<string>()

  for (const node of sourceNodes) {
    // Find edges from this node to services
    const outEdges = edges.filter(
      (e) =>
        e.source === node.id &&
        (e.type === 'calls_external' || e.type === 'authenticates' || e.type === 'stores')
    )

    for (const edge of outEdges) {
      serviceIds.add(edge.target)
    }
  }

  return nodes.filter(
    (n) =>
      serviceIds.has(n.id) &&
      (n.type === 'external_service' || n.type === 'auth' || n.type === 'storage')
  )
}

function buildFeatureFlow(
  def: FeatureDefinition,
  screens: ArchNode[],
  endpoints: ArchNode[],
  tables: ArchNode[],
  edges: ArchEdge[],
  evidence: Evidence[]
): FlowStep[] {
  const flow: FlowStep[] = []
  let order = 1

  // Order screens by route depth (shallow first)
  const sortedScreens = [...screens].sort((a, b) => {
    const routeA = (a.metadata as any).route || ''
    const routeB = (b.metadata as any).route || ''
    return routeA.split('/').length - routeB.split('/').length
  })

  // Add screen steps
  for (const screen of sortedScreens) {
    const screenEvidence = evidence.filter((e) => e.nodeId === screen.id)

    flow.push({
      order: order++,
      type: 'screen',
      nodeId: screen.id,
      label: `View ${screen.label}`,
      description: `Navigate to ${(screen.metadata as any).route}`,
      evidenceIds: screenEvidence.slice(0, 3).map((e) => e.id),
    })

    // Find actions from this screen (calls edges)
    const callEdges = edges.filter(
      (e) => e.source === screen.id && e.type === 'calls'
    )

    for (const callEdge of callEdges) {
      const targetEndpoint = endpoints.find((ep) => ep.id === callEdge.target)
      if (targetEndpoint) {
        const actionEvidence = evidence.filter((e) => e.edgeId === callEdge.id)

        flow.push({
          order: order++,
          type: 'api_call',
          nodeId: targetEndpoint.id,
          label: `Call ${targetEndpoint.label}`,
          description: `${(targetEndpoint.metadata as any).method} ${(targetEndpoint.metadata as any).route}`,
          evidenceIds: actionEvidence.slice(0, 2).map((e) => e.id),
        })
      }
    }
  }

  // Add endpoint-to-table operations
  for (const endpoint of endpoints) {
    const tableEdges = edges.filter(
      (e) =>
        e.source === endpoint.id &&
        (e.type === 'reads' || e.type === 'writes')
    )

    for (const tableEdge of tableEdges) {
      const table = tables.find((t) => t.id === tableEdge.target)
      if (table) {
        const tableEvidence = evidence.filter((e) => e.edgeId === tableEdge.id)

        flow.push({
          order: order++,
          type: 'db_operation',
          nodeId: table.id,
          label: `${tableEdge.type === 'reads' ? 'Read from' : 'Write to'} ${table.label}`,
          description: `${tableEdge.label || tableEdge.type} operation`,
          evidenceIds: tableEvidence.slice(0, 2).map((e) => e.id),
        })
      }
    }
  }

  return flow
}

function detectAdditionalFeatures(
  nodes: ArchNode[],
  edges: ArchEdge[],
  evidence: Evidence[],
  existingFeatures: Feature[]
): Feature[] {
  const additionalFeatures: Feature[] = []
  const coveredScreens = new Set(existingFeatures.flatMap((f) => f.screens))

  // Find uncovered screens with unique route prefixes
  const uncoveredScreens = nodes.filter(
    (n) => n.type === 'screen' && !coveredScreens.has(n.id)
  )

  // Group by route prefix
  const routeGroups = new Map<string, ArchNode[]>()

  for (const screen of uncoveredScreens) {
    const route = (screen.metadata as any).route as string
    if (!route) continue

    // Get first two segments as prefix
    const segments = route.split('/').filter(Boolean)
    const prefix = '/' + segments.slice(0, 2).join('/')

    if (!routeGroups.has(prefix)) {
      routeGroups.set(prefix, [])
    }
    routeGroups.get(prefix)!.push(screen)
  }

  // Create features for groups with multiple screens
  for (const [prefix, screens] of Array.from(routeGroups.entries())) {
    if (screens.length < 2) continue

    const slug = prefix.replace(/\//g, '-').replace(/^\-/, '').replace(/\[.*\]/g, 'param')
    const name = slug
      .split('-')
      .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ')

    // Find related endpoints
    const endpoints = nodes.filter((n) => {
      if (n.type !== 'endpoint') return false
      const route = (n.metadata as any).route as string
      return route?.startsWith(`/api${prefix}`) || route?.startsWith(prefix)
    })

    additionalFeatures.push({
      slug,
      name,
      description: `Auto-detected feature from route pattern ${prefix}`,
      flow: buildFeatureFlow(
        { slug, name, routePatterns: [prefix], endpointPatterns: [], tables: [], description: '' },
        screens,
        endpoints,
        [],
        edges,
        evidence
      ),
      screens: screens.map((s: ArchNode) => s.id),
      endpoints: endpoints.map((e) => e.id),
      tables: [],
      services: [],
    })
  }

  return additionalFeatures
}
