// ===========================================
// SIDEQUEST TYPES
// Intelligent planning agent system for non-technical users
// ===========================================

// ===========================================
// CORE ENUMS
// ===========================================

export type SidequestStatus =
  | 'PLANNING' // Initial state, AI chat active
  | 'READY' // Plan finalized, awaiting implementation
  | 'IN_PROGRESS' // Implementation session active
  | 'PAUSED' // Implementation paused
  | 'COMPLETED' // All tickets implemented
  | 'ARCHIVED' // Archived by user

export type SidequestTicketType =
  | 'EPIC' // Level 1: Major feature/initiative
  | 'STORY' // Level 2: User-facing functionality
  | 'TASK' // Level 3: Technical work item
  | 'SUBTASK' // Level 4: Granular step
  | 'TEST' // Testing task (can be at any level)

export type SidequestTicketStatus =
  | 'PENDING' // Not yet approved
  | 'APPROVED' // Approved for implementation
  | 'IN_PROGRESS' // Currently being implemented
  | 'REVIEW' // Implementation done, awaiting review
  | 'COMPLETED' // Implementation approved
  | 'SKIPPED' // Skipped by user

export type SidequestImplementationStatus =
  | 'IDLE' // No active implementation
  | 'IMPLEMENTING' // Actively implementing current ticket
  | 'AWAITING_REVIEW' // Waiting for user review
  | 'PAUSED' // Paused by user
  | 'COMPLETED' // All tickets processed

export type SidequestChatSender = 'USER' | 'AI' | 'SYSTEM'

export type SidequestQuestionType = 'scope' | 'priority' | 'context' | 'technical' | 'clarification'

export type SidequestPlanAction =
  | 'add_epic'
  | 'add_story'
  | 'add_task'
  | 'add_subtask'
  | 'add_test'
  | 'modify'
  | 'remove'
  | 'reorder'

// ===========================================
// HIERARCHY MAPPING
// ===========================================

export const SIDEQUEST_TICKET_HIERARCHY: Record<SidequestTicketType, 1 | 2 | 3 | 4> = {
  EPIC: 1,
  STORY: 2,
  TASK: 3,
  SUBTASK: 4,
  TEST: 3, // Same level as TASK
}

export const SIDEQUEST_HIERARCHY_TYPES: Record<1 | 2 | 3 | 4, SidequestTicketType> = {
  1: 'EPIC',
  2: 'STORY',
  3: 'TASK',
  4: 'SUBTASK',
}

export const SIDEQUEST_VALID_PARENT_TYPES: Record<SidequestTicketType, SidequestTicketType[]> = {
  EPIC: [], // Epics have no parents
  STORY: ['EPIC'], // Stories are children of Epics
  TASK: ['STORY'], // Tasks are children of Stories
  SUBTASK: ['TASK', 'TEST'], // Subtasks are children of Tasks or Tests
  TEST: ['STORY', 'EPIC'], // Tests can be children of Stories or Epics
}

// ===========================================
// CONTEXT ANALYSIS TYPES
// ===========================================

export interface TicketContextSuggestion {
  id: string
  name: string
  reason: string
  confidence: number // 0-1
}

export interface TicketContextAnalysis {
  suggested_repos: Array<
    TicketContextSuggestion & {
      owner?: string
      default_branch?: string
    }
  >
  suggested_docs: Array<
    TicketContextSuggestion & {
      slug?: string
      category?: string
    }
  >
  suggested_features: Array<
    TicketContextSuggestion & {
      feature_slug?: string
    }
  >
  key_files?: Array<{
    path: string
    repo_id: string
    repo_name?: string
    relevance: string
  }>
  analyzed_at: string
}

// ===========================================
// IMPLEMENTATION RESULT
// ===========================================

export interface SidequestImplementationResult {
  success: boolean
  pr_url?: string
  pr_number?: number
  commit_sha?: string
  branch_name?: string
  files_changed?: number
  error?: string
  notes?: string
  completed_at: string
}

