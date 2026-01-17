# Orchestrator Multi-Session Architecture

## Overview

The Workspace Orchestrator coordinates work across multiple Claude Code sessions, enabling:
1. **File Activity Tracking** - Know what files each session is reading/writing
2. **Push Notifications** - Real-time alerts when conflicts occur
3. **Cross-Session Communication** - Sessions can query each other through the orchestrator

---

## Phase 1: File Activity Tracking

### Purpose
Track which files each Claude Code session is actively reading or modifying, enabling the orchestrator to detect potential conflicts.

### Database Schema

```sql
-- File activity log for real-time tracking
CREATE TABLE workspace_file_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('read', 'write', 'create', 'delete', 'rename')),
  file_path TEXT NOT NULL,
  file_hash TEXT,                    -- SHA256 of file content for conflict detection
  lines_changed INTEGER,             -- Number of lines modified
  change_summary TEXT,               -- Brief description of changes
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour'  -- Auto-cleanup old entries
);

-- Index for fast lookups by session
CREATE INDEX idx_file_activity_session ON workspace_file_activity(session_id, timestamp DESC);

-- Index for finding conflicts (same file, different sessions)
CREATE INDEX idx_file_activity_file ON workspace_file_activity(file_path, timestamp DESC);

-- Composite index for conflict detection queries
CREATE INDEX idx_file_activity_conflicts ON workspace_file_activity(file_path, session_id, activity_type);
```

### API Endpoints

#### POST /api/projects/[id]/workspace/sessions/[sessionId]/activity
Report file activity from a Claude Code session.

```typescript
// Request body
interface FileActivityReport {
  activities: {
    type: 'read' | 'write' | 'create' | 'delete' | 'rename'
    filePath: string
    fileHash?: string
    linesChanged?: number
    changeSummary?: string
  }[]
}

// Response
interface FileActivityResponse {
  recorded: number
  conflicts: {
    filePath: string
    otherSessions: {
      sessionId: string
      userName: string
      lastActivity: string
      activityType: string
    }[]
  }[]
}
```

#### GET /api/projects/[id]/workspace/sessions/[sessionId]/activity/conflicts
Check for potential conflicts with other sessions.

```typescript
// Response
interface ConflictCheckResponse {
  conflicts: {
    filePath: string
    yourLastActivity: string
    otherSessions: {
      sessionId: string
      userName: string
      repoName: string
      lastActivity: string
      activityType: string
    }[]
  }[]
}
```

### How Claude Code Reports Activity

When Claude Code performs file operations, it reports to the orchestrator:

```
Claude Code (in Codespace)
    │
    ├── Reads src/api.ts
    │   └── POST /activity { type: 'read', filePath: 'src/api.ts' }
    │
    ├── Modifies src/api.ts
    │   └── POST /activity { type: 'write', filePath: 'src/api.ts', linesChanged: 15 }
    │
    └── Creates src/utils/helper.ts
        └── POST /activity { type: 'create', filePath: 'src/utils/helper.ts' }
```

---

## Phase 2: Push Notifications (SSE)

### Purpose
Real-time notifications to all sessions when conflicts are detected or when coordination is needed.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR SERVER                          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Event Bus (in-memory + Redis)               │   │
│  │  - file_conflict                                         │   │
│  │  - session_started                                       │   │
│  │  - session_ended                                         │   │
│  │  - orchestrator_message                                  │   │
│  │  - cross_session_request                                 │   │
│  └────────────────────┬────────────────────────────────────┘   │
│                       │                                         │
└───────────────────────┼─────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
   ┌─────────┐    ┌─────────┐    ┌─────────┐
   │ User A  │    │ User A  │    │ User B  │
   │ Repo A  │    │ Repo B  │    │ Repo A  │
   │ Session │    │ Session │    │ Session │
   └─────────┘    └─────────┘    └─────────┘
       │               │               │
       └───────────────┴───────────────┘
                       │
                   SSE Stream
              /api/.../events
