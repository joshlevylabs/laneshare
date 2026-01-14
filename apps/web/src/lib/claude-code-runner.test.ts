/**
 * Tests for Claude Code Runner
 *
 * These tests verify:
 * - Zod schema validation for Claude Code output
 * - JSON parsing and error handling
 * - Mock runner behavior
 * - Slug normalization
 */

import { describe, it, expect } from 'vitest'
import {
  ClaudeCodeDocOutputSchema,
  ClaudeCodeDocPageSchema,
  DocEvidenceSchema,
  MockClaudeRunner,
  normalizeSlug,
  getCategoryFromSlug,
} from './claude-code-runner'
import type { ClaudeCodeDocOutput, RepoContext } from '@laneshare/shared'

describe('DocEvidenceSchema', () => {
  it('should accept valid evidence', () => {
    const valid = {
      file_path: 'src/index.ts',
      excerpt: 'export function main() {}',
      reason: 'Shows main entry point',
    }
    expect(() => DocEvidenceSchema.parse(valid)).not.toThrow()
  })

  it('should reject empty file_path', () => {
    const invalid = {
      file_path: '',
      excerpt: 'some content',
      reason: 'reason',
    }
    expect(() => DocEvidenceSchema.parse(invalid)).toThrow()
  })

  it('should reject excerpt over 1500 chars', () => {
    const invalid = {
      file_path: 'test.ts',
      excerpt: 'a'.repeat(1501),
      reason: 'reason',
    }
    expect(() => DocEvidenceSchema.parse(invalid)).toThrow()
  })
})

describe('ClaudeCodeDocPageSchema', () => {
  it('should accept valid page', () => {
    const valid = {
      category: 'ARCHITECTURE',
      slug: 'architecture/overview',
      title: 'Architecture Overview',
      markdown: '# Architecture\n\nThis is the overview.',
      evidence: [
        {
          file_path: 'src/index.ts',
          excerpt: 'export default app',
          reason: 'Main entry',
        },
      ],
    }
    expect(() => ClaudeCodeDocPageSchema.parse(valid)).not.toThrow()
  })

  it('should reject invalid slug format', () => {
    const invalid = {
      category: 'ARCHITECTURE',
      slug: 'invalid-slug', // Missing category/page format
      title: 'Test',
      markdown: 'Content here',
      evidence: [],
    }
    expect(() => ClaudeCodeDocPageSchema.parse(invalid)).toThrow()
  })

  it('should reject invalid category', () => {
    const invalid = {
      category: 'INVALID',
      slug: 'invalid/page',
      title: 'Test',
      markdown: 'Content here',
      evidence: [],
    }
    expect(() => ClaudeCodeDocPageSchema.parse(invalid)).toThrow()
  })

  it('should allow empty evidence array', () => {
    const valid = {
      category: 'API',
      slug: 'api/overview',
      title: 'API Overview',
      markdown: '# API',
      evidence: [],
    }
    expect(() => ClaudeCodeDocPageSchema.parse(valid)).not.toThrow()
  })
})

describe('ClaudeCodeDocOutputSchema', () => {
  it('should accept valid complete output', () => {
    const valid: ClaudeCodeDocOutput = {
      repo_summary: {
        name: 'test-repo',
        tech_stack: ['TypeScript', 'React'],
        entrypoints: ['src/index.ts'],
      },
      warnings: ['Some content may need review'],
      pages: [
        {
          category: 'ARCHITECTURE',
          slug: 'architecture/overview',
          title: 'Overview',
          markdown: '# Overview',
          evidence: [],
        },
      ],
    }
    expect(() => ClaudeCodeDocOutputSchema.parse(valid)).not.toThrow()
  })

  it('should accept output with needs_more_files', () => {
    const valid: ClaudeCodeDocOutput = {
      repo_summary: {
        name: 'test-repo',
        tech_stack: [],
        entrypoints: [],
      },
      warnings: [],
      needs_more_files: ['package.json', 'tsconfig.json'],
      pages: [
        {
          category: 'ARCHITECTURE',
          slug: 'architecture/overview',
          title: 'Overview',
          markdown: '# Overview\n\n[Needs Review]',
          evidence: [],
        },
      ],
    }
    const result = ClaudeCodeDocOutputSchema.parse(valid)
    expect(result.needs_more_files).toEqual(['package.json', 'tsconfig.json'])
  })

  it('should reject output with no pages', () => {
    const invalid = {
      repo_summary: {
        name: 'test-repo',
        tech_stack: [],
        entrypoints: [],
      },
      warnings: [],
      pages: [],
    }
    expect(() => ClaudeCodeDocOutputSchema.parse(invalid)).toThrow()
  })

  it('should accept output with tasks', () => {
    const valid = {
      repo_summary: {
        name: 'test-repo',
        tech_stack: [],
        entrypoints: [],
      },
      warnings: [],
      pages: [
        {
          category: 'FEATURE',
          slug: 'features/index',
          title: 'Features',
          markdown: '# Features',
          evidence: [],
        },
      ],
      tasks: [
        {
          title: 'Document auth flow',
          description: 'Add detailed auth documentation',
          category: 'API',
          priority: 'high',
        },
      ],
    }
    const result = ClaudeCodeDocOutputSchema.parse(valid)
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks![0].priority).toBe('high')
  })
})

