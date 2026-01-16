/**
 * Vercel Service Adapter
 * Connects to Vercel and discovers projects, deployments, domains, and env vars
 */

import type {
  VercelConfig,
  VercelSecrets,
  VercelSyncStats,
  VercelProjectAssetData,
  DeploymentAssetData,
  DomainAssetData,
  EnvVarAssetData,
} from '@/lib/supabase/supabase-service-types'
import type { ServiceAdapter, ValidationResult, SyncResult, DiscoveredAsset } from './types'

const VERCEL_API_BASE = 'https://api.vercel.com'
const MAX_DEPLOYMENTS_PER_PROJECT = 10

interface VercelProject {
  id: string
  name: string
  framework?: string
  link?: {
    type: string
    repo: string
  }
}

interface VercelDeployment {
  uid: string
  name: string
  url: string
  state: string
  created: number
  ready?: number
  source?: string
  target?: string
}

interface VercelDomain {
  name: string
  projectId: string
  verified: boolean
  configured: boolean
}

interface VercelEnvVar {
  key: string
  target: string[]
  type: string
  id: string
}

interface VercelTeam {
  id: string
  slug: string
  name: string
}

export class VercelAdapter implements ServiceAdapter<VercelConfig, VercelSecrets, VercelSyncStats> {
  readonly serviceType = 'vercel' as const

