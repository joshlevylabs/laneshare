import { describe, it, expect } from 'vitest'
import {
  estimateTokens,
  detectLanguage,
  shouldIndexFile,
  chunkCode,
  chunkMarkdown,
  slugify,
  formatDate,
  formatRelativeTime,
} from './index'

describe('estimateTokens', () => {
  it('estimates tokens based on character count', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('hello')).toBe(2) // 5 chars / 4 = 1.25 -> ceil = 2
    expect(estimateTokens('hello world test')).toBe(4) // 16 chars / 4 = 4
  })
})

describe('detectLanguage', () => {
  it('detects TypeScript files', () => {
    expect(detectLanguage('file.ts')).toBe('typescript')
    expect(detectLanguage('component.tsx')).toBe('typescript')
  })

  it('detects JavaScript files', () => {
    expect(detectLanguage('file.js')).toBe('javascript')
    expect(detectLanguage('component.jsx')).toBe('javascript')
  })

  it('detects Python files', () => {
    expect(detectLanguage('script.py')).toBe('python')
  })

  it('detects Go files', () => {
    expect(detectLanguage('main.go')).toBe('go')
  })

  it('returns null for unknown extensions', () => {
    expect(detectLanguage('file.xyz')).toBe(null)
    expect(detectLanguage('noextension')).toBe(null)
  })
})

describe('shouldIndexFile', () => {
  it('accepts code files under size limit', () => {
    expect(shouldIndexFile('src/index.ts', 1000)).toBe(true)
    expect(shouldIndexFile('lib/utils.py', 10000)).toBe(true)
  })

  it('accepts documentation files', () => {
    expect(shouldIndexFile('README.md', 5000)).toBe(true)
    expect(shouldIndexFile('docs/guide.txt', 1000)).toBe(true)
  })

  it('rejects files over size limit', () => {
    expect(shouldIndexFile('large.ts', 600000)).toBe(false)
  })

  it('rejects files in skip patterns', () => {
    expect(shouldIndexFile('node_modules/package/index.js', 100)).toBe(false)
    expect(shouldIndexFile('.git/config', 100)).toBe(false)
    expect(shouldIndexFile('dist/bundle.js', 100)).toBe(false)
  })

  it('rejects binary files', () => {
    expect(shouldIndexFile('image.png', 100)).toBe(false)
    expect(shouldIndexFile('binary.exe', 100)).toBe(false)
  })
})

describe('chunkCode', () => {
  it('chunks TypeScript code by functions', () => {
    const code = `
function hello() {
  console.log('hello')
}

function world() {
  console.log('world')
}
`
    const chunks = chunkCode(code, 'typescript')
    expect(chunks.length).toBeGreaterThanOrEqual(1)
  })

  it('handles empty content', () => {
    const chunks = chunkCode('', 'typescript')
    expect(chunks).toEqual([''])
  })
})

describe('chunkMarkdown', () => {
  it('chunks markdown by headings', () => {
    const markdown = `
# Heading 1
Content under heading 1

## Heading 2
Content under heading 2
`
    const chunks = chunkMarkdown(markdown)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
  })
})

describe('slugify', () => {
  it('converts text to slug format', () => {
    expect(slugify('Hello World')).toBe('hello-world')
    expect(slugify('Test 123')).toBe('test-123')
    expect(slugify('Special!@#Characters')).toBe('special-characters')
  })

  it('handles edge cases', () => {
    expect(slugify('')).toBe('')
    expect(slugify('---')).toBe('')
  })
})

describe('formatDate', () => {
  it('formats date strings', () => {
    const date = '2024-01-15T12:00:00Z'
    const formatted = formatDate(date)
    expect(formatted).toContain('Jan')
    expect(formatted).toContain('15')
    expect(formatted).toContain('2024')
  })
})

describe('formatRelativeTime', () => {
  it('formats recent times', () => {
    const now = new Date()
    const result = formatRelativeTime(now)
    expect(result).toBe('just now')
  })

  it('formats minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000)
    const result = formatRelativeTime(date)
    expect(result).toMatch(/\d+m ago/)
  })

  it('formats hours ago', () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const result = formatRelativeTime(date)
    expect(result).toMatch(/\d+h ago/)
  })

  it('formats days ago', () => {
    const date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    const result = formatRelativeTime(date)
    expect(result).toMatch(/\d+d ago/)
  })
})
