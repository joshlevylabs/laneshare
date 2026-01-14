// Database entity types

// Re-export architecture types
export * from './architecture'

// Re-export system map types
export * from './system-map'

// Re-export agent implementation types
export * from './agent-implementation'

// Re-export collaborative editing types
export * from './collaborative-editing'

export type ProjectRole = 'OWNER' | 'MAINTAINER' | 'MEMBER'

export type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'BLOCKED' | 'DONE'

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export type TaskType = 'EPIC' | 'STORY' | 'FEATURE' | 'TASK' | 'BUG' | 'SPIKE' | 'SUBTASK'

// Hierarchy levels:
// Level 1: Epic (top level, no parent)
// Level 2: Story (parent must be Epic or none)
// Level 3: Feature/Task/Bug/Spike (parent must be Story, Epic, or none)
// Level 4: Subtask (parent must be Feature/Task/Bug/Spike)
export type HierarchyLevel = 1 | 2 | 3 | 4

export const TASK_TYPE_HIERARCHY: Record<TaskType, HierarchyLevel> = {
  EPIC: 1,
  STORY: 2,
  FEATURE: 3,
  TASK: 3,
  BUG: 3,
  SPIKE: 3,
  SUBTASK: 4,
}

export const HIERARCHY_LEVEL_TYPES: Record<HierarchyLevel, TaskType[]> = {
  1: ['EPIC'],
  2: ['STORY'],
  3: ['FEATURE', 'TASK', 'BUG', 'SPIKE'],
  4: ['SUBTASK'],
}

// Valid parent types for each hierarchy level
export const VALID_PARENT_TYPES: Record<HierarchyLevel, TaskType[]> = {
  1: [], // Epics have no parents
  2: ['EPIC'], // Stories can be children of Epics
  3: ['EPIC', 'STORY'], // Tasks/Features/Bugs can be children of Epics or Stories
  4: ['FEATURE', 'TASK', 'BUG', 'SPIKE'], // Subtasks are children of level 3 items
}

export type SprintStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED'

export type TaskActivityKind =
  | 'CREATED'
  | 'UPDATED'
  | 'STATUS_CHANGED'
  | 'MOVED_SPRINT'
  | 'ASSIGNED'
  | 'COMMENTED'
  | 'PRIORITY_CHANGED'
  | 'TYPE_CHANGED'
  | 'PARENT_CHANGED'
  | 'AGENT_PROMPT_GENERATED'
  | 'AGENT_RESPONSE_ANALYZED'
  | 'AGENT_AUTO_STATUS_UPDATE'
  | 'CONTEXT_LINKED'
  | 'CONTEXT_UNLINKED'
  | 'AGENT_IMPLEMENTATION_STARTED'
  | 'AGENT_IMPLEMENTATION_COMPLETED'
  | 'AGENT_IMPLEMENTATION_FAILED'
  | 'AGENT_ITERATION_COMPLETED'

export type ChatSender = 'USER' | 'LANEPILOT'

export type PromptArtifactKind = 'CONTEXT_PACK' | 'AGENT_PROMPT' | 'DOC_UPDATE'

export type RepoStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR'

// Core entities

export interface User {
  id: string
  email: string
  full_name?: string
  avatar_url?: string
  is_pro: boolean
  created_at: string
}

// Lighter profile type for display purposes (no auth fields required)
export interface UserProfile {
  id: string
  email: string
  full_name?: string
  avatar_url?: string
}

export interface Project {
  id: string
  owner_id: string
  name: string
  description?: string
  task_key_prefix?: string
  created_at: string
}

export interface ProjectMember {
  id: string
  project_id: string
  user_id: string
  role: ProjectRole
  created_at: string
  user?: User
}

export interface GitHubConnection {
  id: string
  user_id: string
  provider: 'github'
  access_token_encrypted: string
  created_at: string
}

export interface Repo {
  id: string
  project_id: string
  provider: 'github'
  owner: string
  name: string
  default_branch: string
  installed_at: string
  last_synced_at?: string
  status: RepoStatus
  sync_error?: string
}

