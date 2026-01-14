/**
 * Tests for Repo Docs Prompt Templates
 */

import { describe, it, expect } from 'vitest'
import {
  buildRepoDocPrompt,
  buildRepoDocFollowUpPrompt,
  getFilePriority,
  KEY_FILE_PATTERNS,
  REPO_DOC_SYSTEM_PROMPT,
} from './repo-docs'
import type { RepoContext } from '../types'

describe('REPO_DOC_SYSTEM_PROMPT', () => {
  it('should include critical rules', () => {
    expect(REPO_DOC_SYSTEM_PROMPT).toContain('CRITICAL RULES')
    expect(REPO_DOC_SYSTEM_PROMPT).toContain('valid JSON')
    expect(REPO_DOC_SYSTEM_PROMPT).toContain('evidence')
  })

  it('should define output format', () => {
    expect(REPO_DOC_SYSTEM_PROMPT).toContain('repo_summary')
    expect(REPO_DOC_SYSTEM_PROMPT).toContain('pages')
    expect(REPO_DOC_SYSTEM_PROMPT).toContain('needs_more_files')
  })
})

describe('buildRepoDocPrompt', () => {
  const baseContext: RepoContext = {
    repo_name: 'test-repo',
    repo_owner: 'test-owner',
    default_branch: 'main',
    file_tree: [
      { path: 'src/index.ts', size: 1000, language: 'typescript' },
      { path: 'package.json', size: 500, language: 'json' },
    ],
    key_files: [
      {
        path: 'package.json',
        content: '{ "name": "test-repo" }',
        language: 'json',
      },
    ],
    total_files: 100,
    round: 1,
    max_rounds: 3,
  }

  it('should include repo information', () => {
    const prompt = buildRepoDocPrompt(baseContext)
    expect(prompt).toContain('test-owner/test-repo')
    expect(prompt).toContain('main')
  })

  it('should include file tree', () => {
    const prompt = buildRepoDocPrompt(baseContext)
    expect(prompt).toContain('src/index.ts')
    expect(prompt).toContain('package.json')
  })

  it('should include key file contents', () => {
    const prompt = buildRepoDocPrompt(baseContext)
    expect(prompt).toContain('{ "name": "test-repo" }')
  })

  it('should include required documentation pages', () => {
    const prompt = buildRepoDocPrompt(baseContext)
    expect(prompt).toContain('architecture/overview')
    expect(prompt).toContain('api/overview')
    expect(prompt).toContain('features/index')
    expect(prompt).toContain('runbook/local-dev')
  })

  it('should include evidence requirements', () => {
    const prompt = buildRepoDocPrompt(baseContext)
    expect(prompt).toContain('Evidence Requirements')
    expect(prompt).toContain('file_path')
    expect(prompt).toContain('excerpt')
    expect(prompt).toContain('reason')
  })

  it('should mention remaining rounds when round < max_rounds', () => {
    const prompt = buildRepoDocPrompt(baseContext)
    expect(prompt).toContain('Need More Files')
    expect(prompt).toContain('2 more round(s)')
  })

  it('should not mention more rounds when at max_rounds', () => {
    const maxContext = { ...baseContext, round: 3, max_rounds: 3 }
    const prompt = buildRepoDocPrompt(maxContext)
    expect(prompt).not.toContain('Need More Files')
  })
})

