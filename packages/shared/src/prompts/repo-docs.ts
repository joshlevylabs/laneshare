/**
 * Claude Code Wrapper Prompts for Repository Documentation Generation
 *
 * This module contains the prompt templates used to instruct Claude Code
 * to generate comprehensive, evidence-grounded documentation for GitHub repositories.
 */

import type { RepoContext, RepoDocCategory } from '../types'

/**
 * System prompt that establishes Claude Code's role as a documentation generator
 */
export const REPO_DOC_SYSTEM_PROMPT = `You are Claude Code, an expert documentation generator. Your task is to analyze a GitHub repository and produce comprehensive, well-structured documentation.

CRITICAL RULES:
1. Output ONLY valid JSON - no prose, comments, or markdown outside the JSON structure.
2. Every major claim MUST have at least one evidence item with file_path, excerpt (≤15 lines, ≤1200 chars), and reason.
3. If you cannot provide evidence for a claim, mark that section with "**[Needs Review]**" and include a warning.
4. Be accurate and grounded - do not hallucinate features, files, or capabilities that aren't evident in the code.
5. Focus on practical, actionable documentation that helps developers understand and work with the codebase.

OUTPUT FORMAT:
Return a single JSON object with this exact structure:
{
  "repo_summary": {
    "name": "repo-name",
    "tech_stack": ["typescript", "react", "postgresql"],
    "entrypoints": ["src/index.ts", "src/server.ts"]
  },
  "warnings": ["List any issues or gaps found"],
  "needs_more_files": ["path/to/file1", "path/to/file2"],  // ONLY if more context is needed
  "pages": [
    {
      "category": "ARCHITECTURE|API|FEATURE|RUNBOOK",
      "slug": "architecture/overview",
      "title": "Architecture Overview",
      "markdown": "# Architecture Overview\\n\\n...",
      "evidence": [
        {"file_path": "src/index.ts", "excerpt": "...", "reason": "Shows main entry point"}
      ]
    }
  ],
  "tasks": [
    {"title": "Document authentication flow", "description": "...", "category": "API", "priority": "medium"}
  ]
}`

/**
 * Build the documentation generation prompt for Claude Code
 */
export function buildRepoDocPrompt(context: RepoContext): string {
  const parts: string[] = []

  // Header with repo info
  parts.push(`# Repository Documentation Task

Generate comprehensive documentation for the following repository:
- **Repository**: ${context.repo_owner}/${context.repo_name}
- **Branch**: ${context.default_branch}
- **Total Files**: ${context.total_files}
- **Round**: ${context.round}/${context.max_rounds}
`)

  // File tree section
  parts.push(`## File Structure

\`\`\`
${formatFileTree(context.file_tree)}
\`\`\`
`)

  // Key files section
  if (context.key_files.length > 0) {
    parts.push(`## Key Files Content

The following key files have been provided for analysis:
`)
    for (const file of context.key_files) {
      parts.push(`### ${file.path}${file.language ? ` (${file.language})` : ''}

\`\`\`${file.language || ''}
${file.content}
\`\`\`
`)
    }
  }

  // Instructions for what to generate
  parts.push(`## Required Documentation Pages

Generate the following documentation pages. If you lack sufficient context for a page, include a warning and mark uncertain sections with "[Needs Review]".

### ARCHITECTURE (Required)
1. **architecture/overview** - High-level system architecture, components, and their relationships
2. **architecture/tech-stack** - Technologies, frameworks, and dependencies with versions
3. **architecture/services-and-integrations** - External services, APIs, and third-party integrations
4. **architecture/data-model** - Database schema, data structures, and relationships (if applicable)
5. **architecture/deployment** - How the application is deployed, infrastructure, and environments
6. **architecture/decisions** - Key architectural decisions (ADRs) found or inferred

### API (Required if API exists)
1. **api/overview** - API architecture, patterns, and conventions used
2. **api/endpoints** - List of endpoints grouped by resource/area
3. **api/auth** - Authentication and authorization mechanisms
4. **api/errors-and-status-codes** - Error handling patterns and status codes

### FEATURES (Required)
1. **features/index** - Overview of major features with confidence levels
2. **features/[feature-name]** - One page per major feature (top 3-5 features)

### RUNBOOK (Required)
1. **runbook/local-dev** - Local development setup instructions
2. **runbook/deployments** - Deployment procedures and CI/CD
3. **runbook/observability** - Logging, monitoring, and metrics
4. **runbook/troubleshooting** - Common issues and solutions
5. **runbook/security** - Security practices, secrets management, access control
`)

  // Evidence requirements
  parts.push(`## Evidence Requirements

For EVERY major claim or fact in your documentation:
1. Include an evidence item with:
   - \`file_path\`: The path to the source file
   - \`excerpt\`: The relevant code snippet (≤15 lines, ≤1200 characters)
   - \`reason\`: Why this evidence supports the claim

If you cannot find evidence:
- Mark the section with "**[Needs Review]**"
- Add a warning explaining what evidence is missing
- Still include the documentation with your best understanding
`)

  // Request more files if needed
  if (context.round < context.max_rounds) {
    parts.push(`## Need More Files?

If you need additional files to complete the documentation accurately, include them in the \`needs_more_files\` array. You have ${context.max_rounds - context.round} more round(s) available.

Prioritize requesting:
- Configuration files you haven't seen
- Entry points and main application files
- Key business logic files
- Database schema/migration files
- API route definitions
`)
  }

  // Final output reminder
  parts.push(`## Output Format

Return ONLY a valid JSON object following the schema in the system prompt. Do not include any text outside the JSON.

Remember:
- Slug format: \`category/page-name\` (lowercase, hyphens)
- Markdown should be well-formatted with headers, code blocks, and lists
- Evidence excerpts must be actual code from the provided files
- If uncertain, add warnings and "[Needs Review]" markers rather than guessing
`)

  return parts.join('\n')
}

