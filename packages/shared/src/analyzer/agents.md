# Architecture Analyzer - Agent Context

## Overview

Multi-pass architecture analysis pipeline that scans repositories and builds comprehensive architecture graphs. Used for understanding codebases and generating documentation.

## File Structure

```
analyzer/
├── index.ts           # Main orchestrator (analyzeArchitecture)
├── passes/            # Individual analysis passes
│   ├── inventory.ts   # Project inventory scan
│   ├── routes.ts      # Frontend routes/screens
│   ├── endpoints.ts   # Backend API endpoints
│   ├── supabase.ts    # Database schema analysis
│   ├── deployment.ts  # Deployment & external services
│   ├── python.ts      # Python project analysis
│   └── features.ts    # Feature extraction
└── utils/
    ├── ids.ts         # ID generation utilities
    └── fingerprint.ts # Content hashing for caching
```

## Main Entry Point

```typescript
import { analyzeArchitecture, type AnalyzerOptions, type AnalyzerResult } from '@laneshare/shared/analyzer';

const result = await analyzeArchitecture(repoFiles, options);
// result.graph contains nodes and edges
// result.features contains extracted features
```

## Analysis Passes

Passes run in order, each adding to the graph:

### 1. Inventory Pass (`inventory.ts`)
- Scans file structure
- Identifies project type (Next.js, React, Python, etc.)
- Creates root nodes for apps/packages

### 2. Routes Pass (`routes.ts`)
- Extracts frontend routes/screens
- Supports Next.js App Router and Pages Router
- Creates `screen` and `layout` nodes

### 3. Endpoints Pass (`endpoints.ts`)
- Extracts API endpoints
- Supports Next.js API routes, Express, FastAPI
- Creates `endpoint` and `api_group` nodes

### 4. Supabase Pass (`supabase.ts`)
- Parses migration files
- Extracts tables, columns, relationships
- Creates `table`, `function`, `trigger` nodes

### 5. Python Pass (`python.ts`)
- Handles Python projects (FastAPI, Django, Flask)
- Extracts routes, models, views

### 6. Deployment Pass (`deployment.ts`)
- Identifies deployment configuration
- Extracts external service references
- Creates `service` and `deployment` nodes

### 7. Features Pass (`features.ts`)
- Higher-level feature extraction
- Groups related nodes into features
- Identifies user flows

## Graph Structure

```typescript
interface AnalyzerResult {
  graph: {
    nodes: ArchNode[];
    edges: ArchEdge[];
  };
  features: Feature[];
  metadata: {
    projectType: string;
    framework?: string;
    passResults: Record<string, PassMetadata>;
  };
}
```

## Node Types

| Type | Description | Created By |
|------|-------------|------------|
| `repo` | Repository root | inventory |
| `app` | Application (web, api) | inventory |
| `package` | Shared package | inventory |
| `screen` | Frontend page/route | routes |
| `layout` | Layout component | routes |
| `component` | React component | routes |
| `endpoint` | API endpoint | endpoints |
| `api_group` | Group of endpoints | endpoints |
| `table` | Database table | supabase |
| `function` | DB function | supabase |
| `trigger` | DB trigger | supabase |
| `service` | External service | deployment |
| `deployment` | Deployment config | deployment |

## Edge Types

| Type | Meaning |
|------|---------|
| `contains` | Parent contains child |
| `imports` | File imports another |
| `navigates_to` | UI navigation |
| `calls` | API call relationship |
| `reads` | Reads from table |
| `writes` | Writes to table |
| `references` | General reference |

## Adding a New Pass

1. Create file in `passes/`:

```typescript
import type { RepoFile } from '../../types';
import type { ArchNode, ArchEdge } from '../../types/architecture';

interface PassResult {
  nodes: ArchNode[];
  edges: ArchEdge[];
  metadata?: Record<string, unknown>;
}

export async function runMyPass(files: RepoFile[]): Promise<PassResult> {
  const nodes: ArchNode[] = [];
  const edges: ArchEdge[] = [];

  // Analyze files...

  return { nodes, edges };
}
```

2. Register in `index.ts`:

```typescript
import { runMyPass } from './passes/my-pass';

// In analyzeArchitecture():
const myPassResult = await runMyPass(files);
allNodes.push(...myPassResult.nodes);
allEdges.push(...myPassResult.edges);
```

## Utilities

### ID Generation (`ids.ts`)
```typescript
import { generateNodeId, generateEdgeId } from './utils/ids';

const nodeId = generateNodeId('screen', '/app/dashboard');
const edgeId = generateEdgeId(sourceId, targetId, 'calls');
```

### Fingerprinting (`fingerprint.ts`)
```typescript
import { fingerprint } from './utils/fingerprint';

const hash = fingerprint(fileContent);
// Used for cache invalidation
```

## Performance Considerations

- Passes run sequentially (some depend on prior results)
- Large repos may take several seconds
- Results are cached by content fingerprint
- Consider filtering files before analysis for large repos
