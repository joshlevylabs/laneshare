/**
 * Parallel Document Generation Prompts
 *
 * Individual prompts for each of the 7 documentation documents.
 * Each prompt is designed to be run in a separate Claude Code terminal.
 */

import type { DocType, DocPromptContext } from '../types/doc-generation'

/**
 * Build the prompt for a specific document type
 */
export function buildDocPrompt(docType: DocType, context: DocPromptContext): string {
  const baseContext = buildBaseContext(context)

  switch (docType) {
    case 'AGENTS_SUMMARY':
      return buildAgentsSummaryPrompt(context)
    case 'ARCHITECTURE':
      return buildArchitecturePrompt(context, baseContext)
    case 'FEATURES':
      return buildFeaturesPrompt(context, baseContext)
    case 'APIS':
      return buildApisPrompt(context, baseContext)
    case 'RUNBOOK':
      return buildRunbookPrompt(context, baseContext)
    case 'ADRS':
      return buildAdrsPrompt(context, baseContext)
    case 'SUMMARY':
      return buildSummaryPrompt(context, baseContext)
    default:
      throw new Error(`Unknown document type: ${docType}`)
  }
}

/**
 * Build the common context section included in all prompts
 */
function buildBaseContext(context: DocPromptContext): string {
  const agentsMdSection = context.agentsMdFiles.length > 0
    ? `
## agents.md Files Found (${context.agentsMdFiles.length})

These files contain important context about the repository's structure and conventions:

${context.agentsMdFiles.map(f => `
### ${f.path}
\`\`\`markdown
${f.content.slice(0, 8000)}${f.content.length > 8000 ? '\n... [truncated]' : ''}
\`\`\`
`).join('\n')}`
    : `
## agents.md Files

No agents.md files found in this repository.
`

  const agentsSummarySection = context.agentsSummary
    ? `
## Agents Summary (Primary Context Source)

This summary was generated from the agents.md files. Use it as your primary reference:

\`\`\`markdown
${context.agentsSummary}
\`\`\`
`
    : ''

  return `
## Repository: ${context.repoOwner}/${context.repoName}

## File Structure Overview
\`\`\`
${context.fileTree.slice(0, 5000)}${context.fileTree.length > 5000 ? '\n... [truncated]' : ''}
\`\`\`
${agentsMdSection}
${agentsSummarySection}
`
}

// ============================================
// DOCUMENT 1: Agents Summary
// ============================================
function buildAgentsSummaryPrompt(context: DocPromptContext): string {
  const hasAgentsMd = context.agentsMdFiles.length > 0
  const agentsMdContent = context.agentsMdFiles.map(f => `
### ${f.path}
\`\`\`markdown
${f.content}
\`\`\`
`).join('\n')

  return `
You are analyzing a code repository to create an Agents Summary document.

## Repository: ${context.repoOwner}/${context.repoName}

## File Structure
\`\`\`
${context.fileTree}
\`\`\`

${hasAgentsMd ? `
## agents.md Files Found (${context.agentsMdFiles.length})

${agentsMdContent}
` : `
## No agents.md Files Found

This repository does not contain agents.md files. You should describe what you CAN determine from the file structure alone.
`}

## Your Task

Create **Agents_Summary.md** - a document that describes:

1. **Application Structure Overview**
   - High-level directory structure
   - How the codebase is organized
   - Key directories and their purposes

2. **agents.md Document Inventory** (if any exist)
   - List ALL agents.md files found in the repository
   - For each agents.md file:
     - File path
     - What area/domain it covers
     - Key topics documented within it
     - How it relates to other agents.md files

3. **Context Map**
   - How the agents.md files together describe the system
   - Any gaps in documentation coverage
   - Recommended reading order for new developers

## Output Format

Return ONLY the markdown content for Agents_Summary.md.
Do NOT wrap in code blocks or add any other text.
Start directly with the document title: # Agents Summary

## Important Rules

- ONLY describe what is ACTUALLY documented in the agents.md files
- Do NOT infer or hallucinate content not present in the files
- If no agents.md files exist, state that clearly and describe what you CAN determine from the file structure
- Be concise but comprehensive
`.trim()
}