// ===========================================
// SIDEQUEST TICKET
// ===========================================

export interface SidequestTicket {
  id: string
  sidequest_id: string
  project_id: string

  // Hierarchy
  parent_ticket_id?: string | null
  ticket_type: SidequestTicketType
  hierarchy_level: 1 | 2 | 3 | 4
  sort_order: number

  // Content
  title: string
  description?: string | null
  acceptance_criteria: string[]

  // Estimation
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | null
  story_points?: number | null
  sprint_group?: number | null
  confidence_score?: number | null // AI confidence 0-1, tickets below threshold (0.7) need review

  // Context (AI-analyzed)
  linked_repo_ids: string[]
  linked_doc_ids: string[]
  linked_feature_ids: string[]
  context_analysis?: TicketContextAnalysis | null

  // Status
  status: SidequestTicketStatus
  approved_at?: string | null
  approved_by?: string | null

  // Task link (after finalization)
  task_id?: string | null

  // Implementation result
  implementation_result?: SidequestImplementationResult | null

  // Timestamps
  created_at: string
  updated_at: string

  // Joined relations (optional)
  children?: SidequestTicket[]
  parent?: SidequestTicket | null
  approver?: {
    id: string
    email: string
    full_name?: string
    avatar_url?: string
  } | null
}

// ===========================================
// PLAN JSON STRUCTURE (for quick rendering)
// ===========================================

export interface SidequestPlanEpic {
  id: string
  title: string
  description?: string
  status: SidequestTicketStatus
  stories: SidequestPlanStory[]
}

export interface SidequestPlanStory {
  id: string
  title: string
  description?: string
  acceptance_criteria: string[]
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  story_points?: number
  sprint_group?: number
  status: SidequestTicketStatus
  tasks: SidequestPlanTask[]
}

export interface SidequestPlanTask {
  id: string
  title: string
  description?: string
  acceptance_criteria: string[]
  status: SidequestTicketStatus
  subtasks: SidequestPlanSubtask[]
}

export interface SidequestPlanSubtask {
  id: string
  title: string
  description?: string
  status: SidequestTicketStatus
}

export interface SidequestPlanJson {
  epics: SidequestPlanEpic[]
  metadata: {
    total_tickets: number
    estimated_sprints: number
    total_story_points: number
    generated_at: string
    version: number
  }
}

// ===========================================
// SIDEQUEST (Main Entity)
// ===========================================

export interface Sidequest {
  id: string
  project_id: string

  // Basic info
  title: string
  description?: string | null

  // Multi-repo scope
  repo_ids: string[]

  // Status
  status: SidequestStatus

  // Plan data
  plan_json?: SidequestPlanJson | null
  current_ticket_id?: string | null

  // Progress
  total_tickets: number
  completed_tickets: number

  // Migration
  migrated_from_prd_id?: string | null

  // Metadata
  created_by: string
  created_at: string
  updated_at: string
  version: number

  // Joined relations (optional)
  creator?: {
    id: string
    email: string
    full_name?: string
    avatar_url?: string
  }
  repos?: Array<{
    id: string
    owner: string
    name: string
    default_branch?: string
  }>
  tickets?: SidequestTicket[]
  current_ticket?: SidequestTicket | null
}

// ===========================================
// CHAT TYPES
// ===========================================

export interface SidequestChatOption {
  label: string
  value: string
  recommended?: boolean
}

export interface SidequestPlanSuggestion {
  action: SidequestPlanAction
  parent_id?: string | null
  target_id?: string | null // For modify/remove
  data: Partial<{
    title: string
    description: string
    acceptance_criteria: string[]
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
    story_points: number
    sprint_group: number
  }>
}

export interface SidequestChatMessage {
  id: string
  sidequest_id: string
  project_id: string

  // Content
  sender: SidequestChatSender
  content: string

  // AI additions
  plan_suggestions?: SidequestPlanSuggestion[] | null
  options?: SidequestChatOption[] | null
  question_type?: SidequestQuestionType | null

