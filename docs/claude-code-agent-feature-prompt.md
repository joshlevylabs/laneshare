# Claude Code Agent Implementation Feature - PRD & Implementation Guide

## Context for Claude

You are working on **laneshare**, a project management and developer productivity platform built with:
- **Frontend**: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API routes, Supabase (PostgreSQL + Auth + Storage)
- **Monorepo**: pnpm workspaces with `apps/web` and `packages/shared`
- **Key integrations**: GitHub (repos), Supabase (database services), Vercel (deployments), OpenAPI specs

The platform currently supports:
1. **Project Management**: Tasks, sprints, backlog management with drag & drop
2. **PRD Planning**: AI-assisted PRD creation with "Plan Mode" chat interface
3. **PRD → Sprint Generation**: Convert user stories to tasks/sprints
4. **Repository Connections**: GitHub repos linked to projects with sync capabilities
5. **Documentation Generation**: AI-generated docs from codebase analysis
6. **Service Connections**: Supabase, Vercel, OpenAPI integrations

---

## Feature Request: Claude Code Agent Implementation

### Overview

Build a complete "AI Implementation" feature that allows Claude Code agents to:
1. Take sprint tasks with acceptance criteria
2. Actually edit code files in connected GitHub repositories
3. Test changes iteratively until acceptance criteria pass
4. Update task status and documentation automatically
5. Use a robust agent loop pattern for reliable execution

### User Flow

```
[PRD Planning] → [Convert to User Stories] → [Generate Sprint with Tasks]
                                                       ↓
                                              [Sprint with Tasks]
                                                       ↓
                                         [Click "Implement Sprint"]
                                                       ↓
                                     [Claude Agent Loop Begins]
                                                       ↓
                              ┌──────────────────────────────────┐
                              │     For each task in sprint:     │
                              │  1. Read task + acceptance criteria│
                              │  2. Analyze codebase context      │
                              │  3. Plan implementation           │
                              │  4. Edit code files               │
                              │  5. Run tests                     │
                              │  6. Verify acceptance criteria    │
                              │  7. Loop until passing OR stuck   │
                              │  8. Update task status            │
                              │  9. Update agents.md              │
                              └──────────────────────────────────┘
                                                       ↓
                                      [Sprint Complete / Report]
```

---

## Technical Requirements

### 1. Database Schema Extensions

```sql
-- Agent execution sessions
CREATE TABLE public.agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sprint_id UUID REFERENCES public.sprints(id) ON DELETE SET NULL,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,

  -- Execution state
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),

  -- Agent configuration
  agent_config JSONB DEFAULT '{}',

  -- Execution tracking
  current_step TEXT,
  steps_completed INTEGER DEFAULT 0,
  total_steps INTEGER,

  -- Results
  files_changed JSONB DEFAULT '[]',  -- [{path, action, diff_summary}]
  tests_run JSONB DEFAULT '[]',       -- [{name, passed, output}]
  acceptance_results JSONB DEFAULT '[]', -- [{criterion, passed, evidence}]

  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Error tracking
  error_message TEXT,
  error_details JSONB,

  -- Conversation/thinking log
  agent_log JSONB DEFAULT '[]',  -- [{timestamp, type, content}]

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES public.profiles(id)
);

-- Agent file operations (for tracking/rollback)
CREATE TABLE public.agent_file_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,

  file_path TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('CREATE', 'UPDATE', 'DELETE')),

  -- Content tracking
  original_content TEXT,
  new_content TEXT,
  diff TEXT,

  -- Status
  applied BOOLEAN DEFAULT FALSE,
  reverted BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_agent_sessions_project ON public.agent_sessions(project_id);
CREATE INDEX idx_agent_sessions_sprint ON public.agent_sessions(sprint_id);
CREATE INDEX idx_agent_sessions_status ON public.agent_sessions(status);
CREATE INDEX idx_agent_file_ops_session ON public.agent_file_operations(session_id);
```

### 2. API Endpoints

#### Sprint Implementation
```
POST /api/projects/[id]/sprints/[sprintId]/implement
- Start agent implementation for entire sprint
- Body: { repo_id, config: { auto_commit, branch_strategy, test_command } }
- Returns: { session_id, status }

GET /api/projects/[id]/sprints/[sprintId]/implement/status
- Get current implementation status
- Returns: { sessions: [...], overall_progress, tasks_completed }

POST /api/projects/[id]/sprints/[sprintId]/implement/pause
POST /api/projects/[id]/sprints/[sprintId]/implement/resume
POST /api/projects/[id]/sprints/[sprintId]/implement/cancel
```

