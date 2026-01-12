// Pass 2: Frontend Routes & Screens Analysis
// Detects Next.js App Router pages and extracts route information

import type {
  AnalysisContext,
  AnalyzerPassResult,
  ScreenNode,
  Evidence,
  Confidence,
} from '../../types/architecture'
import { generateNodeId, generateEvidenceId, generateEdgeId } from '../utils/ids'

interface RouteInfo {
  route: string
  filePath: string
  dynamic: boolean
  layout?: string
  catchAll: boolean
  parallel: boolean
  intercepted: boolean
}

/**
 * Analyze frontend routes and screens
 * Creates screen nodes and navigation edges
 */
export async function analyzeRoutes(
  context: AnalysisContext
): Promise<AnalyzerPassResult> {
  const nodes: AnalyzerPassResult['nodes'] = []
  const edges: AnalyzerPassResult['edges'] = []
  const evidence: Evidence[] = []

  for (const repo of context.repos) {
    const repoNodeId = generateNodeId('repo', repo.id)

    // Find all page files (Next.js App Router)
    const pageFiles = repo.files.filter((f) =>
      f.path.match(/app\/.*\/page\.(tsx?|jsx?)$/) ||
      f.path.match(/^app\/page\.(tsx?|jsx?)$/) ||
      f.path.match(/src\/app\/.*\/page\.(tsx?|jsx?)$/) ||
      f.path.match(/^src\/app\/page\.(tsx?|jsx?)$/)
    )

    // Extract route info from each page file
    const routes = pageFiles.map((f) => extractRouteInfo(f.path))

    // Find layout files to associate with routes
    const layoutFiles = repo.files.filter((f) =>
      f.path.match(/layout\.(tsx?|jsx?)$/)
    )

    for (const route of routes) {
      const nodeId = generateNodeId('screen', repo.id, route.route)

      // Determine the feature based on route prefix
      const feature = inferFeatureFromRoute(route.route)

      // Find associated layout
      const layout = findLayoutForRoute(route.filePath, layoutFiles)

      const screenNode: ScreenNode = {
        id: nodeId,
        type: 'screen',
        label: route.route || '/',
        repoId: repoNodeId,
        metadata: {
          route: route.route,
          filePath: route.filePath,
          dynamic: route.dynamic,
          layout,
          feature,
        },
      }
      nodes.push(screenNode)

      // Add evidence for the page definition
      evidence.push({
        id: generateEvidenceId('PAGE_COMPONENT', nodeId, route.filePath),
        kind: 'PAGE_COMPONENT',
        nodeId,
        repoId: repo.id,
        filePath: route.filePath,
        symbol: 'page',
        confidence: 'high',
        metadata: {
          route: route.route,
          dynamic: route.dynamic,
        },
      })

      // Analyze page content for API calls and navigation
      const pageContent = context.existingChunks.get(route.filePath)
      if (pageContent) {
        const apiCalls = extractApiCalls(pageContent)
        const navigations = extractNavigations(pageContent)

        // Create edges for API calls (will be resolved in endpoints pass)
        for (const call of apiCalls) {
          const edgeId = generateEdgeId(nodeId, `api:${call.path}`, 'calls')
          edges.push({
            id: edgeId,
            source: nodeId,
            target: `api:${call.path}`, // Placeholder, resolved later
            type: 'calls',
            label: call.method,
            confidence: call.confidence,
            evidenceIds: [],
            metadata: { method: call.method, path: call.path },
          })

          evidence.push({
            id: generateEvidenceId('FETCH_CALL', nodeId, route.filePath, call.line),
            kind: 'FETCH_CALL',
            nodeId,
            edgeId,
            repoId: repo.id,
            filePath: route.filePath,
            lineStart: call.line,
            excerpt: call.excerpt,
            confidence: call.confidence,
            metadata: { method: call.method, path: call.path },
          })
        }

        // Create navigation edges
        for (const nav of navigations) {
          if (nav.target.startsWith('/')) {
            const targetRoute = normalizeRoute(nav.target)
            const targetNodeId = generateNodeId('screen', repo.id, targetRoute)

            edges.push({
              id: generateEdgeId(nodeId, targetNodeId, 'navigates_to'),
              source: nodeId,
              target: targetNodeId,
              type: 'navigates_to',
              confidence: nav.confidence,
              evidenceIds: [],
              metadata: {},
            })

            evidence.push({
              id: generateEvidenceId('COMPONENT_USAGE', nodeId, route.filePath, nav.line),
              kind: 'COMPONENT_USAGE',
              nodeId,
              repoId: repo.id,
              filePath: route.filePath,
              lineStart: nav.line,
              excerpt: nav.excerpt,
              confidence: nav.confidence,
              metadata: { target: nav.target },
            })
          }
        }

        // Check for Supabase client usage
        const supabaseCalls = extractSupabaseCalls(pageContent)
        for (const call of supabaseCalls) {
          evidence.push({
            id: generateEvidenceId('SUPABASE_CLIENT', nodeId, route.filePath, call.line),
            kind: 'SUPABASE_CLIENT',
            nodeId,
            repoId: repo.id,
            filePath: route.filePath,
            lineStart: call.line,
            excerpt: call.excerpt,
            confidence: call.confidence,
            metadata: { operation: call.operation, table: call.table },
          })
        }
      }
    }

    // Create contains edges from app to screens
    const appNodeId = generateNodeId('app', repo.id, '')
    for (const node of nodes.filter((n) => n.repoId === repoNodeId)) {
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

  return { nodes, edges, evidence }
}

function extractRouteInfo(filePath: string): RouteInfo {
  // Remove src/app or app prefix and page.tsx suffix
  let route = filePath
    .replace(/^(src\/)?app/, '')
    .replace(/\/page\.(tsx?|jsx?)$/, '')
    .replace(/\([^)]+\)\//g, '') // Remove route groups like (marketing)/

  // Handle index route
  if (route === '' || route === '/') {
    route = '/'
  }

  // Check for dynamic segments
  const dynamic = route.includes('[')
  const catchAll = route.includes('[...')
  const parallel = filePath.includes('@')
  const intercepted = filePath.includes('(.)') || filePath.includes('(..)')

  return {
    route,
    filePath,
    dynamic,
    catchAll,
    parallel,
    intercepted,
  }
}

function normalizeRoute(route: string): string {
  // Remove query params and hash
  let normalized = route.split('?')[0].split('#')[0]

  // Remove trailing slash except for root
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }

  return normalized
}

function findLayoutForRoute(pagePath: string, layoutFiles: Array<{ path: string }>): string | undefined {
  const pageDir = pagePath.substring(0, pagePath.lastIndexOf('/'))

  // Search up the directory tree for layout
  let currentDir = pageDir
  while (currentDir) {
    const layoutPath = layoutFiles.find(
      (l) => l.path.startsWith(currentDir) && l.path.includes('layout.')
    )
    if (layoutPath) {
      return layoutPath.path
    }
    const lastSlash = currentDir.lastIndexOf('/')
    if (lastSlash <= 0) break
    currentDir = currentDir.substring(0, lastSlash)
  }

  return undefined
}

function inferFeatureFromRoute(route: string): string | undefined {
  const featureMap: Record<string, string> = {
    '/projects': 'projects',
    '/tasks': 'tasks',
    '/chat': 'chat',
    '/docs': 'documentation',
    '/repos': 'repositories',
    '/search': 'search',
    '/settings': 'settings',
    '/dashboard': 'dashboard',
    '/map': 'architecture-map',
    '/login': 'auth',
    '/auth': 'auth',
    '/invite': 'invitations',
  }

  for (const [prefix, feature] of Object.entries(featureMap)) {
    if (route.startsWith(prefix) || route.includes(prefix)) {
      return feature
    }
  }

  return undefined
}

interface ApiCall {
  method: string
  path: string
  line: number
  excerpt: string
  confidence: Confidence
}

function extractApiCalls(content: string): ApiCall[] {
  const calls: ApiCall[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Match fetch calls
    const fetchMatch = line.match(/fetch\s*\(\s*[`'"](\/api\/[^`'"]+)[`'"]/)
    if (fetchMatch) {
      calls.push({
        method: inferMethodFromContext(lines, i),
        path: fetchMatch[1],
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'high',
      })
    }

    // Match template literal API paths
    const templateMatch = line.match(/`\/api\/([^`]+)`/)
    if (templateMatch && !fetchMatch) {
      calls.push({
        method: inferMethodFromContext(lines, i),
        path: `/api/${templateMatch[1].replace(/\$\{[^}]+\}/g, '[param]')}`,
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'medium',
      })
    }
  }

  return calls
}

function inferMethodFromContext(lines: string[], lineIndex: number): string {
  // Look at surrounding lines for method hints
  const context = lines.slice(Math.max(0, lineIndex - 3), lineIndex + 3).join('\n')

  if (context.includes('method: "POST"') || context.includes("method: 'POST'")) return 'POST'
  if (context.includes('method: "PUT"') || context.includes("method: 'PUT'")) return 'PUT'
  if (context.includes('method: "PATCH"') || context.includes("method: 'PATCH'")) return 'PATCH'
  if (context.includes('method: "DELETE"') || context.includes("method: 'DELETE'")) return 'DELETE'

  return 'GET'
}

interface Navigation {
  target: string
  line: number
  excerpt: string
  confidence: Confidence
}

function extractNavigations(content: string): Navigation[] {
  const navigations: Navigation[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Match Link components
    const linkMatch = line.match(/<Link[^>]*href=["'`]([^"'`]+)["'`]/)
    if (linkMatch) {
      navigations.push({
        target: linkMatch[1],
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'high',
      })
    }

    // Match router.push
    const pushMatch = line.match(/router\.push\s*\(\s*["'`]([^"'`]+)["'`]/)
    if (pushMatch) {
      navigations.push({
        target: pushMatch[1],
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'high',
      })
    }

    // Match redirect
    const redirectMatch = line.match(/redirect\s*\(\s*["'`]([^"'`]+)["'`]/)
    if (redirectMatch) {
      navigations.push({
        target: redirectMatch[1],
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'high',
      })
    }
  }

  return navigations
}

interface SupabaseCall {
  operation: string
  table?: string
  line: number
  excerpt: string
  confidence: Confidence
}

function extractSupabaseCalls(content: string): SupabaseCall[] {
  const calls: SupabaseCall[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Match .from('table')
    const fromMatch = line.match(/\.from\s*\(\s*["'`]([^"'`]+)["'`]\)/)
    if (fromMatch) {
      const operation = inferSupabaseOperation(lines, i)
      calls.push({
        operation,
        table: fromMatch[1],
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'high',
      })
    }

    // Match auth calls
    if (line.includes('supabase.auth.') || line.includes('.auth.')) {
      const authMatch = line.match(/auth\.(\w+)/)
      if (authMatch) {
        calls.push({
          operation: `auth.${authMatch[1]}`,
          line: i + 1,
          excerpt: line.trim().slice(0, 200),
          confidence: 'high',
        })
      }
    }

    // Match storage calls
    if (line.includes('.storage.')) {
      calls.push({
        operation: 'storage',
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'medium',
      })
    }

    // Match RPC calls
    const rpcMatch = line.match(/\.rpc\s*\(\s*["'`]([^"'`]+)["'`]/)
    if (rpcMatch) {
      calls.push({
        operation: 'rpc',
        table: rpcMatch[1],
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'high',
      })
    }
  }

  return calls
}

function inferSupabaseOperation(lines: string[], lineIndex: number): string {
  const context = lines.slice(lineIndex, Math.min(lines.length, lineIndex + 5)).join('\n')

  if (context.includes('.insert(')) return 'insert'
  if (context.includes('.update(')) return 'update'
  if (context.includes('.delete(')) return 'delete'
  if (context.includes('.upsert(')) return 'upsert'

  return 'select'
}
