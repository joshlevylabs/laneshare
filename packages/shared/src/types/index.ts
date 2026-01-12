// Database entity types

export type ProjectRole = 'OWNER' | 'MAINTAINER' | 'MEMBER'

export type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE'

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

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

export interface Project {
  id: string
  owner_id: string
  name: string
  description?: string
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
  title: string
  description?: string
  status: TaskStatus
  assignee_id?: string
  repo_scope?: string[]
  priority: TaskPriority
  sprint_id?: string
  created_at: string
  updated_at: string
  assignee?: User
}

export interface Sprint {
  id: string
  project_id: string
  name: string
  start_date?: string
  end_date?: string
  created_at: string
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