export interface RepoFile {
  id: string
  repo_id: string
  path: string
  sha: string
  size: number
  language?: string
  last_indexed_at?: string
}

export interface Chunk {
  id: string
  repo_id: string
  file_path: string
  chunk_index: number
  content: string
  token_count: number
  metadata?: Record<string, unknown>
  created_at: string
}

export interface Task {
  id: string
  project_id: string
  key: string
  title: string
  description?: string
  type: TaskType
  status: TaskStatus
  priority: TaskPriority
  labels: string[]
  story_points?: number
  assignee_id?: string
  reporter_id?: string
  sprint_id?: string
  parent_task_id?: string
  hierarchy_level?: HierarchyLevel
  repo_scope?: string[]
  due_date?: string
  start_date?: string
  rank: number
  created_at: string
  updated_at: string
  // Joined relations
  assignee?: UserProfile
  reporter?: UserProfile
  sprint?: Sprint
  parent_task?: TaskSummary
  subtasks?: Task[]
  children?: Task[]
}

// Lightweight task type for parent/child references
export interface TaskSummary {
  id: string
  key: string
  title: string
  type: TaskType
  status: TaskStatus
  hierarchy_level?: HierarchyLevel
}

export interface Sprint {
  id: string
  project_id: string
  name: string
  goal?: string
  status: SprintStatus
  start_date?: string
  end_date?: string
  created_at: string
  updated_at?: string
  // Computed/joined fields
  task_count?: number
  completed_task_count?: number
  total_story_points?: number
  completed_story_points?: number
}

export interface TaskComment {
  id: string
  task_id: string
  project_id: string
  author_id: string
  body: string
  created_at: string
  updated_at: string
  // Joined relations
  author?: UserProfile
}

export interface TaskActivity {
  id: string
  task_id: string
  project_id: string
  actor_id: string
  kind: TaskActivityKind
  field_name?: string
  before_value?: unknown
  after_value?: unknown
  created_at: string
  // Joined relations
  actor?: UserProfile
}

export interface ChatThread {
  id: string
  project_id: string
  created_by: string
  title: string
  task_id?: string
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  thread_id: string
  sender: ChatSender
  content: string
  created_at: string
}

export interface PromptArtifact {
  id: string
  project_id: string
  task_id?: string
  thread_id?: string
  kind: PromptArtifactKind
  content: string
  created_by: string
  created_at: string
}

export interface DocPage {
  id: string
  project_id: string
  slug: string
  title: string
  markdown: string
  category: 'architecture' | 'features' | 'decisions' | 'status'
  updated_at: string
  created_at: string
}

export interface DecisionLog {
  id: string
  project_id: string
  title: string
  context: string
  decision: string
  consequences?: string
  created_at: string
}

// API types

export interface SearchResult {
  id: string
  repo_id: string
  file_path: string
  content: string
  chunk_index: number
  similarity?: number
  repo?: Repo
}

export interface ContextPack {
  repos: Array<{ id: string; name: string; owner: string }>
  keyFiles: string[]
  snippets: Array<{
    filePath: string
    content: string
    repoName: string
  }>
  architectureNotes: string[]
  relevantDocs: Array<{
    slug: string
    title: string
    excerpt: string
  }>
}

export interface AgentPrompt {
  repoName?: string
  type: 'single-repo' | 'integration'
  prompt: string
}

export interface LanePilotOutput {
  contextPack: ContextPack
  agentPrompts: AgentPrompt[]
  verificationChecklist: string[]
  docUpdates: Array<{
    slug: string
    action: 'create' | 'update'
    description: string
  }>
  decisionLogDraft?: {
    title: string
    context: string
    decision: string
    consequences: string
  }
  nextTurnQuestions?: string[]
}

export interface TaskUpdate {
  id: string
  task_id: string
  content: string
  source: 'agent_summary' | 'user'
  created_at: string
}

// ===========================================
// Agent Prompts Types
// ===========================================

