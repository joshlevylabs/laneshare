/**
 * GitHub Code Editor
 *
 * Provides code editing capabilities for GitHub repositories:
 * - Branch management (create, delete)
 * - File operations (create, update, delete)
 * - Multi-file atomic commits via Git Data API
 * - Pull request management
 *
 * Uses composition with GitHubClient for read operations
 * and adds write operations on top.
 */

import { decrypt } from './encryption'

// ===========================================
// Types
// ===========================================

export interface CommitFile {
  path: string
  mode: '100644' | '100755' | '040000' | '160000' | '120000'
  type: 'blob' | 'tree' | 'commit'
  sha?: string | null // null to delete
  content?: string // For inline content (< 1MB)
}

export interface PullRequestCreate {
  title: string
  body: string
  head: string // Source branch
  base: string // Target branch
  draft?: boolean
}

export interface PullRequestInfo {
  number: number
  url: string
  html_url: string
  state: 'open' | 'closed' | 'merged'
  title: string
  body: string | null
  head: { ref: string; sha: string }
  base: { ref: string }
  mergeable?: boolean | null
  merged: boolean
}

export interface BranchRef {
  ref: string
  sha: string
}

export interface CompareResult {
  files: Array<{
    filename: string
    status: 'added' | 'removed' | 'modified' | 'renamed'
    additions: number
    deletions: number
    patch?: string
  }>
  total_commits: number
  ahead_by: number
  behind_by: number
}

export interface GitHubFile {
  path: string
  sha: string
  content: string
  encoding: string
  size: number
}

export interface GitHubTreeItem {
  path: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
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

// ===========================================
// GitHubCodeEditor Class
// ===========================================

export class GitHubCodeEditor {
  private token: string
  private baseUrl = 'https://api.github.com'

  constructor(token: string) {
    this.token = token
  }

  /**
   * Create a GitHubCodeEditor from an encrypted token
   */
  static async fromEncryptedToken(encryptedToken: string): Promise<GitHubCodeEditor> {
    const token = await decrypt(encryptedToken)
    return new GitHubCodeEditor(token)
  }

  /**
   * Make a request to the GitHub API
   */
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

    // Handle empty responses (like DELETE)
    const text = await response.text()
    if (!text) {
      return undefined as T
    }

    return JSON.parse(text)
  }

  // ===========================================
  // Read Operations (from GitHubClient)
  // ===========================================

