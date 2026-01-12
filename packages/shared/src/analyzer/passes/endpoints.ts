// Pass 3: Backend API Endpoints Analysis
// Detects Next.js API routes and Express handlers

import type {
  AnalysisContext,
  AnalyzerPassResult,
  EndpointNode,
  Evidence,
  Confidence,
  ArchEdge,
} from '../../types/architecture'
import { generateNodeId, generateEvidenceId, generateEdgeId } from '../utils/ids'

interface EndpointInfo {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ALL'
  route: string
  filePath: string
}

/**
 * Analyze backend API endpoints
 * Creates endpoint nodes and edges to tables/services
 */
export async function analyzeEndpoints(
  context: AnalysisContext
): Promise<AnalyzerPassResult> {
  const nodes: AnalyzerPassResult['nodes'] = []
  const edges: AnalyzerPassResult['edges'] = []
  const evidence: Evidence[] = []

  for (const repo of context.repos) {
    const repoNodeId = generateNodeId('repo', repo.id)

    // Find API route files (Next.js App Router)
    const routeFiles = repo.files.filter(
      (f) =>
        f.path.match(/app\/api\/.*\/route\.(ts|js)$/) ||
        f.path.match(/src\/app\/api\/.*\/route\.(ts|js)$/)
    )

    for (const file of routeFiles) {
      const route = extractApiRoute(file.path)
      const content = context.existingChunks.get(file.path)

      // Detect which HTTP methods are exported
      const methods = content ? detectHttpMethods(content) : ['ALL']

      for (const method of methods) {
        const nodeId = generateNodeId('endpoint', repo.id, method, route)

        const feature = inferFeatureFromRoute(route)

        const endpointNode: EndpointNode = {
          id: nodeId,
          type: 'endpoint',
          label: `${method} ${route}`,
          repoId: repoNodeId,
          metadata: {
            method: method as EndpointNode['metadata']['method'],
            route,
            filePath: file.path,
            feature,
          },
        }
        nodes.push(endpointNode)

        // Add evidence for the endpoint definition
        evidence.push({
          id: generateEvidenceId('API_HANDLER', nodeId, file.path),
          kind: 'API_HANDLER',
          nodeId,
          repoId: repo.id,
          filePath: file.path,
          symbol: method,
          confidence: 'high',
          metadata: { route, method },
        })

        // Analyze endpoint content for downstream calls
        if (content) {
          // Extract Supabase table operations
          const tableOps = extractTableOperations(content)
          for (const op of tableOps) {
            const tableNodeId = generateNodeId('table', 'supabase', op.table)
            const edgeType = op.operation === 'select' ? 'reads' : 'writes'
            const edgeId = generateEdgeId(nodeId, tableNodeId, edgeType)

            edges.push({
              id: edgeId,
              source: nodeId,
              target: tableNodeId,
              type: edgeType,
              label: op.operation,
              confidence: op.confidence,
              evidenceIds: [],
              metadata: { operation: op.operation },
            })

            evidence.push({
              id: generateEvidenceId('SUPABASE_CLIENT', nodeId, file.path, op.line),
              kind: 'SUPABASE_CLIENT',
              nodeId,
              edgeId,
              repoId: repo.id,
              filePath: file.path,
              lineStart: op.line,
              excerpt: op.excerpt,
              symbol: op.table,
              confidence: op.confidence,
              metadata: { operation: op.operation, table: op.table },
            })
          }

          // Extract RPC calls
          const rpcCalls = extractRpcCalls(content)
          for (const rpc of rpcCalls) {
            const funcNodeId = generateNodeId('function', 'supabase', rpc.functionName)
            const edgeId = generateEdgeId(nodeId, funcNodeId, 'uses_function')

            edges.push({
              id: edgeId,
              source: nodeId,
              target: funcNodeId,
              type: 'uses_function',
              confidence: rpc.confidence,
              evidenceIds: [],
              metadata: {},
            })

            evidence.push({
              id: generateEvidenceId('SUPABASE_CLIENT', nodeId, file.path, rpc.line),
              kind: 'SUPABASE_CLIENT',
              nodeId,
              edgeId,
              repoId: repo.id,
              filePath: file.path,
              lineStart: rpc.line,
              excerpt: rpc.excerpt,
              symbol: rpc.functionName,
              confidence: rpc.confidence,
              metadata: { functionName: rpc.functionName },
            })
          }

          // Extract external API calls
          const externalCalls = extractExternalApiCalls(content)
          for (const ext of externalCalls) {
            const extNodeId = generateNodeId('external_service', ext.domain)
            const edgeId = generateEdgeId(nodeId, extNodeId, 'calls_external')

            edges.push({
              id: edgeId,
              source: nodeId,
              target: extNodeId,
              type: 'calls_external',
              label: ext.domain,
              confidence: ext.confidence,
              evidenceIds: [],
              metadata: { url: ext.url },
            })

            evidence.push({
              id: generateEvidenceId('EXTERNAL_API', nodeId, file.path, ext.line),
              kind: 'EXTERNAL_API',
              nodeId,
              edgeId,
              repoId: repo.id,
              filePath: file.path,
              lineStart: ext.line,
              excerpt: ext.excerpt,
              confidence: ext.confidence,
              metadata: { domain: ext.domain, url: ext.url },
            })
          }

          // Extract auth checks
          const authCalls = extractAuthCalls(content)
          for (const auth of authCalls) {
            const authNodeId = generateNodeId('auth', 'supabase')
            const edgeId = generateEdgeId(nodeId, authNodeId, 'authenticates')

            edges.push({
              id: edgeId,
              source: nodeId,
              target: authNodeId,
              type: 'authenticates',
              confidence: auth.confidence,
              evidenceIds: [],
              metadata: { operation: auth.operation },
            })

            evidence.push({
              id: generateEvidenceId('SUPABASE_CLIENT', nodeId, file.path, auth.line),
              kind: 'SUPABASE_CLIENT',
              nodeId,
              edgeId,
              repoId: repo.id,
              filePath: file.path,
              lineStart: auth.line,
              excerpt: auth.excerpt,
              confidence: auth.confidence,
              metadata: { operation: auth.operation },
            })
          }

          // Extract env var usage
          const envVars = extractEnvVars(content)
          for (const env of envVars) {
            evidence.push({
              id: generateEvidenceId('ENV_VAR', nodeId, file.path, env.line),
              kind: 'ENV_VAR',
              nodeId,
              repoId: repo.id,
              filePath: file.path,
              lineStart: env.line,
              excerpt: env.excerpt,
              symbol: env.name,
              confidence: 'high',
              metadata: { envVar: env.name },
            })
          }
        }
      }
    }

    // Create contains edges from app to endpoints
    const appNodeId = generateNodeId('app', repo.id, '')
    for (const node of nodes.filter((n) => n.repoId === repoNodeId && n.type === 'endpoint')) {
      edges.push({
        id: generateEdgeId(appNodeId, node.id, 'contains'),
        source: appNodeId,
        target: node.id,
        type: 'contains',
        confidence: 'high',
        evidenceIds: [],
        metadata: {},
      })
    }
  }

  // Resolve placeholder API references from routes pass
  // This connects screen -> endpoint edges properly
  resolveApiReferences(edges, nodes)

  return { nodes, edges, evidence }
}