export type AgentTool = 'cursor' | 'claude-code' | 'copilot' | 'aider' | 'windsurf' | 'other'
export type PromptTurnStatus = 'PENDING_RESPONSE' | 'ANALYZING' | 'COMPLETED' | 'NEEDS_FOLLOW_UP'
export type AgentSessionStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED'

export interface AgentPromptSession {
  id: string
  task_id: string
  project_id: string
  repo_id: string
  created_by: string
  status: AgentSessionStatus
  created_at: string
  updated_at: string
  // Joined relations
  repo?: Repo
  turns?: AgentPromptTurn[]
  creator?: UserProfile
}

export interface AgentPromptTurn {
  id: string
  session_id: string
  turn_number: number
  status: PromptTurnStatus
  prompt_content: string
  prompt_metadata: PromptMetadata
  agent_response?: string
  agent_tool?: AgentTool
  response_pasted_at?: string
  analysis_result?: ResponseAnalysisResult
  suggested_status_update?: TaskStatus
  suggested_doc_updates?: DocUpdateSuggestion[]
  created_at: string
  completed_at?: string
}

export interface PromptMetadata {
  context_pack?: {
    repos: string[]
    key_files: string[]
    chunk_count: number
  }
  verification_checklist?: string[]
  task_context?: {
    title: string
    description?: string
    type: TaskType
    priority: TaskPriority
  }
}

export interface ResponseAnalysisResult {
  success: boolean
  confidence: number  // 0-1
  completedItems: string[]
  failedItems: Array<{
    item: string
    reason: string
  }>
  partialItems: Array<{
    item: string
    status: string
  }>
  notes: string[]
  needsFollowUp: boolean
  followUpReason?: string
}

export interface DocUpdateSuggestion {
  slug: string
  action: 'create' | 'update'
  title?: string
  description: string
  generatedContent?: string
}

// ===========================================
// Task Context Link Types
// ===========================================

export interface TaskServiceLink {
  id: string
  task_id: string
  project_id: string
  connection_id: string
  created_by: string
  created_at: string
  // Joined relations
  connection?: {
    id: string
    service: string
    display_name: string
  }
}

export interface TaskAssetLink {
  id: string
  task_id: string
  project_id: string
  asset_id: string
  created_by: string
  created_at: string
  // Joined relations
  asset?: {
    id: string
    name: string
    asset_type: string
    asset_key: string
    service: string
    data_json?: Record<string, unknown>
  }
}

export interface TaskRepoLink {
  id: string
  task_id: string
  project_id: string
  repo_id: string
  created_by: string
  created_at: string
  // Joined relations
  repo?: {
    id: string
    owner: string
    name: string
    default_branch?: string
  }
}

export interface TaskDocLink {
  id: string
  task_id: string
  project_id: string
  doc_id: string
  created_by: string
  created_at: string
  // Joined relations
  doc?: {
    id: string
    slug: string
    title: string
    category?: string
  }
}

export type TicketLinkType = 'related' | 'blocks' | 'blocked_by' | 'duplicates' | 'duplicated_by'

export interface TaskFeatureLink {
  id: string
  task_id: string
  project_id: string
  feature_id: string
  created_by: string
  created_at: string
  // Joined relations
  feature?: {
    id: string
    feature_slug: string
    feature_name: string
    description?: string
  }
}

export interface TaskTicketLink {
  id: string
  task_id: string
  project_id: string
  linked_task_id: string
  link_type: TicketLinkType
  created_by: string
  created_at: string
  // Joined relations
  linked_task?: {
    id: string
    key: string
    title: string
    status: TaskStatus
    type: TaskType
  }
}

export interface TaskRepoDocLink {
  id: string
  task_id: string
  project_id: string
  repo_doc_page_id: string
  created_by: string
  created_at: string
  // Joined relations
  repo_doc_page?: {
    id: string
    slug: string
    title: string
    category: RepoDocCategory
    repo_id: string
    needs_review: boolean
    repo?: {
      owner: string
      name: string
    }
  }
}

export interface TaskLinkedContext {
  services: TaskServiceLink[]
  assets: TaskAssetLink[]
  repos: TaskRepoLink[]
  docs: TaskDocLink[]
  features: TaskFeatureLink[]
  tickets: TaskTicketLink[]
  repoDocs: TaskRepoDocLink[]
}