describe('buildRepoDocFollowUpPrompt', () => {
  const baseContext: RepoContext = {
    repo_name: 'test-repo',
    repo_owner: 'test-owner',
    default_branch: 'main',
    file_tree: [],
    key_files: [
      {
        path: 'src/config.ts',
        content: 'export const config = {}',
        language: 'typescript',
      },
    ],
    total_files: 100,
    round: 2,
    max_rounds: 3,
  }

  const previousOutput = {
    warnings: ['Missing database schema', 'API docs incomplete'],
    needs_more_files: ['src/config.ts', 'prisma/schema.prisma'],
  }

  it('should include previous warnings', () => {
    const prompt = buildRepoDocFollowUpPrompt(baseContext, previousOutput)
    expect(prompt).toContain('Missing database schema')
    expect(prompt).toContain('API docs incomplete')
  })

  it('should list requested files', () => {
    const prompt = buildRepoDocFollowUpPrompt(baseContext, previousOutput)
    expect(prompt).toContain('src/config.ts')
    expect(prompt).toContain('prisma/schema.prisma')
  })

  it('should include new file contents', () => {
    const prompt = buildRepoDocFollowUpPrompt(baseContext, previousOutput)
    expect(prompt).toContain('export const config = {}')
  })

  it('should request complete updated output', () => {
    const prompt = buildRepoDocFollowUpPrompt(baseContext, previousOutput)
    expect(prompt).toContain('COMPLETE updated JSON output')
  })
})

describe('getFilePriority', () => {
  it('should give highest priority to README and package.json', () => {
    expect(getFilePriority('README.md')).toBe(100)
    expect(getFilePriority('package.json')).toBe(100)
    expect(getFilePriority('readme.md')).toBe(100)
  })

  it('should give high priority to entry points', () => {
    expect(getFilePriority('src/index.ts')).toBe(80)
    expect(getFilePriority('main.go')).toBe(80)
    expect(getFilePriority('app.py')).toBe(80)
  })

  it('should give high priority to config files', () => {
    expect(getFilePriority('tsconfig.json')).toBe(70)
    expect(getFilePriority('next.config.js')).toBe(70)
  })

  it('should give medium priority to documentation', () => {
    expect(getFilePriority('docs/README.md')).toBe(60)
    expect(getFilePriority('CONTRIBUTING.md')).toBe(60)
  })

  it('should give medium priority to infrastructure', () => {
    expect(getFilePriority('Dockerfile')).toBe(50)
    expect(getFilePriority('docker-compose.yml')).toBe(50)
  })

  it('should give lower priority to API routes', () => {
    expect(getFilePriority('src/api/users.ts')).toBe(40)
    expect(getFilePriority('routes/index.ts')).toBe(40)
  })

  it('should give lower priority to tests', () => {
    expect(getFilePriority('tests/user.test.ts')).toBe(10)
    expect(getFilePriority('__tests__/index.ts')).toBe(10)
  })
})

describe('KEY_FILE_PATTERNS', () => {
  it('should include dependency files', () => {
    expect(KEY_FILE_PATTERNS.dependencies).toContain('package.json')
    expect(KEY_FILE_PATTERNS.dependencies).toContain('requirements.txt')
  })

  it('should include config files', () => {
    expect(KEY_FILE_PATTERNS.config).toContain('tsconfig.json')
    expect(KEY_FILE_PATTERNS.config).toContain('next.config.js')
  })

  it('should include entry points', () => {
    expect(KEY_FILE_PATTERNS.entrypoints).toContain('src/index.ts')
    expect(KEY_FILE_PATTERNS.entrypoints).toContain('main.go')
  })

  it('should include docs', () => {
    expect(KEY_FILE_PATTERNS.docs).toContain('README.md')
    expect(KEY_FILE_PATTERNS.docs).toContain('CONTRIBUTING.md')
  })

  it('should include infra files', () => {
    expect(KEY_FILE_PATTERNS.infra).toContain('Dockerfile')
    expect(KEY_FILE_PATTERNS.infra).toContain('docker-compose.yml')
  })

  it('should include database files', () => {
    expect(KEY_FILE_PATTERNS.database).toContain('prisma/schema.prisma')
    expect(KEY_FILE_PATTERNS.database).toContain('migrations/')
  })

  it('should include API specs', () => {
    expect(KEY_FILE_PATTERNS.api).toContain('openapi.yaml')
    expect(KEY_FILE_PATTERNS.api).toContain('swagger.json')
  })
})