function extractApiRoute(filePath: string): string {
  let route = filePath
    .replace(/^(src\/)?app\/api/, '/api')
    .replace(/\/route\.(ts|js)$/, '')

  // Handle dynamic segments
  route = route.replace(/\[\.\.\.(\w+)\]/g, '[...$1]')

  return route
}

function detectHttpMethods(content: string): string[] {
  const methods: string[] = []

  // Match exported async functions
  if (content.match(/export\s+(async\s+)?function\s+GET/)) methods.push('GET')
  if (content.match(/export\s+(async\s+)?function\s+POST/)) methods.push('POST')
  if (content.match(/export\s+(async\s+)?function\s+PUT/)) methods.push('PUT')
  if (content.match(/export\s+(async\s+)?function\s+PATCH/)) methods.push('PATCH')
  if (content.match(/export\s+(async\s+)?function\s+DELETE/)) methods.push('DELETE')

  // Match const exports
  if (content.match(/export\s+const\s+GET\s*=/)) methods.push('GET')
  if (content.match(/export\s+const\s+POST\s*=/)) methods.push('POST')
  if (content.match(/export\s+const\s+PUT\s*=/)) methods.push('PUT')
  if (content.match(/export\s+const\s+PATCH\s*=/)) methods.push('PATCH')
  if (content.match(/export\s+const\s+DELETE\s*=/)) methods.push('DELETE')

  return methods.length > 0 ? methods : ['ALL']
}

function inferFeatureFromRoute(route: string): string | undefined {
  const featureMap: Record<string, string> = {
    '/api/projects': 'projects',
    '/api/tasks': 'tasks',
    '/api/chat': 'chat',
    '/api/docs': 'documentation',
    '/api/repos': 'repositories',
    '/api/search': 'search',
    '/api/auth': 'auth',
    '/api/github': 'github-integration',
    '/api/invitations': 'invitations',
  }

  for (const [prefix, feature] of Object.entries(featureMap)) {
    if (route.startsWith(prefix)) {
      return feature
    }
  }

  return undefined
}

interface TableOperation {
  table: string
  operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  line: number
  excerpt: string
  confidence: Confidence
}

