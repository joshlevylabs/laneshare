import { decrypt } from './encryption'

export interface GitHubRepo {
  id: number
  name: string
  full_name: string
  owner: {
    login: string
  }
  default_branch: string
  private: boolean
}

export interface GitHubTreeItem {
  path: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

export interface GitHubFile {
  path: string
  sha: string
  content: string
  encoding: string
  size: number
}

export interface GitHubBranch {
  name: string
  commit: {
    sha: string
    url: string
  }
  protected: boolean
}

export interface GitHubCommit {
  sha: string
  commit: {
    message: string
    author: {
      name: string
      email: string
      date: string
    }
  }
}

export interface GitHubWebhook {
  id: number
  name: string
  active: boolean
  events: string[]
  config: {
    url: string
    content_type: string
  }
}

export interface GitHubCodespace {
  id: number
  name: string
  display_name: string | null
  state: 'Unknown' | 'Created' | 'Queued' | 'Provisioning' | 'Available' | 'Awaiting' | 'Unavailable' | 'Deleted' | 'Moved' | 'Shutdown' | 'Archived' | 'Starting' | 'ShuttingDown' | 'Failed' | 'Exporting' | 'Updating' | 'Rebuilding'
  owner: {
    login: string
  }
  repository: {
    id: number
    full_name: string
    owner: {
      login: string
    }
    name: string
  }
  machine: {
    name: string
    display_name: string
    operating_system: string
    storage_in_bytes: number
    memory_in_bytes: number
    cpus: number
  } | null
  created_at: string
  updated_at: string
  last_used_at: string
  web_url: string
  machines_url: string
  git_status: {
    ahead: number
    behind: number
    has_unpushed_changes: boolean
    has_uncommitted_changes: boolean
    ref: string
  }
  location: string
  idle_timeout_minutes: number
  retention_period_minutes: number | null
}

export interface GitHubCodespaceMachine {
  name: string
  display_name: string
  operating_system: string
  storage_in_bytes: number
  memory_in_bytes: number
  cpus: number
  prebuild_availability: 'none' | 'ready' | 'in_progress'
}

export interface CreateCodespaceOptions {
  ref?: string
  machine?: string
  location?: string
  idle_timeout_minutes?: number
  display_name?: string
  working_directory?: string
}

export class GitHubClient {
  private token: string
  private baseUrl = 'https://api.github.com'

  constructor(token: string) {
    this.token = token
  }

  static async fromEncryptedToken(encryptedToken: string): Promise<GitHubClient> {
    const token = await decrypt(encryptedToken)
    return new GitHubClient(token)
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...options?.headers,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`GitHub API error: ${response.status} - ${error}`)
    }

