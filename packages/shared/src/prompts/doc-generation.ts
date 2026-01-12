import type { Repo } from '../types'

export interface FileTreeItem {
  path: string
  size: number
  language?: string
}

export interface ChunkSummary {
  filePath: string
  content: string
  repoName: string
}

export interface ArchitecturePromptContext {
  repoOwner: string
  repoName: string
  fileTree: FileTreeItem[]
  keyChunks: ChunkSummary[]
}

export interface FeaturesPromptContext {
  repoOwner: string
  repoName: string
  readmeContent?: string
  routeFiles: string[]
  keyChunks: ChunkSummary[]
}

export interface MultiRepoPromptContext {
  projectName: string
  repos: Array<{
    owner: string
    name: string
    techStack: string[]
    description: string
  }>
  sharedPatterns: string[]
  crossRepoChunks: ChunkSummary[]
}

export function buildArchitectureDocPrompt(context: ArchitecturePromptContext): string {
  const parts: string[] = []

  parts.push(`You are a technical documentation expert. Generate comprehensive architecture documentation for the following repository.

## Repository: ${context.repoOwner}/${context.repoName}

## File Structure Summary:`)

  // Group files by directory for better overview
  const filesByDir: Record<string, FileTreeItem[]> = {}
  for (const file of context.fileTree.slice(0, 150)) {
    const dir = file.path.split('/').slice(0, -1).join('/') || '.'
    if (!filesByDir[dir]) filesByDir[dir] = []
    filesByDir[dir].push(file)
  }

  for (const [dir, files] of Object.entries(filesByDir).slice(0, 30)) {
    parts.push(`\n### ${dir}/`)
    for (const file of files.slice(0, 10)) {
      const lang = file.language ? ` (${file.language})` : ''
      parts.push(`- ${file.path.split('/').pop()}${lang}`)
    }
    if (files.length > 10) {
      parts.push(`- ... and ${files.length - 10} more files`)
    }
  }

  parts.push(`\n## Key Files:`)
  for (const chunk of context.keyChunks.slice(0, 15)) {
    parts.push(`\n### ${chunk.filePath}`)
    parts.push('```')
    parts.push(chunk.content.slice(0, 800))
    parts.push('```')
  }

  parts.push(`
## Task:
Generate comprehensive architecture documentation in Markdown format. Include:

1. **Tech Stack** - Languages, frameworks, major dependencies with versions if visible
2. **Project Structure** - Explain the directory layout and how code is organized
3. **Architecture Patterns** - Design patterns used (MVC, microservices, monorepo, etc.)
4. **Key Components** - Main modules/packages and their responsibilities
5. **Entry Points** - Main files, how the application starts
6. **Configuration** - Build tools, environment setup, config files

Output clean Markdown starting with "# Architecture Overview". Be specific and reference actual file paths from the repository.`)

  return parts.join('\n')
}

export function buildFeaturesDocPrompt(context: FeaturesPromptContext): string {
  const parts: string[] = []

  parts.push(`You are a technical documentation expert. Generate feature documentation for the following repository.

## Repository: ${context.repoOwner}/${context.repoName}`)

  if (context.readmeContent) {
    parts.push(`\n## README Content:`)
    parts.push(context.readmeContent.slice(0, 3000))
  }

  if (context.routeFiles.length > 0) {
    parts.push(`\n## Routes/Endpoints Found:`)
    for (const route of context.routeFiles.slice(0, 30)) {
      parts.push(`- ${route}`)
    }
  }

  parts.push(`\n## Key Code Samples:`)
  for (const chunk of context.keyChunks.slice(0, 12)) {
    parts.push(`\n### ${chunk.filePath}`)
    parts.push('```')
    parts.push(chunk.content.slice(0, 600))
    parts.push('```')
  }

  parts.push(`
## Task:
Generate user-friendly feature documentation in Markdown format. Include:

1. **Overview** - What this application/library does (2-3 sentences)
2. **Main Features** - Bullet list of key functionality
3. **User Flows** - Common use cases and how users accomplish them
4. **API Endpoints** - If applicable, list main endpoints and their purposes
5. **Key Components** - Important modules users should know about

Output clean Markdown starting with "# Features". Focus on what the software DOES, not how it's built. Be specific and reference actual functionality from the code.`)

  return parts.join('\n')
}

export function buildMultiRepoDocPrompt(context: MultiRepoPromptContext): string {
  const parts: string[] = []

  parts.push(`You are a technical documentation expert documenting how multiple repositories in a project work together.

## Project: ${context.projectName}

## Repositories:`)

  for (const repo of context.repos) {
    parts.push(`\n### ${repo.owner}/${repo.name}`)
    parts.push(`- **Tech Stack:** ${repo.techStack.join(', ') || 'Unknown'}`)
    parts.push(`- **Description:** ${repo.description}`)
  }

  if (context.sharedPatterns.length > 0) {
    parts.push(`\n## Detected Integration Patterns:`)
    for (const pattern of context.sharedPatterns) {
      parts.push(`- ${pattern}`)
    }
  }

  if (context.crossRepoChunks.length > 0) {
    parts.push(`\n## Cross-Repo Code References:`)
    for (const chunk of context.crossRepoChunks.slice(0, 10)) {
      parts.push(`\n### ${chunk.repoName}: ${chunk.filePath}`)
      parts.push('```')
      parts.push(chunk.content.slice(0, 500))
      parts.push('```')
    }
  }

  parts.push(`
## Task:
Generate documentation explaining how these repositories work together. Include:

1. **System Overview** - How these repos form a complete system
2. **Data Flow** - How data moves between services/packages
3. **Shared Contracts** - Common types, API schemas, or protocols
4. **Integration Points** - Where and how repos communicate (APIs, shared packages, events)
5. **Development Workflow** - How to develop features that span multiple repos

Output clean Markdown starting with "# Multi-Repository Architecture". Be specific about how the repos actually connect based on the code patterns found.`)

  return parts.join('\n')
}

// Helper to identify important files for architecture docs
export const ARCHITECTURE_PRIORITY_PATTERNS = [
  'package.json',
  'tsconfig.json',
  'next.config',
  'vite.config',
  'webpack.config',
  'Dockerfile',
  'docker-compose',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  '.env.example',
  'src/index',
  'src/main',
  'src/app',
  'app/layout',
  'app/page',
  'lib/',
  'core/',
  'config/',
]

// Helper to identify important files for feature docs
export const FEATURES_PRIORITY_PATTERNS = [
  'README',
  'readme',
  'routes/',
  'pages/',
  'app/api/',
  'api/',
  'handlers/',
  'controllers/',
  'components/',
  'views/',
  'screens/',
  'features/',
]

// Helper to detect cross-repo patterns
export const CROSS_REPO_PATTERNS = [
  /from ['"]@\w+\//,          // Monorepo imports
  /import.*from ['"]\.\.\//, // Relative imports that might cross packages
  /fetch\(['"]\/api\//,      // API calls
  /axios\./,                  // HTTP client usage
  /\.env/,                    // Environment config
  /process\.env\./,          // Environment variables
]
