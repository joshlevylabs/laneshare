/**
 * Document Verification System
 *
 * Validates AI-generated documentation evidence against actual file contents
 * to detect and flag hallucinated content.
 */

import type { RepoDocCategory, RepoContextKeyFile } from '@laneshare/shared'

export interface EvidenceItem {
  file_path: string
  excerpt: string
  reason: string
}

export interface DocPage {
  category: RepoDocCategory
  slug: string
  title: string
  markdown: string
  evidence: EvidenceItem[]
}

export interface VerificationIssue {
  type: 'missing_file' | 'excerpt_not_found' | 'low_similarity' | 'no_evidence'
  severity: 'error' | 'warning'
  message: string
  evidence_index?: number
  file_path?: string
}

export interface PageVerificationResult {
  slug: string
  title: string
  verified_count: number
  total_evidence: number
  verification_score: number // 0-100
  issues: VerificationIssue[]
  needs_review: boolean
}

export interface VerificationSummary {
  total_pages: number
  fully_verified: number
  needs_review: number
  total_evidence: number
  verified_evidence: number
  overall_score: number // 0-100
  pages: PageVerificationResult[]
}

/**
 * Normalize text for comparison (remove extra whitespace, normalize line endings)
 */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Calculate similarity between two strings using Levenshtein-based approach
 * Returns value between 0 and 1
 */
function calculateSimilarity(str1: string, str2: string): number {
  const norm1 = normalizeText(str1)
  const norm2 = normalizeText(str2)

  if (norm1 === norm2) return 1

  // Check if one contains the other
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    return 0.9
  }

  // Simple word overlap similarity
  const words1 = new Set(norm1.split(/\s+/))
  const words2 = new Set(norm2.split(/\s+/))

  const intersection = new Set([...words1].filter(x => words2.has(x)))
  const union = new Set([...words1, ...words2])

  return intersection.size / union.size
}

/**
 * Check if an excerpt exists in file content
 */
function findExcerptInContent(
  excerpt: string,
  fileContent: string
): { found: boolean; similarity: number; bestMatch?: string } {
  const normExcerpt = normalizeText(excerpt)
  const normContent = normalizeText(fileContent)

  // Direct containment check (high confidence)
  if (normContent.includes(normExcerpt)) {
    return { found: true, similarity: 1 }
  }

  // Try to find similar passages
  // Split content into chunks roughly the size of the excerpt
  const words = fileContent.split(/\s+/)
  const excerptWords = excerpt.split(/\s+/).length
  const chunkSize = Math.max(excerptWords, 10)

  let bestSimilarity = 0
  let bestMatch = ''

  for (let i = 0; i < words.length - chunkSize; i += Math.floor(chunkSize / 2)) {
    const chunk = words.slice(i, i + chunkSize * 2).join(' ')
    const similarity = calculateSimilarity(excerpt, chunk)

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity
      bestMatch = chunk.slice(0, 200) // Truncate for storage
    }
  }

  // Consider found if similarity is above threshold
  const SIMILARITY_THRESHOLD = 0.6
  return {
    found: bestSimilarity >= SIMILARITY_THRESHOLD,
    similarity: bestSimilarity,
    bestMatch: bestSimilarity > 0.3 ? bestMatch : undefined,
  }
}

/**
 * Verify a single page's evidence against actual file contents
 */