#### Task Implementation
```
POST /api/projects/[id]/tasks/[taskId]/implement
- Start agent implementation for single task
- Body: { repo_id, config }
- Returns: { session_id }

GET /api/projects/[id]/tasks/[taskId]/implement/status
- Real-time status with SSE support
- Returns: { status, current_step, log, files_changed, tests }

POST /api/projects/[id]/tasks/[taskId]/implement/feedback
- Send user feedback/guidance to running agent
- Body: { message, action: 'continue' | 'retry' | 'skip' | 'cancel' }
```

#### Agent Session Management
```
GET /api/projects/[id]/agent-sessions
GET /api/projects/[id]/agent-sessions/[sessionId]
GET /api/projects/[id]/agent-sessions/[sessionId]/log
POST /api/projects/[id]/agent-sessions/[sessionId]/rollback
```

### 3. Core Agent Loop Implementation

Create `packages/shared/src/agents/implementation-agent.ts`:

```typescript
interface ImplementationAgentConfig {
  taskId: string;
  repoId: string;
  projectId: string;

  // Repo access
  githubToken: string;
  repoOwner: string;
  repoName: string;
  baseBranch: string;
  workingBranch?: string;

  // Task context
  taskTitle: string;
  taskDescription: string;
  acceptanceCriteria: string[];
  linkedContext: {
    docs: string[];
    services: string[];
    relatedTasks: string[];
  };

  // Configuration
  testCommand?: string;
  buildCommand?: string;
  maxIterations?: number;
  autoCommit?: boolean;
}

interface AgentStep {
  id: string;
  type: 'ANALYZE' | 'PLAN' | 'IMPLEMENT' | 'TEST' | 'VERIFY' | 'DOCUMENT';
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  input: unknown;
  output: unknown;
  startedAt?: Date;
  completedAt?: Date;
}

interface AgentState {
  sessionId: string;
  currentStep: AgentStep | null;
  completedSteps: AgentStep[];
  filesChanged: FileChange[];
  testsRun: TestResult[];
  acceptanceResults: AcceptanceResult[];
  iteration: number;
  maxIterations: number;
}
```

#### The "Ralph Wiggum Loop" Pattern

```typescript
/**
 * Ralph Wiggum Loop - Named for its "I'm helping!" persistence
 *
 * Core principles:
 * 1. Always make progress (even small steps count)
 * 2. Never give up until explicitly told or max iterations
 * 3. Learn from each iteration's failures
 * 4. Document everything for human review
 * 5. Know when to ask for help vs. keep trying
 */

async function implementTask(config: ImplementationAgentConfig): Promise<AgentResult> {
  const state: AgentState = initializeState(config);

  while (state.iteration < state.maxIterations) {
    state.iteration++;
    log(state, `Starting iteration ${state.iteration}`);

    try {
      // Step 1: ANALYZE - Understand current state
      const analysis = await analyzeCodebase(state, config);
      if (analysis.needsMoreContext) {
        await gatherAdditionalContext(state, analysis.contextNeeded);
      }

      // Step 2: PLAN - Create implementation plan
      const plan = await createImplementationPlan(state, config, analysis);
      await logPlan(state, plan);

      // Step 3: IMPLEMENT - Make code changes
      for (const change of plan.changes) {
        const result = await applyChange(state, change);
        state.filesChanged.push(result);

        // Incremental verification
        if (config.testCommand) {
          const quickTest = await runQuickTests(state, config);
          if (!quickTest.passed) {
            log(state, `Quick test failed after ${change.path}, analyzing...`);
            const fix = await analyzeTestFailure(state, quickTest);
            if (fix.canAutoFix) {
              await applyChange(state, fix.change);
            } else {
              break; // Re-plan in next iteration
            }
          }
        }
      }

      // Step 4: TEST - Run full test suite
      const testResults = await runTests(state, config);
      state.testsRun.push(...testResults);

      // Step 5: VERIFY - Check acceptance criteria
      const verification = await verifyAcceptanceCriteria(
        state,
        config.acceptanceCriteria,
        { code: state.filesChanged, tests: testResults }
      );
      state.acceptanceResults = verification.results;

      // Success check
      if (verification.allPassing) {
        log(state, 'All acceptance criteria passing!');

        // Step 6: DOCUMENT - Update agents.md
        await updateAgentDocumentation(state, config);

        // Commit if configured
        if (config.autoCommit) {
          await commitChanges(state, config);
        }

        return { success: true, state };
      }

      // Not all passing - analyze what's wrong
      const failedCriteria = verification.results.filter(r => !r.passed);
      log(state, `${failedCriteria.length} criteria still failing, planning fixes...`);

      // Check if we're making progress
      const progress = calculateProgress(state);
      if (progress.stuck) {
        log(state, 'Appears stuck, requesting human guidance...');
        await requestHumanFeedback(state, {
          reason: progress.stuckReason,
          suggestions: progress.suggestedActions
        });

        // Wait for feedback (with timeout)
        const feedback = await waitForFeedback(state, { timeout: 300000 });
        if (feedback.action === 'cancel') {
          return { success: false, state, reason: 'Cancelled by user' };
        }
        if (feedback.action === 'skip') {
          return { success: false, state, reason: 'Skipped by user', partial: true };
        }
        // 'continue' or 'retry' - incorporate feedback and continue
        state.humanFeedback.push(feedback);
      }

    } catch (error) {
      log(state, `Error in iteration ${state.iteration}: ${error.message}`);

      // Recoverable errors - try to continue
      if (isRecoverableError(error)) {
        await handleRecoverableError(state, error);
        continue;
      }

      // Unrecoverable - stop and report
      return {
        success: false,
        state,
        reason: `Unrecoverable error: ${error.message}`,
        error
      };
    }
  }

  // Max iterations reached
  return {
    success: false,
    state,
    reason: `Max iterations (${state.maxIterations}) reached`,
    partial: state.acceptanceResults.some(r => r.passed)
  };
}
```

