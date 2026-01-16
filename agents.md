# LaneShare - Project Context for AI Agents

## Project Overview

LaneShare is an AI-powered collaborative development platform that enables multi-repository collaboration with AI-assisted documentation, task management, and code context generation for external coding agents (Cursor, Claude Code, etc.).

## Tech Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Radix UI
- **Backend**: Next.js API Routes, Supabase (PostgreSQL + Row Level Security)
- **AI Integration**: Anthropic Claude SDK, OpenAI (embeddings + GPT-4)
- **External Services**: GitHub API, Vercel API, OpenAPI spec parsing
- **Package Manager**: pnpm with npm workspaces

## Monorepo Structure

```
laneshare/
├── apps/web/              # Main Next.js application
├── packages/shared/       # Shared types, utilities, and prompts
└── supabase/migrations/   # Database schema migrations
```

## Key Directories

- `apps/web/src/app/api/` - REST API endpoints (see agents.md there)
- `apps/web/src/components/` - React UI components by feature domain
- `apps/web/src/lib/` - Utilities, service adapters, and helpers
- `packages/shared/src/types/` - Core TypeScript type definitions
- `packages/shared/src/analyzer/` - Multi-pass architecture analysis
- `packages/shared/src/prompts/` - AI prompt templates

## Core Concepts

### Projects
Multi-tenant projects with role-based access (OWNER, MAINTAINER, MEMBER). Each project can have multiple repositories, tasks, documents, and service connections.

### Repositories
GitHub repositories are synced, indexed, and chunked for semantic search. Code is analyzed for architecture graphs.

### Tasks
Hierarchical task system (Epic > Story > Feature/Task/Bug > Subtask) with Kanban board, sprints, and AI-powered context linking.

### Documents
User-created documentation with AI-assisted builder. Categories include architecture, API, feature guides, runbooks, decisions, onboarding.

### Systems
Visual architecture diagrams built with ReactFlow. Nodes represent components, edges represent relationships.

### Service Connections
External service integrations (Supabase, Vercel, OpenAPI) with encrypted credential storage and asset discovery.

## Database Patterns

- All tables use Row Level Security (RLS) with `is_project_member()` and `is_project_admin()` helper functions
- Sensitive tokens are encrypted at rest using libsodium
- UUIDs are used for all primary keys
- Soft deletes are not used - CASCADE deletes are standard

## API Patterns

- All API routes are in `apps/web/src/app/api/`
- Authentication via Supabase Auth (check `getUser()` from server client)
- Project membership validated via `is_project_member()` RLS or manual check
- Standard error responses: `{ error: string }` with appropriate status codes

## Testing

- Unit tests use Vitest
- Test files are co-located with source files (`.test.ts` suffix)

## Parallel Document Generation

Documentation generation uses 7 parallel Claude Code terminals:

1. **Agents_Summary.md** - Generated first, provides context for others
2. **Architecture.md** - System design and technologies
3. **Features.md** - All features in the repo
4. **APIs.md** - API documentation
5. **Runbook.md** - Operational guides
6. **ADRs.md** - Architecture decisions
7. **Summary.md** - Overall summary

This approach:
- Uses the user's Claude Code subscription (no API tokens) when bridge connected
- Falls back to Anthropic API when bridge not available
- Runs 6 documents in parallel after Agents_Summary completes
- Prioritizes agents.md files from target repos as primary context
- Provides granular progress tracking per document

## Environment Variables

Required in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for server-side admin operations)
- `ENCRYPTION_KEY` (32-byte base64 for token encryption)
- `OPENAI_API_KEY` (for embeddings)
- `ANTHROPIC_API_KEY` (for Claude integration)