/**
 * Format file tree for display in prompt
 */
function formatFileTree(files: Array<{ path: string; size: number; language?: string }>): string {
  // Group by directory and show tree structure
  const tree = new Map<string, string[]>()

  for (const file of files) {
    const parts = file.path.split('/')
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.'
    const filename = parts[parts.length - 1]

    if (!tree.has(dir)) {
      tree.set(dir, [])
    }
    tree.get(dir)!.push(filename)
  }

  const lines: string[] = []
  const sortedDirs = Array.from(tree.keys()).sort()

  for (const dir of sortedDirs) {
    if (dir !== '.') {
      lines.push(`${dir}/`)
    }
    const filesInDir = tree.get(dir)!.sort()
    for (const file of filesInDir) {
      lines.push(dir === '.' ? file : `  ${file}`)
    }
  }

  // Truncate if too long
  if (lines.length > 200) {
    return lines.slice(0, 200).join('\n') + `\n... and ${lines.length - 200} more files`
  }

  return lines.join('\n')
}

/**
 * Key file patterns to prioritize for initial context
 * These patterns help identify the most important files to fetch first
 */
export const KEY_FILE_PATTERNS = {
  // Package managers and dependencies
  dependencies: [
    'package.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
    'Cargo.toml',
    'go.mod',
    'requirements.txt',
    'pyproject.toml',
    'Gemfile',
    'composer.json',
  ],

  // Configuration files
  config: [
    'tsconfig.json',
    'next.config.js',
    'next.config.mjs',
    'next.config.ts',
    'vite.config.ts',
    'webpack.config.js',
    '.env.example',
    '.env.local.example',
    'config/default.json',
    'config/production.json',
  ],

  // Entry points
  entrypoints: [
    'src/index.ts',
    'src/index.tsx',
    'src/main.ts',
    'src/main.tsx',
    'src/app.ts',
    'src/server.ts',
    'main.go',
    'cmd/main.go',
    'app.py',
    'main.py',
    'server.py',
    'index.js',
    'server.js',
    'app.js',
  ],

  // Documentation
  docs: [
    'README.md',
    'readme.md',
    'CONTRIBUTING.md',
    'ARCHITECTURE.md',
    'docs/README.md',
    'API.md',
  ],

  // Infrastructure
  infra: [
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    'vercel.json',
    '.github/workflows/deploy.yml',
    '.github/workflows/ci.yml',
    'terraform/main.tf',
    'k8s/deployment.yaml',
    'kubernetes/deployment.yaml',
  ],

  // Database
  database: [
    'prisma/schema.prisma',
    'drizzle.config.ts',
    'supabase/migrations/',
    'migrations/',
    'db/schema.rb',
    'alembic/',
  ],

  // API specs
  api: [
    'openapi.yaml',
    'openapi.json',
    'swagger.yaml',
    'swagger.json',
    'api-spec.yaml',
  ],
}

