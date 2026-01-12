import { describe, it, expect } from 'vitest'
import { generateNodeId, generateEdgeId, generateEvidenceId } from './utils/ids'
import { computeFingerprint } from './utils/fingerprint'
import type { AnalysisContext, RepoContext } from '../types/architecture'

describe('Architecture Analyzer Utils', () => {
  describe('generateNodeId', () => {
    it('should generate deterministic node IDs', () => {
      const id1 = generateNodeId('repo', 'uuid-123')
      const id2 = generateNodeId('repo', 'uuid-123')
      expect(id1).toBe(id2)
    })

    it('should generate different IDs for different inputs', () => {
      const id1 = generateNodeId('repo', 'uuid-123')
      const id2 = generateNodeId('repo', 'uuid-456')
      expect(id1).not.toBe(id2)
    })

    it('should include type in the hash', () => {
      const repoId = generateNodeId('repo', 'uuid-123')
      const tableId = generateNodeId('table', 'uuid-123')
      expect(repoId).not.toBe(tableId)
    })

    it('should have correct prefix', () => {
      const id = generateNodeId('screen', 'test')
      expect(id).toMatch(/^node_/)
    })
  })

  describe('generateEdgeId', () => {
    it('should generate deterministic edge IDs', () => {
      const id1 = generateEdgeId('source-1', 'target-1', 'calls')
      const id2 = generateEdgeId('source-1', 'target-1', 'calls')
      expect(id1).toBe(id2)
    })

    it('should generate different IDs for different source/target', () => {
      const id1 = generateEdgeId('source-1', 'target-1', 'calls')
      const id2 = generateEdgeId('source-1', 'target-2', 'calls')
      expect(id1).not.toBe(id2)
    })

    it('should have correct prefix', () => {
      const id = generateEdgeId('source', 'target', 'reads')
      expect(id).toMatch(/^edge_/)
    })
  })

  describe('generateEvidenceId', () => {
    it('should generate deterministic evidence IDs', () => {
      const id1 = generateEvidenceId('FETCH_CALL', 'node-1', 'file.ts', 42)
      const id2 = generateEvidenceId('FETCH_CALL', 'node-1', 'file.ts', 42)
      expect(id1).toBe(id2)
    })

    it('should handle optional parameters', () => {
      const id1 = generateEvidenceId('FETCH_CALL', 'node-1')
      const id2 = generateEvidenceId('FETCH_CALL', 'node-1', undefined, undefined)
      expect(id1).toBe(id2)
    })

    it('should have correct prefix', () => {
      const id = generateEvidenceId('DB_TABLE', 'node')
      expect(id).toMatch(/^evid_/)
    })
  })

  describe('computeFingerprint', () => {
    it('should generate consistent fingerprints', () => {
      const context: AnalysisContext = {
        projectId: 'project-1',
        repos: [
          {
            id: 'repo-1',
            projectId: 'project-1',
            owner: 'user',
            name: 'repo',
            provider: 'github',
            defaultBranch: 'main',
            files: [
              { path: 'package.json', sha: 'abc123' },
              { path: 'app/page.tsx', sha: 'def456' },
            ],
          },
        ],
        existingChunks: new Map(),
      }

      const fp1 = computeFingerprint(context)
      const fp2 = computeFingerprint(context)
      expect(fp1).toBe(fp2)
    })

    it('should change when file SHA changes', () => {
      const context1: AnalysisContext = {
        projectId: 'project-1',
        repos: [
          {
            id: 'repo-1',
            projectId: 'project-1',
            owner: 'user',
            name: 'repo',
            provider: 'github',
            defaultBranch: 'main',
            files: [{ path: 'package.json', sha: 'abc123' }],
          },
        ],
        existingChunks: new Map(),
      }

      const context2: AnalysisContext = {
        ...context1,
        repos: [
          {
            ...context1.repos[0],
            files: [{ path: 'package.json', sha: 'xyz789' }],
          },
        ],
      }

      const fp1 = computeFingerprint(context1)
      const fp2 = computeFingerprint(context2)
      expect(fp1).not.toBe(fp2)
    })

    it('should be deterministic regardless of repo order', () => {
      const repo1: RepoContext = {
        id: 'repo-1',
        projectId: 'project-1',
        owner: 'user',
        name: 'repo1',
        provider: 'github',
        defaultBranch: 'main',
        files: [{ path: 'package.json', sha: 'abc' }],
      }

      const repo2: RepoContext = {
        id: 'repo-2',
        projectId: 'project-1',
        owner: 'user',
        name: 'repo2',
        provider: 'github',
        defaultBranch: 'main',
        files: [{ path: 'package.json', sha: 'def' }],
      }

      const context1: AnalysisContext = {
        projectId: 'project-1',
        repos: [repo1, repo2],
        existingChunks: new Map(),
      }

      const context2: AnalysisContext = {
        projectId: 'project-1',
        repos: [repo2, repo1], // Reversed order
        existingChunks: new Map(),
      }

      const fp1 = computeFingerprint(context1)
      const fp2 = computeFingerprint(context2)
      expect(fp1).toBe(fp2)
    })
  })
})

