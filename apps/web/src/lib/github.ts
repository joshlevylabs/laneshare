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
}
