// Pass for Python Project Analysis
// Detects FastAPI routes, Python modules, classes, and services

import type {
  AnalysisContext,
  AnalyzerPassResult,
  AppNode,
  ArchNode,
  EndpointNode,
  Evidence,
  Confidence,
  StorageNode,
} from '../../types/architecture'
import { generateNodeId, generateEvidenceId, generateEdgeId } from '../utils/ids'

interface PythonModule {
  name: string
  path: string
  type: 'package' | 'module'
  classes: PythonClass[]
  functions: PythonFunction[]
  imports: string[]
}

interface PythonClass {
  name: string
  bases: string[]
  methods: string[]
  lineStart: number
}

interface PythonFunction {
  name: string
  decorators: string[]
  isAsync: boolean
  lineStart: number
}

interface FastAPIRoute {
  method: string
  path: string
  functionName: string
  filePath: string
  lineStart: number
}

interface PyProjectToml {
  project?: {
    name?: string
    version?: string
    dependencies?: string[]
  }
  tool?: {
    poetry?: {
      dependencies?: Record<string, string | { version: string }>
    }
  }
}

/**
 * Analyze Python projects - modules, classes, FastAPI routes, dependencies
 */
export async function analyzePython(
  context: AnalysisContext
): Promise<AnalyzerPassResult> {
  const nodes: AnalyzerPassResult['nodes'] = []
  const edges: AnalyzerPassResult['edges'] = []
  const evidence: Evidence[] = []

  for (const repo of context.repos) {
    const repoNodeId = generateNodeId('repo', repo.id)

    // Check if this is a Python project
    const isPythonProject = repo.files.some(
      (f) =>
        f.path === 'pyproject.toml' ||
        f.path === 'setup.py' ||
        f.path === 'requirements.txt' ||
        f.path.endsWith('.py')
    )

    if (!isPythonProject) continue

    // Detect framework from pyproject.toml or requirements
    const framework = detectPythonFramework(repo, context.existingChunks)

    // Find all Python files
    const pythonFiles = repo.files.filter(
      (f) => f.path.endsWith('.py') && !f.path.includes('__pycache__')
    )

    // Detect Python packages (directories with __init__.py)
    const packages = detectPythonPackages(repo)

    // Create module/service nodes for each package
    for (const pkg of packages) {
      const moduleNodeId = generateNodeId('app', repo.id, pkg.path)

      // Determine if this is a service, store, or regular module
      const moduleType = inferModuleType(pkg.name, pkg.path)

      // Use AppNode type as it has the moduleType metadata we need
      const moduleNode: AppNode = {
        id: moduleNodeId,
        type: 'app',
        label: pkg.name,
        repoId: repoNodeId,
        metadata: {
          repoId: repo.id,
          appPath: pkg.path,
          framework: framework || 'python',
          moduleType,
          hasApiRoutes: pkg.path.includes('routes') || pkg.path.includes('api'),
          hasPages: false,
        },
      }
      nodes.push(moduleNode)

      // Create contains edge from repo
      edges.push({
        id: generateEdgeId(repoNodeId, moduleNodeId, 'contains'),
        source: repoNodeId,
        target: moduleNodeId,
        type: 'contains',
        confidence: 'high',
        evidenceIds: [],
        metadata: {},
      })

      // Add evidence
      const initPath = `${pkg.path}/__init__.py`
      if (repo.files.some((f) => f.path === initPath)) {
        evidence.push({
          id: generateEvidenceId('IMPORT_STMT', moduleNodeId, initPath),
          kind: 'IMPORT_STMT',
          nodeId: moduleNodeId,
          repoId: repo.id,
          filePath: initPath,
          symbol: pkg.name,
          confidence: 'high',
          metadata: { moduleType },
        })
      }
    }

    // Analyze each Python file for classes and functions
    for (const file of pythonFiles) {
      const content = context.existingChunks.get(file.path)
      if (!content) continue

      // Parse Python classes
      const classes = parsePythonClasses(content, file.path)
      for (const cls of classes) {
        const classNodeId = generateNodeId('app', repo.id, file.path, cls.name)

        // Determine class type based on name and bases
        const classType = inferClassType(cls, file.path)

        if (classType !== 'generic') {
          const classNode: AppNode = {
            id: classNodeId,
            type: 'app',
            label: cls.name,
            repoId: repoNodeId,
            metadata: {
              repoId: repo.id,
              appPath: file.path,
              framework: framework || 'python',
              classType,
              bases: cls.bases,
              methods: cls.methods,
              hasApiRoutes: false,
              hasPages: false,
            },
          }
          nodes.push(classNode)

          // Find parent module and create edge
          const parentPkg = packages.find((p) => file.path.startsWith(p.path + '/'))
          if (parentPkg) {
            const parentNodeId = generateNodeId('app', repo.id, parentPkg.path)
            edges.push({
              id: generateEdgeId(parentNodeId, classNodeId, 'contains'),
              source: parentNodeId,
              target: classNodeId,
              type: 'contains',
              confidence: 'high',
              evidenceIds: [],
              metadata: {},
            })
          }

          evidence.push({
            id: generateEvidenceId('PAGE_COMPONENT', classNodeId, file.path, cls.lineStart),
            kind: 'PAGE_COMPONENT',
            nodeId: classNodeId,
            repoId: repo.id,
            filePath: file.path,
            lineStart: cls.lineStart,
            symbol: cls.name,
            excerpt: `class ${cls.name}(${cls.bases.join(', ')})`,
            confidence: 'high',
            metadata: { methods: cls.methods.length },
          })
        }
      }

      // Parse FastAPI routes
      if (framework === 'fastapi') {
        const routes = parseFastAPIRoutes(content, file.path)
        for (const route of routes) {
          const endpointNodeId = generateNodeId(
            'endpoint',
            repo.id,
            route.method,
            route.path
          )

          const endpointNode: EndpointNode = {
            id: endpointNodeId,
            type: 'endpoint',
            label: `${route.method.toUpperCase()} ${route.path}`,
            repoId: repoNodeId,
            metadata: {
              method: route.method.toUpperCase() as any,
              route: route.path,
              filePath: file.path,
              feature: inferFeatureFromPath(route.path, file.path),
            },
          }
          nodes.push(endpointNode)

          evidence.push({
            id: generateEvidenceId('API_HANDLER', endpointNodeId, file.path, route.lineStart),
            kind: 'API_HANDLER',
            nodeId: endpointNodeId,
            repoId: repo.id,
            filePath: file.path,
            lineStart: route.lineStart,
            symbol: route.functionName,
            excerpt: `@router.${route.method}("${route.path}")`,
            confidence: 'high',
            metadata: { method: route.method, functionName: route.functionName },
          })

          // Create edge from parent module to endpoint
          const parentPkg = packages.find((p) => file.path.startsWith(p.path + '/'))
          if (parentPkg) {
            const parentNodeId = generateNodeId('app', repo.id, parentPkg.path)
            edges.push({
              id: generateEdgeId(parentNodeId, endpointNodeId, 'contains'),
              source: parentNodeId,
              target: endpointNodeId,
              type: 'contains',
              confidence: 'high',
              evidenceIds: [],
              metadata: {},
            })
          }
        }
      }

      // Detect database/store interactions
      const storeInteractions = parseStoreInteractions(content, file.path)
      for (const interaction of storeInteractions) {
        const sourceNodeId = findNodeForFile(nodes, repo.id, file.path)
        if (sourceNodeId) {
          const storeNodeId = generateNodeId('storage', repo.id, interaction.store)

          // Create store node if doesn't exist
          if (!nodes.find((n) => n.id === storeNodeId)) {
            nodes.push({
              id: storeNodeId,
              type: 'storage',
              label: interaction.store,
              repoId: repoNodeId,
              metadata: {
                provider: interaction.store.toLowerCase() as 'supabase' | 's3' | 'gcs',
                isPublic: false,
              },
            } as StorageNode)
          }

          const edgeType = interaction.operation === 'read' ? 'reads' : 'writes'
          const edgeId = generateEdgeId(sourceNodeId, storeNodeId, edgeType)

          if (!edges.find((e) => e.id === edgeId)) {
            edges.push({
              id: edgeId,
              source: sourceNodeId,
              target: storeNodeId,
              type: edgeType,
              confidence: interaction.confidence,
              evidenceIds: [],
              metadata: { operation: interaction.operation },
            })
          }

          evidence.push({
            id: generateEvidenceId('SUPABASE_CLIENT', sourceNodeId, file.path, interaction.line),
            kind: 'SUPABASE_CLIENT',
            nodeId: sourceNodeId,
            edgeId,
            repoId: repo.id,
            filePath: file.path,
            lineStart: interaction.line,
            excerpt: interaction.excerpt,
            confidence: interaction.confidence,
            metadata: { store: interaction.store, operation: interaction.operation },
          })
        }
      }

      // Detect external service calls
      const externalCalls = parseExternalServiceCalls(content, file.path)
      for (const call of externalCalls) {
        const sourceNodeId = findNodeForFile(nodes, repo.id, file.path)
        if (sourceNodeId) {
          const serviceNodeId = generateNodeId('external_service', call.service)

          if (!nodes.find((n) => n.id === serviceNodeId)) {
            nodes.push({
              id: serviceNodeId,
              type: 'external_service',
              label: call.service,
              metadata: {
                domain: call.domain || call.service,
                apiType: 'rest',
              },
            })
          }

          const edgeId = generateEdgeId(sourceNodeId, serviceNodeId, 'calls_external')
          if (!edges.find((e) => e.id === edgeId)) {
            edges.push({
              id: edgeId,
              source: sourceNodeId,
              target: serviceNodeId,
              type: 'calls_external',
              confidence: call.confidence,
              evidenceIds: [],
              metadata: {},
            })
          }

          evidence.push({
            id: generateEvidenceId('EXTERNAL_API', sourceNodeId, file.path, call.line),
            kind: 'EXTERNAL_API',
            nodeId: sourceNodeId,
            edgeId,
            repoId: repo.id,
            filePath: file.path,
            lineStart: call.line,
            excerpt: call.excerpt,
            confidence: call.confidence,
            metadata: { service: call.service },
          })
        }
      }
    }

    // Analyze Python dependencies from pyproject.toml
    const pyprojectContent = context.existingChunks.get('pyproject.toml')
    if (pyprojectContent) {
      const deps = parsePythonDependencies(pyprojectContent)
      for (const dep of deps) {
        const depNodeId = generateNodeId('package', repo.id, dep.name)

        nodes.push({
          id: depNodeId,
          type: 'package',
          label: dep.name,
          repoId: repoNodeId,
          metadata: {
            name: dep.name,
            version: dep.version || 'unknown',
            isDevDep: dep.isDev,
            category: categorizePythonPackage(dep.name),
          },
        })

        edges.push({
          id: generateEdgeId(repoNodeId, depNodeId, 'depends_on'),
          source: repoNodeId,
          target: depNodeId,
          type: 'depends_on',
          confidence: 'high',
          evidenceIds: [],
          metadata: {},
        })

        evidence.push({
          id: generateEvidenceId('PACKAGE_DEP', depNodeId, 'pyproject.toml'),
          kind: 'PACKAGE_DEP',
          nodeId: depNodeId,
          repoId: repo.id,
          filePath: 'pyproject.toml',
          symbol: dep.name,
          excerpt: `${dep.name} = "${dep.version || '*'}"`,
          confidence: 'high',
          metadata: {},
        })
      }
    }
  }

  return { nodes, edges, evidence }
}