/**
 * Get priority score for a file path (higher = more important)
 */
export function getFilePriority(path: string): number {
  const lowerPath = path.toLowerCase()

  // Highest priority: README and main config
  if (lowerPath === 'readme.md' || lowerPath === 'package.json') {
    return 100
  }

  // High priority: entry points
  if (KEY_FILE_PATTERNS.entrypoints.some(p => lowerPath.endsWith(p.toLowerCase()))) {
    return 80
  }

  // High priority: config files
  if (KEY_FILE_PATTERNS.config.some(p => lowerPath.endsWith(p.toLowerCase()))) {
    return 70
  }

  // Medium priority: documentation
  if (KEY_FILE_PATTERNS.docs.some(p => lowerPath.includes(p.toLowerCase()))) {
    return 60
  }

  // Medium priority: infrastructure
  if (KEY_FILE_PATTERNS.infra.some(p => lowerPath.includes(p.toLowerCase()))) {
    return 50
  }

  // Medium priority: database
  if (KEY_FILE_PATTERNS.database.some(p => lowerPath.includes(p.toLowerCase()))) {
    return 50
  }

  // Lower priority: API routes and handlers
  if (lowerPath.includes('/api/') || lowerPath.includes('/routes/') || lowerPath.includes('/controllers/')) {
    return 40
  }

  // Lower priority: source files
  if (lowerPath.includes('/src/') || lowerPath.includes('/lib/') || lowerPath.includes('/app/')) {
    return 30
  }

  // Lowest priority: tests
  if (lowerPath.includes('test') || lowerPath.includes('spec') || lowerPath.includes('__tests__')) {
    return 10
  }

  // Default
  return 20
}

/**
 * Category-specific prompts for focused regeneration
 */
export const CATEGORY_PROMPTS: Record<RepoDocCategory, string> = {
  ARCHITECTURE: `Focus on generating Architecture documentation:
- System overview and component relationships
- Technology stack with versions
- External services and integrations
- Data model and database schema
- Deployment architecture
- Key architectural decisions

Pay special attention to:
- How components communicate
- Data flow through the system
- Scalability considerations
- Key design patterns used`,

  API: `Focus on generating API documentation:
- API architecture and patterns
- All endpoints with methods, paths, and parameters
- Request/response formats with examples
- Authentication and authorization
- Error codes and handling
- Rate limiting and quotas

Pay special attention to:
- REST vs GraphQL vs other patterns
- API versioning strategy
- Common request headers
- Pagination patterns`,

  FEATURE: `Focus on generating Feature documentation:
- Identify major user-facing features
- Document each feature's purpose and behavior
- Include code paths and key files
- Note dependencies between features
- Highlight configuration options

Pay special attention to:
- User workflows and journeys
- Feature flags or toggles
- Integration points
- Known limitations`,

  RUNBOOK: `Focus on generating Runbook/Operations documentation:
- Local development setup
- Build and deployment procedures
- Monitoring and alerting
- Troubleshooting guides
- Security practices

Pay special attention to:
- Required environment variables
- Database setup and migrations
- CI/CD pipeline steps
- Common issues and solutions`,
}

/**
 * Build a follow-up prompt for requesting additional files
 */
export function buildRepoDocFollowUpPrompt(
  context: RepoContext,
  previousOutput: { warnings: string[]; needs_more_files: string[] }
): string {
  const parts: string[] = []

  parts.push(`# Follow-up: Additional Files Provided

You previously analyzed ${context.repo_owner}/${context.repo_name} and requested additional files.

## Previously Identified Issues
${previousOutput.warnings.map(w => `- ${w}`).join('\n')}

## Requested Files That Are Now Provided
${previousOutput.needs_more_files.map(f => `- ${f}`).join('\n')}

## Additional Key Files
`)

  for (const file of context.key_files) {
    parts.push(`### ${file.path}

\`\`\`${file.language || ''}
${file.content}
\`\`\`
`)
  }

  parts.push(`## Task

Using the additional context, please update your documentation:
1. Fill in any "[Needs Review]" sections you can now address
2. Add more evidence where you previously had gaps
3. Update any incorrect assumptions
4. Generate any pages you couldn't complete before

Return the COMPLETE updated JSON output (all pages, not just changes).
`)

  return parts.join('\n')
}