```

### SSE Endpoint

#### GET /api/projects/[id]/workspace/sessions/[sessionId]/events
Server-Sent Events stream for real-time notifications.

```typescript
// Event types
type OrchestratorEvent =
  | { type: 'file_conflict'; data: FileConflictEvent }
  | { type: 'session_joined'; data: SessionJoinedEvent }
  | { type: 'session_left'; data: SessionLeftEvent }
  | { type: 'orchestrator_message'; data: OrchestratorMessageEvent }
  | { type: 'cross_session_request'; data: CrossSessionRequestEvent }
  | { type: 'cross_session_response'; data: CrossSessionResponseEvent }
  | { type: 'heartbeat'; data: { timestamp: string } }

interface FileConflictEvent {
  conflictId: string
  filePath: string
  yourActivity: { type: string; timestamp: string }
  otherSession: {
    sessionId: string
    userName: string
    repoName: string
    activity: { type: string; timestamp: string }
  }
  severity: 'warning' | 'critical'
  suggestion: string
}

interface SessionJoinedEvent {
  sessionId: string
  userName: string
  repoName: string
  codespaceName: string
}

interface SessionLeftEvent {
  sessionId: string
  userName: string
}

interface OrchestratorMessageEvent {
  messageId: string
  content: string
  priority: 'info' | 'warning' | 'urgent'
  action?: {
    type: 'acknowledge' | 'respond' | 'sync'
    endpoint: string
  }
}
```

### Event Storage (for delivery guarantee)

```sql
-- Store pending events for sessions that might reconnect
CREATE TABLE workspace_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_session_id UUID REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,
  delivered BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour'
);

-- Index for fetching pending events
CREATE INDEX idx_workspace_events_pending
  ON workspace_events(target_session_id, delivered, created_at)
  WHERE delivered = false;
```

### Frontend Integration

```typescript
// useOrchestratorEvents hook
function useOrchestratorEvents(projectId: string, sessionId: string) {
  const [events, setEvents] = useState<OrchestratorEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    const eventSource = new EventSource(
      `/api/projects/${projectId}/workspace/sessions/${sessionId}/events`
    )

    eventSource.onopen = () => setIsConnected(true)
    eventSource.onerror = () => setIsConnected(false)

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      setEvents(prev => [...prev, data])

      // Handle specific event types
      if (data.type === 'file_conflict') {
        showConflictNotification(data.data)
      }
    }

    return () => eventSource.close()
  }, [projectId, sessionId])

  return { events, isConnected }
}
```

---

## Phase 3: Cross-Session Communication

### Purpose
Enable Claude Code sessions to request information from other sessions through the orchestrator.

### Message Flow

```
Session 1 (Repo A)                Orchestrator              Session 2 (Repo B)
      │                               │                           │
      │  "I need the API schema       │                           │
      │   from Repo B"                │                           │
      │                               │                           │
      ├──────────────────────────────>│                           │
      │  POST /cross-session-request  │                           │
      │  { targetRepo: 'B',           │                           │
      │    query: 'API schema' }      │                           │
      │                               │                           │
      │                               ├──────────────────────────>│
      │                               │  SSE: cross_session_request│
      │                               │  { requestId: 'xxx',      │
      │                               │    query: 'API schema' }  │
      │                               │                           │
      │                               │<──────────────────────────┤
      │                               │  POST /cross-session-response
      │                               │  { requestId: 'xxx',      │
      │                               │    response: '...' }      │
      │                               │                           │
      │<──────────────────────────────┤                           │
      │  SSE: cross_session_response  │                           │
      │  { requestId: 'xxx',          │                           │
      │    response: '...' }          │                           │
      │                               │                           │
```

### Database Schema

```sql
-- Cross-session message queue
CREATE TABLE workspace_cross_session_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Request details
  request_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  source_session_id UUID NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
  target_session_id UUID REFERENCES workspace_sessions(id) ON DELETE SET NULL,
  target_repo_id UUID REFERENCES repos(id) ON DELETE SET NULL,

  -- Message content
  message_type TEXT NOT NULL CHECK (message_type IN ('query', 'command', 'sync')),
  query TEXT NOT NULL,
  context JSONB,  -- Additional context for the request

  -- Response
  response TEXT,
  response_data JSONB,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'processing', 'completed', 'failed', 'timeout')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '5 minutes'
);

-- Index for finding pending requests
CREATE INDEX idx_cross_session_pending
  ON workspace_cross_session_messages(target_session_id, status, created_at)
  WHERE status IN ('pending', 'delivered');

-- Index for source session to check their requests
CREATE INDEX idx_cross_session_source
  ON workspace_cross_session_messages(source_session_id, status, created_at);
