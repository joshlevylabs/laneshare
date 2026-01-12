// Pass 5: Deployment & External Services Analysis
// Detects Vercel configuration and external service integrations

import type {
  AnalysisContext,
  AnalyzerPassResult,
  DeploymentNode,
  ExternalServiceNode,
  Evidence,
} from '../../types/architecture'
import { generateNodeId, generateEvidenceId, generateEdgeId } from '../utils/ids'

interface VercelConfig {
  framework?: string
  buildCommand?: string
  outputDirectory?: string
  regions?: string[]
  functions?: Record<string, unknown>
  env?: string[]
}

interface EnvMapping {
  name: string
  service: string
  domain?: string
}

/**
 * Analyze deployment configuration and external services
 * Creates deployment and external service nodes
 */
export async function analyzeDeployment(
  context: AnalysisContext
): Promise<AnalyzerPassResult> {
  const nodes: AnalyzerPassResult['nodes'] = []
  const edges: AnalyzerPassResult['edges'] = []
  const evidence: Evidence[] = []

  for (const repo of context.repos) {
    const repoNodeId = generateNodeId('repo', repo.id)

    // Check for Vercel configuration
    const vercelJsonFile = repo.files.find((f) => f.path === 'vercel.json')
    const hasNextConfig = repo.files.some(
      (f) => f.path.match(/next\.config\.(js|mjs|ts)$/)
    )

    // Create Vercel deployment node if applicable
    if (vercelJsonFile || hasNextConfig) {
      const deployNodeId = generateNodeId('deployment', repo.id, 'vercel')

      // Parse vercel.json if exists
      let vercelConfig: VercelConfig = {}
      if (vercelJsonFile) {
        const content = context.existingChunks.get(vercelJsonFile.path)
        if (content) {
          try {
            vercelConfig = JSON.parse(content)
          } catch {
            // Invalid JSON
          }
        }
      }

      // Collect env vars from code
      const envVars = collectEnvVars(repo, context.existingChunks)

      const deployNode: DeploymentNode = {
        id: deployNodeId,
        type: 'deployment',
        label: 'Vercel',
        repoId: repoNodeId,
        metadata: {
          platform: 'vercel',
          region: vercelConfig.regions?.[0],
          envVars,
        },
      }
      nodes.push(deployNode)

      // Create deploys_to edge from app to deployment
      const appNodeId = generateNodeId('app', repo.id, '')
      edges.push({
        id: generateEdgeId(appNodeId, deployNodeId, 'deploys_to'),
        source: appNodeId,
        target: deployNodeId,
        type: 'deploys_to',
        confidence: 'high',
        evidenceIds: [],
        metadata: {},
      })

      // Add evidence
      if (vercelJsonFile) {
        evidence.push({
          id: generateEvidenceId('VERCEL_CONFIG', deployNodeId, vercelJsonFile.path),
          kind: 'VERCEL_CONFIG',
          nodeId: deployNodeId,
          repoId: repo.id,
          filePath: vercelJsonFile.path,
          symbol: 'vercel.json',
          excerpt: context.existingChunks.get(vercelJsonFile.path)?.slice(0, 300),
          confidence: 'high',
          metadata: { ...vercelConfig } as Record<string, unknown>,
        })
      }

      // Create external service nodes from env var patterns
      const serviceNodes = detectExternalServices(envVars, repo.id)
      for (const serviceNode of serviceNodes) {
        if (!nodes.find((n) => n.id === serviceNode.node.id)) {
          nodes.push(serviceNode.node)
        }

        // Create edge from deployment to service
        edges.push({
          id: generateEdgeId(deployNodeId, serviceNode.node.id, 'calls_external'),
          source: deployNodeId,
          target: serviceNode.node.id,
          type: 'calls_external',
          confidence: serviceNode.confidence,
          evidenceIds: [],
          metadata: { envVar: serviceNode.envVar },
        })

        evidence.push({
          id: generateEvidenceId('ENV_VAR', serviceNode.node.id),
          kind: 'ENV_VAR',
          nodeId: serviceNode.node.id,
          symbol: serviceNode.envVar,
          confidence: serviceNode.confidence,
          metadata: { service: serviceNode.service },
        })
      }
    }

    // Look for .env.example or .env.local to discover env vars
    const envExampleFile = repo.files.find(
      (f) => f.path === '.env.example' || f.path === '.env.local.example'
    )
    if (envExampleFile) {
      const content = context.existingChunks.get(envExampleFile.path)
      if (content) {
        evidence.push({
          id: generateEvidenceId('ENV_VAR', 'env-example', envExampleFile.path),
          kind: 'ENV_VAR',
          nodeId: 'config',
          repoId: repo.id,
          filePath: envExampleFile.path,
          symbol: '.env.example',
          excerpt: content.slice(0, 500),
          confidence: 'high',
          metadata: { envVars: parseEnvFile(content) },
        })
      }
    }
  }

  // Create Supabase external service node if detected
  const supabaseNode = createSupabaseServiceNode(context)
  if (supabaseNode) {
    if (!nodes.find((n) => n.id === supabaseNode.id)) {
      nodes.push(supabaseNode)
    }
  }

  // Create OpenAI service node if detected
  const openaiNode = createOpenAIServiceNode(context)
  if (openaiNode) {
    if (!nodes.find((n) => n.id === openaiNode.id)) {
      nodes.push(openaiNode)
    }
  }

  return { nodes, edges, evidence }
}

