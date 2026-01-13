// Database entity types

// Re-export architecture types
export * from './architecture'

// Re-export system map types
export * from './system-map'

export type ProjectRole = 'OWNER' | 'MAINTAINER' | 'MEMBER'

export type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'BLOCKED' | 'DONE'

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export type TaskType = 'EPIC' | 'STORY' | 'TASK' | 'BUG' | 'SPIKE'

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
  | 'AGENT_PROMPT_GENERATED'
  | 'AGENT_RESPONSE_ANALYZED'
  | 'AGENT_AUTO_STATUS_UPDATE'
  | 'CONTEXT_LINKED'
  | 'CONTEXT_UNLINKED'

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
  subtasks?: Task[]
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

export interface TaskLinkedContext {
  services: TaskServiceLink[]
  assets: TaskAssetLink[]
  repos: TaskRepoLink[]
  docs: TaskDocLink[]
  features: TaskFeatureLink[]
  tickets: TaskTicketLink[]
}

export type ContextSuggestionType = 'service' | 'asset' | 'repo' | 'doc' | 'feature' | 'ticket'

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
