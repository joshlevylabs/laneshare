'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
  Send,
  Loader2,
  Bot,
  User,
  Sparkles,
  Link,
  Server,
  GitBranch,
  FileText,
  Table2,
  Trash2,
  Workflow,
  Ticket,
} from 'lucide-react'
import type {
  TaskContextMessage,
  ContextAISuggestion,
  ContextSuggestionType,
} from '@laneshare/shared'

interface ContextAITabProps {
  projectId: string
  taskId: string
  onLinkContext: (type: ContextSuggestionType, id: string) => Promise<void>
}

const SUGGESTION_ICONS: Record<ContextSuggestionType, React.ReactNode> = {
  service: <Server className="h-4 w-4" />,
  asset: <Table2 className="h-4 w-4" />,
  repo: <GitBranch className="h-4 w-4" />,
  doc: <FileText className="h-4 w-4" />,
  feature: <Workflow className="h-4 w-4" />,
  ticket: <Ticket className="h-4 w-4" />,
}

const SUGGESTION_COLORS: Record<ContextSuggestionType, string> = {
  service: 'border-purple-200 bg-purple-50 hover:bg-purple-100',
  asset: 'border-blue-200 bg-blue-50 hover:bg-blue-100',
  repo: 'border-green-200 bg-green-50 hover:bg-green-100',
  doc: 'border-orange-200 bg-orange-50 hover:bg-orange-100',
  feature: 'border-cyan-200 bg-cyan-50 hover:bg-cyan-100',
  ticket: 'border-pink-200 bg-pink-50 hover:bg-pink-100',
}

interface MessageBubbleProps {
  message: TaskContextMessage
  onLinkSuggestion: (suggestion: ContextAISuggestion) => Promise<void>
  linkingId: string | null
}

function MessageBubble({ message, onLinkSuggestion, linkingId }: MessageBubbleProps) {
  const isUser = message.sender === 'USER'

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div className={cn('flex flex-col gap-2', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-lg px-4 py-2 max-w-[280px]',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground'
          )}
        >
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>

        {/* Suggestions (only for AI messages) */}
        {!isUser && message.suggestions && message.suggestions.length > 0 && (
          <div className="flex flex-col gap-2 w-full max-w-[280px]">
            {message.suggestions.map((suggestion, index) => (
              <div
                key={`${suggestion.id}-${index}`}
                className={cn(
                  'rounded-lg border p-3 transition-colors',
                  SUGGESTION_COLORS[suggestion.type]
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {SUGGESTION_ICONS[suggestion.type]}
                    <span className="font-medium text-sm">{suggestion.name}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    disabled={linkingId === suggestion.id}
                    onClick={() => onLinkSuggestion(suggestion)}
                  >
                    {linkingId === suggestion.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        <Link className="h-3 w-3 mr-1" />
                        Link
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{suggestion.reason}</p>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="outline" className="text-xs">
                    {suggestion.type}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {Math.round(suggestion.confidence * 100)}% confidence
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function ContextAITab({
  projectId,
  taskId,
  onLinkContext,
}: ContextAITabProps) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<TaskContextMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(true)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Fetch initial messages
  useEffect(() => {
    async function fetchMessages() {
      try {
        const response = await fetch(
          `/api/projects/${projectId}/tasks/${taskId}/context-ai`
        )
        if (response.ok) {
          const data = await response.json()
          setMessages(data.messages || [])
        }
      } catch (error) {
        console.error('Error fetching context AI messages:', error)
      } finally {
        setIsFetching(false)
      }
    }

    fetchMessages()
  }, [projectId, taskId])

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSendMessage = async () => {
    const trimmedInput = input.trim()
    if (!trimmedInput || isLoading) return

    setIsLoading(true)
    setInput('')

    // Optimistically add user message
    const tempUserMessage: TaskContextMessage = {
      id: `temp-${Date.now()}`,
      task_id: taskId,
      project_id: projectId,
      sender: 'USER',
      content: trimmedInput,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMessage])

    try {
      const response = await fetch(
        `/api/projects/${projectId}/tasks/${taskId}/context-ai`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmedInput }),
        }
      )

      if (!response.ok) {
        throw new Error('Failed to send message')
      }

      const data = await response.json()

      // Replace temp message with real ones
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempUserMessage.id),
        data.userMessage,
        data.aiMessage,
      ])
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to send message. Please try again.',
      })
      // Remove the temp message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id))
      setInput(trimmedInput) // Restore input
    } finally {
      setIsLoading(false)
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleLinkSuggestion = async (suggestion: ContextAISuggestion) => {
    setLinkingId(suggestion.id)
    try {
      await onLinkContext(suggestion.type, suggestion.id)
      toast({
        title: 'Context linked',
        description: `Added ${suggestion.name} to the task`,
      })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to link context',
      })
    } finally {
      setLinkingId(null)
    }
  }

  const handleClearHistory = async () => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/tasks/${taskId}/context-ai`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        throw new Error('Failed to clear history')
      }

      setMessages([])
      toast({
        title: 'History cleared',
        description: 'Context AI chat history has been cleared',
      })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to clear history',
      })
    }
  }

  if (isFetching) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[400px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Context AI</span>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={handleClearHistory}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="h-12 w-12 text-muted-foreground mb-4" />
            <h4 className="font-medium mb-2">Context AI Assistant</h4>
            <p className="text-sm text-muted-foreground max-w-[250px]">
              Ask me to help find relevant services, repos, and docs for this task.
            </p>
            <div className="mt-4 space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setInput('What context would be most helpful for this task?')}
              >
                Suggest relevant context
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs block"
                onClick={() => setInput('Which database tables are related to this task?')}
              >
                Find related tables
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onLinkSuggestion={handleLinkSuggestion}
                linkingId={linkingId}
              />
            ))}
            {isLoading && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="bg-muted rounded-lg px-4 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about relevant context... (Enter to send)"
            className="min-h-[40px] max-h-[120px] resize-none"
            disabled={isLoading}
          />
          <Button
            size="icon"
            onClick={handleSendMessage}
            disabled={!input.trim() || isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
