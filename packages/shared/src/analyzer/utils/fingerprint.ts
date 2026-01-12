// Fingerprint computation for cache invalidation
// Combines repo SHAs and config file hashes

import { createHash } from 'crypto'
import type { AnalysisContext } from '../../types/architecture'

/**
 * Compute a fingerprint that uniquely identifies the current state of analyzed repos
 * Used to determine if a cached snapshot is still valid
 */
export function computeFingerprint(context: AnalysisContext): string {
  const parts: string[] = []

  // Sort repos by ID for determinism
  const sortedRepos = [...context.repos].sort((a, b) => a.id.localeCompare(b.id))

  for (const repo of sortedRepos) {
    // Include repo identifier
    parts.push(`repo:${repo.id}`)

    // Include sorted file SHAs for key files
    const keyFiles = repo.files
      .filter(
        (f) =>
          f.path.includes('package.json') ||
          f.path.includes('next.config') ||
          f.path.includes('vercel.json') ||
          f.path.includes('supabase/migrations') ||
          f.path.match(/app\/.*\/page\.tsx?$/) ||
          f.path.match(/app\/api\/.*\/route\.ts?$/)
      )
      .sort((a, b) => a.path.localeCompare(b.path))

    for (const file of keyFiles) {
      parts.push(`file:${file.path}:${file.sha}`)
    }
  }

  // Hash the combined parts
  const hash = createHash('sha256').update(parts.join('\n')).digest('hex')
  return hash.slice(0, 32)
}

/**
 * Check if two fingerprints match
 */
export function fingerprintMatches(a: string, b: string): boolean {
  return a === b
}
