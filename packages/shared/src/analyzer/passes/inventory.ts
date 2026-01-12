// Pass 1: Inventory & Metadata Analysis
// Detects repo types, frameworks, and creates repo/app nodes

import type {
  AnalysisContext,
  AnalyzerPassResult,
  RepoNode,
  AppNode,
  PackageNode,
  Evidence,
} from '../../types/architecture'
import { generateNodeId, generateEvidenceId } from '../utils/ids'

interface PackageJson {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

interface DetectedApp {
  path: string
  framework: string
  hasApiRoutes: boolean
  hasPages: boolean
}

/**
 * Analyze repository inventory and metadata
 * Creates repo nodes, app nodes, and package nodes
 */
export async function analyzeInventory(
  context: AnalysisContext
): Promise<AnalyzerPassResult> {
  const nodes: AnalyzerPassResult['nodes'] = []
  const edges: AnalyzerPassResult['edges'] = []
  const evidence: Evidence[] = []

  for (const repo of context.repos) {
    // Create repo node
    const repoNodeId = generateNodeId('repo', repo.id)
    const framework = detectFramework(repo, context.existingChunks)

    const repoNode: RepoNode = {
      id: repoNodeId,
      type: 'repo',
      label: `${repo.owner}/${repo.name}`,
      metadata: {
        owner: repo.owner,
        name: repo.name,
        provider: repo.provider,
        defaultBranch: repo.defaultBranch,
        framework,
        language: detectLanguage(repo),
      },
    }
    nodes.push(repoNode)

    // Detect apps within the repo
    const apps = detectApps(repo, context.existingChunks)

    for (const app of apps) {
      const appNodeId = generateNodeId('app', repo.id, app.path)
      const appNode: AppNode = {
        id: appNodeId,
        type: 'app',
        label: app.path || repo.name,
        repoId: repoNodeId,
        metadata: {
          repoId: repo.id,
          appPath: app.path,
          framework: app.framework,
          hasApiRoutes: app.hasApiRoutes,
          hasPages: app.hasPages,
        },
      }
      nodes.push(appNode)

      // Create contains edge: repo -> app
      edges.push({
        id: `${repoNodeId}_contains_${appNodeId}`,
        source: repoNodeId,
        target: appNodeId,
        type: 'contains',
        confidence: 'high',
        evidenceIds: [],
        metadata: {},
      })

      // Create evidence for app detection
      const packageJsonPath = app.path
        ? `${app.path}/package.json`
        : 'package.json'
      const packageJsonFile = repo.files.find((f) => f.path === packageJsonPath)
      if (packageJsonFile) {
        evidence.push({
          id: generateEvidenceId('PACKAGE_DEP', appNodeId, packageJsonPath),
          kind: 'PACKAGE_DEP',
          nodeId: appNodeId,
          repoId: repo.id,
          filePath: packageJsonPath,
          symbol: 'package.json',
          confidence: 'high',
          metadata: { framework: app.framework },
        })
      }
    }

    // Analyze dependencies if requested
    const packageNodes = analyzePackages(repo, context.existingChunks, repoNodeId)
    for (const pkg of packageNodes.nodes) {
      nodes.push(pkg)
    }
    for (const edge of packageNodes.edges) {
      edges.push(edge)
    }
    evidence.push(...packageNodes.evidence)
  }

  return { nodes, edges, evidence }
}

function detectFramework(
  repo: AnalysisContext['repos'][0],
  chunks: Map<string, string>
): string | undefined {
  // Check for common framework indicators
  const hasNextConfig = repo.files.some(
    (f) =>
      f.path === 'next.config.js' ||
      f.path === 'next.config.mjs' ||
      f.path === 'next.config.ts'
  )
  if (hasNextConfig) return 'next'

  // Check package.json
  const packageJsonFile = repo.files.find((f) => f.path === 'package.json')
  if (packageJsonFile) {
    const content = chunks.get(packageJsonFile.path)
    if (content) {
      try {
        const pkg = JSON.parse(content) as PackageJson
        const deps = { ...pkg.dependencies, ...pkg.devDependencies }
        if (deps['next']) return 'next'
        if (deps['express']) return 'express'
        if (deps['fastify']) return 'fastify'
        if (deps['@nestjs/core']) return 'nestjs'
        if (deps['react'] && !deps['next']) return 'react'
        if (deps['vue']) return 'vue'
        if (deps['svelte']) return 'svelte'
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Check for other indicators
  if (repo.files.some((f) => f.path === 'manage.py')) return 'django'
  if (repo.files.some((f) => f.path === 'requirements.txt')) return 'python'
  if (repo.files.some((f) => f.path === 'go.mod')) return 'go'
  if (repo.files.some((f) => f.path === 'Cargo.toml')) return 'rust'

  return undefined
}

function detectLanguage(repo: AnalysisContext['repos'][0]): string {
  const langCounts: Record<string, number> = {}

  for (const file of repo.files) {
    const lang = file.language || getLanguageFromPath(file.path)
    if (lang) {
      langCounts[lang] = (langCounts[lang] || 0) + 1
    }
  }

  // Return the most common language
  let maxLang = 'unknown'
  let maxCount = 0
  for (const [lang, count] of Object.entries(langCounts)) {
    if (count > maxCount) {
      maxLang = lang
      maxCount = count
    }
  }

  return maxLang
}

function getLanguageFromPath(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    rb: 'ruby',
    php: 'php',
    cs: 'csharp',
    cpp: 'cpp',
    c: 'c',
    sql: 'sql',
    md: 'markdown',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
  }
  return ext ? langMap[ext] : undefined
}

function detectApps(
  repo: AnalysisContext['repos'][0],
  chunks: Map<string, string>
): DetectedApp[] {
  const apps: DetectedApp[] = []

  // Check for monorepo patterns (apps/*, packages/*)
  const appDirs = new Set<string>()

  for (const file of repo.files) {
    const match = file.path.match(/^(apps|packages)\/([^/]+)\//)
    if (match) {
      appDirs.add(`${match[1]}/${match[2]}`)
    }
  }

  if (appDirs.size > 0) {
    // Monorepo structure
    for (const appPath of Array.from(appDirs)) {
      const appFiles = repo.files.filter((f) => f.path.startsWith(appPath + '/'))
      const hasApiRoutes = appFiles.some((f) => f.path.includes('/api/'))
      const hasPages = appFiles.some((f) =>
        f.path.includes('/page.tsx') || f.path.includes('/page.ts')
      )

      // Detect framework for this app
      const packageJsonPath = `${appPath}/package.json`
      let framework = 'unknown'
      const pkgContent = chunks.get(packageJsonPath)
      if (pkgContent) {
        try {
          const pkg = JSON.parse(pkgContent) as PackageJson
          const deps = { ...pkg.dependencies, ...pkg.devDependencies }
          if (deps['next']) framework = 'next'
          else if (deps['express']) framework = 'express'
          else if (deps['react']) framework = 'react'
        } catch {
          // Ignore parse errors
        }
      }

      apps.push({
        path: appPath,
        framework,
        hasApiRoutes,
        hasPages,
      })
    }
  } else {
    // Single app at root
    const hasApiRoutes = repo.files.some((f) => f.path.includes('/api/'))
    const hasPages = repo.files.some(
      (f) => f.path.includes('/page.tsx') || f.path.includes('/page.ts')
    )

    let framework = detectFramework(repo, chunks) || 'unknown'

    apps.push({
      path: '',
      framework,
      hasApiRoutes,
      hasPages,
    })
  }

  return apps
}

function analyzePackages(
  repo: AnalysisContext['repos'][0],
  chunks: Map<string, string>,
  repoNodeId: string
): AnalyzerPassResult {
  const nodes: AnalyzerPassResult['nodes'] = []
  const edges: AnalyzerPassResult['edges'] = []
  const evidence: Evidence[] = []

  const packageJsonFile = repo.files.find((f) => f.path === 'package.json')
  if (!packageJsonFile) return { nodes, edges, evidence }

  const content = chunks.get(packageJsonFile.path)
  if (!content) return { nodes, edges, evidence }

  try {
    const pkg = JSON.parse(content) as PackageJson
    const deps = pkg.dependencies || {}
    const devDeps = pkg.devDependencies || {}

    // Key packages to track
    const keyPackages = [
      '@supabase/supabase-js',
      '@supabase/ssr',
      'next',
      'react',
      'express',
      'fastify',
      '@radix-ui/react-dialog',
      'tailwindcss',
      'openai',
      'zod',
    ]

    for (const pkgName of keyPackages) {
      const version = deps[pkgName] || devDeps[pkgName]
      if (version) {
        const nodeId = generateNodeId('package', repo.id, pkgName)
        const category = categorizePackage(pkgName)

        const packageNode: PackageNode = {
          id: nodeId,
          type: 'package',
          label: pkgName,
          repoId: repoNodeId,
          metadata: {
            name: pkgName,
            version: version.replace(/^\^|~/, ''),
            isDevDep: !!devDeps[pkgName],
            category,
          },
        }
        nodes.push(packageNode)

        // Create depends_on edge
        edges.push({
          id: `${repoNodeId}_depends_on_${nodeId}`,
          source: repoNodeId,
          target: nodeId,
          type: 'depends_on',
          confidence: 'high',
          evidenceIds: [],
          metadata: {},
        })

        evidence.push({
          id: generateEvidenceId('PACKAGE_DEP', nodeId, packageJsonFile.path),
          kind: 'PACKAGE_DEP',
          nodeId,
          repoId: repo.id,
          filePath: packageJsonFile.path,
          symbol: pkgName,
          excerpt: `"${pkgName}": "${version}"`,
          confidence: 'high',
          metadata: {},
        })
      }
    }
  } catch {
    // Ignore parse errors
  }

  return { nodes, edges, evidence }
}

function categorizePackage(name: string): PackageNode['metadata']['category'] {
  if (name.includes('supabase')) return 'database'
  if (name === 'next' || name === 'express' || name === 'fastify') return 'framework'
  if (name.includes('radix') || name.includes('tailwind')) return 'ui'
  if (name.includes('vitest') || name.includes('jest')) return 'testing'
  if (name === 'zod' || name === 'date-fns' || name === 'clsx') return 'utility'
  return 'other'
}