export function verifyPage(
  page: DocPage,
  fileContents: Map<string, string>,
  availableFiles: Set<string>
): PageVerificationResult {
  const issues: VerificationIssue[] = []
  let verifiedCount = 0

  // Check for no evidence
  if (page.evidence.length === 0) {
    issues.push({
      type: 'no_evidence',
      severity: 'warning',
      message: 'Page has no evidence citations to verify',
    })
  }

  // Verify each evidence item
  page.evidence.forEach((ev, index) => {
    const normalizedPath = ev.file_path.replace(/\\/g, '/').replace(/^\/+/, '')

    // Check if file exists in available files
    const fileExists = availableFiles.has(normalizedPath) ||
      availableFiles.has(ev.file_path) ||
      [...availableFiles].some(f => f.endsWith(normalizedPath) || normalizedPath.endsWith(f))

    if (!fileExists) {
      issues.push({
        type: 'missing_file',
        severity: 'error',
        message: `Referenced file not found: ${ev.file_path}`,
        evidence_index: index,
        file_path: ev.file_path,
      })
      return
    }

    // Get file content
    const content = fileContents.get(normalizedPath) ||
      fileContents.get(ev.file_path) ||
      [...fileContents.entries()].find(([k]) =>
        k.endsWith(normalizedPath) || normalizedPath.endsWith(k)
      )?.[1]

    if (!content) {
      // File exists but wasn't fetched (might be in tree but not key files)
      // This is less severe - we can't verify but it's not necessarily wrong
      issues.push({
        type: 'missing_file',
        severity: 'warning',
        message: `File exists but content not available for verification: ${ev.file_path}`,
        evidence_index: index,
        file_path: ev.file_path,
      })
      return
    }

    // Check if excerpt exists in content
    const result = findExcerptInContent(ev.excerpt, content)

    if (result.found) {
      verifiedCount++
    } else if (result.similarity >= 0.3) {
      issues.push({
        type: 'low_similarity',
        severity: 'warning',
        message: `Excerpt only partially matches file content (${Math.round(result.similarity * 100)}% similar): ${ev.file_path}`,
        evidence_index: index,
        file_path: ev.file_path,
      })
      // Give partial credit for low similarity
      verifiedCount += result.similarity
    } else {
      issues.push({
        type: 'excerpt_not_found',
        severity: 'error',
        message: `Excerpt not found in file: ${ev.file_path} - possible hallucination`,
        evidence_index: index,
        file_path: ev.file_path,
      })
    }
  })

  // Check for [Needs Review] markers in markdown
  if (page.markdown.includes('[Needs Review]')) {
    issues.push({
      type: 'no_evidence',
      severity: 'warning',
      message: 'Page contains [Needs Review] markers indicating uncertain content',
    })
  }

  // Calculate verification score
  const totalEvidence = page.evidence.length
  const score = totalEvidence > 0
    ? Math.round((verifiedCount / totalEvidence) * 100)
    : 0

  // Determine if needs review
  const hasErrors = issues.some(i => i.severity === 'error')
  const lowScore = score < 50
  const noEvidence = totalEvidence === 0
  const hasReviewMarkers = page.markdown.includes('[Needs Review]')

  return {
    slug: page.slug,
    title: page.title,
    verified_count: Math.round(verifiedCount),
    total_evidence: totalEvidence,
    verification_score: score,
    issues,
    needs_review: hasErrors || lowScore || noEvidence || hasReviewMarkers,
  }
}

/**
 * Verify all pages in a documentation bundle
 */
export function verifyDocumentation(
  pages: DocPage[],
  keyFiles: RepoContextKeyFile[],
  fileTree: Array<{ path: string }>
): VerificationSummary {
  // Build file content map
  const fileContents = new Map<string, string>()
  for (const file of keyFiles) {
    fileContents.set(file.path, file.content)
  }

  // Build available files set
  const availableFiles = new Set(fileTree.map(f => f.path))

  // Verify each page
  const pageResults = pages.map(page => verifyPage(page, fileContents, availableFiles))

  // Calculate summary
  const fullyVerified = pageResults.filter(p => p.verification_score === 100 && !p.needs_review).length
  const needsReview = pageResults.filter(p => p.needs_review).length
  const totalEvidence = pageResults.reduce((sum, p) => sum + p.total_evidence, 0)
  const verifiedEvidence = pageResults.reduce((sum, p) => sum + p.verified_count, 0)
  const overallScore = totalEvidence > 0
    ? Math.round((verifiedEvidence / totalEvidence) * 100)
    : 0

  return {
    total_pages: pages.length,
    fully_verified: fullyVerified,
    needs_review: needsReview,
    total_evidence: totalEvidence,
    verified_evidence: verifiedEvidence,
    overall_score: overallScore,
    pages: pageResults,
  }
}

/**
 * Generate a verification report as markdown
 */
export function generateVerificationReport(summary: VerificationSummary): string {
  const lines: string[] = []

  lines.push('# Documentation Verification Report\n')
  lines.push(`**Overall Score:** ${summary.overall_score}%`)
  lines.push(`**Pages:** ${summary.total_pages} total, ${summary.fully_verified} verified, ${summary.needs_review} need review`)
  lines.push(`**Evidence:** ${summary.verified_evidence}/${summary.total_evidence} citations verified\n`)

  if (summary.needs_review > 0) {
    lines.push('## Pages Needing Review\n')

    for (const page of summary.pages.filter(p => p.needs_review)) {
      lines.push(`### ${page.title}`)
      lines.push(`- **Score:** ${page.verification_score}%`)
      lines.push(`- **Evidence:** ${page.verified_count}/${page.total_evidence} verified`)

      if (page.issues.length > 0) {
        lines.push('- **Issues:**')
        for (const issue of page.issues) {
          const icon = issue.severity === 'error' ? '❌' : '⚠️'
          lines.push(`  - ${icon} ${issue.message}`)
        }
      }
      lines.push('')
    }
  }

  if (summary.fully_verified > 0) {
    lines.push('## Fully Verified Pages\n')
    for (const page of summary.pages.filter(p => !p.needs_review)) {
      lines.push(`- ✅ ${page.title} (${page.verification_score}%)`)
    }
  }

  return lines.join('\n')
}