describe('Route Extraction Patterns', () => {
  it('should match Next.js App Router page patterns', () => {
    const patterns = [
      'app/page.tsx',
      'app/about/page.tsx',
      'app/projects/[id]/page.tsx',
      'src/app/page.tsx',
      'src/app/dashboard/page.ts',
    ]

    const regex = /app\/.*\/page\.(tsx?|jsx?)$|^app\/page\.(tsx?|jsx?)$/

    for (const pattern of patterns) {
      expect(
        regex.test(pattern) || pattern.match(/^(src\/)?app\/page\.(tsx?|jsx?)$/)
      ).toBeTruthy()
    }
  })

  it('should match API route patterns', () => {
    const patterns = [
      'app/api/projects/route.ts',
      'app/api/projects/[id]/route.ts',
      'src/app/api/auth/callback/route.ts',
    ]

    const regex = /app\/api\/.*\/route\.(ts|js)$/

    for (const pattern of patterns) {
      expect(regex.test(pattern)).toBeTruthy()
    }
  })
})

describe('Supabase Query Patterns', () => {
  it('should detect .from() calls', () => {
    const code = `
      const { data } = await supabase
        .from('projects')
        .select('*')
    `
    const match = code.match(/\.from\s*\(\s*["'`]([^"'`]+)["'`]\)/)
    expect(match).toBeTruthy()
    expect(match![1]).toBe('projects')
  })

  it('should detect RPC calls', () => {
    const code = `
      await supabase.rpc('search_chunks', { query })
    `
    const match = code.match(/\.rpc\s*\(\s*["'`]([^"'`]+)["'`]/)
    expect(match).toBeTruthy()
    expect(match![1]).toBe('search_chunks')
  })

  it('should detect insert/update/delete operations', () => {
    const insertCode = `.from('tasks').insert({ title })`
    const updateCode = `.from('tasks').update({ status })`
    const deleteCode = `.from('tasks').delete()`

    expect(insertCode.includes('.insert(')).toBeTruthy()
    expect(updateCode.includes('.update(')).toBeTruthy()
    expect(deleteCode.includes('.delete()')).toBeTruthy()
  })
})

describe('SQL Migration Parsing', () => {
  it('should extract table names from CREATE TABLE', () => {
    const sql = `
      CREATE TABLE public.projects (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL
      );
    `
    const match = sql.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:(\w+)\.)?(\w+)/)
    expect(match).toBeTruthy()
    expect(match![2]).toBe('projects')
  })

  it('should detect RLS enable statements', () => {
    const sql = `
      ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
    `
    const hasRls = sql.includes('ENABLE ROW LEVEL SECURITY')
    expect(hasRls).toBeTruthy()
  })

  it('should extract policy names', () => {
    const sql = `
      CREATE POLICY "Project members can view" ON public.projects
        FOR SELECT USING (is_project_member(id));
    `
    const match = sql.match(/CREATE POLICY\s+"([^"]+)"/)
    expect(match).toBeTruthy()
    expect(match![1]).toBe('Project members can view')
  })
})

describe('Feature Detection', () => {
  const routeToFeatureMap: Record<string, string> = {
    '/projects': 'projects',
    '/projects/[id]/tasks': 'tasks',
    '/chat': 'chat',
    '/docs': 'documentation',
    '/settings': 'settings',
    '/map': 'architecture-map',
  }

  it('should map routes to features correctly', () => {
    for (const [route, expectedFeature] of Object.entries(routeToFeatureMap)) {
      const feature = inferFeature(route)
      expect(feature).toBe(expectedFeature)
    }
  })

  function inferFeature(route: string): string | undefined {
    const featureMap: Record<string, string> = {
      '/projects': 'projects',
      '/tasks': 'tasks',
      '/chat': 'chat',
      '/docs': 'documentation',
      '/settings': 'settings',
      '/map': 'architecture-map',
    }

    for (const [prefix, feature] of Object.entries(featureMap)) {
      if (route.startsWith(prefix) || route.includes(prefix)) {
        return feature
      }
    }
    return undefined
  }
})