// ============================================
// DOCUMENT 2: Architecture
// ============================================
function buildArchitecturePrompt(context: DocPromptContext, baseContext: string): string {
  // Filter for architecture-relevant files
  const architectureFiles = context.keyFiles.filter(f =>
    f.path.includes('config') ||
    f.path.includes('schema') ||
    f.path.endsWith('.json') ||
    f.path.includes('docker') ||
    f.path.includes('infrastructure') ||
    f.path.endsWith('.prisma') ||
    f.path.includes('migrations')
  )

  const keyFilesSection = architectureFiles.length > 0
    ? `
## Key Files for Architecture Analysis

${architectureFiles.slice(0, 10).map(f => `
### ${f.path}
\`\`\`
${f.content.slice(0, 5000)}${f.content.length > 5000 ? '\n... [truncated]' : ''}
\`\`\`
`).join('\n')}`
    : ''

  return `
You are analyzing a code repository to create an Architecture document.

${baseContext}
${keyFilesSection}

## Your Task

Create **Architecture.md** - a document that describes:

1. **System Overview**
   - What this system does at a high level
   - Core architectural pattern (monolith, microservices, serverless, etc.)

2. **Technology Stack**
   - Languages and frameworks
   - Databases and data stores
   - External services and APIs
   - Build tools and CI/CD

3. **Component Architecture**
   - Major components/modules
   - How they interact
   - Data flow between components

4. **Infrastructure**
   - Deployment architecture
   - Hosting/cloud services used
   - Scaling considerations

5. **Key Design Patterns**
   - Patterns used in the codebase
   - Architectural decisions evident from code structure

## Output Format

Return ONLY the markdown content for Architecture.md.
Do NOT wrap in code blocks or add any other text.
Start directly with the document title: # Architecture

## Important Rules

- Base ALL claims on evidence from the code and agents.md files
- Include file path references for key architectural components
- If uncertain about something, note it as "Needs Verification"
`.trim()
}

// ============================================
// DOCUMENT 3: Features
// ============================================
function buildFeaturesPrompt(context: DocPromptContext, baseContext: string): string {
  // Filter for feature-relevant files
  const featureFiles = context.keyFiles.filter(f =>
    f.path.includes('component') ||
    f.path.includes('feature') ||
    f.path.includes('page') ||
    f.path.includes('route') ||
    f.path.includes('handler') ||
    f.path.includes('screen') ||
    f.path.includes('view')
  )

  const keyFilesSection = featureFiles.length > 0
    ? `
## Key Files for Feature Analysis

${featureFiles.slice(0, 10).map(f => `
### ${f.path}
\`\`\`
${f.content.slice(0, 3000)}${f.content.length > 3000 ? '\n... [truncated]' : ''}
\`\`\`
`).join('\n')}`
    : ''

  return `
You are analyzing a code repository to create a Features document.

${baseContext}
${keyFilesSection}

## Your Task

Create **Features.md** - a document that describes:

1. **Feature Overview**
   - List of all major features
   - Feature categories/domains

2. **Feature Details** (for each major feature)
   - Feature name and description
   - User-facing functionality
   - Key components/files implementing the feature
   - Dependencies on other features

3. **Feature Flags / Toggles**
   - Any feature flags found in the code
   - How features are enabled/disabled

4. **Planned/In-Progress Features**
   - Any TODO comments indicating planned features
   - Partial implementations

## Output Format

Return ONLY the markdown content for Features.md.
Do NOT wrap in code blocks or add any other text.
Start directly with the document title: # Features

## Important Rules