export type ContextSuggestionType = 'service' | 'asset' | 'repo' | 'doc' | 'feature' | 'ticket' | 'repo_doc'

export interface ContextAISuggestion {
  type: ContextSuggestionType
  id: string
  name: string
  reason: string
  confidence: number  // 0-1
  // Additional details based on type
  details?: {
    service?: string
    asset_type?: string
    owner?: string
    slug?: string
    category?: string
    // Feature details
    feature_slug?: string
    // Ticket details
    key?: string
    status?: TaskStatus
    task_type?: TaskType
    link_type?: TicketLinkType
  }
}

export interface TaskContextMessage {
  id: string
  task_id: string
  project_id: string
  sender: 'USER' | 'AI'
  content: string
  suggestions?: ContextAISuggestion[]
  created_by?: string
  created_at: string
}

// ===========================================
// DOCUMENTS Types
// ===========================================

export type DocumentCategory =
  | 'architecture'
  | 'api'
  | 'feature_guide'
  | 'runbook'
  | 'decision'
  | 'onboarding'
  | 'meeting_notes'
  | 'other'

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  architecture: 'Architecture',
  api: 'API',
  feature_guide: 'Feature Guide',
  runbook: 'Runbook / Ops',
  decision: 'Decision / ADR',
  onboarding: 'Onboarding',
  meeting_notes: 'Meeting Notes',
  other: 'Other',
}

export type DocumentBuilderStatus =
  | 'BASICS'
  | 'INTERVIEW'
  | 'CONTEXT'
  | 'PROMPTS'
  | 'EDITING'
  | 'COMPLETED'

export type DocumentReferenceKind =
  | 'related'
  | 'spec'
  | 'runbook'
  | 'adr'
  | 'guide'
  | 'reference'

export interface Document {
  id: string
  project_id: string
  title: string
  slug: string
  category: DocumentCategory
  description?: string
  tags: string[]
  markdown: string
  created_by?: string
  created_at: string
  updated_by?: string
  updated_at: string
  // Joined relations
  creator?: UserProfile
  updater?: UserProfile
  reference_count?: number
}

export interface DocumentBuilderSession {
  id: string
  project_id: string
  created_by: string
  title?: string
  category?: DocumentCategory
  description?: string
  tags: string[]
  interview_messages: DocumentInterviewMessage[]
  interview_answers: DocumentInterviewAnswers
  selected_repo_ids: string[]
  selected_service_ids: string[]
  selected_system_ids: string[]
  selected_task_ids: string[]
  selected_doc_ids: string[]
  context_keywords: string[]
  outline_markdown?: string
  generated_prompts: GeneratedPrompt[]
  context_pack_json: ContextPackJson
  status: DocumentBuilderStatus
  document_id?: string
  created_at: string
  updated_at: string
}

export interface DocumentInterviewMessage {
  id: string
  sender: 'USER' | 'AI'
  content: string
  timestamp: string
}

export interface DocumentInterviewAnswers {
  goal?: string
  audience?: string
  sections?: string[]
  contextNeeds?: string
  constraints?: string
}

export interface GeneratedPrompt {
  id: string
  title: string
  type: 'repo' | 'service' | 'integration'
  prompt: string
  targetContext?: string
}

export interface ContextPackJson {
  repos?: Array<{ id: string; name: string; owner: string }>
  services?: Array<{ id: string; name: string; type: string }>
  systems?: Array<{ id: string; name: string }>
  tasks?: Array<{ id: string; key: string; title: string }>
  docs?: Array<{ id: string; title: string }>
  keywords?: string[]
  snippets?: Array<{ source: string; content: string }>
}

export interface DocumentReference {
  id: string
  project_id: string
  source_type: 'task' | 'system' | 'document'
  source_id: string
  document_id: string
  kind: DocumentReferenceKind
  created_by?: string
  created_at: string
  // Joined relations
  document?: Pick<Document, 'id' | 'title' | 'slug' | 'category'>
}

