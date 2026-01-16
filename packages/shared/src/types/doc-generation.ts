/**
 * Parallel Document Generation Types
 *
 * Defines types for the 7-terminal parallel document generation system.
 * Each terminal generates one specific document using Claude Code CLI.
 */

/**
 * The 7 document types generated in parallel
 */
export const DOC_TYPES = {
  AGENTS_SUMMARY: {
    id: 'agents_summary',
    filename: 'Agents_Summary.md',
    title: 'Agents Summary',
    category: 'ARCHITECTURE' as const,
    description: 'Structure and agents.md document overview',
    order: 1,
    isPrerequisite: true, // Must complete before others start
  },
  ARCHITECTURE: {
    id: 'architecture',
    filename: 'Architecture.md',
    title: 'Architecture',
    category: 'ARCHITECTURE' as const,
    description: 'System architecture and technologies',
    order: 2,
    isPrerequisite: false,
  },
  FEATURES: {
    id: 'features',
    filename: 'Features.md',
    title: 'Features',
    category: 'FEATURE' as const,
    description: 'All features in the repository',
    order: 3,
    isPrerequisite: false,
  },
  APIS: {
    id: 'apis',
    filename: 'APIs.md',
    title: 'APIs',
    category: 'API' as const,
    description: 'API documentation and integrations',
    order: 4,
    isPrerequisite: false,
  },
  RUNBOOK: {
    id: 'runbook',
    filename: 'Runbook.md',
    title: 'Runbook',
    category: 'RUNBOOK' as const,
    description: 'Operational guides and procedures',
    order: 5,
    isPrerequisite: false,
  },
  ADRS: {
    id: 'adrs',
    filename: 'ADRs.md',
    title: 'Architecture Decision Records',
    category: 'ARCHITECTURE' as const,
    description: 'Documented architecture decisions',
    order: 6,
    isPrerequisite: false,
  },
  SUMMARY: {
    id: 'summary',
    filename: 'Summary.md',
    title: 'Summary',
    category: 'ARCHITECTURE' as const,
    description: 'Overall repository summary',
    order: 7,
    isPrerequisite: false,
  },
} as const

export type DocType = keyof typeof DOC_TYPES

/**
 * Status of an individual document generation job
 */
export type DocJobStatus = 'pending' | 'running' | 'completed' | 'failed'

/**
 * Individual document generation job
 */
export interface DocGenerationJob {
  docType: DocType
  status: DocJobStatus
  terminalId?: string
  promptQueueId?: string
  startedAt?: string
  completedAt?: string
  result?: string // Markdown content
  error?: string
}

/**
 * Phase of the overall generation session
 */
export type DocGenerationPhase =
  | 'context'        // Gathering repository context
  | 'agents_summary' // Generating Agents_Summary.md (sequential)
  | 'parallel'       // Generating 6 remaining docs in parallel
  | 'assembly'       // Assembling and storing results
  | 'complete'       // All done
  | 'error'          // Error occurred

/**
 * Complete generation session tracking all 7 jobs
 */
export interface DocGenerationSession {
  bundleId: string
  projectId: string
  repoId: string
  connectionId?: string // Bridge connection ID
  sessionId?: string    // Workspace session ID
  jobs: Record<DocType, DocGenerationJob>
  agentsSummaryContent?: string // Cached for use by other jobs
  phase: DocGenerationPhase
  startedAt?: string
  completedAt?: string
  error?: string
}

/**
 * Context provided to document prompts
 */
export interface DocPromptContext {
  repoName: string
  repoOwner: string
  fileTree: string
  agentsMdFiles: Array<{
    path: string
    content: string
  }>
  keyFiles: Array<{
    path: string
    content: string
  }>
  agentsSummary?: string // Output from first document (for docs 2-7)
}

/**
 * Progress update for the UI
 */
export interface DocGenProgressUpdate {
  phase: DocGenerationPhase
  jobs: Record<DocType, {
    status: DocJobStatus
    startedAt?: string
    completedAt?: string
    error?: string
  }>
  currentDocType?: DocType
  pagesGenerated: number
  totalPages: number // Always 7
  estimatedSecondsRemaining?: number
  elapsedSeconds?: number
}

/**
 * Helper to get ordered list of doc types for display
 */
export function getDocTypesInOrder(): DocType[] {
  return Object.keys(DOC_TYPES)
    .sort((a, b) => DOC_TYPES[a as DocType].order - DOC_TYPES[b as DocType].order) as DocType[]
}

/**
 * Helper to initialize a fresh session with all jobs pending
 */
export function initializeDocGenSession(
  bundleId: string,
  projectId: string,
  repoId: string,
  connectionId?: string,
  sessionId?: string
): DocGenerationSession {
  const jobs = {} as Record<DocType, DocGenerationJob>

  for (const docType of Object.keys(DOC_TYPES) as DocType[]) {
    jobs[docType] = {
      docType,
      status: 'pending',
    }
  }

  return {
    bundleId,
    projectId,
    repoId,
    connectionId,
    sessionId,
    jobs,
    phase: 'context',
    startedAt: new Date().toISOString(),
  }
}

/**
 * Check if all parallel jobs are complete (success or failure)
 */
export function areParallelJobsComplete(session: DocGenerationSession): boolean {
  const parallelDocTypes: DocType[] = ['ARCHITECTURE', 'FEATURES', 'APIS', 'RUNBOOK', 'ADRS', 'SUMMARY']

  return parallelDocTypes.every(docType => {
    const status = session.jobs[docType].status
    return status === 'completed' || status === 'failed'
  })
}

/**
 * Count completed jobs
 */
export function countCompletedJobs(session: DocGenerationSession): number {
  return Object.values(session.jobs).filter(job => job.status === 'completed').length
}

/**
 * Count failed jobs
 */
export function countFailedJobs(session: DocGenerationSession): number {
  return Object.values(session.jobs).filter(job => job.status === 'failed').length
}