- Only document features with evidence in the code
- Reference specific files/components for each feature
- Distinguish between complete and partial features
`.trim()
}

// ============================================
// DOCUMENT 4: APIs
// ============================================
function buildApisPrompt(context: DocPromptContext, baseContext: string): string {
  // Filter for API-relevant files
  const apiFiles = context.keyFiles.filter(f =>
    f.path.includes('api') ||
    f.path.includes('route') ||
    f.path.includes('endpoint') ||
    f.path.includes('controller') ||
    f.path.includes('handler') ||
    f.path.includes('openapi') ||
    f.path.includes('swagger') ||
    f.path.includes('graphql')
  )

  const keyFilesSection = apiFiles.length > 0
    ? `
## Key Files for API Analysis

${apiFiles.slice(0, 10).map(f => `
### ${f.path}
\`\`\`
${f.content.slice(0, 4000)}${f.content.length > 4000 ? '\n... [truncated]' : ''}
\`\`\`
`).join('\n')}`
    : ''

  return `
You are analyzing a code repository to create an APIs document.

${baseContext}
${keyFilesSection}

## Your Task

Create **APIs.md** - a document that describes:

1. **API Overview**
   - Types of APIs (REST, GraphQL, WebSocket, gRPC, etc.)
   - Base URLs and versioning
   - Authentication methods

2. **Internal APIs / Endpoints**
   - List of all API routes/endpoints
   - HTTP methods
   - Request/response formats
   - Required parameters

3. **External API Integrations**
   - Third-party APIs consumed
   - How they're used
   - Configuration requirements

4. **API Patterns**
   - Common patterns used
   - Error handling approach
   - Rate limiting
   - Pagination

5. **WebSocket / Real-time APIs**
   - WebSocket endpoints (if any)
   - Event types
   - Connection handling

## Output Format

Return ONLY the markdown content for APIs.md.
Do NOT wrap in code blocks or add any other text.
Start directly with the document title: # APIs

## Important Rules

- Document actual endpoints found in the code
- Include HTTP methods and paths
- Note authentication requirements
- Reference implementation files
`.trim()
}

// ============================================
// DOCUMENT 5: Runbook
// ============================================
function buildRunbookPrompt(context: DocPromptContext, baseContext: string): string {
  // Filter for operations-relevant files
  const opsFiles = context.keyFiles.filter(f =>
    f.path.includes('docker') ||
    f.path.includes('script') ||
    f.path.includes('deploy') ||
    f.path.includes('ci') ||
    f.path.includes('workflow') ||
    f.path.endsWith('.sh') ||
    f.path.includes('package.json') ||
    f.path.includes('Makefile') ||
    f.path.includes('.env')
  )

  const keyFilesSection = opsFiles.length > 0
    ? `
## Key Files for Runbook Analysis

${opsFiles.slice(0, 10).map(f => `
### ${f.path}
\`\`\`
${f.content.slice(0, 4000)}${f.content.length > 4000 ? '\n... [truncated]' : ''}
\`\`\`
`).join('\n')}`
    : ''

  return `
You are analyzing a code repository to create a Runbook document.

${baseContext}
${keyFilesSection}

## Your Task

Create **Runbook.md** - a document with step-by-step operational guides:

1. **Local Development Setup**
   - Prerequisites (Node version, tools, etc.)
   - Installation steps
   - Environment configuration
   - Running the application locally
   - Running tests

2. **Deployment Procedures**
   - Deployment environments (dev, staging, prod)
   - Deployment steps for each environment
   - Pre-deployment checklist
   - Post-deployment verification

3. **Common Operations**
   - Database migrations
   - Cache clearing
   - Log access
   - Configuration updates

4. **Incident Response**
   - Common issues and solutions
   - Debugging steps
   - Rollback procedures
   - Escalation paths

5. **Maintenance Tasks**
   - Scheduled maintenance procedures
   - Backup/restore procedures
   - Dependency updates
   - Security patches

## Output Format

Return ONLY the markdown content for Runbook.md.
Do NOT wrap in code blocks or add any other text.
Start directly with the document title: # Runbook

## Important Rules

