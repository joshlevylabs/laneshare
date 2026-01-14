# Library Utilities - Agent Context

## Overview

Core utilities, service adapters, and helper functions for the web application. Contains integrations with external services and shared functionality.

## Directory Structure

```
lib/
├── supabase/              # Supabase client initialization
│   ├── client.ts          # Browser-side client
│   ├── server.ts          # Server-side client (with cookies)
│   └── types.ts           # Supabase-specific types
├── services/              # External service adapters
│   ├── index.ts           # Service aggregation
│   ├── supabase-adapter.ts
│   ├── vercel-adapter.ts
│   ├── openapi-adapter.ts
│   └── types.ts
├── encryption.ts          # Token encryption/decryption
├── github.ts              # GitHub API integration
├── embeddings.ts          # OpenAI embeddings
├── claude-code-runner.ts  # Claude Code integration
├── doc-generator.ts       # Documentation generation
├── service-doc-generator.ts
├── repo-context-provider.ts
└── utils.ts               # General utilities (cn, etc.)
```

## Supabase Clients

### Browser Client (`supabase/client.ts`)

```typescript
import { createBrowserClient } from '@/lib/supabase/client';

// In client components:
const supabase = createBrowserClient();
const { data } = await supabase.from('projects').select();
```

### Server Client (`supabase/server.ts`)

```typescript
import { createClient, createServiceClient } from '@/lib/supabase/server';

// In API routes (respects RLS):
const supabase = await createClient();

// Admin operations (bypasses RLS):
const supabaseAdmin = createServiceClient();
```

## Service Adapters (`services/`)

Unified interface for external service connections.

### Common Pattern

```typescript
interface ServiceAdapter {
  connect(config: ServiceConfig): Promise<ConnectionResult>;
  validate(config: ServiceConfig): Promise<ValidationResult>;
  discoverAssets(): Promise<ServiceAsset[]>;
  sync(): Promise<SyncResult>;
}
```

### Supabase Adapter

```typescript
import { SupabaseAdapter } from '@/lib/services/supabase-adapter';

const adapter = new SupabaseAdapter(serviceConfig);
const tables = await adapter.discoverTables();
const policies = await adapter.discoverPolicies();
```

### Vercel Adapter

```typescript
import { VercelAdapter } from '@/lib/services/vercel-adapter';

const adapter = new VercelAdapter(accessToken);
const projects = await adapter.listProjects();
const deployments = await adapter.getDeployments(projectId);
```

### OpenAPI Adapter

```typescript
import { OpenAPIAdapter } from '@/lib/services/openapi-adapter';

const adapter = new OpenAPIAdapter(specUrl);
const spec = await adapter.parseSpec();
const endpoints = await adapter.discoverEndpoints();
```

## Encryption (`encryption.ts`)

For storing sensitive tokens at rest.

```typescript
import { encryptToken, decryptToken } from '@/lib/encryption';

// Encrypt before storing
const encrypted = await encryptToken(plainToken);
await supabase.from('services').insert({ token: encrypted });

// Decrypt when using
const { data } = await supabase.from('services').select();
const decrypted = await decryptToken(data.token);
```

**Requirements:**
- `ENCRYPTION_KEY` env var (32-byte base64)
- Uses libsodium for symmetric encryption

## GitHub Integration (`github.ts`)

```typescript
import { GitHubClient } from '@/lib/github';

const github = new GitHubClient(accessToken);

// Repository operations
const repos = await github.listRepos();
const files = await github.getRepoFiles(owner, repo, branch);
const content = await github.getFileContent(owner, repo, path);

// Webhook management
await github.createWebhook(owner, repo, webhookUrl);
```

## Embeddings (`embeddings.ts`)

OpenAI text embeddings for semantic search.

```typescript
import { generateEmbedding, searchByEmbedding } from '@/lib/embeddings';

// Generate embedding for text
const embedding = await generateEmbedding(text);

// Search similar content
const results = await searchByEmbedding(queryEmbedding, {
  table: 'chunks',
  limit: 10,
  threshold: 0.8,
});
```

## Claude Code Runner (`claude-code-runner.ts`)

Integration for running Claude Code to generate documentation.

```typescript
import { ClaudeCodeRunner } from '@/lib/claude-code-runner';

const runner = new ClaudeCodeRunner({
  projectPath: '/path/to/repo',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

const docs = await runner.generateDocs({
  type: 'ARCHITECTURE',
  context: additionalContext,
});
```

## Context Provider (`repo-context-provider.ts`)

Prepares code context for AI prompts.

```typescript
import { RepoContextProvider } from '@/lib/repo-context-provider';

const provider = new RepoContextProvider(repoFiles);

// Get context for a task
const context = await provider.getContextForTask(task, {
  maxFiles: 20,
  maxTokens: 8000,
});
```

## Utilities (`utils.ts`)

```typescript
import { cn } from '@/lib/utils';

// Class name merging (tailwind-merge + clsx)
<div className={cn('base-class', condition && 'conditional', className)} />
```

## Environment Variables

Required in `.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Encryption
ENCRYPTION_KEY=  # 32-byte base64

# AI Services
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# GitHub (optional, for OAuth)
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
```

## Error Handling Pattern

```typescript
export async function myServiceFunction() {
  try {
    // Operation
    return { data: result, error: null };
  } catch (error) {
    console.error('Operation failed:', error);
    return { data: null, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
```
