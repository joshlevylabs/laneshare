'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Send,
  Loader2,
  ChevronDown,
  ChevronRight,
  FileText,
  Terminal,
  Search,
  Edit3,
  Globe,
  CheckCircle,
  XCircle,
  Wand2,
  Copy,
  Check,
  FolderOpen,
  Link,
  Sparkles,
  X,
  PieChart,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ChatMessage } from './claude-chat-types'
import { getToolDisplayName } from './claude-chat-types'

interface ClaudeChatUIProps {
  messages: ChatMessage[]
  isLoading: boolean
  sessionId?: string
  modelName?: string
  selectedFile?: string | null
  contextUsagePercent?: number
  onSendMessage: (message: string) => void
  onCancel?: () => void
  onClearFile?: () => void
}

// Get icon for tool type
function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'Read':
      return <FileText className="h-3.5 w-3.5" />
    case 'Write':
    case 'Edit':
      return <Edit3 className="h-3.5 w-3.5" />
    case 'Bash':
      return <Terminal className="h-3.5 w-3.5" />
    case 'Glob':
      return <FolderOpen className="h-3.5 w-3.5" />
    case 'Grep':
      return <Search className="h-3.5 w-3.5" />
    case 'WebFetch':
    case 'WebSearch':
      return <Globe className="h-3.5 w-3.5" />
    default:
      return <Wand2 className="h-3.5 w-3.5" />
  }
}

// Tool use card component
function ToolUseCard({
  toolName,
  input,
  result,
  isError,
}: {
  toolName: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const content = result || JSON.stringify(input, null, 2)
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Format input for display
  const getInputSummary = (): string | null => {
    if (toolName === 'Read' && input.file_path) {
      const filePath = String(input.file_path)
      return filePath.split('/').pop() || filePath
    }
    if (toolName === 'Write' && input.file_path) {
      const filePath = String(input.file_path)
      return filePath.split('/').pop() || filePath
    }
    if (toolName === 'Edit' && input.file_path) {
      const filePath = String(input.file_path)
      return filePath.split('/').pop() || filePath
    }
    if (toolName === 'Bash' && input.command) {
      const cmd = String(input.command)
      return cmd.length > 50 ? cmd.slice(0, 50) + '...' : cmd
    }
    if (toolName === 'Glob' && input.pattern) {
      return String(input.pattern)
    }
    if (toolName === 'Grep' && input.pattern) {
      return String(input.pattern)
    }
    return null
  }

  const summary = getInputSummary()

  return (
    <div className="my-2 rounded-lg border border-[#3c3c3c] bg-[#252526] overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-[#2d2d2d] transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
        )}
        <span className="text-amber-500 flex-shrink-0">{getToolIcon(toolName)}</span>
        <span className="text-sm text-gray-300">{getToolDisplayName(toolName)}</span>
        {summary && (
          <code className="text-xs text-gray-500 truncate ml-1 flex-1 text-left">{summary}</code>
        )}
        {result && (
          <span className="flex-shrink-0 ml-auto">
            {isError ? (
              <XCircle className="h-4 w-4 text-red-400" />
            ) : (
              <CheckCircle className="h-4 w-4 text-green-400" />
            )}
          </span>
        )}
      </button>
      {isExpanded && (
        <div className="border-t border-[#3c3c3c]">
          <div className="px-3 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500 font-medium">Input</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-gray-500 hover:text-gray-300"
                onClick={handleCopy}
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
            <pre className="text-xs text-gray-400 overflow-x-auto max-h-32 overflow-y-auto">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {result && (
            <div className="px-3 py-2 border-t border-[#3c3c3c] bg-[#1e1e1e]">
              <span className="text-xs text-gray-500 font-medium">Output</span>
              <pre
                className={cn(
                  'text-xs overflow-x-auto max-h-48 overflow-y-auto mt-1',
                  isError ? 'text-red-400' : 'text-gray-400'
                )}
              >
                {result.length > 2000 ? result.slice(0, 2000) + '\n...(truncated)' : result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Thinking indicator with fun words like Claude Code does
const THINKING_WORDS = [
  'Thinking',
  'Pondering',
  'Cogitating',
  'Ruminating',
  'Deliberating',
  'Contemplating',
  'Musing',
  'Reflecting',
  'Considering',
  'Analyzing',
  'Processing',
  'Computing',
  'Synthesizing',
  'Evaluating',
  'Reasoning',
]

function ThinkingIndicator() {
  const [wordIndex, setWordIndex] = useState(0)
  const [dots, setDots] = useState('')

  useEffect(() => {
    // Change word every 2 seconds
    const wordInterval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % THINKING_WORDS.length)
    }, 2000)

    // Animate dots
    const dotInterval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'))
    }, 400)

    return () => {
      clearInterval(wordInterval)
      clearInterval(dotInterval)
    }
  }, [])

  return (
    <div className="flex justify-start mb-4">
      <div className="bg-[#2d2d2d] text-gray-400 border border-[#3c3c3c] rounded-2xl px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
          <span className="text-sm italic">
            {THINKING_WORDS[wordIndex]}{dots}
          </span>
        </div>
      </div>
    </div>
  )
}

// Message component
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="flex justify-center my-3">
        <span className="text-xs text-gray-500 bg-[#252526] px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    )
  }

  if (message.toolUse) {
    return (
      <ToolUseCard
        toolName={message.toolUse.name}
        input={message.toolUse.input}
        result={message.toolResult?.content}
        isError={message.toolResult?.isError}
      />
    )
  }

  return (
    <div className={cn('flex mb-4', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5',
          isUser
            ? 'bg-amber-600 text-white'
            : 'bg-[#2d2d2d] text-gray-200 border border-[#3c3c3c]'
        )}
      >
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
        {message.isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse" />
        )}
      </div>
    </div>
  )
}

