/**
 * Agent Implementation Types
 *
 * Types for the AI-powered task implementation feature.
 * Supports autonomous code editing via GitHub API with iterative verification.
 */

import type { Task, Repo, UserProfile } from './index'

// ===========================================
// Enums
// ===========================================

export type AgentExecutionStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING_FEEDBACK'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'STUCK'

export type FileOperationType = 'CREATE' | 'UPDATE' | 'DELETE' | 'RENAME'

export type AgentLoopStage =
  | 'INITIALIZING'
  | 'ANALYZING_TASK'
  | 'PLANNING'
  | 'IMPLEMENTING'
  | 'VERIFYING'
  | 'COMMITTING'
  | 'CREATING_PR'
  | 'AWAITING_FEEDBACK'
  | 'ITERATING'
  | 'FINALIZING'

export type AgentFeedbackType = 'guidance' | 'approval' | 'rejection' | 'abort'

// ===========================================
// Progress Tracking
// ===========================================

/** Progress JSON structure stored in database */
export interface AgentProgressInfo {
  stage: AgentLoopStage
  message: string
  filesModified: number
  currentFile?: string
  criteriaChecked: number
  criteriaPassed: number
  criteriaTotal: number
  lastUpdated: string
}

// ===========================================
// Verification Types
// ===========================================

/** Verification result for a single acceptance criterion */
export interface CriterionVerification {
  criterion: string
  passed: boolean
  reason: string
  evidence?: string[]
}

/** Full verification results for an iteration */
export interface VerificationResults {
  passed: boolean
  score: number // 0-1
  items: CriterionVerification[]
  summary: string
}

// ===========================================
// File Change Types
// ===========================================

/** Summary of a file change for display */
export interface FileChangeSummary {
  file: string
  operation: FileOperationType
  summary: string
  linesAdded?: number
  linesRemoved?: number
}

// ===========================================
// Database Entity Types
// ===========================================

/** Agent Execution Session - tracks an implementation attempt for a task */
export interface AgentExecutionSession {
  id: string
  task_id: string
  project_id: string
  repo_id: string
  created_by: string

  // Status tracking
  status: AgentExecutionStatus
  stage: AgentLoopStage

  // Branch info
  source_branch: string
  implementation_branch: string

  // Progress tracking
  current_iteration: number
  max_iterations: number
  progress_json: AgentProgressInfo

  // Results
  total_files_changed: number
  pr_number?: number
  pr_url?: string
  final_commit_sha?: string

  // Error tracking
  error_message?: string
  stuck_reason?: string

  // Timing
  started_at?: string
  completed_at?: string
  created_at: string
  updated_at: string

  // Joined relations
  task?: Task
  repo?: Repo
  creator?: UserProfile
  iterations?: AgentIteration[]
}

/** Agent Iteration - each loop iteration within a session */
export interface AgentIteration {
  id: string
  session_id: string
  iteration_number: number

  // What the agent did
  prompt_sent?: string
  response_received?: string

  // Verification
  verification_results?: VerificationResults
  criteria_passed: number
  criteria_total: number

  // Outcome
  changes_made: FileChangeSummary[]
  commit_sha?: string
  commit_message?: string

  // Error/block info
  blocked_reason?: string
  needs_human_input: boolean
  human_feedback?: string

  started_at: string
  completed_at?: string
}

/** Agent File Operation - tracks file changes for rollback */
export interface AgentFileOperation {
  id: string
  session_id: string
  iteration_id?: string

  // File info
  file_path: string
  operation: FileOperationType

  // Content for rollback
  before_sha?: string
  after_sha?: string
  before_content?: string

  // Metadata
  language?: string
  lines_added: number
  lines_removed: number

  created_at: string
}

/** Agent Feedback - human input during stuck states */
export interface AgentFeedback {
  id: string
  session_id: string
  iteration_id?: string

  feedback_type: AgentFeedbackType
  content: string

  created_by: string
  created_at: string

  // Joined relations
  creator?: UserProfile
}

// ===========================================
// API Request/Response Types
// ===========================================

/** Request to start an implementation session */
export interface StartImplementationRequest {
  repoId: string
  sourceBranch?: string // Defaults to default_branch
  maxIterations?: number // Defaults to 10
}

/** Response when starting an implementation session */
export interface StartImplementationResponse {
  sessionId: string
  implementationBranch: string
  status: AgentExecutionStatus
  message: string
}

/** Response for implementation status */
export interface ImplementationStatusResponse {
  session: AgentExecutionSession
  currentIteration?: AgentIteration
  fileOperations: AgentFileOperation[]
  feedback: AgentFeedback[]
}

/** Request to submit feedback */
export interface SubmitFeedbackRequest {
  feedbackType: AgentFeedbackType
  content: string
  iterationId?: string
}

/** Request to rollback changes */
export interface RollbackRequest {
  toIterationNumber?: number // Rollback to specific iteration, or all if not specified
  reason: string
}

// ===========================================
// Implementation Agent Types
// ===========================================

/** Context for building implementation prompts */
export interface ImplementationContext {
  task: Task
  repo: Repo
  acceptanceCriteria: string[]
  repoStructure: string[] // File paths
  keyFiles: Array<{ path: string; content: string }>
  previousIterations: AgentIteration[]
  humanFeedback?: string
}

/** Result from Claude's implementation response */
export interface ImplementationResult {
  analysis: {
    understanding: string
    approach: string
    risks: string[]
  }
  fileChanges: Array<{
    path: string
    operation: 'CREATE' | 'UPDATE' | 'DELETE'
    content?: string
    reason: string
  }>
  commitMessage: string
  verification: {
    selfCheck: CriterionVerification[]
    allPassed: boolean
    confidence: number
  }
  needsHumanInput: boolean
  humanInputReason?: string
  nextSteps: string[]
}

// ===========================================
// Constants
// ===========================================

/** Status display configuration */
export const AGENT_STATUS_CONFIG: Record<
  AgentExecutionStatus,
  { label: string; color: string; bgColor: string }
> = {
  PENDING: { label: 'Starting', color: 'text-blue-600', bgColor: 'bg-blue-100' },
  RUNNING: { label: 'Running', color: 'text-blue-600', bgColor: 'bg-blue-100' },
  WAITING_FEEDBACK: { label: 'Needs Input', color: 'text-yellow-600', bgColor: 'bg-yellow-100' },
  SUCCEEDED: { label: 'Completed', color: 'text-green-600', bgColor: 'bg-green-100' },
  FAILED: { label: 'Failed', color: 'text-red-600', bgColor: 'bg-red-100' },
  CANCELLED: { label: 'Cancelled', color: 'text-gray-600', bgColor: 'bg-gray-100' },
  STUCK: { label: 'Stuck', color: 'text-orange-600', bgColor: 'bg-orange-100' },
}

/** Stage display labels */
export const AGENT_STAGE_LABELS: Record<AgentLoopStage, string> = {
  INITIALIZING: 'Initializing',
  ANALYZING_TASK: 'Analyzing Task',
  PLANNING: 'Planning',
  IMPLEMENTING: 'Implementing',
  VERIFYING: 'Verifying',
  COMMITTING: 'Committing',
  CREATING_PR: 'Creating PR',
  AWAITING_FEEDBACK: 'Awaiting Feedback',
  ITERATING: 'Iterating',
  FINALIZING: 'Finalizing',
}

/** Default configuration values */
export const AGENT_DEFAULTS = {
  maxIterations: 10,
  pauseBetweenIterations: 2000, // ms
  feedbackTimeout: 3600000, // 1 hour
}
