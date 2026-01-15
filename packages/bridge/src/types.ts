/**
 * Bridge Agent Types
 *
 * Defines the communication protocol between the bridge and LaneShare server
 */

export interface BridgeConfig {
  /** LaneShare API endpoint */
  apiUrl: string
  /** Project ID this bridge is associated with */
  projectId: string
  /** Session ID for this workspace session */
  sessionId: string
  /** API key for authentication */
  apiKey: string
  /** Working directory (usually the repo root) */
  workDir: string
  /** Enable debug logging */
  debug?: boolean
}

export type MessageType =
  | 'connected'
  | 'disconnected'
  | 'prompt'
  | 'output'
  | 'file_activity'
  | 'git_status'
  | 'error'
  | 'ping'
  | 'pong'

export interface BridgeMessage {
  type: MessageType
  timestamp: string
  payload: unknown
}

export interface ConnectedPayload {
  bridgeVersion: string
  workDir: string
  gitBranch?: string
  gitRemote?: string
}

export interface PromptPayload {
  prompt: string
  sessionMessageId: string
}

export interface OutputPayload {
  sessionMessageId: string
  content: string
  isComplete: boolean
  toolUse?: {
    tool: string
    input: Record<string, unknown>
  }
}

export interface FileActivityPayload {
  type: 'read' | 'write' | 'create' | 'delete' | 'rename'
  path: string
  timestamp: string
  linesRead?: number
  linesAdded?: number
  linesRemoved?: number
  preview?: string
}

export interface GitStatusPayload {
  branch: string
  ahead: number
  behind: number
  hasUncommittedChanges: boolean
  hasUnpushedChanges: boolean
  modifiedFiles: string[]
  stagedFiles: string[]
  untrackedFiles: string[]
}

export interface ErrorPayload {
  code: string
  message: string
  details?: unknown
}