function detectPythonFramework(
  repo: AnalysisContext['repos'][0],
  chunks: Map<string, string>
): string | undefined {
  // Check pyproject.toml
  const pyprojectContent = chunks.get('pyproject.toml')
  if (pyprojectContent) {
    if (pyprojectContent.includes('fastapi')) return 'fastapi'
    if (pyprojectContent.includes('django')) return 'django'
    if (pyprojectContent.includes('flask')) return 'flask'
    if (pyprojectContent.includes('starlette')) return 'starlette'
  }

  // Check requirements.txt
  const requirementsContent = chunks.get('requirements.txt')
  if (requirementsContent) {
    if (requirementsContent.includes('fastapi')) return 'fastapi'
    if (requirementsContent.includes('django')) return 'django'
    if (requirementsContent.includes('flask')) return 'flask'
  }

  // Check for FastAPI usage in files
  for (const file of repo.files) {
    if (file.path.endsWith('.py')) {
      const content = chunks.get(file.path)
      if (content) {
        if (content.includes('from fastapi import') || content.includes('import fastapi')) {
          return 'fastapi'
        }
        if (content.includes('from django') || content.includes('import django')) {
          return 'django'
        }
        if (content.includes('from flask import') || content.includes('import flask')) {
          return 'flask'
        }
      }
    }
  }

  return undefined
}

