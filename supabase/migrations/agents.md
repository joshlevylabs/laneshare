# Database Migrations - Agent Context

## Overview

Supabase PostgreSQL migrations defining the database schema for LaneShare. All tables use Row Level Security (RLS) for multi-tenant access control.

## Migration Naming Convention

```
YYYYMMDD000000_description.sql
```

Example: `20240117000000_documents.sql`

## Key Tables

### Core Entities

| Table | Description |
|-------|-------------|
| `profiles` | User profiles (synced from auth.users) |
| `projects` | Projects/workspaces |
| `project_members` | Project membership with roles |
| `project_invitations` | Pending invitations |

### Repositories

| Table | Description |
|-------|-------------|
| `repos` | Connected GitHub repositories |
| `repo_files` | Indexed file metadata |
| `chunks` | Code chunks with embeddings |
| `repo_doc_bundles` | Auto-generated repo documentation |

### Tasks

| Table | Description |
|-------|-------------|
| `tasks` | Task items (hierarchical) |
| `sprints` | Sprint containers |
| `task_comments` | Task discussion |
| `task_activity` | Activity log |
| `task_context_links` | Links to repos, services, docs |

### Documents

| Table | Description |
|-------|-------------|
| `documents` | User-created documentation |
| `document_builder_sessions` | Document creation wizard state |
| `document_references` | Links between entities and docs |

### Services

| Table | Description |
|-------|-------------|
| `connected_services` | External service connections |
| `service_assets` | Cached assets from services |

### Systems

| Table | Description |
|-------|-------------|
| `systems` | Architecture system definitions |
| `system_nodes` | Flowchart nodes |
| `system_edges` | Flowchart edges |
| `system_evidence` | Supporting evidence |

## Row Level Security (RLS)

All tables have RLS enabled. Common patterns:

### Helper Functions

```sql
-- Check if user is project member
CREATE OR REPLACE FUNCTION public.is_project_member(project_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = project_uuid
    AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Check if user is project admin (OWNER or MAINTAINER)
CREATE OR REPLACE FUNCTION public.is_project_admin(project_uuid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = project_uuid
    AND user_id = auth.uid()
    AND role IN ('OWNER', 'MAINTAINER')
  );
$$ LANGUAGE sql SECURITY DEFINER;
```

### Standard Policy Pattern

```sql
-- SELECT: Project members can view
CREATE POLICY "Project members can view X"
  ON public.table_name FOR SELECT
  USING (public.is_project_member(project_id));

-- INSERT: Project members can create
CREATE POLICY "Project members can create X"
  ON public.table_name FOR INSERT
  WITH CHECK (public.is_project_member(project_id));

-- UPDATE: Project members can update
CREATE POLICY "Project members can update X"
  ON public.table_name FOR UPDATE
  USING (public.is_project_member(project_id));

-- DELETE: Only admins can delete
CREATE POLICY "Admins can delete X"
  ON public.table_name FOR DELETE
  USING (public.is_project_admin(project_id));
```

## Common Patterns

### UUID Primary Keys

```sql
CREATE TABLE public.my_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ...
);
```

### Timestamps with Auto-Update

```sql
CREATE TABLE public.my_table (
  -- ...
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_my_table_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER my_table_updated_at_trigger
  BEFORE UPDATE ON public.my_table
  FOR EACH ROW
  EXECUTE FUNCTION update_my_table_updated_at();
```

### Foreign Key with CASCADE Delete

```sql
project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE
```

### Enums

```sql
CREATE TYPE task_status AS ENUM (
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE'
);
```

### JSONB for Flexible Data

```sql
config JSONB DEFAULT '{}',
metadata JSONB DEFAULT '{}'
```

### Array Fields

```sql
tags TEXT[] DEFAULT '{}',
selected_repo_ids UUID[] DEFAULT '{}'
```

## Creating New Migrations

1. Create file with timestamp:
   ```bash
   # migrations/20240120000000_my_feature.sql
   ```

2. Add table with RLS:
   ```sql
   CREATE TABLE IF NOT EXISTS public.my_table (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
     -- columns...
     created_at TIMESTAMPTZ DEFAULT NOW(),
     updated_at TIMESTAMPTZ DEFAULT NOW()
   );

   ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "Project members can view"
     ON public.my_table FOR SELECT
     USING (public.is_project_member(project_id));
   -- ... other policies
   ```

3. Add indexes for common queries:
   ```sql
   CREATE INDEX my_table_project_idx ON public.my_table (project_id);
   ```

4. Run migration:
   ```bash
   npx supabase db push
   ```

## Vector Search (pgvector)

For semantic search on code chunks:

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column
ALTER TABLE public.chunks ADD COLUMN embedding vector(1536);

-- Create index for similarity search
CREATE INDEX chunks_embedding_idx ON public.chunks
  USING ivfflat (embedding vector_cosine_ops);

-- Query similar chunks
SELECT * FROM public.chunks
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

## Encrypted Fields

Sensitive data (tokens, keys) should be encrypted at application level before storage. Store as TEXT, not JSONB.

## Feature-Specific Migrations

### Bridge Connections (`20240203000000_bridge_connections.sql`)

Schema for Claude Code bridge connections (Codespace ↔ LaneShare communication).

| Table | Description |
|-------|-------------|
| `bridge_connections` | Active bridge connection sessions |
| `bridge_prompt_queue` | Queue of prompts awaiting execution |

**Key Columns (bridge_connections):**
- `connection_id`: Unique identifier for the connection
- `user_id`: Owner of the connection
- `session_id`: Current session identifier
- `status`: 'connected', 'disconnected', 'idle'
- `last_heartbeat`: For connection health monitoring

**Key Columns (bridge_prompt_queue):**
- `connection_id`: Target bridge connection
- `prompt`: The prompt to execute
- `status`: 'pending', 'processing', 'completed', 'failed'
- `response`: Response from Claude Code

### Parallel Doc Generation (`20240205000000_parallel_doc_generation.sql`)

Schema updates for 7-terminal parallel document generation.

**bridge_prompt_queue Updates:**
| Column | Type | Description |
|--------|------|-------------|
| `prompt_type` | TEXT | 'general' or 'doc_generation' |
| `doc_type` | TEXT | Document type: AGENTS_SUMMARY, ARCHITECTURE, FEATURES, APIS, RUNBOOK, ADRS, SUMMARY |
| `result_bundle_id` | UUID | Links to target `repo_doc_bundles` |
| `streaming_output` | TEXT | Accumulated output during streaming generation |

**repo_doc_bundles Updates:**
| Column | Type | Description |
|--------|------|-------------|
| `agent_context_files` | JSONB | Array of discovered agents.md file paths |
| `generation_mode` | TEXT | 'parallel' (new 7-terminal) or 'legacy' (single API call) |

**repo_doc_pages Updates:**
| Column | Type | Description |
|--------|------|-------------|
| `original_markdown` | TEXT | Original generated markdown before user edits |
| `verification_score` | INT | Score from verification pass (0-100) |
| `verification_issues` | JSONB | Array of verification issues found |
| `reviewed_at` | TIMESTAMPTZ | When page was marked as reviewed |
| `reviewed_by` | UUID | User who reviewed the page |

**Indexes:**
- `idx_bridge_prompt_queue_bundle` - For doc generation queries
- `idx_bridge_prompt_queue_doc_type` - For finding prompts by doc type
- `idx_repo_doc_bundles_generation_mode` - For generation mode queries
- `idx_repo_doc_pages_verification` - For pages needing verification (score < 80)
- `idx_repo_doc_pages_reviewed` - For reviewed pages
