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

CRITICAL RULES - READ CAREFULLY:
1. Output ONLY valid JSON - no prose, comments, or markdown outside the JSON structure.
2. Every major claim MUST have at least one evidence item with file_path, excerpt (≤15 lines, ≤1200 chars), and reason.
3. If you cannot provide evidence for a claim, mark that section with "**[Needs Review]**" and include a warning.
4. Be accurate and grounded - do not hallucinate features, files, or capabilities that aren't evident in the code.
5. Focus on practical, actionable documentation that helps developers understand and work with the codebase.

====================================================================
CRITICAL ANTI-HALLUCINATION RULES - FAILURE TO FOLLOW = INVALID OUTPUT
====================================================================

⚠️ MOST IMPORTANT RULE - IGNORE THE REPOSITORY NAME:
- DO NOT infer what the application does from its name.
- The repository name is JUST A LABEL - it tells you NOTHING about functionality.
- A repo named "LaneShare" might be a code collaboration tool, NOT a lane/parking sharing app.
- A repo named "CloudKitchen" might be a database library, NOT a food delivery app.
- ONLY determine purpose by reading the ACTUAL CODE provided below.

⚠️ DERIVE UNDERSTANDING ONLY FROM PROVIDED CODE:
- Read the package.json dependencies to understand the tech stack.
- Read the actual source files to understand what the code does.
- Look at component names, function names, API routes, and database schemas.
- If a file contains "ProjectSidebar", "ReposList", "TaskBoard" - document THOSE features.
- If a file imports "@supabase/supabase-js" - the app uses Supabase, not a custom database.

⚠️ EVIDENCE-FIRST DOCUMENTATION:
- Before writing ANY feature description, find the code that implements it.
- If you cannot point to specific code, the feature DOES NOT EXIST.
- Every feature claim must cite actual function names, component names, or API routes from the provided files.
- Do NOT describe features based on what "makes sense" or what you "expect" - only what you SEE.

⚠️ WHEN IN DOUBT, SAY "I DON'T KNOW":
- If the provided files don't clearly show a feature, mark it [Needs Review].
- It is better to have incomplete documentation than WRONG documentation.
- Wrong documentation is worse than no documentation.

ANTI-HALLUCINATION CHECKLIST (verify before each claim):
□ Can I point to a specific file and line that proves this?
□ Am I describing what the code DOES, not what the name SUGGESTS?
□ Did I copy the evidence VERBATIM from the provided files?
□ Would a developer reading the actual code agree with my description?
□ Am I making zero assumptions based on the project/repo name?

- ONLY document what you can SEE in the provided files. Do not assume or infer functionality that isn't explicitly shown.
- Evidence excerpts MUST be EXACT copies from the provided file contents. Do not paraphrase or modify code snippets.
- If you're unsure about something, say so with "[Needs Review]" rather than guessing.
- Do NOT make up file paths, function names, or code that wasn't provided.
- Do NOT assume typical patterns exist unless you see them in the actual code.
- When documenting features, only describe what the code actually does, not what it "probably" does.
- If a file wasn't provided, do not create evidence from it - instead note it as a gap.

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

⚠️ CRITICAL REMINDER: The repository name "${context.repo_name}" is JUST A LABEL. DO NOT use the name to guess what the application does. Read the actual code files below to understand the application's purpose and features. The name could be completely unrelated to the actual functionality.
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

### FEATURES (Required) - MUST BE DERIVED FROM CODE, NOT THE REPO NAME
1. **features/index** - Overview of major features with confidence levels
   - List ONLY features you can see implemented in the provided code
   - Each feature MUST reference specific components, functions, or API routes
   - DO NOT invent features based on what the repo name suggests
2. **features/[feature-name]** - One page per major feature (top 3-5 features)
   - Feature names should match actual component/module names in the code
   - E.g., if you see "TaskBoard.tsx", document "Task Management", not made-up features

### RUNBOOK (Required)
1. **runbook/local-dev** - Local development setup instructions
2. **runbook/deployments** - Deployment procedures and CI/CD
3. **runbook/observability** - Logging, monitoring, and metrics
4. **runbook/troubleshooting** - Common issues and solutions
5. **runbook/security** - Security practices, secrets management, access control
`)

  // Evidence requirements
  parts.push(`## Evidence Requirements (CRITICAL)