interface PythonPackage {
  name: string
  path: string
}

function detectPythonPackages(repo: AnalysisContext['repos'][0]): PythonPackage[] {
  const packages: PythonPackage[] = []
  const initFiles = repo.files.filter((f) => f.path.endsWith('__init__.py'))

  for (const initFile of initFiles) {
    const dirPath = initFile.path.replace('/__init__.py', '')
    const name = dirPath.split('/').pop() || dirPath

    // Skip common non-package directories
    if (['tests', 'test', '__pycache__', '.pytest_cache', 'migrations'].includes(name)) {
      continue
    }

    packages.push({ name, path: dirPath })
  }

  return packages
}

function inferModuleType(name: string, path: string): 'service' | 'store' | 'api' | 'config' | 'shared' | 'module' {
  const nameLower = name.toLowerCase()
  const pathLower = path.toLowerCase()

  if (nameLower.includes('store') || pathLower.includes('store')) return 'store'
  if (nameLower.includes('service') || pathLower.includes('service')) return 'service'
  if (nameLower.includes('api') || nameLower.includes('routes') || nameLower.includes('praxis')) return 'api'
  if (nameLower.includes('config') || nameLower.includes('settings')) return 'config'
  if (nameLower.includes('shared') || nameLower.includes('common') || nameLower.includes('utils')) return 'shared'

  return 'module'
}