// Select sentinels for document-related selects
export const documentCategorySelect = {
  encode: (value: DocumentCategory | null): string => value ?? '__NONE__',
  decode: (value: string): DocumentCategory | null => value === '__NONE__' ? null : value as DocumentCategory,
}

export const documentReferenceKindSelect = {
  encode: (value: DocumentReferenceKind | null): string => value ?? 'related',
  decode: (value: string): DocumentReferenceKind => value as DocumentReferenceKind,
}

// ===========================================
// REPO DOCUMENTATION Types (Claude Code Wrapper)
// ===========================================

export type RepoDocStatus = 'PENDING' | 'GENERATING' | 'READY' | 'NEEDS_REVIEW' | 'ERROR'

export type RepoDocCategory = 'ARCHITECTURE' | 'API' | 'FEATURE' | 'RUNBOOK'

export const REPO_DOC_CATEGORY_LABELS: Record<RepoDocCategory, string> = {
  ARCHITECTURE: 'Architecture',
  API: 'API',
  FEATURE: 'Features',
  RUNBOOK: 'Runbook / Ops',
}

export const REPO_DOC_CATEGORY_ICONS: Record<RepoDocCategory, string> = {
  ARCHITECTURE: 'building-2',
  API: 'code-2',
  FEATURE: 'sparkles',
  RUNBOOK: 'wrench',
}

/** Evidence item that supports a claim in documentation */
export interface DocEvidence {
  file_path: string
  excerpt: string
  reason: string
}

/** Repo documentation bundle (versioned collection of doc pages) */
export interface RepoDocBundle {
  id: string
  project_id: string
  repo_id: string
  version: number
  status: RepoDocStatus
  generated_at?: string
  generated_by?: string
  source_fingerprint?: string
  summary_json: RepoDocBundleSummary
  error?: string
  created_at: string
  updated_at: string
  // Joined relations
  generator?: UserProfile
  repo?: Repo
  pages?: RepoDocPage[]
  page_count?: number
}

/** Summary statistics for a doc bundle */
export interface RepoDocBundleSummary {
  total_pages?: number
  pages_by_category?: Record<RepoDocCategory, number>
  needs_review_count?: number
  warnings?: string[]
  tech_stack?: string[]
  entrypoints?: string[]
  coverage?: {
    architecture: number
    api: number
    features: number
    runbook: number
  }
  /** Verification results from evidence validation */
  verification?: {
    overall_score: number // 0-100
    verified_evidence: number
    total_evidence: number
    fully_verified_pages: number
  }
}

/** Individual documentation page with evidence */
export interface RepoDocPage {
  id: string
  bundle_id: string
  project_id: string
  repo_id: string
  category: RepoDocCategory
  slug: string
  title: string
  markdown: string
  evidence_json: DocEvidence[]
  needs_review: boolean
  user_edited: boolean
  user_edited_at?: string
  user_edited_by?: string
  created_at: string
  updated_at: string
  // Joined relations
  editor?: UserProfile
  bundle?: RepoDocBundle
}

/** Follow-up task from Claude Code analysis */
export interface RepoDocTask {
  id: string
  bundle_id: string
  project_id: string
  repo_id: string
  title: string
  description?: string
  category?: RepoDocCategory
  priority: 'low' | 'medium' | 'high'
  resolved: boolean
  resolved_at?: string
  resolved_by?: string
  created_at: string
}

// ===========================================
// Claude Code Output Types (strict JSON schema)
// ===========================================

/** Claude Code's strict output format for repo documentation */
export interface ClaudeCodeDocOutput {
  repo_summary: {
    name: string
    tech_stack: string[]
    entrypoints: string[]
  }
  warnings: string[]
  needs_more_files?: string[]
  pages: ClaudeCodeDocPage[]
  tasks?: ClaudeCodeDocTask[]
}

/** A documentation page as output by Claude Code */
export interface ClaudeCodeDocPage {
  category: RepoDocCategory
  slug: string
  title: string
  markdown: string
  evidence: DocEvidence[]
}