### 4. GitHub Integration for Code Editing

```typescript
// packages/shared/src/agents/github-operations.ts

interface GitHubFileOperation {
  path: string;
  content: string;
  message: string;
  branch: string;
}

class GitHubCodeEditor {
  constructor(
    private octokit: Octokit,
    private owner: string,
    private repo: string
  ) {}

  async createBranch(baseBranch: string, newBranch: string): Promise<void> {
    const baseRef = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${baseBranch}`
    });

    await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${newBranch}`,
      sha: baseRef.data.object.sha
    });
  }

  async readFile(path: string, branch: string): Promise<string | null> {
    try {
      const response = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: branch
      });

      if ('content' in response.data) {
        return Buffer.from(response.data.content, 'base64').toString('utf-8');
      }
      return null;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async writeFile(op: GitHubFileOperation): Promise<void> {
    const existingFile = await this.getFileSha(op.path, op.branch);

    await this.octokit.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path: op.path,
      message: op.message,
      content: Buffer.from(op.content).toString('base64'),
      branch: op.branch,
      sha: existingFile?.sha
    });
  }

  async createPullRequest(
    head: string,
    base: string,
    title: string,
    body: string
  ): Promise<number> {
    const pr = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      head,
      base,
      title,
      body
    });
    return pr.data.number;
  }
}
```

### 5. UI Components

#### Implement Sprint Dialog
```tsx
// apps/web/src/components/sprints/implement-sprint-dialog.tsx

interface ImplementSprintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  sprint: Sprint;
  tasks: Task[];
  repos: Repo[];
}

// Shows:
// - Sprint overview (tasks, acceptance criteria count)
// - Repo selection dropdown
// - Branch strategy (new branch vs existing)
// - Test command configuration
// - Auto-commit toggle
// - "Start Implementation" button
```

#### Agent Progress Panel
```tsx
// apps/web/src/components/agents/agent-progress-panel.tsx

interface AgentProgressPanelProps {
  sessionId: string;
  onFeedback: (feedback: AgentFeedback) => void;
}

// Shows real-time:
// - Current step indicator
// - Progress bar
// - Live log output (collapsible)
// - Files changed (with diff preview)
// - Test results
// - Acceptance criteria checklist
// - Feedback input for stuck states
// - Pause/Resume/Cancel buttons
```

#### Task Implementation Status
```tsx
// apps/web/src/components/tasks/task-implementation-status.tsx

// Inline status indicator on task cards showing:
// - Not started (gray)
// - In progress (yellow spinner)
// - Completed (green check)
// - Failed (red X with hover details)
// - Needs feedback (orange with notification)
```

### 6. Agent Documentation (agents.md)

The agent should maintain/update an `agents.md` file in the repo:

```markdown
# AI Agent Activity Log

## Latest Session
- **Date**: 2024-01-15
- **Sprint**: Sprint Jan W2
- **Tasks Completed**: 3/5

### Task: LS-42 - Add user authentication
- **Status**: Completed
- **Files Changed**:
  - `src/lib/auth.ts` (created)
  - `src/middleware.ts` (modified)
  - `src/app/login/page.tsx` (created)
- **Tests Added**: 4
- **Acceptance Criteria**: 5/5 passing

### Task: LS-43 - Create user profile page
- **Status**: Completed with notes
- **Notes**: Used existing Avatar component, added new ProfileCard
- **Files Changed**: ...

## Change History
| Date | Task | Action | Files |
|------|------|--------|-------|
| 2024-01-15 | LS-42 | Implement auth | 3 files |
| 2024-01-15 | LS-43 | Add profile page | 2 files |
```

