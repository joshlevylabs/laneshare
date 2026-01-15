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
const MAX_KEY_FILES_PER_ROUND = 25 // More files = better docs quality

/** Maximum total content size per round (in characters) */
const MAX_CONTENT_SIZE = 150000 // ~150KB per round - needed for schema + source code

/** Maximum size for a single file */
const MAX_SINGLE_FILE_SIZE = 15000 // ~15KB - allow larger source files

/** Maximum size for critical schema files (can be larger) */
const MAX_SCHEMA_FILE_SIZE = 50000 // ~50KB - schema files are often large but critical

/**
 * Critical file patterns that MUST be included regardless of normal priority.
 * These are essential for understanding the application's data model and types.
 * Reserved budget: ~40KB for these files.
 */
const MUST_INCLUDE_PATTERNS = [
  // Type definitions - essential for understanding data structures
  /types\/index\.ts$/,
  /types\.ts$/,
  /shared\/.*types.*\.ts$/,
  // Database schemas - essential for data model documentation
  /schema\.prisma$/,
  /prisma\/schema\.prisma$/,
  // Supabase migrations - show actual database structure
  /migrations\/\d+.*\.sql$/,
  // Package.json - tech stack info
  /^package\.json$/,
]

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
  // Cache tree within this provider instance to avoid re-fetching
  private treeCache: Map<string, { tree: RepoContextFile[]; timestamp: number }> = new Map()
  private readonly TREE_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  constructor(supabase: SupabaseClient, options: RepoContextProviderOptions = {}) {
    this.supabase = supabase
    this.options = {
      maxTreeFiles: options.maxTreeFiles ?? 1000,
      maxKeyFiles: options.maxKeyFiles ?? MAX_KEY_FILES_PER_ROUND,
      maxContentSize: options.maxContentSize ?? MAX_CONTENT_SIZE,
    }
  }

  /**
   * Get cached tree or fetch from GitHub
   */
  private getCacheKey(owner: string, repo: string, branch: string): string {
    return `${owner}/${repo}/${branch}`
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

    // Get file tree from GitHub (with caching)
    const branch = repo.selected_branch || repo.default_branch
    const cacheKey = this.getCacheKey(repo.owner, repo.name, branch)

    let fileTree: RepoContextFile[]
    const cached = this.treeCache.get(cacheKey)

    if (cached && Date.now() - cached.timestamp < this.TREE_CACHE_TTL) {
      console.log(`[RepoContext] Using cached tree for ${cacheKey}`)
      fileTree = cached.tree
    } else {
      const treeStartTime = Date.now()
      const treeResponse = await github.getTree(repo.owner, repo.name, branch)
      fileTree = this.processTree(treeResponse.tree)
      // Cache the processed tree
      this.treeCache.set(cacheKey, { tree: fileTree, timestamp: Date.now() })
      console.log(`[RepoContext] Fetched and cached tree in ${Date.now() - treeStartTime}ms`)
    }

    // Determine which files to fetch
    let filesToFetch: string[]

    if (round === 1) {
      // First round: fetch prioritized key files
      filesToFetch = this.selectKeyFiles(fileTree)
    } else if (requestedFiles.length > 0) {
      // Follow-up rounds: fetch requested files
      // Handle both exact file paths AND directory patterns (e.g., "supabase/migrations")
      filesToFetch = this.expandRequestedFiles(requestedFiles, fileTree)
      console.log(`[RepoContext] Expanded ${requestedFiles.length} requests to ${filesToFetch.length} files`)
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
   *
   * IMPORTANT: Critical files (schemas, types, migrations) are selected FIRST
   * with a reserved budget, then remaining budget goes to priority-sorted files.
   */
  private selectKeyFiles(fileTree: RepoContextFile[], round: number = 1): string[] {
    const selected: string[] = []
    let totalSize = 0
    let criticalFilesCount = 0

    // Reserved budget for critical files (40% of total)
    const criticalBudget = Math.floor(this.options.maxContentSize * 0.4)
    // Remaining budget for priority-sorted files
    const remainingBudget = this.options.maxContentSize - criticalBudget

    // ===========================================
    // PHASE 1: Select critical "must-include" files first
    // These are essential for understanding the application
    // ===========================================
    if (round === 1) {
      // Find files matching must-include patterns
      const criticalFiles = fileTree.filter(file =>
        MUST_INCLUDE_PATTERNS.some(pattern => pattern.test(file.path))
      )

      // Sort critical files by priority (types > schema > migrations > package.json)
      criticalFiles.sort((a, b) => {
        const aPriority = this.getCriticalFilePriority(a.path)
        const bPriority = this.getCriticalFilePriority(b.path)
        return bPriority - aPriority
      })

      // Add critical files up to the reserved budget
      for (const file of criticalFiles) {
        // Allow larger files for schemas (up to 50KB)
        const maxSize = file.path.endsWith('.sql') || file.path.includes('schema')
          ? MAX_SCHEMA_FILE_SIZE
          : MAX_SINGLE_FILE_SIZE

        if (file.size > maxSize) continue
        if (totalSize + file.size > criticalBudget) continue

        selected.push(file.path)
        totalSize += file.size
      }

      // Track how many critical files were actually selected
      criticalFilesCount = selected.length

      console.log(`[RepoContext] Phase 1: Selected ${criticalFilesCount} critical files (${Math.round(totalSize / 1024)}KB)`)
    }

    // ===========================================
    // PHASE 2: Fill remaining budget with priority-sorted files
    // ===========================================

    // Score all files not already selected
    const scored = fileTree
      .filter(file => !selected.includes(file.path))
      .map(file => ({
        path: file.path,
        priority: getFilePriority(file.path),
        size: file.size,
      }))

    // Sort by priority (descending)
    scored.sort((a, b) => b.priority - a.priority)

    // Adjust offset for subsequent rounds (skip already-fetched priority files)
    const offset = round === 1 ? 0 : (round - 1) * this.options.maxKeyFiles

    // Calculate remaining budget
    const budgetForPhase2 = round === 1 ? remainingBudget : this.options.maxContentSize
    let phase2Size = 0

    for (let i = offset; i < scored.length && selected.length < this.options.maxKeyFiles; i++) {
      const file = scored[i]

      // Skip very large files
      if (file.size > MAX_SINGLE_FILE_SIZE) continue

      // Check content size limit for this phase
      if (phase2Size + file.size > budgetForPhase2) continue

      selected.push(file.path)
      phase2Size += file.size
      totalSize += file.size
    }

    console.log(`[RepoContext] Phase 2: Added ${selected.length - (round === 1 ? criticalFilesCount : 0)} priority files. Total: ${selected.length} files (${Math.round(totalSize / 1024)}KB)`)

    return selected
  }

  /**
   * Get priority for critical files (used for sorting within critical files)
   */
  private getCriticalFilePriority(path: string): number {
    const lowerPath = path.toLowerCase()

    // Type definitions are highest priority - define all data structures
    if (lowerPath.includes('types/index.ts') || lowerPath.endsWith('types.ts')) {
      return 100
    }

    // Prisma schema - complete data model
    if (lowerPath.includes('schema.prisma')) {
      return 95
    }

    // Package.json - tech stack
    if (lowerPath === 'package.json') {
      return 90
    }

    // SQL migrations - sort by date (newer = higher priority)
    if (lowerPath.includes('migrations/') && lowerPath.endsWith('.sql')) {
      // Extract date from migration filename (e.g., 20240101000000_xxx.sql)
      const match = lowerPath.match(/(\d{14})/)
      if (match) {
        // Normalize to 0-85 range, newer files get higher priority
        const dateNum = parseInt(match[1].slice(0, 8))
        return 50 + Math.min((dateNum - 20240101) / 100, 35)
      }
      return 60
    }

    return 50
  }

  /**
   * Expand requested files/directories to actual file paths
   * Handles:
   * - Exact file paths
   * - Directory patterns (e.g., "supabase/migrations")
   * - Path variations (e.g., "src/pages/api" -> "src/app/api" for Next.js App Router)
   * - Partial matches when exact prefix fails
   */
  private expandRequestedFiles(requestedPaths: string[], fileTree: RepoContextFile[]): string[] {
    const expanded: string[] = []
    const seen = new Set<string>()

    // Common path equivalences (Claude might request old patterns)
    const PATH_EQUIVALENCES: Record<string, string[]> = {
      'src/pages/api': ['src/app/api', 'app/api', 'pages/api'],
      'src/pages': ['src/app', 'app', 'pages'],
      'pages/api': ['src/app/api', 'app/api'],
      'prisma/migrations': ['supabase/migrations', 'migrations', 'db/migrations'],
      'migrations': ['supabase/migrations', 'prisma/migrations', 'db/migrations'],
      'src/lib/database': ['src/lib/db', 'src/lib/supabase', 'lib/database', 'lib/db'],
      'src/types': ['packages/shared/src/types', 'types', 'src/@types'],
      'src/hooks': ['src/lib/hooks', 'hooks', 'src/utils/hooks'],
    }

    const MAX_FILES_PER_DIR = 10

    for (const requested of requestedPaths) {
      // Normalize path (remove trailing slashes)
      const normalizedPath = requested.replace(/\/+$/, '')

      // Build list of paths to try (original + equivalences)
      const pathsToTry = [normalizedPath]
      if (PATH_EQUIVALENCES[normalizedPath]) {
        pathsToTry.push(...PATH_EQUIVALENCES[normalizedPath])
      }
      // Also try without 'src/' prefix if present
      if (normalizedPath.startsWith('src/')) {
        pathsToTry.push(normalizedPath.slice(4))
      }

      let foundMatches = false

      for (const pathToTry of pathsToTry) {
        // Check for exact file match
        const exactMatch = fileTree.find(f => f.path === pathToTry)
        if (exactMatch && !seen.has(exactMatch.path)) {
          expanded.push(exactMatch.path)
          seen.add(exactMatch.path)
          foundMatches = true
          break
        }

        // Check for directory prefix match
        const dirPrefix = pathToTry + '/'
        const matchingFiles = fileTree.filter(f => f.path.startsWith(dirPrefix))

        if (matchingFiles.length > 0) {
          const sortedMatches = matchingFiles
            .sort((a, b) => getFilePriority(b.path) - getFilePriority(a.path))
            .slice(0, MAX_FILES_PER_DIR)

          for (const file of sortedMatches) {
            if (!seen.has(file.path)) {
              expanded.push(file.path)
              seen.add(file.path)
            }
          }
          foundMatches = true
          break
        }
      }

      // If no exact match, try fuzzy matching - find files containing the last path segment
      if (!foundMatches) {
        const lastSegment = normalizedPath.split('/').pop()?.toLowerCase()
        if (lastSegment && lastSegment.length > 2) {
          const fuzzyMatches = fileTree.filter(f => {
            const lowerPath = f.path.toLowerCase()
            return lowerPath.includes(lastSegment) ||
                   lowerPath.includes(lastSegment.replace(/s$/, '')) // Handle plural/singular
          })

          if (fuzzyMatches.length > 0) {
            console.log(`[RepoContext] Fuzzy match for "${normalizedPath}": found ${fuzzyMatches.length} files containing "${lastSegment}"`)
            const sortedFuzzy = fuzzyMatches
              .sort((a, b) => getFilePriority(b.path) - getFilePriority(a.path))
              .slice(0, MAX_FILES_PER_DIR)

            for (const file of sortedFuzzy) {
              if (!seen.has(file.path)) {
                expanded.push(file.path)
                seen.add(file.path)
              }
            }
          }
        }
      }
    }

    // Limit total files to avoid exceeding content budget
    return expanded.slice(0, this.options.maxKeyFiles)
  }

  /**
   * Fetch file contents from GitHub - PARALLELIZED for speed
   */
  private async fetchFileContents(
    github: GitHubClient,
    owner: string,
    repo: string,
    branch: string,
    paths: string[]
  ): Promise<RepoContextKeyFile[]> {
    const startTime = Date.now()

    // Fetch all files in parallel (much faster than sequential)
    const BATCH_SIZE = 10 // Limit concurrent requests to avoid rate limiting
    const results: Array<{ path: string; content: string | null }> = []

    for (let i = 0; i < paths.length; i += BATCH_SIZE) {
      const batch = paths.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.all(
        batch.map(async (path) => {
          try {
            const content = await github.getFileContentDecoded(owner, repo, path, branch)
            return { path, content }
          } catch (error) {
            console.warn(`[RepoContext] Failed to fetch ${path}:`, error)
            return { path, content: null }
          }
        })
      )
      results.push(...batchResults)
    }

    // Filter and process results
    const files: RepoContextKeyFile[] = []
    let totalSize = 0

    for (const { path, content } of results) {
      // Check size limit
      if (totalSize > this.options.maxContentSize) break

      // Skip if content is null, too large, or binary
      if (!content) continue

      // Allow larger files for schema files
      const maxSize = path.endsWith('.sql') || path.includes('schema')
        ? MAX_SCHEMA_FILE_SIZE
        : MAX_SINGLE_FILE_SIZE

      if (content.length > maxSize) continue
      if (this.isBinaryContent(content)) continue

      files.push({
        path,
        content,
        language: this.detectLanguage(path),
      })

      totalSize += content.length
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[RepoContext] Fetched ${files.length} files in ${elapsed}s (parallel batches of ${BATCH_SIZE})`)

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