function parsePythonClasses(content: string, filePath: string): PythonClass[] {
  const classes: PythonClass[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const classMatch = line.match(/^class\s+(\w+)\s*(?:\(([^)]*)\))?:/)

    if (classMatch) {
      const name = classMatch[1]
      const basesStr = classMatch[2] || ''
      const bases = basesStr.split(',').map((b) => b.trim()).filter(Boolean)

      // Find methods
      const methods: string[] = []
      let j = i + 1
      let indent = ''

      // Get the indentation of class body
      while (j < lines.length) {
        const bodyLine = lines[j]
        if (bodyLine.trim() && !bodyLine.startsWith('#')) {
          indent = bodyLine.match(/^(\s*)/)?.[1] || '    '
          break
        }
        j++
      }

      // Find methods
      while (j < lines.length) {
        const methodLine = lines[j]

        // Check if we've left the class (less indentation)
        if (methodLine.trim() && !methodLine.startsWith(indent) && !methodLine.startsWith('#')) {
          break
        }

        const methodMatch = methodLine.match(/^\s+(?:async\s+)?def\s+(\w+)\s*\(/)
        if (methodMatch) {
          methods.push(methodMatch[1])
        }
        j++
      }

      classes.push({
        name,
        bases,
        methods,
        lineStart: i + 1,
      })
    }
  }

  return classes
}

function inferClassType(cls: PythonClass, filePath: string): 'store' | 'service' | 'adapter' | 'schema' | 'generic' {
  const name = cls.name.toLowerCase()
  const bases = cls.bases.map((b) => b.toLowerCase())
  const path = filePath.toLowerCase()

  if (name.includes('store') || path.includes('store')) return 'store'
  if (name.includes('service') || path.includes('service')) return 'service'
  if (name.includes('adapter') || path.includes('adapter')) return 'adapter'
  if (name.includes('schema') || bases.includes('basemodel') || path.includes('schema')) return 'schema'
  if (bases.some((b) => b.includes('exception'))) return 'generic'

  // If it has significant methods, consider it a service
  if (cls.methods.length >= 3) return 'service'

  return 'generic'
}