For EVERY major claim or fact in your documentation:
1. Include an evidence item with:
   - \`file_path\`: The EXACT path from the provided files (must match exactly)
   - \`excerpt\`: VERBATIM code copied from the provided file (≤15 lines, ≤1200 characters)
   - \`reason\`: Why this evidence supports the claim

IMPORTANT - Evidence Quality Rules:
- Excerpts must be EXACT copies, not paraphrased or modified
- File paths must match files that were provided to you
- Do NOT fabricate evidence - if you can't cite real code, mark it [Needs Review]
- Your documentation will be AUTOMATICALLY VERIFIED against actual files

If you cannot find evidence:
- Mark the section with "**[Needs Review]**"
- Add a warning explaining what evidence is missing
- Still include the documentation with your best understanding
- Note: Pages without valid evidence will be flagged for manual review
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

⚠️ FINAL CHECK BEFORE OUTPUT:
1. Did you base your documentation on the ACTUAL CODE FILES provided above?
2. Did you IGNORE the repository name when determining what the app does?
3. Does every feature you documented have evidence from the actual code?
4. If a developer reads your docs and looks at the code, will they match?
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

  // High priority: Prisma schema (critical for data model documentation)
  if (lowerPath.endsWith('schema.prisma') || lowerPath.endsWith('prisma/schema.prisma')) {
    return 95
  }

  // High priority: Database migrations (newest first for schema understanding)
  if ((lowerPath.includes('migrations/') || lowerPath.includes('supabase/')) && lowerPath.endsWith('.sql')) {
    return 85
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

  // Medium priority: database config (drizzle, etc.)
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

⚠️ CRITICAL: Features must be discovered from CODE, not guessed from the repository name!
- Look at actual component files (*.tsx, *.ts) to find features
- Look at API route files to understand what operations are supported
- Look at database schemas to understand the data model
- The feature list should match what you SEE in the code, not what the name suggests

- Identify major user-facing features BY READING THE CODE
- Document each feature's purpose and behavior BASED ON CODE EVIDENCE
- Include code paths and key files (with REAL file paths from the repo)
- Note dependencies between features (that you can SEE in imports)
- Highlight configuration options (that EXIST in config files)

Pay special attention to:
- Component names in /components folders - these reveal actual features
- API routes in /api folders - these show what operations exist
- Database tables and schemas - these show what data is managed
- Package.json dependencies - these reveal the tech stack`,

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
 * Build a continuation prompt when the previous response was truncated
 * This asks Claude to continue generating pages from where it left off
 */
export function buildRepoDocContinuationPrompt(
  context: RepoContext,
  completedPages: Array<{ category: string; slug: string; title: string }>,
  partialPageInfo?: { category: string; slug: string; title: string }
): string {
  const parts: string[] = []

  parts.push(`# Continuation: Complete Documentation Generation

You were generating documentation for ${context.repo_owner}/${context.repo_name} but the response was truncated.

⚠️ REMINDER: Continue to base ALL documentation on the actual code files, NOT the repository name. The repo name is just a label and tells you nothing about the app's functionality.

## Already Completed Pages
The following pages have been successfully generated and saved:
${completedPages.length > 0 ? completedPages.map(p => `- ${p.category}/${p.slug}: "${p.title}"`).join('\n') : '(none yet)'}

${partialPageInfo ? `## Partial Page (discard and regenerate)
The following page was partially generated and needs to be regenerated:
- ${partialPageInfo.category}/${partialPageInfo.slug}: "${partialPageInfo.title}"
` : ''}

## Task
Continue generating the remaining documentation pages. Do NOT regenerate pages that are already completed above.

Focus on generating the pages that haven't been completed yet from this list:
- architecture/overview, architecture/tech-stack, architecture/services-and-integrations, architecture/data-model, architecture/deployment, architecture/decisions
- api/overview, api/endpoints, api/auth, api/errors-and-status-codes
- features/index, features/[feature-specific pages]
- runbook/local-dev, runbook/deployments, runbook/observability, runbook/troubleshooting, runbook/security

Return a JSON object with the same structure as before, but ONLY include pages you are generating in this continuation.
Include the repo_summary, warnings array, and any needs_more_files if applicable.

IMPORTANT: Output ONLY valid JSON. Start your response with \`{\` and ensure it ends with \`}\`.
`)

  return parts.join('\n')
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
