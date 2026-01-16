/**
 * Types for Claude Code's headless JSON output format
 * Used when running: claude -p "prompt" --output-format stream-json
 */

// Message types from Claude Code's stream-json output
export type ClaudeMessageType = 'system' | 'assistant' | 'user' | 'result'

// Content block types
export interface TextContent {
  type: 'text'
  text: string
}

export interface ToolUseContent {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultContent {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type ContentBlock = TextContent | ToolUseContent | ToolResultContent

// System init message (first message in stream)
export interface SystemInitMessage {
  type: 'system'
  subtype: 'init'
  session_id: string
  cwd: string
  model: string
  tools: string[]
  mcp_servers?: string[]
  claude_code_version: string
}

// Assistant message
export interface AssistantMessage {
  type: 'assistant'
  message: {
    id: string
    role: 'assistant'
    content: ContentBlock[]
    model?: string
    stop_reason?: string
  }
}

// User message (typically tool results)
export interface UserMessage {
  type: 'user'
  message: {
    role: 'user'
    content: ContentBlock[]
  }
}

// Result message (final message with stats)
export interface ResultMessage {
  type: 'result'
  subtype: 'result'
  is_error: boolean
  duration_ms: number
  duration_api_ms: number
  num_turns: number
  result: string
  total_cost_usd: number
  session_id: string
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}

// Union type for all message types
export type ClaudeStreamMessage =
  | SystemInitMessage
  | AssistantMessage
  | UserMessage
  | ResultMessage

// Parsed/rendered message for the chat UI
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  toolUse?: {
    id: string
    name: string
    input: Record<string, unknown>
  }
  toolResult?: {
    toolUseId: string
    content: string
    isError?: boolean
  }
  isStreaming?: boolean
}

// Tool name display mapping
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  Read: 'Reading file',
  Write: 'Writing file',
  Edit: 'Editing file',
  Bash: 'Running command',
  Glob: 'Searching files',
  Grep: 'Searching content',
  Task: 'Running task',
  WebFetch: 'Fetching URL',
  WebSearch: 'Searching web',
  TodoWrite: 'Updating todos',
  AskUserQuestion: 'Asking question',
  NotebookEdit: 'Editing notebook',
}

// Helper to get tool display name
export function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] || toolName
}

// Helper to parse NDJSON line
export function parseStreamLine(line: string): ClaudeStreamMessage | null {
  if (!line.trim()) return null
  try {
    return JSON.parse(line) as ClaudeStreamMessage
  } catch {
    console.warn('Failed to parse Claude stream line:', line)
    return null
  }
}