function collectEnvVars(
  repo: AnalysisContext['repos'][0],
  chunks: Map<string, string>
): string[] {
  const envVars = new Set<string>()

  // Check common config files
  const configFiles = repo.files.filter(
    (f) =>
      f.path.includes('.env') ||
      f.path.includes('next.config') ||
      f.path.includes('lib/') ||
      f.path.includes('utils/')
  )

  for (const file of configFiles) {
    const content = chunks.get(file.path)
    if (content) {
      // Match process.env.VAR_NAME
      const matches = Array.from(content.matchAll(/process\.env\.(\w+)/g))
      for (const match of matches) {
        envVars.add(match[1])
      }

      // Match NEXT_PUBLIC_ vars
      const publicMatches = Array.from(content.matchAll(/NEXT_PUBLIC_(\w+)/g))
      for (const match of publicMatches) {
        envVars.add(`NEXT_PUBLIC_${match[1]}`)
      }
    }
  }

  return Array.from(envVars).sort()
}

interface ServiceDetection {
  node: ExternalServiceNode
  envVar: string
  service: string
  confidence: 'high' | 'medium' | 'low'
}

function detectExternalServices(envVars: string[], repoId: string): ServiceDetection[] {
  const services: ServiceDetection[] = []

  const servicePatterns: Array<{
    pattern: RegExp
    service: string
    domain: string
    apiType: 'rest' | 'graphql' | 'grpc' | 'unknown'
  }> = [
    {
      pattern: /SUPABASE.*URL/i,
      service: 'supabase',
      domain: 'supabase.co',
      apiType: 'rest',
    },
    {
      pattern: /OPENAI.*KEY/i,
      service: 'openai',
      domain: 'api.openai.com',
      apiType: 'rest',
    },
    {
      pattern: /STRIPE.*KEY/i,
      service: 'stripe',
      domain: 'api.stripe.com',
      apiType: 'rest',
    },
    {
      pattern: /GITHUB.*TOKEN|GITHUB.*CLIENT/i,
      service: 'github',
      domain: 'api.github.com',
      apiType: 'rest',
    },
    {
      pattern: /SENDGRID.*KEY/i,
      service: 'sendgrid',
      domain: 'api.sendgrid.com',
      apiType: 'rest',
    },
    {
      pattern: /SLACK.*TOKEN/i,
      service: 'slack',
      domain: 'api.slack.com',
      apiType: 'rest',
    },
    {
      pattern: /AWS.*KEY|S3.*KEY/i,
      service: 'aws',
      domain: 'amazonaws.com',
      apiType: 'rest',
    },
    {
      pattern: /REDIS.*URL/i,
      service: 'redis',
      domain: 'redis',
      apiType: 'unknown',
    },
    {
      pattern: /SENTRY.*DSN/i,
      service: 'sentry',
      domain: 'sentry.io',
      apiType: 'rest',
    },
  ]

  for (const envVar of envVars) {
    for (const sp of servicePatterns) {
      if (sp.pattern.test(envVar)) {
        const nodeId = generateNodeId('external_service', sp.service)

        services.push({
          node: {
            id: nodeId,
            type: 'external_service',
            label: sp.service.charAt(0).toUpperCase() + sp.service.slice(1),
            metadata: {
              domain: sp.domain,
              apiType: sp.apiType,
              envVar,
            },
          },
          envVar,
          service: sp.service,
          confidence: 'high',
        })
        break // Don't duplicate for same service
      }
    }
  }

  return services
}

function createSupabaseServiceNode(context: AnalysisContext): ExternalServiceNode | null {
  // Check if any repo uses Supabase
  for (const repo of context.repos) {
    const packageJson = context.existingChunks.get('package.json') ||
      context.existingChunks.get('apps/web/package.json')

    if (packageJson?.includes('@supabase/supabase-js')) {
      return {
        id: generateNodeId('external_service', 'supabase-platform'),
        type: 'external_service',
        label: 'Supabase Platform',
        metadata: {
          domain: 'supabase.co',
          apiType: 'rest',
          envVar: 'NEXT_PUBLIC_SUPABASE_URL',
        },
      }
    }
  }

  return null
}

function createOpenAIServiceNode(context: AnalysisContext): ExternalServiceNode | null {
  for (const repo of context.repos) {
    const packageJson = context.existingChunks.get('package.json') ||
      context.existingChunks.get('apps/web/package.json')

    if (packageJson?.includes('openai')) {
      return {
        id: generateNodeId('external_service', 'openai'),
        type: 'external_service',
        label: 'OpenAI API',
        metadata: {
          domain: 'api.openai.com',
          apiType: 'rest',
          envVar: 'OPENAI_API_KEY',
        },
      }
    }
  }

  return null
}

function parseEnvFile(content: string): string[] {
  const envVars: string[] = []
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=/)
      if (match) {
        envVars.push(match[1])
      }
    }
  }

  return envVars
}