  /**
   * Get file content from a repo
   */
  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<GitHubFile> {
    const url = `/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${ref}` : ''}`
    return this.request(url)
  }

  /**
   * Decode file content from base64
   */
  decodeContent(content: string, encoding: string): string {
    if (encoding === 'base64') {
      return Buffer.from(content, 'base64').toString('utf-8')
    }
    return content
  }

  /**
   * Get file content decoded as string
   */
  async getFileContentDecoded(
    owner: string,
    repo: string,
    path: string,
    branch: string
  ): Promise<string | null> {
    try {
      const file = await this.getFileContent(owner, repo, path, branch)
      return this.decodeContent(file.content, file.encoding)
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null
      }
      throw error
    }
  }

  /**
   * Get the file tree of a repo
   */
  async getTree(
    owner: string,
    repo: string,
    branch: string,
    recursive = true
  ): Promise<{ tree: GitHubTreeItem[] }> {
    const url = `/repos/${owner}/${repo}/git/trees/${branch}${recursive ? '?recursive=1' : ''}`
    return this.request(url)
  }

  /**
   * Get the latest commit on a branch
   */
  async getLatestCommit(owner: string, repo: string, branch: string): Promise<GitHubCommit> {
    return this.request(`/repos/${owner}/${repo}/commits/${branch}`)
  }

  // ===========================================
  // Write Operations
  // ===========================================

  /**
   * Create a new branch from a source ref
   */
  async createBranch(
    owner: string,
    repo: string,
    branchName: string,
    fromRef: string
  ): Promise<BranchRef> {
    // Get the SHA of the source ref
    const sourceCommit = await this.getLatestCommit(owner, repo, fromRef)

    // Create the new branch reference
    const response = await this.request<{ ref: string; object: { sha: string } }>(
      `/repos/${owner}/${repo}/git/refs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: sourceCommit.sha,
        }),
      }
    )

    return { ref: response.ref, sha: response.object.sha }
  }

  /**
   * Delete a branch
   */
  async deleteBranch(owner: string, repo: string, branchName: string): Promise<void> {
    await this.request(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`, {
      method: 'DELETE',
    })
  }

  /**
   * Check if a branch exists
   */
  async branchExists(owner: string, repo: string, branchName: string): Promise<boolean> {
    try {
      await this.request(`/repos/${owner}/${repo}/git/refs/heads/${branchName}`)
      return true
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return false
      }
      throw error
    }
  }

  /**
   * Create or update a single file
   */
  async createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    branch: string,
    existingSha?: string
  ): Promise<{ sha: string; commit: { sha: string } }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = {
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
    }

    if (existingSha) {
      body.sha = existingSha
    }

    return this.request(`/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  /**
   * Delete a file
   */
  async deleteFile(
    owner: string,
    repo: string,
    path: string,
    message: string,
    branch: string,
    sha: string
  ): Promise<{ commit: { sha: string } }> {
    return this.request(`/repos/${owner}/${repo}/contents/${path}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        sha,
        branch,
      }),
    })
  }

  /**
   * Get the SHA of a file (returns undefined if file doesn't exist)
   */
  async getFileSha(
    owner: string,
    repo: string,
    path: string,
    branch: string
  ): Promise<string | undefined> {
    try {
      const file = await this.getFileContent(owner, repo, path, branch)
      return file.sha
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return undefined
      }
      throw error
    }
  }

  /**
   * Create a commit with multiple file changes using Git Data API
   * This is more efficient for multiple files than individual updates
   * and creates an atomic commit
   */
  async createMultiFileCommit(
    owner: string,
    repo: string,
    branch: string,
    message: string,
    files: CommitFile[]
  ): Promise<{ sha: string; url: string }> {
    // 1. Get the current commit SHA for the branch
    const currentCommit = await this.getLatestCommit(owner, repo, branch)

    // 2. Get the base tree SHA from the commit
    const commitData = await this.request<{ tree: { sha: string } }>(
      `/repos/${owner}/${repo}/git/commits/${currentCommit.sha}`
    )
    const baseTreeSha = commitData.tree.sha

    // 3. Create blobs for each file with content and build tree items
    const treeItems: Array<{
      path: string
      mode: string
      type: string
      sha?: string | null
    }> = []

    for (const file of files) {
      if (file.content) {
        // Create a blob for the file content
        const blob = await this.request<{ sha: string }>(
          `/repos/${owner}/${repo}/git/blobs`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: file.content,
              encoding: 'utf-8',
            }),
          }
        )
        treeItems.push({
          path: file.path,
          mode: file.mode,
          type: file.type,
          sha: blob.sha,
        })
      } else if (file.sha === null) {
        // Delete file by setting sha to null
        treeItems.push({
          path: file.path,
          mode: file.mode,
          type: file.type,
          sha: null,
        })
      } else if (file.sha) {
        // Reference existing blob
        treeItems.push({
          path: file.path,
          mode: file.mode,
          type: file.type,
          sha: file.sha,
        })
      }
    }

    // 4. Create a new tree
    const newTree = await this.request<{ sha: string }>(
      `/repos/${owner}/${repo}/git/trees`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeItems,
        }),
      }
    )

    // 5. Create the commit
    const newCommit = await this.request<{ sha: string; url: string }>(
      `/repos/${owner}/${repo}/git/commits`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          tree: newTree.sha,
          parents: [currentCommit.sha],
        }),
      }
    )

    // 6. Update the branch reference
    await this.request(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sha: newCommit.sha,
        force: false,
      }),
    })

    return newCommit
  }

  // ===========================================
  // Pull Request Operations
  // ===========================================

  /**
   * Create a pull request
   */
  async createPullRequest(
    owner: string,
    repo: string,
    options: PullRequestCreate
  ): Promise<PullRequestInfo> {
    return this.request(`/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: options.title,
        body: options.body,
        head: options.head,
        base: options.base,
        draft: options.draft ?? false,
      }),
    })
  }

  /**
   * Get pull request info
   */
  async getPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<PullRequestInfo> {
    return this.request(`/repos/${owner}/${repo}/pulls/${prNumber}`)
  }

  /**
   * Update pull request
   */
  async updatePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    updates: { title?: string; body?: string; state?: 'open' | 'closed' }
  ): Promise<PullRequestInfo> {
    return this.request(`/repos/${owner}/${repo}/pulls/${prNumber}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  }

  /**
   * Get diff between two refs
   */
  async getCompare(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<CompareResult> {
    return this.request(`/repos/${owner}/${repo}/compare/${base}...${head}`)
  }

  /**
   * List commits on a branch
   */
  async listCommits(
    owner: string,
    repo: string,
    branch: string,
    options?: { per_page?: number; since?: string }
  ): Promise<
    Array<{
      sha: string
      commit: {
        message: string
        author: { name: string; email: string; date: string }
      }
    }>
  > {
    const params = new URLSearchParams()
    params.set('sha', branch)
    if (options?.per_page) params.set('per_page', options.per_page.toString())
    if (options?.since) params.set('since', options.since)

    return this.request(`/repos/${owner}/${repo}/commits?${params.toString()}`)
  }
}
