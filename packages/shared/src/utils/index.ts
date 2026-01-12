import { CHUNKING_CONFIG } from '../prompts'

/**
 * Estimate token count for a string (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Rough approximation: ~4 characters per token for English/code
  return Math.ceil(text.length / 4)
}

/**
 * Detect programming language from file extension
 */
export function detectLanguage(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    go: 'go',
    java: 'java',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    md: 'markdown',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    sh: 'bash',
    css: 'css',
    scss: 'scss',
    html: 'html',
    vue: 'vue',
    svelte: 'svelte',
  }
  return ext ? languageMap[ext] || null : null
}

/**
 * Check if a file should be indexed based on its path and extension
 */
export function shouldIndexFile(filePath: string, size: number): boolean {
  // Check size limit
  if (size > CHUNKING_CONFIG.maxFileSizeBytes) {
    return false
  }

  // Check skip patterns
  for (const pattern of CHUNKING_CONFIG.skipPatterns) {
    if (filePath.includes(pattern)) {
      return false
    }
  }

  // Check extension
  const ext = '.' + (filePath.split('.').pop()?.toLowerCase() || '')
  const allowedExtensions = [
    ...CHUNKING_CONFIG.codeExtensions,
    ...CHUNKING_CONFIG.docExtensions,
    ...CHUNKING_CONFIG.configExtensions,
  ]

  return allowedExtensions.includes(ext)
}

/**
 * Split code into chunks by functions/classes (basic heuristic)
 */
export function chunkCode(content: string, language: string | null): string[] {
  const chunks: string[] = []
  const lines = content.split('\n')
  let currentChunk: string[] = []
  let currentTokens = 0

  const isBlockStart = (line: string): boolean => {
    if (!language) return false

    // TypeScript/JavaScript
    if (['typescript', 'javascript'].includes(language)) {
      return (
        /^(export\s+)?(async\s+)?function\s+\w+/.test(line.trim()) ||
        /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/.test(line.trim()) ||
        /^(export\s+)?class\s+\w+/.test(line.trim()) ||
        /^(export\s+)?interface\s+\w+/.test(line.trim()) ||
        /^(export\s+)?type\s+\w+/.test(line.trim())
      )
    }

    // Python
    if (language === 'python') {
      return (
        /^(async\s+)?def\s+\w+/.test(line.trim()) ||
        /^class\s+\w+/.test(line.trim())
      )
    }

    // Go
    if (language === 'go') {
      return (
        /^func\s+(\(\w+\s+\*?\w+\)\s+)?\w+/.test(line.trim()) ||
        /^type\s+\w+\s+(struct|interface)/.test(line.trim())
      )
    }

    // Java
    if (language === 'java') {
      return (
        /^(public|private|protected)?\s*(static\s+)?(class|interface|enum)\s+\w+/.test(line.trim()) ||
        /^(public|private|protected)?\s*(static\s+)?[\w<>\[\]]+\s+\w+\s*\(/.test(line.trim())
      )
    }

    return false
  }

  for (const line of lines) {
    const lineTokens = estimateTokens(line)

    // If this is a block start and we have content, finalize current chunk
    if (isBlockStart(line) && currentChunk.length > 0 && currentTokens > CHUNKING_CONFIG.minChunkSize) {
      chunks.push(currentChunk.join('\n'))
      // Keep some overlap
      const overlapLines = currentChunk.slice(-3)
      currentChunk = overlapLines
      currentTokens = estimateTokens(overlapLines.join('\n'))
    }

    currentChunk.push(line)
    currentTokens += lineTokens

    // If chunk is too large, split it
    if (currentTokens >= CHUNKING_CONFIG.maxTokensPerChunk) {
      chunks.push(currentChunk.join('\n'))
      // Keep overlap
      const overlapLines = currentChunk.slice(-5)
      currentChunk = overlapLines
      currentTokens = estimateTokens(overlapLines.join('\n'))
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'))
  }

  return chunks
}

/**
 * Split markdown by headings
 */
export function chunkMarkdown(content: string): string[] {
  const chunks: string[] = []
  const lines = content.split('\n')
  let currentChunk: string[] = []
  let currentTokens = 0

  for (const line of lines) {
    const lineTokens = estimateTokens(line)
    const isHeading = /^#{1,3}\s+/.test(line)

    // If this is a heading and we have content, consider starting a new chunk
    if (isHeading && currentChunk.length > 0 && currentTokens > CHUNKING_CONFIG.minChunkSize) {
      chunks.push(currentChunk.join('\n'))
      currentChunk = []
      currentTokens = 0
    }

    currentChunk.push(line)
    currentTokens += lineTokens

    // If chunk is too large, split it
    if (currentTokens >= CHUNKING_CONFIG.maxTokensPerChunk) {
      chunks.push(currentChunk.join('\n'))
      currentChunk = []
      currentTokens = 0
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'))
  }

  return chunks
}

/**
 * Generic text chunking with overlap
 */
export function chunkText(content: string): string[] {
  const chunks: string[] = []
  const lines = content.split('\n')
  let currentChunk: string[] = []
  let currentTokens = 0

  for (const line of lines) {
    const lineTokens = estimateTokens(line)
    currentChunk.push(line)
    currentTokens += lineTokens

    if (currentTokens >= CHUNKING_CONFIG.maxTokensPerChunk) {
      chunks.push(currentChunk.join('\n'))
      // Keep overlap
      const overlapLines = currentChunk.slice(-3)
      currentChunk = overlapLines
      currentTokens = estimateTokens(overlapLines.join('\n'))
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'))
  }

  return chunks
}

/**
 * Main chunking function that dispatches to appropriate chunker
 */
export function chunkContent(content: string, filePath: string): string[] {
  const language = detectLanguage(filePath)
  const ext = '.' + (filePath.split('.').pop()?.toLowerCase() || '')

  if (CHUNKING_CONFIG.docExtensions.includes(ext)) {
    return chunkMarkdown(content)
  }

  if (CHUNKING_CONFIG.codeExtensions.includes(ext)) {
    return chunkCode(content, language)
  }

  return chunkText(content)
}

/**
 * Slugify a string for use in URLs/filenames
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}

/**
 * Format date for display
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Format relative time
 */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDate(d)
}