### 7. Prompts for Claude Agent

Create `packages/shared/src/prompts/implementation-agent.ts`:

```typescript
export const IMPLEMENTATION_SYSTEM_PROMPT = `You are an expert software engineer implementing features for a codebase.

## Your Role
You will receive a task with:
- Title and description
- Acceptance criteria (must ALL pass)
- Codebase context (file structure, patterns, dependencies)
- Linked documentation and related code

## Your Process
1. **Analyze**: Understand the codebase patterns, existing code, and requirements
2. **Plan**: Create a detailed implementation plan before writing any code
3. **Implement**: Write clean, idiomatic code following existing patterns
4. **Test**: Ensure tests pass and add new tests for new functionality
5. **Verify**: Check each acceptance criterion explicitly
6. **Document**: Update relevant documentation

## Code Quality Rules
- Follow existing code patterns and conventions
- Use TypeScript with proper types (no \`any\`)
- Add JSDoc comments for public functions
- Handle errors appropriately
- Keep functions small and focused
- Write testable code

## When Stuck
- Explain what you tried and why it didn't work
- Suggest alternative approaches
- Ask specific questions (not vague ones)
- Never silently give up

## Output Format
For each action, output structured JSON:
\`\`\`json
{
  "action": "ANALYZE" | "PLAN" | "EDIT_FILE" | "CREATE_FILE" | "RUN_TESTS" | "VERIFY" | "REQUEST_FEEDBACK",
  "reasoning": "Why you're taking this action",
  "details": { ... action-specific details ... }
}
\`\`\`
`;

export const VERIFICATION_PROMPT = `
Given the following acceptance criteria and the current implementation state, verify each criterion:

## Acceptance Criteria
{{criteria}}

## Implementation
### Files Changed
{{files}}

### Test Results
{{tests}}

## Instructions
For EACH criterion, determine:
1. Is it passing? (true/false)
2. What evidence supports this? (specific code, test results)
3. If failing, what's missing or wrong?

Output JSON:
\`\`\`json
{
  "results": [
    {
      "criterion": "...",
      "passing": true/false,
      "evidence": "...",
      "missingWork": "..." // only if not passing
    }
  ],
  "allPassing": true/false,
  "summary": "..."
}
\`\`\`
`;
```

---

## Implementation Phases

### Phase 1: Foundation (Database + Basic API)
1. Create database migrations for agent sessions and file operations
2. Implement basic API endpoints for session management
3. Add agent session status to task/sprint pages

### Phase 2: GitHub Integration
1. Implement GitHubCodeEditor class
2. Add branch creation and file editing
3. Implement diff tracking and rollback capability
4. Add PR creation support

### Phase 3: Core Agent Loop
1. Implement the Ralph Wiggum loop pattern
2. Create codebase analysis functions
3. Implement test running and verification
4. Add progress tracking and logging

### Phase 4: UI Components
1. Build ImplementSprintDialog
2. Create AgentProgressPanel with real-time updates
3. Add task implementation status indicators
4. Implement feedback input for stuck states

### Phase 5: Polish & Safety
1. Add rollback functionality
2. Implement rate limiting and cost tracking
3. Add approval workflows for sensitive changes
4. Create comprehensive logging and audit trail

---

## Success Criteria for This Feature

1. [ ] User can click "Implement Sprint" on any sprint with tasks
2. [ ] Agent creates appropriate branch in connected repo
3. [ ] Agent iteratively implements each task
4. [ ] Agent runs tests and verifies acceptance criteria
5. [ ] Agent updates task status automatically (TODO → IN_PROGRESS → DONE)
6. [ ] Agent updates agents.md with activity log
7. [ ] User can provide feedback when agent is stuck
8. [ ] User can pause/resume/cancel implementation
9. [ ] All changes are tracked and can be rolled back
10. [ ] PR is created with implementation summary

---

## Additional Context

### Existing Relevant Files
- `apps/web/src/app/api/projects/[id]/tasks/[taskId]/route.ts` - Task CRUD
- `apps/web/src/app/api/projects/[id]/sprints/` - Sprint management
- `apps/web/src/components/tasks/` - Task UI components
- `packages/shared/src/prompts/` - AI prompt templates
- `apps/web/src/lib/supabase/` - Database utilities

### Environment
- Claude API for agent intelligence
- GitHub API for code operations
- Supabase for state persistence
- Next.js API routes for orchestration

---

## Your Task

Implement this feature following the phases above. Start with Phase 1 (database schema) and proceed systematically. For each phase:

1. Create the necessary files
2. Update existing files as needed
3. Add appropriate TypeScript types
4. Include error handling
5. Write tests where applicable

Ask clarifying questions if requirements are ambiguous. Prefer simple, working implementations over complex architectures.