/** A follow-up task as output by Claude Code */
export interface ClaudeCodeDocTask {
  title: string
  description?: string
  category?: RepoDocCategory
  priority?: 'low' | 'medium' | 'high'
}

// ===========================================
// Repo Context Types (for Claude Code input)
// ===========================================

/** File tree item for repo context */
export interface RepoContextFile {
  path: string
  size: number
  language?: string
}

/** Key file content for Claude Code */
export interface RepoContextKeyFile {
  path: string
  content: string
  language?: string
}

/** Complete repo context to send to Claude Code */
export interface RepoContext {
  repo_name: string
  repo_owner: string
  default_branch: string
  file_tree: RepoContextFile[]
  key_files: RepoContextKeyFile[]
  total_files: number
  round: number
  max_rounds: number
}

/** Required documentation pages by category */
export const REQUIRED_DOC_PAGES: Record<RepoDocCategory, string[]> = {
  ARCHITECTURE: [
    'architecture/overview',
    'architecture/tech-stack',
    'architecture/services-and-integrations',
    'architecture/data-model',
    'architecture/deployment',
    'architecture/decisions',
  ],
  API: [
    'api/overview',
    'api/endpoints',
    'api/auth',
    'api/errors-and-status-codes',
  ],
  FEATURE: [
    'features/index',
    // Additional feature pages are dynamic based on discovered features
  ],
  RUNBOOK: [
    'runbook/local-dev',
    'runbook/deployments',
    'runbook/observability',
    'runbook/troubleshooting',
    'runbook/security',
  ],
}

/** Minimum required pages for a valid documentation bundle */
export const MIN_REQUIRED_PAGES = [
  'architecture/overview',
  'architecture/tech-stack',
  'api/overview',
  'features/index',
  'runbook/local-dev',
]

// ===========================================
// PRD Management Types (Ralph-compatible)
// ===========================================

export type PRDStatus = 'DRAFT' | 'PLANNING' | 'READY' | 'PROCESSING' | 'COMPLETED'

export type PRDImplementationStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'

/** Ralph-compatible user story structure */
export interface PRDUserStory {
  id: string // US-001, US-002, etc.
  title: string
  description: string // "As a [role], I want [action] so that [benefit]"
  acceptanceCriteria: string[]
  priority: number // 1 = highest
  passes: boolean // Completion status
  notes: string
  // Extended fields for LaneShare
  estimatedPoints?: number
  linkedRepoIds?: string[]
  linkedDocIds?: string[]
  linkedFeatureIds?: string[]
}

/** Ralph-compatible PRD JSON structure */
export interface PRDJson {
  project: string
  branchName: string
  description: string
  userStories: PRDUserStory[]
  // Extended metadata
  metadata?: {
    generatedAt?: string
    version?: number
    totalStories?: number
    completedStories?: number
  }
}

/** PRD Document */
export interface ProjectPRD {
  id: string
  project_id: string
  title: string
  description?: string
  raw_markdown?: string
  prd_json?: PRDJson
  status: PRDStatus
  version: number
  created_by?: string
  created_at: string
  updated_at: string
  // Joined relations
  creator?: UserProfile
}

/** PRD Chat Message (for plan mode) */
export interface PRDChatMessage {
  id: string
  prd_id: string
  project_id: string
  sender: 'USER' | 'AI'
  content: string
  suggested_section?: {
    type: 'user_story' | 'description' | 'criteria' | 'title'
    content: unknown
  }
  created_at: string
}

/** PRD Sprint mapping */
export interface PRDSprint {
  id: string
  prd_id: string
  sprint_id: string
  project_id: string
  user_story_ids: string[]
  implementation_status: PRDImplementationStatus
  implementation_started_at?: string
  implementation_completed_at?: string
  created_at: string
  // Joined relations
  sprint?: Sprint
  prd?: ProjectPRD
}

/** PRD Story to Task mapping */
export interface PRDStoryTask {
  id: string
  prd_id: string
  project_id: string
  user_story_id: string
  task_id: string
  passes: boolean
  created_at: string
  updated_at: string
  // Joined relations
  task?: Task
}