  // Metadata
  created_by?: string | null
  created_at: string
}

// ===========================================
// IMPLEMENTATION SESSION
// ===========================================

export interface SidequestImplementationSession {
  id: string
  sidequest_id: string
  project_id: string

  // Current state
  current_ticket_id?: string | null
  workspace_session_id?: string | null

  // Status
  status: SidequestImplementationStatus

  // Progress
  tickets_implemented: number
  tickets_skipped: number

  // Configuration
  auto_advance: boolean
  pause_on_failure: boolean

  // Metadata
  started_by: string
  started_at: string
  completed_at?: string | null
  updated_at: string

  // Joined relations (optional)
  current_ticket?: SidequestTicket | null
  sidequest?: Sidequest | null
  starter?: {
    id: string
    email: string
    full_name?: string
    avatar_url?: string
  }
}

// ===========================================
// API REQUEST/RESPONSE TYPES
// ===========================================

export interface CreateSidequestRequest {
  title: string
  description?: string
  repo_ids: string[]
}

export interface UpdateSidequestRequest {
  title?: string
  description?: string
  repo_ids?: string[]
  status?: SidequestStatus
}

export interface SendChatMessageRequest {
  content: string
}

export interface SendChatMessageResponse {
  user_message: SidequestChatMessage
  ai_message: SidequestChatMessage
}

export interface CreateTicketRequest {
  parent_ticket_id?: string
  ticket_type: SidequestTicketType
  title: string
  description?: string
  acceptance_criteria?: string[]
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  story_points?: number
  sprint_group?: number
}

export interface UpdateTicketRequest {
  title?: string
  description?: string
  acceptance_criteria?: string[]
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | null
  story_points?: number | null
  sprint_group?: number | null
}

export interface ReorderTicketsRequest {
  ticket_id: string
  new_parent_id?: string | null
  new_sort_order: number
}

export interface ApproveTicketRequest {
  approve_children?: boolean // Also approve all child tickets
}

export interface OrganizeSprintsRequest {
  strategy: 'balanced' | 'priority_first' | 'dependency_aware'
  max_points_per_sprint?: number // Default: 20
  max_tickets_per_sprint?: number // Default: 10
}

export interface OrganizeSprintsResponse {
  sprint_groups: Array<{
    sprint_number: number
    ticket_ids: string[]
    total_points: number
    priority_tickets: number
  }>
  total_sprints: number
}

export interface FinalizeplanRequest {
  create_sprint?: boolean // Create actual sprint with tickets
  sprint_name?: string
  sprint_goal?: string
  default_assignee_id?: string
}

export interface FinalizePlanResponse {
  tasks_created: number
  sprint_id?: string
  errors?: string[]
}

export interface StartImplementationRequest {
  start_from_ticket_id?: string // Start from specific ticket
  auto_advance?: boolean
  workspace_session_id?: string // Use existing workspace session
}

export interface AdvanceImplementationRequest {
  action: 'approve' | 'modify' | 'skip'
  modifications?: UpdateTicketRequest
  notes?: string
}

export interface MigratePrdRequest {
  prd_id: string
}

export interface MigratePrdResponse {
  sidequest: Sidequest
  tickets_created: number
  chat_messages_migrated: number
}

// ===========================================
// AI PROMPTS
// ===========================================