```

### API Endpoints

#### POST /api/projects/[id]/workspace/cross-session/request
Create a cross-session request.

```typescript
// Request body
interface CrossSessionRequest {
  targetSessionId?: string    // Specific session, or...
  targetRepoName?: string     // Any session working on this repo
  messageType: 'query' | 'command' | 'sync'
  query: string               // What to ask/do
  context?: Record<string, any>
  timeoutMs?: number          // Default 30000 (30 seconds)
}

// Response
interface CrossSessionRequestResponse {
  requestId: string
  status: 'pending' | 'no_target_available'
  targetSession?: {
    sessionId: string
    userName: string
    repoName: string
  }
}
```

#### POST /api/projects/[id]/workspace/cross-session/response
Respond to a cross-session request.

```typescript
// Request body
interface CrossSessionResponseBody {
  requestId: string
  response: string
  responseData?: Record<string, any>
  status: 'completed' | 'failed'
}
```

#### GET /api/projects/[id]/workspace/cross-session/pending
Get pending requests for a session.

```typescript
// Response
interface PendingRequestsResponse {
  requests: {
    requestId: string
    sourceSession: {
      sessionId: string
      userName: string
      repoName: string
    }
    messageType: string
    query: string
    context?: Record<string, any>
    createdAt: string
    expiresAt: string
  }[]
}
```

### Orchestrator as Router

The orchestrator Claude can also initiate cross-session requests:

```typescript
// When user asks orchestrator about another repo
"What's the API structure in repo B?"

// Orchestrator:
// 1. Check if there's an active session on repo B
// 2. If yes, send cross-session request
// 3. Wait for response (with timeout)
// 4. Synthesize response for user
```

---

## Implementation Files

### Database Migration
- `supabase/migrations/20240211000000_orchestrator_events.sql`

### API Routes
- `apps/web/src/app/api/projects/[id]/workspace/sessions/[sessionId]/activity/route.ts`
- `apps/web/src/app/api/projects/[id]/workspace/sessions/[sessionId]/events/route.ts`
- `apps/web/src/app/api/projects/[id]/workspace/cross-session/request/route.ts`
- `apps/web/src/app/api/projects/[id]/workspace/cross-session/response/route.ts`

### Hooks
- `apps/web/src/hooks/use-orchestrator-events.ts`

### Components
- `apps/web/src/components/workspace/conflict-notification.tsx`
- `apps/web/src/components/workspace/cross-session-panel.tsx`

### Enhanced Orchestrator
- Update `orchestrator/route.ts` to use cross-session communication

---

## Event Flow Examples

### Example 1: File Conflict Detection

```
1. User A (Session 1) modifies src/api.ts
2. Activity reported to orchestrator
3. Orchestrator checks for conflicts
4. User B (Session 2) is also editing src/api.ts
5. Both sessions receive SSE event:
   {
     type: 'file_conflict',
     data: {
       filePath: 'src/api.ts',
       severity: 'critical',
       suggestion: 'Coordinate with User B before committing'
     }
   }
6. UI shows conflict warning in both workspaces
```

### Example 2: Cross-Session Query

```
1. User asks Orchestrator: "What endpoints does repo B expose?"
2. Orchestrator checks for active session on repo B
3. Found: User A has Session 2 on repo B
4. Orchestrator sends cross-session request:
   {
     targetSessionId: 'session-2',
     query: 'List all API endpoints in this repository'
   }
5. Session 2 receives SSE event, Claude processes query
6. Session 2 responds with endpoint list
7. Orchestrator synthesizes response for user
```

### Example 3: Sync Coordination

```
1. User A wants to push changes to repo A
2. Orchestrator detects User B has uncommitted changes in repo A
3. Orchestrator sends notification to both:
   - User A: "User B has uncommitted changes. Coordinate before pushing."
   - User B: "User A wants to push. Please commit or stash your changes."
4. Users can acknowledge or request more time
```

---

## Security Considerations

1. **Session Isolation**: Sessions can only communicate within the same project
2. **Rate Limiting**: Cross-session requests are rate-limited per session
3. **Timeout**: All cross-session requests have mandatory timeouts
4. **Audit Trail**: All cross-session communication is logged
5. **User Consent**: Users can disable cross-session queries in settings