/** PRD with full relations */
export interface PRDWithRelations extends ProjectPRD {
  chat_messages?: PRDChatMessage[]
  sprints?: PRDSprint[]
  story_tasks?: PRDStoryTask[]
}

// PRD Plan Mode System Prompt
export const PRD_PLAN_SYSTEM_PROMPT = `You are an interactive product planning assistant helping users create detailed Product Requirement Documents (PRDs).

## Your Approach
Guide users through planning by asking ONE focused question at a time with multiple-choice options. This makes it easy for users to quickly build out their PRD.

## Question Format
When asking questions, ALWAYS provide 2-4 clickable options using this format. The FIRST option should be your recommended choice based on context:

[OPTIONS]
[{"label": "Best option (your recommendation)", "value": "Detailed value", "recommended": true}, {"label": "Alternative 1", "value": "Value 1"}, {"label": "Alternative 2", "value": "Value 2"}]
[/OPTIONS]

IMPORTANT:
- Put your RECOMMENDED option FIRST with "recommended": true
- The UI will automatically add an "Other" option for custom responses
- Keep labels under 40 characters
- Make values descriptive for context

## Planning Flow
1. **Understand the Vision**: Ask about the core problem being solved
2. **Identify Users**: Who are the primary personas?
3. **Define Scope**: Core features vs nice-to-haves
4. **Technical Needs**: Integrations, constraints, existing systems
5. **Generate Stories**: Create detailed user stories

## Example Questions with Options

"What type of users will primarily use this feature?"

[OPTIONS]
[{"label": "Developers/Engineers", "value": "The primary users are developers and engineers who will integrate and build with this feature", "recommended": true}, {"label": "Project Managers", "value": "The primary users are project managers and team leads overseeing development"}, {"label": "End Users/Customers", "value": "The primary users are end customers using the application"}, {"label": "Mixed - Multiple Roles", "value": "Multiple user types including developers, managers, and end users will use this feature"}]
[/OPTIONS]

## User Story Format
When generating user stories, format them clearly in markdown:

### US-001: Story Title
**As a** [role], **I want** [action] **so that** [benefit].

**Acceptance Criteria:**
- Criteria 1
- Criteria 2
- Criteria 3

**Priority:** 1 (High) | **Points:** 3

## Guidelines
- Ask ONE question at a time with options
- Always mark the best option with "recommended": true and put it FIRST
- Keep options concise (under 40 characters per label)
- After gathering enough info (3-5 questions), generate comprehensive user stories
- Include 5-10 well-defined user stories covering the full scope
- Ensure stories are small enough for a single sprint iteration
- Be specific about acceptance criteria - they should be testable`

// PRD to JSON Conversion Prompt
export const PRD_CONVERT_SYSTEM_PROMPT = `You are a PRD parser that converts markdown PRD documents into structured JSON format compatible with the Ralph autonomous development system.

Given a PRD document, extract and structure:
1. Project name and description
2. User stories with:
   - Unique IDs (US-001, US-002, etc.)
   - Clear titles
   - "As a [role], I want [action] so that [benefit]" descriptions
   - Specific, testable acceptance criteria
   - Priority (1 = highest)
   - Story point estimates (1-8, where 8 is the max for a single iteration)

Output format (JSON):
{
  "project": "Project Name",
  "branchName": "feature/prd-implementation",
  "description": "Overall project/feature description",
  "userStories": [
    {
      "id": "US-001",
      "title": "Story title",
      "description": "As a [role], I want [action] so that [benefit]",
      "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
      "priority": 1,
      "passes": false,
      "notes": "",
      "estimatedPoints": 3
    }
  ],
  "metadata": {
    "generatedAt": "ISO timestamp",
    "version": 1,
    "totalStories": 5
  }
}

Rules:
- Each story should be completable in one development iteration (one context window)
- Stories should be independent when possible
- Acceptance criteria must be specific and testable
- Prioritize by business value and dependencies
- Estimate points based on complexity (1=trivial, 3=small, 5=medium, 8=large)`