  /**
   * Validate the Vercel connection
   */
  async validateConnection(
    config: VercelConfig,
    secrets: VercelSecrets
  ): Promise<ValidationResult> {
    const token = secrets.token || secrets.access_token
    if (!token) {
      return {
        valid: false,
        error: 'Vercel token is required',
      }
    }

    try {
      // Verify token by fetching user info
      const response = await this.fetch('/v2/user', token)

      if (!response.ok) {
        if (response.status === 401) {
          return {
            valid: false,
            error: 'Invalid Vercel token. Please check your credentials.',
          }
        }
        const errorData = await response.json().catch(() => ({}))
        return {
          valid: false,
          error: `Vercel API error: ${(errorData as { error?: { message?: string } }).error?.message || response.statusText}`,
        }
      }

      const userData = await response.json() as { user: { username: string; name: string } }

      // If team_id is specified, verify access to that team
      if (config.team_id) {
        const teamResponse = await this.fetch(`/v2/teams/${config.team_id}`, token)
        if (!teamResponse.ok) {
          return {
            valid: false,
            error: 'Cannot access the specified team. Please check your permissions.',
          }
        }
      }

      return {
        valid: true,
        metadata: {
          username: userData.user.username,
          name: userData.user.name,
          team_id: config.team_id,
          validated_at: new Date().toISOString(),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[VercelAdapter] Validation error:', this.redact({ error: message }))

      return {
        valid: false,
        error: `Connection failed: ${message}`,
      }
    }
  }

  /**
   * Sync all Vercel assets
   */
  async sync(config: VercelConfig, secrets: VercelSecrets): Promise<SyncResult> {
    const assets: DiscoveredAsset[] = []
    const stats: VercelSyncStats = {
      projects: 0,
      deployments: 0,
      domains: 0,
      env_vars: 0,
    }

    const token = secrets.token || secrets.access_token
    if (!token) {
      return {
        success: false,
        assets,
        stats,
        error: 'Vercel token is required',
      }
    }

    try {
      // Fetch projects
      const projects = await this.fetchProjects(token, config.team_id, config.project_ids)
      stats.projects = projects.length

      for (const project of projects) {
        // Add project asset
        const projectData: VercelProjectAssetData = {
          id: project.id,
          name: project.name,
          framework: project.framework,
          git_repo: project.link
            ? {
                repo: project.link.repo,
                type: project.link.type,
              }
            : undefined,
        }

        assets.push({
          asset_type: 'vercel_project',
          asset_key: `vercel:${project.id}`,
          name: project.name,
          data_json: projectData as unknown as Record<string, unknown>,
        })

        // Fetch deployments for this project
        const deployments = await this.fetchDeployments(
          token,
          project.id,
          config.team_id
        )
        stats.deployments += deployments.length

        for (const deployment of deployments) {
          const deploymentData: DeploymentAssetData = {
            id: deployment.uid,
            name: deployment.name,
            url: deployment.url,
            state: deployment.state,
            created_at: new Date(deployment.created).toISOString(),
            ready: deployment.ready ? new Date(deployment.ready).toISOString() : undefined,
            target: deployment.target,
          }

          assets.push({
            asset_type: 'deployment',
            asset_key: `deployment:${deployment.uid}`,
            name: `${project.name}@${deployment.uid.slice(0, 8)}`,
            data_json: deploymentData as unknown as Record<string, unknown>,
          })
        }

        // Fetch domains for this project
        const domains = await this.fetchDomains(token, project.id, config.team_id)
        stats.domains += domains.length

        for (const domain of domains) {
          const domainData: DomainAssetData = {
            name: domain.name,
            project_id: domain.projectId,
            verified: domain.verified,
            configured: domain.configured,
          }

          assets.push({
            asset_type: 'domain',
            asset_key: `domain:${domain.name}`,
            name: domain.name,
            data_json: domainData as unknown as Record<string, unknown>,
          })
        }

        // Fetch env vars for this project (names only!)
        const envVars = await this.fetchEnvVars(token, project.id, config.team_id)
        stats.env_vars += envVars.length

        for (const envVar of envVars) {
          const envVarData: EnvVarAssetData = {
            key: envVar.key,
            target: envVar.target,
            type: envVar.type,
            // Note: We NEVER store the value!
          }

          assets.push({
            asset_type: 'env_var',
            asset_key: `env:${project.id}:${envVar.key}`,
            name: envVar.key,
            data_json: envVarData as unknown as Record<string, unknown>,
          })
        }
      }

      console.log('[VercelAdapter] Sync completed:', this.redact({ stats }))

      return {
        success: true,
        assets,
        stats,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[VercelAdapter] Sync error:', this.redact({ error: message }))

      return {
        success: false,
        assets,
        stats,
        error: message,
      }
    }
  }

  /**
   * Redact sensitive information for safe logging
   */
  redact<T extends Record<string, unknown>>(obj: T): T {
    const redacted = { ...obj }
    const sensitiveKeys = ['token', 'secret', 'password', 'apiKey', 'api_key', 'bearer', 'authorization']

    for (const key of Object.keys(redacted)) {
      if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
        redacted[key as keyof T] = '[REDACTED]' as T[keyof T]
      } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
        redacted[key as keyof T] = this.redact(redacted[key] as Record<string, unknown>) as T[keyof T]
      }
    }

    return redacted
  }

  /**
   * Make an authenticated request to the Vercel API
   */
  private async fetch(path: string, token: string, teamId?: string): Promise<Response> {
    const url = new URL(`${VERCEL_API_BASE}${path}`)
    if (teamId) {
      url.searchParams.set('teamId', teamId)
    }

    return fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
  }

  /**
   * Fetch projects from Vercel
   */
  private async fetchProjects(
    token: string,
    teamId?: string,
    projectIds?: string[]
  ): Promise<VercelProject[]> {
    const response = await this.fetch('/v9/projects', token, teamId)

    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.statusText}`)
    }

    const data = await response.json() as { projects: VercelProject[] }
    let projects = data.projects || []

    // Filter to specific projects if requested
    if (projectIds && projectIds.length > 0) {
      projects = projects.filter((p) => projectIds.includes(p.id))
    }

    return projects
  }

  /**
   * Fetch recent deployments for a project
   */
  private async fetchDeployments(
    token: string,
    projectId: string,
    teamId?: string
  ): Promise<VercelDeployment[]> {
    const url = `/v6/deployments?projectId=${projectId}&limit=${MAX_DEPLOYMENTS_PER_PROJECT}`
    const response = await this.fetch(url, token, teamId)

    if (!response.ok) {
      console.log(`[VercelAdapter] Could not fetch deployments for project ${projectId}`)
      return []
    }

    const data = await response.json() as { deployments: VercelDeployment[] }
    return data.deployments || []
  }

  /**
   * Fetch domains for a project
   */
  private async fetchDomains(
    token: string,
    projectId: string,
    teamId?: string
  ): Promise<VercelDomain[]> {
    const response = await this.fetch(`/v9/projects/${projectId}/domains`, token, teamId)

    if (!response.ok) {
      console.log(`[VercelAdapter] Could not fetch domains for project ${projectId}`)
      return []
    }

    const data = await response.json() as { domains: VercelDomain[] }
    return data.domains || []
  }

  /**
   * Fetch environment variable names (not values!) for a project
   */
  private async fetchEnvVars(
    token: string,
    projectId: string,
    teamId?: string
  ): Promise<VercelEnvVar[]> {
    const response = await this.fetch(`/v9/projects/${projectId}/env`, token, teamId)

    if (!response.ok) {
      console.log(`[VercelAdapter] Could not fetch env vars for project ${projectId}`)
      return []
    }

    const data = await response.json() as { envs: VercelEnvVar[] }
    return data.envs || []
  }

  /**
   * Fetch available teams for the user (for UI selection)
   */
  async fetchTeams(token: string): Promise<VercelTeam[]> {
    const response = await this.fetch('/v2/teams', token)

    if (!response.ok) {
      return []
    }

    const data = await response.json() as { teams: VercelTeam[] }
    return data.teams || []
  }

  /**
   * Fetch available projects for a team (for UI selection)
   */
  async fetchProjectsForSelection(
    token: string,
    teamId?: string
  ): Promise<Array<{ id: string; name: string }>> {
    const projects = await this.fetchProjects(token, teamId)
    return projects.map((p) => ({ id: p.id, name: p.name }))
  }
}

/**
 * Factory function to create a new VercelAdapter instance
 */
export function createVercelAdapter(): VercelAdapter {
  return new VercelAdapter()
}