    return response.json()
  }

  async getUser(): Promise<{ login: string; email: string }> {
    return this.request('/user')
  }

  async listRepos(options?: {
    visibility?: 'all' | 'public' | 'private'
    sort?: 'created' | 'updated' | 'pushed' | 'full_name'
    per_page?: number
    page?: number
  }): Promise<GitHubRepo[]> {
    const params = new URLSearchParams()
    if (options?.visibility) params.set('visibility', options.visibility)
    if (options?.sort) params.set('sort', options.sort)
    if (options?.per_page) params.set('per_page', options.per_page.toString())
    if (options?.page) params.set('page', options.page.toString())

    const query = params.toString()
    return this.request(`/user/repos${query ? `?${query}` : ''}`)
  }

  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    return this.request(`/repos/${owner}/${repo}`)
  }

  async getTree(
    owner: string,
    repo: string,
    branch: string,
    recursive = true
  ): Promise<{ tree: GitHubTreeItem[] }> {
    const url = `/repos/${owner}/${repo}/git/trees/${branch}${recursive ? '?recursive=1' : ''}`
    return this.request(url)
  }

  async getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<GitHubFile> {
    const url = `/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${ref}` : ''}`
    return this.request(url)
  }

  async getBlob(owner: string, repo: string, sha: string): Promise<{ content: string; encoding: string; size: number }> {
    return this.request(`/repos/${owner}/${repo}/git/blobs/${sha}`)
  }

  decodeContent(content: string, encoding: string): string {
    if (encoding === 'base64') {
      return Buffer.from(content, 'base64').toString('utf-8')
    }
    return content
  }

  /**
   * Get file content by path and branch, returning decoded text content
   */
  async getFileContentDecoded(owner: string, repo: string, path: string, branch: string): Promise<string | null> {
    try {
      const file = await this.getFileContent(owner, repo, path, branch)
      return this.decodeContent(file.content, file.encoding)
    } catch (error) {
      console.warn(`[GitHub] Failed to get ${path}:`, error)
      return null
    }
  }

  async listBranches(owner: string, repo: string): Promise<GitHubBranch[]> {
    return this.request(`/repos/${owner}/${repo}/branches`)
  }

  async getLatestCommit(owner: string, repo: string, branch: string): Promise<GitHubCommit> {
    return this.request(`/repos/${owner}/${repo}/commits/${branch}`)
  }

  async createWebhook(
    owner: string,
    repo: string,
    webhookUrl: string,
    secret: string,
    events: string[] = ['push']
  ): Promise<GitHubWebhook> {
    return this.request(`/repos/${owner}/${repo}/hooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'web',
        active: true,
        events,
        config: {
          url: webhookUrl,
          content_type: 'json',
          secret,
          insecure_ssl: '0',
        },
      }),
    })
  }

  async deleteWebhook(owner: string, repo: string, hookId: number): Promise<void> {
    await fetch(`${this.baseUrl}/repos/${owner}/${repo}/hooks/${hookId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  }

  // ===== Codespaces API =====

  /**
   * List all codespaces for the authenticated user
   */
  async listCodespaces(): Promise<{ total_count: number; codespaces: GitHubCodespace[] }> {
    return this.request('/user/codespaces')
  }

  /**
   * List codespaces for a specific repository
   */
  async listRepoCodespaces(owner: string, repo: string): Promise<{ total_count: number; codespaces: GitHubCodespace[] }> {
    return this.request(`/repos/${owner}/${repo}/codespaces`)
  }

  /**
   * Get a specific codespace by name
   */
  async getCodespace(codespaceName: string): Promise<GitHubCodespace> {
    return this.request(`/user/codespaces/${codespaceName}`)
  }

  /**
   * Create a new codespace for a repository
   */
  async createCodespace(owner: string, repo: string, options: CreateCodespaceOptions = {}): Promise<GitHubCodespace> {
    return this.request(`/repos/${owner}/${repo}/codespaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: options.ref,
        machine: options.machine,
        location: options.location,
        idle_timeout_minutes: options.idle_timeout_minutes,
        display_name: options.display_name,
        working_directory: options.working_directory,
      }),
    })
  }

  /**
   * Start a stopped codespace
   */
  async startCodespace(codespaceName: string): Promise<GitHubCodespace> {
    return this.request(`/user/codespaces/${codespaceName}/start`, {
      method: 'POST',
    })
  }

  /**
   * Stop a running codespace
   */
  async stopCodespace(codespaceName: string): Promise<GitHubCodespace> {
    return this.request(`/user/codespaces/${codespaceName}/stop`, {
      method: 'POST',
    })
  }

  /**
   * Delete a codespace
   */
  async deleteCodespace(codespaceName: string): Promise<void> {
    await fetch(`${this.baseUrl}/user/codespaces/${codespaceName}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  }

  /**
   * List available machine types for a repository codespace
   */
  async listCodespaceMachines(owner: string, repo: string): Promise<{ total_count: number; machines: GitHubCodespaceMachine[] }> {
    return this.request(`/repos/${owner}/${repo}/codespaces/machines`)
  }

  /**
   * Export a codespace (creates a branch with the current state)
   */
  async exportCodespace(codespaceName: string): Promise<{ id: string; state: string; branch: string | null; sha: string | null; export_url: string }> {
    return this.request(`/user/codespaces/${codespaceName}/exports`, {
      method: 'POST',
    })
  }
}