function parseFastAPIRoutes(content: string, filePath: string): FastAPIRoute[] {
  const routes: FastAPIRoute[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Match FastAPI route decorators
    const routeMatch = line.match(/@(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/)
    if (routeMatch) {
      const method = routeMatch[1]
      const path = routeMatch[2]

      // Find the function name on the next line(s)
      let functionName = 'unknown'
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const funcMatch = lines[j].match(/(?:async\s+)?def\s+(\w+)\s*\(/)
        if (funcMatch) {
          functionName = funcMatch[1]
          break
        }
      }

      routes.push({
        method,
        path,
        functionName,
        filePath,
        lineStart: i + 1,
      })
    }
  }

  return routes
}

interface StoreInteraction {
  store: string
  operation: 'read' | 'write'
  line: number
  excerpt: string
  confidence: Confidence
}

function parseStoreInteractions(content: string, filePath: string): StoreInteraction[] {
  const interactions: StoreInteraction[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Supabase
    if (line.includes('supabase') && (line.includes('.select(') || line.includes('.from('))) {
      interactions.push({
        store: 'Supabase',
        operation: 'read',
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'high',
      })
    }
    if (line.includes('supabase') && (line.includes('.insert(') || line.includes('.update(') || line.includes('.delete('))) {
      interactions.push({
        store: 'Supabase',
        operation: 'write',
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'high',
      })
    }

    // Neo4j
    if (line.includes('neo4j') || line.includes('graph') || line.includes('cypher')) {
      const isWrite = line.includes('CREATE') || line.includes('MERGE') || line.includes('DELETE') || line.includes('SET')
      interactions.push({
        store: 'Neo4j',
        operation: isWrite ? 'write' : 'read',
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'medium',
      })
    }

    // Pinecone
    if (line.includes('pinecone') || line.includes('vector') || line.includes('embedding')) {
      const isWrite = line.includes('upsert') || line.includes('delete')
      interactions.push({
        store: 'Pinecone',
        operation: isWrite ? 'write' : 'read',
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'medium',
      })
    }

    // Generic database patterns
    if (line.includes('.execute(') || line.includes('.query(')) {
      const isWrite = line.includes('INSERT') || line.includes('UPDATE') || line.includes('DELETE')
      interactions.push({
        store: 'Database',
        operation: isWrite ? 'write' : 'read',
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'low',
      })
    }
  }

  return interactions
}

interface ExternalServiceCall {
  service: string
  domain?: string
  line: number
  excerpt: string
  confidence: Confidence
}

function parseExternalServiceCalls(content: string, filePath: string): ExternalServiceCall[] {
  const calls: ExternalServiceCall[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // OpenAI / Claude / LLM
    if (line.includes('openai') || line.includes('anthropic') || line.includes('claude')) {
      calls.push({
        service: line.includes('claude') || line.includes('anthropic') ? 'Claude' : 'OpenAI',
        domain: line.includes('claude') ? 'api.anthropic.com' : 'api.openai.com',
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'high',
      })
    }

    // Replicate
    if (line.includes('replicate')) {
      calls.push({
        service: 'Replicate',
        domain: 'api.replicate.com',
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        confidence: 'high',
      })
    }

    // HTTP calls
    const httpMatch = line.match(/(?:requests|httpx|aiohttp)\.(?:get|post|put|delete)\s*\(\s*["']([^"']+)["']/)
    if (httpMatch) {
      const url = httpMatch[1]
      try {
        const domain = new URL(url).hostname
        calls.push({
          service: domain,
          domain,
          line: i + 1,
          excerpt: line.trim().slice(0, 200),
          confidence: 'high',
        })
      } catch {
        // Not a valid URL
      }
    }
  }

  return calls
}

function findNodeForFile(nodes: ArchNode[], repoId: string, filePath: string): string | undefined {
  // Try to find the most specific node for this file
  const dirPath = filePath.substring(0, filePath.lastIndexOf('/'))

  // Look for a node matching the directory
  for (const node of nodes) {
    if (node.metadata && (node.metadata as any).appPath === dirPath) {
      return node.id
    }
  }

  // Look for a parent package
  let currentPath = dirPath
  while (currentPath) {
    for (const node of nodes) {
      if (node.metadata && (node.metadata as any).appPath === currentPath) {
        return node.id
      }
    }
    const lastSlash = currentPath.lastIndexOf('/')
    if (lastSlash <= 0) break
    currentPath = currentPath.substring(0, lastSlash)
  }

  return undefined
}

interface PythonDependency {
  name: string
  version?: string
  isDev: boolean
}

function parsePythonDependencies(pyprojectContent: string): PythonDependency[] {
  const deps: PythonDependency[] = []

  // Parse dependencies from [project.dependencies] or [tool.poetry.dependencies]
  const lines = pyprojectContent.split('\n')
  let inDepsSection = false
  let inDevDepsSection = false

  for (const line of lines) {
    if (line.includes('[project.dependencies]') || line.includes('[tool.poetry.dependencies]')) {
      inDepsSection = true
      inDevDepsSection = false
      continue
    }
    if (line.includes('[project.optional-dependencies]') || line.includes('[tool.poetry.dev-dependencies]')) {
      inDepsSection = false
      inDevDepsSection = true
      continue
    }
    if (line.startsWith('[') && !line.includes('dependencies')) {
      inDepsSection = false
      inDevDepsSection = false
      continue
    }

    if (inDepsSection || inDevDepsSection) {
      // Parse dependency line
      const match = line.match(/^\s*"?([a-zA-Z0-9_-]+)"?\s*[>=<~^]*\s*["']?([0-9.]+)?/)
      if (match && match[1] && !match[1].startsWith('#')) {
        deps.push({
          name: match[1],
          version: match[2],
          isDev: inDevDepsSection,
        })
      }
    }
  }

  // Also parse simple requirements-style dependencies
  const depMatches = pyprojectContent.matchAll(/["']([a-zA-Z0-9_-]+)(?:[>=<~^]+)?([0-9.]+)?["']/g)
  for (const match of Array.from(depMatches)) {
    const name = match[1]
    if (!deps.find((d) => d.name === name) && !['python', 'version'].includes(name.toLowerCase())) {
      deps.push({
        name,
        version: match[2],
        isDev: false,
      })
    }
  }

  // Filter to key packages
  const keyPythonPackages = [
    'fastapi', 'django', 'flask', 'starlette',
    'sqlalchemy', 'pydantic', 'pydantic-settings',
    'neo4j', 'pinecone-client', 'pinecone',
    'supabase', 'httpx', 'aiohttp', 'requests',
    'openai', 'anthropic', 'replicate',
    'pytest', 'black', 'ruff', 'mypy',
    'pyjwt', 'python-jose', 'passlib',
    'celery', 'redis', 'boto3',
  ]

  return deps.filter((d) =>
    keyPythonPackages.some((k) => d.name.toLowerCase().includes(k.toLowerCase()))
  )
}

function categorizePythonPackage(name: string): 'framework' | 'database' | 'ui' | 'testing' | 'utility' | 'other' {
  const nameLower = name.toLowerCase()

  if (['fastapi', 'django', 'flask', 'starlette'].some((f) => nameLower.includes(f))) return 'framework'
  if (['sqlalchemy', 'neo4j', 'pinecone', 'supabase', 'redis', 'postgres', 'mysql'].some((d) => nameLower.includes(d))) return 'database'
  if (['pytest', 'unittest', 'black', 'ruff', 'mypy', 'flake8'].some((t) => nameLower.includes(t))) return 'testing'
  if (['pydantic', 'httpx', 'aiohttp', 'requests', 'pyjwt', 'jose', 'passlib'].some((u) => nameLower.includes(u))) return 'utility'

  return 'other'
}

function inferFeatureFromPath(routePath: string, filePath: string): string | undefined {
  const pathLower = routePath.toLowerCase()
  const filePathLower = filePath.toLowerCase()

  if (pathLower.includes('/auth') || filePathLower.includes('auth') || filePathLower.includes('aegis')) return 'authentication'
  if (pathLower.includes('/identity') || filePathLower.includes('identity')) return 'identity-management'
  if (pathLower.includes('/avatar') || pathLower.includes('/generation')) return 'avatar-generation'
  if (pathLower.includes('/connection') || filePathLower.includes('connection')) return 'connections'
  if (pathLower.includes('/user')) return 'users'
  if (pathLower.includes('/bio') || pathLower.includes('/synthesis')) return 'ai-content'

  return undefined
}