- Provide EXACT commands where possible
- Include environment variable requirements
- Note any prerequisites for each procedure
- Mark any steps that need manual verification as [VERIFY]
`.trim()
}

// ============================================
// DOCUMENT 6: ADRs (Architecture Decision Records)
// ============================================
function buildAdrsPrompt(context: DocPromptContext, baseContext: string): string {
  return `
You are analyzing a code repository to create an Architecture Decision Records document.

${baseContext}

## Your Task

Create **ADRs.md** - a document capturing significant architecture decisions:

For EACH significant decision you can identify from the code:

1. **Title**: Short descriptive title
2. **Status**: (Accepted/Proposed/Deprecated/Superseded)
3. **Context**: What is the issue we're addressing?
4. **Decision**: What is the change we're making?
5. **Consequences**: What are the results? (positive and negative)

## Decisions to Look For

Analyze the codebase for evidence of decisions about:
- Framework/library choices (Why Next.js? Why Supabase? Why this state management?)
- Database design patterns
- API design patterns
- Authentication/authorization approach
- File structure and organization
- Testing strategy
- Deployment architecture
- Third-party service selections

## Output Format

Return ONLY the markdown content for ADRs.md.
Do NOT wrap in code blocks or add any other text.
Start directly with the document title: # Architecture Decision Records

Use this format for each ADR:

## ADR-001: [Title]

**Status:** Accepted

**Context:**
[Description of the problem or situation]

**Decision:**
[What was decided]

**Consequences:**
- [Positive consequence 1]
- [Positive consequence 2]
- [Negative consequence / trade-off 1]

**Evidence:**
- [File path or code reference]

## Important Rules

- Only document decisions with clear evidence in the code
- Number ADRs sequentially (ADR-001, ADR-002, etc.)
- Include file references as evidence
- Be honest about trade-offs and negative consequences
- If a decision seems questionable, note it neutrally
`.trim()
}

// ============================================
// DOCUMENT 7: Summary
// ============================================
function buildSummaryPrompt(context: DocPromptContext, baseContext: string): string {
  return `
You are analyzing a code repository to create a Summary document.

${baseContext}

## Your Task

Create **Summary.md** - an overall summary of the repository:

1. **Overview**
   - What is this project?
   - What problem does it solve?
   - Who is it for?

2. **Key Components**
   - Main parts of the system
   - How they work together
   - Core technologies

3. **Quick Start**
   - Minimal steps to get running
   - Key commands
   - Where to find more info

4. **Project Status**
   - Current state (active development, maintenance, etc.)
   - Recent activity indicators
   - Known limitations

5. **Navigation Guide**
   - Where to find what in the codebase
   - Recommended reading order
   - Key files to understand first

6. **Contributing**
   - How to contribute (if evident)
   - Code style/patterns to follow
   - Testing requirements

## Output Format

Return ONLY the markdown content for Summary.md.
Do NOT wrap in code blocks or add any other text.
Start directly with the document title: # Summary

## Important Rules

- This is the FIRST document someone will read
- Keep it concise but informative
- Link to other documents for details
- Focus on helping new developers get oriented quickly
`.trim()
}

/**
 * Get document metadata for UI display
 */
export function getDocTypeInfo(docType: DocType): {
  title: string
  description: string
  category: string
  icon: string
} {
  const DOC_TYPE_INFO: Record<DocType, { icon: string }> = {
    AGENTS_SUMMARY: { icon: 'file-text' },
    ARCHITECTURE: { icon: 'building-2' },
    FEATURES: { icon: 'sparkles' },
    APIS: { icon: 'code-2' },
    RUNBOOK: { icon: 'wrench' },
    ADRS: { icon: 'git-branch' },
    SUMMARY: { icon: 'book-open' },
  }

  // Import DOC_TYPES dynamically to avoid circular dependency
  const { DOC_TYPES } = require('../types/doc-generation')
  const info = DOC_TYPES[docType]

  return {
    title: info.title,
    description: info.description,
    category: info.category,
    icon: DOC_TYPE_INFO[docType].icon,
  }
}
