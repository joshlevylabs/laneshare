/**
 * Repository Context Provider
 *
 * Assembles the context (file tree + key files) needed for Claude Code
 * to generate documentation. Intelligently selects the most important
 * files while staying within size limits.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { GitHubClient } from './github'
import { decrypt } from './encryption'
import { getFilePriority, KEY_FILE_PATTERNS } from '@laneshare/shared'
import type {
  RepoContext,
  RepoContextFile,
  RepoContextKeyFile,
} from '@laneshare/shared'

// ===========================================
// Configuration
// ===========================================

/** Maximum number of key files to fetch per round */
const MAX_KEY_FILES_PER_ROUND = 5 // Fewer files = faster API response

/** Maximum total content size per round (in characters) */
const MAX_CONTENT_SIZE = 20000 // ~20KB per round

/** Maximum size for a single file */
const MAX_SINGLE_FILE_SIZE = 8000 // ~8KB - reduced for faster API response

/** File extensions to include in the tree */
const INCLUDE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.swift',
  '.rb', '.php', '.cs', '.cpp', '.c', '.h',
  '.yaml', '.yml', '.json', '.toml', '.xml',
  '.md', '.mdx', '.txt', '.env.example',
  '.sql', '.prisma', '.graphql',
  '.css', '.scss', '.less',
  '.html', '.vue', '.svelte',
  '.sh', '.bash', '.zsh',
  '.dockerfile', '.containerfile',
])

/** Directories to exclude from tree */
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '__pycache__',
  '.cache',
  '.turbo',
  'vendor',
  'target',
  '.idea',
  '.vscode',
])

// ===========================================
// Types
// ===========================================

export interface RepoContextProviderOptions {
  /** Maximum files in tree (for large repos) */
  maxTreeFiles?: number
  /** Maximum key files per round */
  maxKeyFiles?: number
  /** Maximum content size per round */
  maxContentSize?: number
}

export interface GitHubTreeItem {
  path: string
  mode?: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
}

// ===========================================
// Main Provider Class
// ===========================================

export class RepoContextProvider {
  private supabase: SupabaseClient
  private options: Required<RepoContextProviderOptions>

  constructor(supabase: SupabaseClient, options: RepoContextProviderOptions = {}) {
    this.supabase = supabase
    this.options = {
      maxTreeFiles: options.maxTreeFiles ?? 1000,
      maxKeyFiles: options.maxKeyFiles ?? MAX_KEY_FILES_PER_ROUND,
      maxContentSize: options.maxContentSize ?? MAX_CONTENT_SIZE,
    }
  }

  /**
   * Build the complete repo context for Claude Code
   */
  async buildContext(
    repoId: string,
    userId: string,
    round: number = 1,
    maxRounds: number = 3,
    requestedFiles: string[] = []
  ): Promise<RepoContext> {
    // Get repo info
    const { data: repo, error: repoError } = await this.supabase
      .from('repos')
      .select('*')
      .eq('id', repoId)
      .single()

    if (repoError || !repo) {
      throw new Error('Repository not found')
    }

    // Get GitHub token
    const { data: connection, error: connError } = await this.supabase
      .from('github_connections')
      .select('access_token_encrypted')
      .eq('user_id', userId)
      .single()

    if (connError || !connection) {
      throw new Error('GitHub connection not found')
    }

    const token = await decrypt(connection.access_token_encrypted)
    const github = new GitHubClient(token)

    // Get file tree from GitHub
    const branch = repo.selected_branch || repo.default_branch
    const treeResponse = await github.getTree(repo.owner, repo.name, branch)

    // Filter and process tree
    const fileTree = this.processTree(treeResponse.tree)

    // Determine which files to fetch
    let filesToFetch: string[]

    if (round === 1) {
      // First round: fetch prioritized key files
      filesToFetch = this.selectKeyFiles(fileTree)
    } else if (requestedFiles.length > 0) {
      // Follow-up rounds: fetch requested files
      filesToFetch = requestedFiles.filter(f => fileTree.some(t => t.path === f))
    } else {
      // No specific requests, fetch more key files
      filesToFetch = this.selectKeyFiles(fileTree, round)
    }

    // Fetch file contents
    const keyFiles = await this.fetchFileContents(github, repo.owner, repo.name, branch, filesToFetch)

    return {
      repo_name: repo.name,
      repo_owner: repo.owner,
      default_branch: branch,
      file_tree: fileTree,
      key_files: keyFiles,
      total_files: fileTree.length,
      round,
      max_rounds: maxRounds,
    }
  }

