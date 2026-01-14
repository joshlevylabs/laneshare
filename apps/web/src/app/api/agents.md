# API Routes - Agent Context

## Overview

This directory contains all REST API endpoints for LaneShare. Routes follow Next.js 14 App Router conventions.

## Route Structure

```
api/
├── auth/                    # Authentication endpoints
├── claude/                  # Claude Code integration
├── github/                  # GitHub OAuth and API
├── invitations/             # Project invitation management
├── projects/                # Project CRUD and nested resources
│   └── [id]/
│       ├── documents/       # Document management
│       ├── docs/            # Legacy doc generation
│       ├── prd/             # Product Requirements Documents
│       ├── repos/[repoId]/  # Repository-specific operations
│       ├── search/          # Code search
│       ├── services/        # Service connections (Supabase, Vercel, OpenAPI)
│       ├── sprints/         # Sprint management
│       ├── systems/         # Architecture systems
│       ├── tasks/           # Task management
│       └── workspace/       # Workspace features
├── repos/[id]/              # Cross-project repo operations
└── webhooks/                # GitHub webhooks
```

## Authentication Pattern

Every protected route should:

```typescript
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // For project-scoped routes, verify membership:
  const { data: member } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single();

  if (!member) {
    return NextResponse.json({ error: 'Not a project member' }, { status: 403 });
  }

  // ... rest of handler
}
```

## Common Response Patterns

**Success:**
```typescript
return NextResponse.json(data);
return NextResponse.json(data, { status: 201 }); // Created
```

**Error:**
```typescript
return NextResponse.json({ error: 'Error message' }, { status: 400 });
return NextResponse.json({ error: 'Not found' }, { status: 404 });
```

## Service Role Usage

For operations that bypass RLS (admin operations):

```typescript
import { createServiceClient } from '@/lib/supabase/server';

const supabaseAdmin = createServiceClient();
// This client bypasses RLS
```

## Key API Domains

### Projects (`/projects/[id]`)
- CRUD operations for projects
- Nested resources all require project membership

### Tasks (`/projects/[id]/tasks`)
- Full CRUD with hierarchy support (parent_task_id)
- Context linking (repos, services, docs)
- AI context suggestions at `/[taskId]/context-ai`

### Systems (`/projects/[id]/systems`)
- Architecture system management
- Flowchart nodes and edges
- Evidence collection

### Services (`/projects/[id]/services`)
- Supabase, Vercel, and OpenAPI connections
- Encrypted credential storage
- Asset discovery and caching

### Documents (`/projects/[id]/documents`)
- Document CRUD
- Document builder sessions
- Reference linking

## Error Handling

Always wrap database operations in try-catch:

```typescript
try {
  const { data, error } = await supabase.from('table').select();
  if (error) throw error;
  return NextResponse.json(data);
} catch (error) {
  console.error('Operation failed:', error);
  return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
}
```

## Encryption

For storing sensitive tokens (GitHub PATs, API keys):

```typescript
import { encryptToken, decryptToken } from '@/lib/encryption';

// Store encrypted
const encrypted = await encryptToken(plainToken);

// Retrieve decrypted
const decrypted = await decryptToken(encryptedToken);
```