describe('MockClaudeRunner', () => {
  it('should return success with mock output', async () => {
    const runner = new MockClaudeRunner()
    const context: RepoContext = {
      repo_name: 'test-repo',
      repo_owner: 'test-owner',
      default_branch: 'main',
      file_tree: [],
      key_files: [],
      total_files: 0,
      round: 1,
      max_rounds: 3,
    }

    const result = await runner.run(context)

    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()
    expect(result.output!.pages.length).toBeGreaterThan(0)
  })

  it('should customize output with repo name', async () => {
    const runner = new MockClaudeRunner()
    const context: RepoContext = {
      repo_name: 'my-custom-repo',
      repo_owner: 'test-owner',
      default_branch: 'main',
      file_tree: [],
      key_files: [],
      total_files: 0,
      round: 1,
      max_rounds: 3,
    }

    const result = await runner.run(context)

    expect(result.output!.repo_summary.name).toBe('my-custom-repo')
  })

  it('should accept custom fixtures', async () => {
    const runner = new MockClaudeRunner()
    const customOutput: ClaudeCodeDocOutput = {
      repo_summary: {
        name: 'custom',
        tech_stack: ['Go'],
        entrypoints: ['main.go'],
      },
      warnings: [],
      pages: [
        {
          category: 'RUNBOOK',
          slug: 'runbook/local-dev',
          title: 'Local Dev',
          markdown: '# Local Development',
          evidence: [],
        },
      ],
    }

    runner.addFixture('custom-owner/custom-repo', customOutput)

    const context: RepoContext = {
      repo_name: 'custom-repo',
      repo_owner: 'custom-owner',
      default_branch: 'main',
      file_tree: [],
      key_files: [],
      total_files: 0,
      round: 1,
      max_rounds: 3,
    }

    const result = await runner.run(context)

    expect(result.output!.repo_summary.tech_stack).toContain('Go')
  })
})

describe('normalizeSlug', () => {
  it('should lowercase and replace invalid chars', () => {
    expect(normalizeSlug('Architecture/Overview')).toBe('architecture/overview')
    expect(normalizeSlug('API_Endpoints')).toBe('api-endpoints')
    expect(normalizeSlug('features/User Auth')).toBe('features/user-auth')
  })

  it('should remove leading/trailing hyphens', () => {
    expect(normalizeSlug('-test-')).toBe('test')
    expect(normalizeSlug('--double--')).toBe('double')
  })

  it('should collapse multiple hyphens', () => {
    expect(normalizeSlug('test---multiple')).toBe('test-multiple')
  })
})

describe('getCategoryFromSlug', () => {
  it('should extract valid categories', () => {
    expect(getCategoryFromSlug('architecture/overview')).toBe('ARCHITECTURE')
    expect(getCategoryFromSlug('api/endpoints')).toBe('API')
    expect(getCategoryFromSlug('feature/auth')).toBe('FEATURE')
    expect(getCategoryFromSlug('runbook/local-dev')).toBe('RUNBOOK')
  })

  it('should return null for invalid categories', () => {
    expect(getCategoryFromSlug('invalid/page')).toBeNull()
    expect(getCategoryFromSlug('other/stuff')).toBeNull()
  })
})