function extractTableOperations(content: string): TableOperation[] {
  const operations: TableOperation[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Match .from('table')
    const fromMatch = line.match(/\.from\s*\(\s*["'`]([^"'`]+)["'`]\)/)
    if (fromMatch) {
      const table = fromMatch[1]
      const operation = inferTableOperation(lines, i)

      operations.push({
        table,
        operation,
        line: i + 1,
        excerpt: getMultilineExcerpt(lines, i, 3),
        confidence: 'high',
      })
    }
  }

  return operations
}

function inferTableOperation(lines: string[], lineIndex: number): TableOperation['operation'] {
  // Look at lines after .from()
  const context = lines.slice(lineIndex, Math.min(lines.length, lineIndex + 8)).join('\n')

  if (context.includes('.insert(')) return 'insert'
  if (context.includes('.update(')) return 'update'
  if (context.includes('.delete()')) return 'delete'
  if (context.includes('.upsert(')) return 'upsert'

  return 'select'
}

interface RpcCall {
  functionName: string
  line: number
  excerpt: string
  confidence: Confidence
}

function extractRpcCalls(content: string): RpcCall[] {
  const calls: RpcCall[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const rpcMatch = line.match(/\.rpc\s*\(\s*["'`]([^"'`]+)["'`]/)
    if (rpcMatch) {
      calls.push({
        functionName: rpcMatch[1],
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'high',
      })
    }
  }

  return calls
}

interface ExternalApiCall {
  domain: string
  url: string
  line: number
  excerpt: string
  confidence: Confidence
}

function extractExternalApiCalls(content: string): ExternalApiCall[] {
  const calls: ExternalApiCall[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Match fetch with external URLs
    const fetchMatch = line.match(/fetch\s*\(\s*["'`](https?:\/\/[^"'`]+)["'`]/)
    if (fetchMatch) {
      const url = fetchMatch[1]
      const domain = extractDomain(url)

      // Skip internal API calls
      if (!domain.includes('localhost') && !url.startsWith('/')) {
        calls.push({
          domain,
          url,
          line: i + 1,
          excerpt: line.trim().slice(0, 200),
          confidence: 'high',
        })
      }
    }

    // Match axios with external URLs
    const axiosMatch = line.match(/axios\.(get|post|put|patch|delete)\s*\(\s*["'`](https?:\/\/[^"'`]+)["'`]/)
    if (axiosMatch) {
      const url = axiosMatch[2]
      const domain = extractDomain(url)

      calls.push({
        domain,
        url,
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'high',
      })
    }

    // Match process.env URLs
    const envUrlMatch = line.match(/process\.env\.(\w+_URL|\w+_API_URL)/)
    if (envUrlMatch && (line.includes('fetch') || line.includes('axios'))) {
      calls.push({
        domain: `env:${envUrlMatch[1]}`,
        url: `$${envUrlMatch[1]}`,
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'medium',
      })
    }
  }

  return calls
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname
  } catch {
    return url.split('/')[2] || 'unknown'
  }
}

interface AuthCall {
  operation: string
  line: number
  excerpt: string
  confidence: Confidence
}

function extractAuthCalls(content: string): AuthCall[] {
  const calls: AuthCall[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Match supabase.auth.getUser() or auth.getUser()
    const authMatch = line.match(/(?:supabase\.)?auth\.(getUser|getSession|signIn|signOut|signUp)/)
    if (authMatch) {
      calls.push({
        operation: authMatch[1],
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'high',
      })
    }
  }

  return calls
}

interface EnvVar {
  name: string
  line: number
  excerpt: string
}

function extractEnvVars(content: string): EnvVar[] {
  const envVars: EnvVar[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Match process.env.VAR_NAME
    const matches = Array.from(line.matchAll(/process\.env\.(\w+)/g))
    for (const match of matches) {
      envVars.push({
        name: match[1],
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
      })
    }
  }

  return envVars
}

function getMultilineExcerpt(lines: string[], startLine: number, numLines: number): string {
  return lines
    .slice(startLine, Math.min(lines.length, startLine + numLines))
    .join('\n')
    .trim()
    .slice(0, 300)
}

function resolveApiReferences(edges: ArchEdge[], nodes: AnalyzerPassResult['nodes']): void {
  // Find edges with placeholder targets like 'api:/api/projects'
  for (const edge of edges) {
    if (edge.target.startsWith('api:')) {
      const apiPath = edge.target.slice(4)
      const method = (edge.metadata?.method as string) || 'GET'

      // Find matching endpoint node
      const matchingEndpoint = nodes.find(
        (n) =>
          n.type === 'endpoint' &&
          matchesRoute(n.metadata.route as string, apiPath) &&
          (n.metadata.method === method || n.metadata.method === 'ALL')
      )

      if (matchingEndpoint) {
        edge.target = matchingEndpoint.id
      }
    }
  }
}

function matchesRoute(pattern: string, actual: string): boolean {
  // Convert route pattern to regex
  // /api/projects/[id] should match /api/projects/123
  const regexPattern = pattern
    .replace(/\[\.\.\.(\w+)\]/g, '.*') // Catch-all
    .replace(/\[(\w+)\]/g, '[^/]+') // Dynamic segment

  try {
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(actual)
  } catch {
    return pattern === actual
  }
}
