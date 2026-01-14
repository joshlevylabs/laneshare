/**
 * Collaborative Multi-Agent Editing Types
 *
 * Enables multiple Claude agents to work on the same files simultaneously
 * with an Integrator Agent that semantically merges changes.
 */

// ============================================================================
// Virtual Branches
// ============================================================================

export type VirtualBranchStatus = 'ACTIVE' | 'MERGING' | 'MERGED' | 'CONFLICT' | 'STALE'

export interface VirtualBranch {
  id: string
  projectId: string
  codespaceId?: string
  agentSessionId?: string
  workspaceSessionId?: string
  name: string
  baseSha: string
  currentSha?: string
  status: VirtualBranchStatus
  createdBy?: string
  createdAt: string
  updatedAt: string
}

// ============================================================================
// Edit Stream
// ============================================================================

export type EditOperation = 'create' | 'edit' | 'delete' | 'rename'

export interface DiffHunk {
  startLine: number
  oldLines: string[]
  newLines: string[]
}

export interface EditStreamEntry {
  id: string
  virtualBranchId: string
  projectId: string

  // Edit details
  operation: EditOperation
  filePath: string
  oldFilePath?: string // For renames

  // Content
  oldContent?: string
  newContent?: string
  diffHunks?: DiffHunk[]

  // Metadata
  linesAdded: number
  linesRemoved: number
  agentReasoning?: string
  relatedTaskId?: string

  // Ordering
  sequenceNum: number
  createdAt: string

  // For conflict detection
  fileHashBefore?: string
  fileHashAfter?: string
}

export interface CreateEditInput {
  virtualBranchId: string
  operation: EditOperation
  filePath: string
  oldFilePath?: string
  oldContent?: string
  newContent?: string
  agentReasoning?: string
  relatedTaskId?: string
}

// ============================================================================
// Canonical State
// ============================================================================

export interface CanonicalState {
  id: string
  projectId: string
  codespaceId?: string
  currentSha: string
  lastMergeAt?: string
  totalMerges: number
  totalConflictsResolved: number
  createdAt: string
  updatedAt: string
}

// ============================================================================
// Merge Events
// ============================================================================

export type MergeStrategy =
  | 'AUTO' // No conflicts, simple merge
  | 'SEMANTIC' // Integrator agent merged semantically
  | 'REFACTOR' // Required refactoring to merge
  | 'PARTIAL' // Some files merged, some need review
  | 'FAILED' // Could not merge, needs human intervention

export interface FileMergeResult {
  path: string
  strategy: MergeStrategy
  hadConflict: boolean
  linesChanged?: number
}

export interface MergeEvent {
  id: string
  projectId: string
  canonicalStateId?: string

  // Branches involved
  sourceBranches: string[]

  // Files affected
  filesMerged: FileMergeResult[]

  // Merge details
  mergeStrategy: MergeStrategy
  integratorReasoning?: string
  integratorPrompt?: string
  integratorResponse?: string

  // Results
  resultSha?: string
  conflictsDetected: number
  conflictsResolved: number

  // Validation
  testsRun: boolean
  testsPassed?: boolean
  testOutput?: string

  // Timing
  startedAt: string
  completedAt?: string
  durationMs?: number

  createdAt: string
}

// ============================================================================
// Conflicts
// ============================================================================

export type ConflictType =
  | 'SAME_LINE' // Both edited same line
  | 'SAME_FUNCTION' // Both edited same function
  | 'SAME_BLOCK' // Both edited overlapping regions
  | 'LOGICAL' // Semantically incompatible changes
  | 'DELETE_MODIFY' // One deleted, other modified
  | 'RENAME_CONFLICT' // Conflicting renames

export type ResolutionStrategy =
  | 'TAKE_A'
  | 'TAKE_B'
  | 'MERGE_BOTH'
  | 'REFACTOR'
  | 'MANUAL'

export interface EditConflict {
  id: string
  mergeEventId?: string
  projectId: string

  filePath: string
  conflictType: ConflictType

  editAId?: string
  editBId?: string

  versionA?: string
  versionB?: string
  mergedVersion?: string

  resolutionStrategy?: ResolutionStrategy
  resolutionReasoning?: string
  resolvedAt?: string
  resolvedBy?: string

  createdAt: string
}

// ============================================================================
// Collaboration Sessions
// ============================================================================

export type CollaborationStatus =
  | 'ACTIVE' // Agents actively collaborating
  | 'PAUSED' // Paused for merge
  | 'SYNCING' // Syncing state after merge
  | 'COMPLETED' // All work merged and done
  | 'ERROR' // Error state

export interface CollaborationSession {
  id: string
  projectId: string
  codespaceId?: string

  virtualBranchIds: string[]

  status: CollaborationStatus

  // Integrator config
  mergeFrequencyMs: number
  autoMergeEnabled: boolean
  requireTests: boolean

  // Stats
  totalEdits: number
  totalMerges: number
  totalConflicts: number

  createdBy?: string
  createdAt: string
  updatedAt: string
}

// ============================================================================
// File Locks
// ============================================================================

export type RegionType = 'file' | 'function' | 'class' | 'block' | 'lines'

export interface FileRegionLock {
  id: string
  projectId: string
  virtualBranchId: string

  filePath: string
  regionType?: RegionType
  regionIdentifier?: string

  acquiredAt: string
  expiresAt?: string
}

// ============================================================================
// Integrator Agent Types
// ============================================================================

export interface ConflictingEdit {
  branchId: string
  branchName: string
  agentName?: string
  taskTitle?: string
  edit: EditStreamEntry
}

export interface FileConflictContext {
  filePath: string
  originalContent: string
  edits: ConflictingEdit[]
  language?: string // e.g., 'typescript', 'python'
}

export interface IntegratorInput {
  projectContext: {
    name: string
    description?: string
    techStack?: string[]
  }
  conflicts: FileConflictContext[]
  preferences?: {
    preferRefactoring: boolean
    runTests: boolean
    explainDecisions: boolean
  }
}

export interface IntegratorOutput {
  success: boolean
  mergedFiles: {
    path: string
    content: string
    strategy: MergeStrategy
    reasoning: string
  }[]
  conflicts: {
    path: string
    type: ConflictType
    resolution: ResolutionStrategy
    reasoning: string
  }[]
  suggestedTests?: string[]
  overallReasoning: string
}

// ============================================================================
// Real-time Collaboration Events (SSE)
// ============================================================================

export type CollaborationEventType =
  | 'edit_received' // New edit from an agent
  | 'conflict_detected' // Potential conflict found
  | 'merge_started' // Integrator starting merge
  | 'merge_completed' // Merge finished
  | 'sync_required' // Agents need to sync
  | 'agent_joined' // New agent joined collaboration
  | 'agent_left' // Agent left collaboration
  | 'lock_acquired' // File/region locked
  | 'lock_released' // Lock released

export interface CollaborationEvent {
  type: CollaborationEventType
  timestamp: string
  sessionId: string
  data: {
    // For edit_received
    edit?: EditStreamEntry
    branchId?: string

    // For conflict_detected
    filePath?: string
    conflictingBranches?: string[]

    // For merge events
    mergeEventId?: string
    filesAffected?: string[]

    // For agent events
    agentId?: string
    agentName?: string

    // For lock events
    lockId?: string
    lockedPath?: string
  }
}
