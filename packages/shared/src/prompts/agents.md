# AI Prompts - Agent Context

## Overview

AI prompt templates for different contexts in LaneShare. Used for generating documentation, providing context to coding agents, and AI-assisted features.

## File Structure

```
prompts/
├── index.ts              # Prompt exports
├── agent-prompts.ts      # LanePilot prompts for coding context
├── context-ai.ts         # AI prompts for context suggestions
├── doc-generation.ts     # Documentation generation prompts
├── repo-docs.ts          # Claude Code integration for repo docs (legacy)
└── doc-prompts.ts        # Parallel document generation prompts (7-terminal)
```

## Prompt Categories

### Agent Prompts (`agent-prompts.ts`)

Used by LanePilot to generate context packs for external coding agents (Cursor, Claude Code).

**Key Functions:**
- `generateTaskContextPrompt(task, context)` - Creates context for a specific task
- `generateSystemPrompt(system, evidence)` - System architecture context
- `generateCodebasePrompt(files, query)` - General codebase Q&A

**Output Format:**
Prompts generate structured markdown with:
- Task/goal description
- Relevant file paths
- Code snippets with line numbers
- Architecture context
- Related documentation

### Context AI Prompts (`context-ai.ts`)

For AI-powered context suggestions - helps users discover relevant code for tasks.

**Key Functions:**
- `suggestContextForTask(task, codebaseIndex)` - Suggests relevant files/code
- `rankContextRelevance(candidates, task)` - Ranks potential context items

### Documentation Generation (`doc-generation.ts`)

Prompts for generating project documentation.

**Document Types:**
- Architecture documentation
- API reference
- Feature guides
- Runbooks
- Decision records (ADRs)

**Key Functions:**
- `generateArchitectureDocPrompt(graph)` - From architecture graph
- `generateAPIDocPrompt(endpoints)` - API documentation
- `generateFeatureDocPrompt(feature, codeContext)` - Feature documentation

### Repository Documentation (`repo-docs.ts`)

For Claude Code integration - generates comprehensive repo documentation bundles (legacy single-call approach).

**Bundle Types:**
- `ARCHITECTURE` - System architecture overview
- `API` - API endpoints and usage
- `FEATURES` - Feature documentation
- `RUNBOOK` - Operational procedures

### Parallel Document Prompts (`doc-prompts.ts`)

Individual prompts for each of the 7 documentation documents in the parallel generation system.

**Prompt Structure:**

Each prompt includes:
1. Repository context (file tree, key files)
2. All discovered agents.md files
3. Agents_Summary content (for docs 2-7)
4. Document-specific instructions
5. Output format requirements

**Document Types:**

| Document | Primary Focus | Key Files Analyzed |
|----------|--------------|-------------------|
| Agents_Summary | agents.md inventory | `**/agents.md` |
| Architecture | System design | config, schema, docker |
| Features | Functionality | components, pages, routes |
| APIs | Endpoints | api, route, controller |
| Runbook | Operations | docker, scripts, workflows |
| ADRs | Decisions | All (inference-based) |
| Summary | Overview | README, package.json |

**Usage:**

```typescript
import { buildDocPrompt } from '@laneshare/shared/prompts';
import type { DocType, DocPromptContext } from '@laneshare/shared';

const prompt = buildDocPrompt('ARCHITECTURE', {
  repoName: 'my-repo',
  repoOwner: 'owner',
  fileTree: '...',
  agentsMdFiles: [...],
  keyFiles: [...],
  agentsSummary: '...', // Output from AGENTS_SUMMARY (for docs 2-7)
});
```

## Prompt Engineering Patterns

### System Prompts

Always start with role and constraints:

```typescript
const systemPrompt = `You are an expert software architect analyzing a codebase.

Your task is to ${task}.

Guidelines:
- Be specific and reference file paths
- Include code snippets when relevant
- Focus on actionable insights

Output format:
${formatInstructions}`;
```

### Context Injection

Include relevant context in user prompts:

```typescript
const userPrompt = `
## Task
${task.title}

## Description
${task.description}

## Relevant Files
${relevantFiles.map(f => `- ${f.path}`).join('\n')}

## Code Context
\`\`\`${language}
${codeSnippet}
\`\`\`

Based on the above, ${instruction}
`;
```

### Structured Output

Request JSON for parsing:

```typescript
const prompt = `
Analyze and respond with JSON:
{
  "summary": "brief summary",
  "files": ["array", "of", "paths"],
  "suggestions": [
    { "type": "type", "description": "desc" }
  ]
}
`;
```

## Usage in API Routes

```typescript
import { generateTaskContextPrompt } from '@laneshare/shared/prompts';

// In API route:
const prompt = generateTaskContextPrompt(task, {
  files: relevantFiles,
  system: linkedSystem,
  docs: linkedDocs,
});

const response = await anthropic.messages.create({
  model: 'claude-3-sonnet',
  messages: [{ role: 'user', content: prompt }],
});
```

## Token Management

Prompts should be mindful of context limits:

```typescript
// Truncate long content
function truncateContent(content: string, maxTokens: number): string {
  // Rough estimate: 4 chars per token
  const maxChars = maxTokens * 4;
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n... [truncated]';
}
```

## Adding New Prompts

1. Create prompt function in appropriate file:

```typescript
export function generateMyPrompt(context: MyContext): string {
  return `
System: You are...

Context:
${formatContext(context)}

Task: ${context.task}

Respond with:
${formatInstructions}
`.trim();
}
```

2. Export from `index.ts`:

```typescript
export { generateMyPrompt } from './my-prompts';
```

3. Use in API route or component
