import type { Task, DocPage, SearchResult, Repo } from '../types'

export interface LanePilotContext {
  task?: Task
  projectName: string
  repos: Repo[]
  relevantChunks: SearchResult[]
  relevantDocs: Pick<DocPage, 'slug' | 'title' | 'markdown'>[]
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  userMessage: string
}

export function buildLanePilotSystemPrompt(): string {
  return `You are LanePilot, an AI assistant specialized in generating context-packed coding prompts for external coding agents (Cursor, Claude Code, etc.) and maintaining project documentation.

You are NOT a generic chatbot. Your role is to produce STRUCTURED outputs that help developers work efficiently across multiple repositories.

## Your Capabilities:
1. Generate Context Packs: Curated sets of repo snippets and doc excerpts relevant to a task
2. Create Agent Prompts: Copy-pastable prompts for coding agents, one per repo if needed, plus integration prompts
3. Plan Documentation Updates: Identify which docs need updating and what to write

## Output Format:
You MUST always structure your response in this exact format:

## 1) Context Pack
- **Repos involved:** [list repos]
- **Key files:** [list important files to understand/modify]
- **Relevant snippets:**
  \`\`\`filepath:path/to/file.ts
  [relevant code excerpt]
  \`\`\`
- **Architecture notes:**
  - [bulleted notes about how components interact]

## 2) Agent Prompts
### Prompt A (Repo: <repo-name>)
\`\`\`
[copy/paste prompt for this specific repo]
\`\`\`

### Prompt B (Repo: <repo-name>) [if multiple repos]
\`\`\`
[copy/paste prompt]
\`\`\`

### Integration Prompt (cross-repo)
\`\`\`
[prompt describing how changes across repos should integrate]
\`\`\`

## 3) Verification Checklist
- [ ] [Step to validate the implementation]
- [ ] [Tests to run]
- [ ] [Integration checks]

## 4) Documentation Updates
- **Files to create/update:**
  - \`docs/features/<feature>.md\` - [description of what to add]
  - \`docs/architecture/<component>.md\` - [description of changes]
- **Decision log entry:**
  - Title: [decision title]
  - Context: [why this decision was needed]
  - Decision: [what was decided]
  - Consequences: [what this means going forward]

## 5) Next Turn Questions (if needed)
[Only include if critical information is missing. Prefer making reasonable assumptions.]

## Guidelines:
- Be specific and actionable in your prompts
- Include file paths and code context
- Reference existing patterns in the codebase
- Consider cross-repo dependencies
- Keep prompts focused and atomic where possible
- Use the provided code snippets to ground your suggestions in the actual codebase`
}

export function buildLanePilotUserPrompt(context: LanePilotContext): string {
  const parts: string[] = []

  parts.push(`## Project: ${context.projectName}`)
  parts.push('')

  if (context.task) {
    parts.push(`## Current Task`)
    parts.push(`**Title:** ${context.task.title}`)
    parts.push(`**Status:** ${context.task.status}`)
    parts.push(`**Priority:** ${context.task.priority}`)
    if (context.task.description) {
      parts.push(`**Description:**`)
      parts.push(context.task.description)
    }
    if (context.task.repo_scope && context.task.repo_scope.length > 0) {
      parts.push(`**Repo Scope:** ${context.task.repo_scope.join(', ')}`)
    }
    parts.push('')
  }

  if (context.repos.length > 0) {
    parts.push(`## Connected Repositories`)
    for (const repo of context.repos) {
      parts.push(`- ${repo.owner}/${repo.name} (${repo.default_branch})`)
    }
    parts.push('')
  }

  if (context.relevantChunks.length > 0) {
    parts.push(`## Relevant Code (from vector search)`)
    for (const chunk of context.relevantChunks.slice(0, 10)) {
      const repoName = chunk.repo ? `${chunk.repo.owner}/${chunk.repo.name}` : 'unknown'
      parts.push(`### ${repoName}: ${chunk.file_path}`)
      parts.push('```')
      parts.push(chunk.content.slice(0, 1500))
      parts.push('```')
      parts.push('')
    }
  }

  if (context.relevantDocs.length > 0) {
    parts.push(`## Current Documentation`)
    for (const doc of context.relevantDocs.slice(0, 5)) {
      parts.push(`### ${doc.title} (${doc.slug})`)
      parts.push(doc.markdown.slice(0, 1000))
      parts.push('')
    }
  }

  if (context.chatHistory.length > 0) {
    parts.push(`## Recent Chat History`)
    for (const msg of context.chatHistory.slice(-6)) {
      const role = msg.role === 'user' ? 'User' : 'LanePilot'
      parts.push(`**${role}:** ${msg.content.slice(0, 500)}`)
    }
    parts.push('')
  }

  parts.push(`## User Message`)
  parts.push(context.userMessage)

  return parts.join('\n')
}

export function buildDocUpdatePrompt(
  agentSummary: string,
  existingDocs: DocPage[],
  task?: Task
): string {
  const parts: string[] = []

  parts.push(`You are updating project documentation based on an agent's implementation summary.`)
  parts.push('')
  parts.push(`## Agent Summary`)
  parts.push(agentSummary)
  parts.push('')

  if (task) {
    parts.push(`## Task Context`)
    parts.push(`**Title:** ${task.title}`)
    if (task.description) {
      parts.push(`**Description:** ${task.description}`)
    }
    parts.push('')
  }

  if (existingDocs.length > 0) {
    parts.push(`## Existing Documentation`)
    for (const doc of existingDocs) {
      parts.push(`### ${doc.title} (${doc.slug})`)
      parts.push(doc.markdown.slice(0, 2000))
      parts.push('')
    }
  }

  parts.push(`## Instructions`)
  parts.push(`Based on the agent summary, generate updated documentation in JSON format:`)
  parts.push(`{
  "docUpdates": [
    {
      "slug": "features/feature-name",
      "title": "Feature Title",
      "category": "features",
      "markdown": "# Feature Title\\n\\nContent here..."
    }
  ],
  "taskStatusUpdate": "DONE" | "IN_PROGRESS" | null,
  "decisionLog": {
    "title": "Decision title",
    "context": "Why this decision was made",
    "decision": "What was decided",
    "consequences": "Impact of this decision"
  } | null
}`)

  return parts.join('\n')
}

export const CHUNKING_CONFIG = {
  maxTokensPerChunk: 1000,
  overlapTokens: 100,
  minChunkSize: 50,
  codeExtensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rs', '.rb', '.php'],
  docExtensions: ['.md', '.txt', '.mdx'],
  configExtensions: ['.json', '.yaml', '.yml', '.toml'],
  skipPatterns: [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    'coverage',
    '__pycache__',
    '.venv',
    'vendor',
    'target',
  ],
  maxFileSizeBytes: 500000, // 500KB
}