export function ClaudeChatUI({
  messages,
  isLoading,
  sessionId,
  modelName,
  selectedFile,
  contextUsagePercent = 0,
  onSendMessage,
  onCancel,
  onClearFile,
}: ClaudeChatUIProps) {
  const [input, setInput] = useState('')
  const [autoEdit, setAutoEdit] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    onSendMessage(input.trim())
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#3c3c3c] bg-[#252526]">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-amber-500" />
          <span className="text-sm text-gray-200 font-medium">Claude Code</span>
          {modelName && (
            <Badge variant="outline" className="text-[10px] text-gray-400 border-gray-600">
              {modelName}
            </Badge>
          )}
        </div>
        {sessionId && (
          <span className="text-xs text-gray-500 font-mono">
            {sessionId.slice(0, 8)}
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Wand2 className="h-12 w-12 text-amber-500/30 mb-4" />
            <h3 className="text-lg font-medium text-gray-300 mb-2">Start a conversation</h3>
            <p className="text-sm text-gray-500 max-w-sm">
              Ask Claude to help you with code, answer questions, or explore this repository.
            </p>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {isLoading && <ThinkingIndicator />}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-[#3c3c3c] bg-[#252526]">
        {/* Selected file indicator */}
        {selectedFile && (
          <div className="px-4 pt-3 pb-1">
            <div className="inline-flex items-center gap-2 px-2 py-1 bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg text-xs">
              <FileText className="h-3 w-3 text-amber-500" />
              <span className="text-gray-300">{selectedFile}</span>
              {onClearFile && (
                <button
                  onClick={onClearFile}
                  className="hover:text-gray-200 text-gray-500"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Input form */}
        <form onSubmit={handleSubmit} className="p-4 pt-2">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Claude anything..."
                disabled={isLoading}
                rows={1}
                className={cn(
                  'w-full resize-none rounded-xl border border-[#3c3c3c] bg-[#1e1e1e] px-4 py-3',
                  'text-sm text-gray-200 placeholder:text-gray-500',
                  'focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'max-h-32 overflow-y-auto'
                )}
                style={{ minHeight: '48px' }}
              />
            </div>
            {isLoading ? (
              <Button
                type="button"
                onClick={onCancel}
                variant="outline"
                size="icon"
                className="h-12 w-12 rounded-xl border-red-500/50 text-red-400 hover:bg-red-500/10"
              >
                <XCircle className="h-5 w-5" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!input.trim()}
                size="icon"
                className="h-12 w-12 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
              >
                <Send className="h-5 w-5" />
              </Button>
            )}
          </div>

          {/* Bottom toolbar */}
          <TooltipProvider>
            <div className="flex items-center justify-between mt-3">
              {/* Left side - Actions */}
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-gray-500 hover:text-gray-300"
                    >
                      <Link className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Add file or link</p>
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Center - Edit automatically toggle */}
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[#1e1e1e] transition-colors cursor-pointer">
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-xs text-gray-400">Edit automatically</span>
                      <Switch
                        checked={autoEdit}
                        onCheckedChange={setAutoEdit}
                        className="h-4 w-7 data-[state=checked]:bg-amber-600"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Auto-apply Claude&apos;s code edits</p>
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Right side - Context usage */}
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5 text-gray-500">
                      <PieChart className="h-3.5 w-3.5" />
                      <span className="text-xs font-mono">
                        {Math.max(0, 100 - contextUsagePercent).toFixed(0)}%
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Context remaining</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </TooltipProvider>
        </form>
      </div>
    </div>
  )
}
