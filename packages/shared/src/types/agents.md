# Type Definitions - Agent Context

## Overview

Core TypeScript type definitions shared across the monorepo. These define the data models for all entities in LaneShare.

## File Structure

```
types/
├── index.ts           # Main entity types (User, Project, Task, etc.)
├── architecture.ts    # Architecture graph types (nodes, edges, features)
└── system-map.ts      # System/flowchart mapping types
```

## Core Entities (index.ts)

### User & Project

```typescript
interface User {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
}

interface Project {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  owner_id: string;
}

type ProjectRole = 'OWNER' | 'MAINTAINER' | 'MEMBER';
```

### Tasks

```typescript
type TaskType = 'EPIC' | 'STORY' | 'FEATURE' | 'TASK' | 'BUG' | 'SUBTASK';
type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface Task {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  parent_task_id?: string;    // For hierarchy
  sprint_id?: string;
  assignee_id?: string;
  due_date?: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}
```

### Repositories

```typescript
interface Repo {
  id: string;
  project_id: string;
  name: string;
  full_name: string;          // owner/repo
  github_url: string;
  default_branch: string;
  last_synced_at?: string;
  sync_status: 'idle' | 'syncing' | 'error';
}

interface RepoFile {
  id: string;
  repo_id: string;
  path: string;
  content?: string;
  language?: string;
}

interface Chunk {
  id: string;
  file_id: string;
  content: string;
  start_line: number;
  end_line: number;
  embedding?: number[];       // Vector for semantic search
}
```

### Documents

```typescript
type DocumentCategory =
  | 'architecture'
  | 'api'
  | 'feature_guide'
  | 'runbook'
  | 'decision'
  | 'onboarding'
  | 'meeting_notes'
  | 'other';

interface Document {
  id: string;
  project_id: string;
  title: string;
  slug: string;
  category: DocumentCategory;
  description?: string;
  tags: string[];
  markdown: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}
```

### Services

```typescript
type ServiceType = 'supabase' | 'vercel' | 'openapi';

interface ConnectedService {
  id: string;
  project_id: string;
  service_type: ServiceType;
  name: string;
  config: Record<string, unknown>;  // Encrypted credentials
  cached_assets?: ServiceAsset[];
  last_synced_at?: string;
}
```

### Context Linking

```typescript
interface TaskContextLinks {
  task_id: string;
  linked_repos: string[];       // Repo IDs
  linked_services: string[];    // Service IDs
  linked_docs: string[];        // Document IDs
  linked_tasks: string[];       // Related task IDs
  file_paths: string[];         // Specific file paths
  code_snippets: CodeSnippet[];
}
```

## Architecture Types (architecture.ts)

### Graph Structure

```typescript
interface ArchitectureGraph {
  nodes: ArchNode[];
  edges: ArchEdge[];
  features: Feature[];
}

type NodeType =
  | 'repo' | 'app' | 'package'
  | 'screen' | 'component' | 'layout'
  | 'endpoint' | 'api_group'
  | 'table' | 'function' | 'trigger'
  | 'service' | 'deployment';

interface ArchNode {
  id: string;
  type: NodeType;
  label: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

type EdgeType =
  | 'contains' | 'imports'
  | 'navigates_to' | 'calls'
  | 'reads' | 'writes' | 'references';

interface ArchEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
}
```

### Evidence

```typescript
interface Evidence {
  id: string;
  system_id: string;
  type: 'code' | 'config' | 'schema' | 'api';
  source_path: string;
  content: string;
  line_start?: number;
  line_end?: number;
}
```

## System Map Types (system-map.ts)

For visual flowchart builder:

```typescript
interface SystemNode {
  id: string;
  system_id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  data?: Record<string, unknown>;
}

interface SystemEdge {
  id: string;
  system_id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
}
```

## Usage in Components

Import from the shared package:

```typescript
import type { Task, Project, Document } from '@laneshare/shared/types';
```

Or with path alias:

```typescript
import type { Task } from '@/../../packages/shared/src/types';
```

## Database Alignment

These types mirror the Supabase table schemas. When adding new fields:
1. Add migration in `supabase/migrations/`
2. Update type definition here
3. Update any API routes that use the type
4. Update UI components as needed