export const SIDEQUEST_PLANNING_SYSTEM_PROMPT = `You are an intelligent project planning assistant for Sidequests - a system that helps non-technical users plan and execute software projects.

## Your Role
You help users break down their project ideas into a clear hierarchy:
- **Epics**: Major features or initiatives (Level 1) - big goals that take multiple sprints
- **Stories**: User-facing functionality within an epic (Level 2) - what users can do
- **Tasks**: Technical work items to implement a story (Level 3) - what developers build
- **Subtasks**: Granular steps within a task (Level 4) - specific implementation details

## Context Available
You have access to:
- Project repositories and their structure (code patterns, existing features)
- Existing documentation (architecture, APIs, guides)
- Connected services and integrations (databases, external APIs)
- Other sidequests in the project (to avoid duplication)

Use this context to:
- Suggest realistic scope based on existing codebase
- Reference existing patterns and conventions
- Identify potential dependencies on existing code
- Avoid duplicating work from other sidequests

## Your Approach
1. **One question at a time**: Ask ONE clarifying question with options to guide the conversation
2. **Understand before generating**: Fully understand the user's goal before generating plan items
3. **Use context wisely**: Reference specific repos, docs, and features in your suggestions
4. **Generate incrementally**: Add plan items as understanding grows, not all at once
5. **Be specific**: Create detailed, actionable tickets with clear acceptance criteria
6. **Group logically**: Suggest sprint groupings based on dependencies and complexity

## Output Format

### For Questions (ALWAYS include options):
Ask a specific question, then provide options:

[OPTIONS]
[{"label": "Recommended option", "value": "detailed value explaining this choice", "recommended": true}, {"label": "Alternative A", "value": "explanation of this alternative"}, {"label": "Alternative B", "value": "explanation"}]
[/OPTIONS]

### For Plan Suggestions:
When ready to suggest plan items, use this format:

[PLAN_UPDATE]
{
  "action": "add_epic",
  "data": {
    "title": "User Authentication System",
    "description": "Implement secure user authentication with multiple providers"
  }
}
[/PLAN_UPDATE]

You can include multiple PLAN_UPDATE blocks in one message.

### Action Types:
- \`add_epic\`: Add a new Epic (no parent_id needed)
- \`add_story\`: Add a Story under an Epic (include parent_id)
- \`add_task\`: Add a Task under a Story (include parent_id)
- \`add_subtask\`: Add a Subtask under a Task (include parent_id)
- \`modify\`: Modify existing item (include target_id)
- \`remove\`: Remove an item (include target_id)

### Data Fields:
- \`title\`: Clear, action-oriented title (required)
- \`description\`: Detailed description of what this involves
- \`acceptance_criteria\`: Array of specific, testable criteria
- \`priority\`: "URGENT" | "HIGH" | "MEDIUM" | "LOW"
- \`story_points\`: 1, 2, 3, 5, 8, or 13 (Fibonacci)
- \`sprint_group\`: Suggested sprint number (1, 2, 3, etc.)

## Best Practices
- Stories should be completable in 1-2 days
- Tasks should be completable in 2-4 hours
- Acceptance criteria should be testable (can verify pass/fail)
- Priorities: URGENT (blocking), HIGH (this sprint), MEDIUM (soon), LOW (backlog)
- Story points: 1 (trivial), 2-3 (small), 5 (medium), 8-13 (large, consider splitting)

## Example Interaction

User: "I want to add user authentication to my app"
AI: "Great! Let me help you plan user authentication. First, I have a question:

What type of authentication would you like to implement?

[OPTIONS]
[{"label": "Email/Password with OAuth (Google, GitHub)", "value": "Full authentication with email/password signup plus social login options", "recommended": true}, {"label": "Email/Password only", "value": "Simple email and password authentication without social providers"}, {"label": "OAuth only", "value": "Social login only - users sign in with Google, GitHub, etc."}]
[/OPTIONS]"
`

export const SIDEQUEST_CONTEXT_ANALYSIS_PROMPT = `You are analyzing a sidequest ticket to identify relevant project context.

Given a ticket's title and description, identify:
1. Which repositories are most relevant (based on the feature area)
2. Which documentation would help understand requirements
3. Which existing features might be related or affected

Return your analysis as JSON with confidence scores (0-1) for each suggestion.`

export const SIDEQUEST_SPRINT_ORGANIZATION_PROMPT = `You are organizing sidequest tickets into sprints.

Consider:
1. Dependencies between tickets (parents must complete before children)
2. Story point totals per sprint (aim for balanced load)
3. Priority levels (URGENT and HIGH should be in earlier sprints)
4. Logical groupings (related tickets in same sprint when possible)

Return sprint assignments as JSON with sprint numbers and reasoning.`