  /**
   * Process GitHub tree into our format, filtering out irrelevant files
   */
  private processTree(tree: GitHubTreeItem[]): RepoContextFile[] {
    const files: RepoContextFile[] = []

    for (const item of tree) {
      // Skip non-files
      if (item.type !== 'blob') continue

      // Skip excluded directories
      const pathParts = item.path.split('/')
      if (pathParts.some(part => EXCLUDE_DIRS.has(part))) continue

      // Check file extension
      const ext = this.getExtension(item.path)
      const isConfigFile = this.isConfigFile(item.path)

      if (!INCLUDE_EXTENSIONS.has(ext) && !isConfigFile) continue

      // Detect language
      const language = this.detectLanguage(item.path)

      files.push({
        path: item.path,
        size: item.size || 0,
        language,
      })

      // Limit tree size
      if (files.length >= this.options.maxTreeFiles) break
    }

    return files.sort((a, b) => a.path.localeCompare(b.path))
  }

  /**
   * Select key files to fetch based on priority
   */
  private selectKeyFiles(fileTree: RepoContextFile[], round: number = 1): string[] {
    // Score all files
    const scored = fileTree.map(file => ({
      path: file.path,
      priority: getFilePriority(file.path),
      size: file.size,
    }))

    // Sort by priority (descending)
    scored.sort((a, b) => b.priority - a.priority)

    // Select files within limits
    const selected: string[] = []
    let totalSize = 0

    // Adjust offset for subsequent rounds
    const offset = (round - 1) * this.options.maxKeyFiles

    for (let i = offset; i < scored.length && selected.length < this.options.maxKeyFiles; i++) {
      const file = scored[i]

      // Skip very large files
      if (file.size > MAX_SINGLE_FILE_SIZE) continue

      // Check content size limit
      if (totalSize + file.size > this.options.maxContentSize) continue

      selected.push(file.path)
      totalSize += file.size
    }

    return selected
  }

  /**
   * Fetch file contents from GitHub
   */
  private async fetchFileContents(
    github: GitHubClient,
    owner: string,
    repo: string,
    branch: string,
    paths: string[]
  ): Promise<RepoContextKeyFile[]> {
    const files: RepoContextKeyFile[] = []
    let totalSize = 0

    for (const path of paths) {
      try {
        // Check size limit before fetching
        if (totalSize > this.options.maxContentSize) break

        const content = await github.getFileContentDecoded(owner, repo, path, branch)

        // Skip if content is null, too large, or binary
        if (!content || content.length > MAX_SINGLE_FILE_SIZE) continue
        if (this.isBinaryContent(content)) continue

        files.push({
          path,
          content,
          language: this.detectLanguage(path),
        })

        totalSize += content.length
      } catch (error) {
        console.warn(`[RepoContext] Failed to fetch ${path}:`, error)
        // Continue with other files
      }
    }

    return files
  }

  /**
   * Get file extension
   */
  private getExtension(path: string): string {
    const parts = path.split('.')
    if (parts.length < 2) return ''
    return '.' + parts[parts.length - 1].toLowerCase()
  }

  /**
   * Check if a file is a config file (no extension but important)
   */
  private isConfigFile(path: string): boolean {
    const filename = path.split('/').pop() || ''
    const configNames = [
      'Dockerfile',
      'Makefile',
      'Procfile',
      'Gemfile',
      'Rakefile',
      '.gitignore',
      '.dockerignore',
      '.env.example',
      '.env.local.example',
      'LICENSE',
    ]
    return configNames.includes(filename)
  }

  /**
   * Detect programming language from file path
   */
  private detectLanguage(path: string): string | undefined {
    const ext = this.getExtension(path)
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.kt': 'kotlin',
      '.swift': 'swift',
      '.rb': 'ruby',
      '.php': 'php',
      '.cs': 'csharp',
      '.cpp': 'cpp',
      '.c': 'c',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.json': 'json',
      '.toml': 'toml',
      '.xml': 'xml',
      '.md': 'markdown',
      '.sql': 'sql',
      '.prisma': 'prisma',
      '.graphql': 'graphql',
      '.css': 'css',
      '.scss': 'scss',
      '.html': 'html',
      '.vue': 'vue',
      '.svelte': 'svelte',
      '.sh': 'bash',
    }
    return languageMap[ext]
  }

  /**
   * Check if content appears to be binary
   */
  private isBinaryContent(content: string): boolean {
    // Check for null bytes or high ratio of non-printable characters
    let nonPrintable = 0
    const sampleSize = Math.min(content.length, 1000)

    for (let i = 0; i < sampleSize; i++) {
      const code = content.charCodeAt(i)
      if (code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
        nonPrintable++
      }
    }

    return nonPrintable > sampleSize * 0.1 // >10% non-printable
  }
}

/**
 * Generate a fingerprint for a repo state (used for caching/deduplication)
 */
export function generateRepoFingerprint(
  branch: string,
  commitSha: string,
  keyConfigShas?: string[]
): string {
  const parts = [branch, commitSha]
  if (keyConfigShas) {
    parts.push(...keyConfigShas.sort())
  }
  return parts.join(':')
}

/**
 * Check if documentation should be regenerated based on fingerprint
 */
export function shouldRegenerate(
  currentFingerprint: string,
  storedFingerprint: string | null
): boolean {
  if (!storedFingerprint) return true
  return currentFingerprint !== storedFingerprint
}
