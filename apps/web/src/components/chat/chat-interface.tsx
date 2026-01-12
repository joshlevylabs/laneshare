'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
  Send,
  Plus,
  Loader2,
  Bot,
  User,
  Zap,
  Copy,
  Check,
  MessageSquare,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Thread {
  id: string
  title: string
  task_id: string | null
  created_at: string
  updated_at: string
}

interface Message {
  id: string
  thread_id: string
  sender: 'USER' | 'LANEPILOT'
  content: string
  created_at: string
}

interface Task {
  id: string
  title: string
  status: string
  priority: string
}

interface Repo {
  id: string
  owner: string
  name: string
}

interface ChatInterfaceProps {
  projectId: string
  userId: string
  threads: Thread[]
  tasks: Task[]
  repos: Repo[]
  initialThread: Thread | null
  initialMessages: Message[]
  initialTask: Task | null
}

export function ChatInterface({
  projectId,
  userId,
  threads: initialThreads,
  tasks,
  repos,
  initialThread,
  initialMessages,
  initialTask,
}: ChatInterfaceProps) {
  const { toast } = useToast()
  const router = useRouter()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [threads, setThreads] = useState(initialThreads)
  const [activeThread, setActiveThread] = useState<Thread | null>(initialThread)
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState(initialTask?.id || '')
  const [isLoading, setIsLoading] = useState(false)
  const [isCreatingThread, setIsCreatingThread] = useState(false)
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const createThread = async () => {
    setIsCreatingThread(true)

    try {
      const response = await fetch(`/api/projects/${projectId}/chat/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New Chat',
          task_id: selectedTaskId || null,
        }),
      })

      if (!response.ok) throw new Error('Failed to create thread')

      const thread = await response.json()
      setThreads((prev) => [thread, ...prev])
      setActiveThread(thread)
      setMessages([])

      router.push(`/projects/${projectId}/chat?threadId=${thread.id}`)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create chat thread',
      })
    } finally {
      setIsCreatingThread(false)
    }
  }

  const selectThread = async (thread: Thread) => {
    setActiveThread(thread)
    router.push(`/projects/${projectId}/chat?threadId=${thread.id}`)

    // Fetch messages
    try {
      const response = await fetch(
        `/api/projects/${projectId}/chat/threads/${thread.id}/messages`
      )
      if (response.ok) {
        const data = await response.json()
        setMessages(data)
      }
    } catch (error) {
      console.error('Failed to fetch messages:', error)
    }
  }

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !activeThread) return

    const userMessage = input.trim()
    setInput('')
    setIsLoading(true)

    // Optimistically add user message
    const tempUserMessage: Message = {
      id: `temp-${Date.now()}`,
      thread_id: activeThread.id,
      sender: 'USER',
      content: userMessage,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMessage])

    try {
      const response = await fetch(
        `/api/projects/${projectId}/chat/threads/${activeThread.id}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: userMessage,
            task_id: selectedTaskId || activeThread.task_id,
          }),
        }
      )

      if (!response.ok) throw new Error('Failed to send message')

      const data = await response.json()

      // Replace temp message with real ones
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempUserMessage.id),
        data.userMessage,
        data.assistantMessage,
      ])
    } catch (error) {
      // Remove temp message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id))
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to send message',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const copyToClipboard = (content: string, blockId: string) => {
    navigator.clipboard.writeText(content)
    setCopiedBlock(blockId)
    setTimeout(() => setCopiedBlock(null), 2000)
    toast({
      title: 'Copied to clipboard',
      description: 'Content copied successfully.',
    })
  }

  return (
    <div className="flex h-full gap-4">
      {/* Thread sidebar */}
      <Card className="w-64 flex-shrink-0">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Chats</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={createThread}
              disabled={isCreatingThread}
            >
              {isCreatingThread ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-1 overflow-y-auto max-h-[calc(100vh-14rem)]">
          {threads.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No chats yet. Start a new one!
            </p>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => selectThread(thread)}
                className={cn(
                  'w-full text-left p-2 rounded-md text-sm transition-colors',
                  activeThread?.id === thread.id
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                )}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{thread.title}</span>
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {/* Main chat area */}
      <Card className="flex-1 flex flex-col">
        <CardHeader className="pb-2 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">LanePilot</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Select value={selectedTaskId} onValueChange={setSelectedTaskId}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select task (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No task selected</SelectItem>
                  {tasks.map((task) => (
                    <SelectItem key={task.id} value={task.id}>
                      {task.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {!activeThread ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Zap className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Start a Conversation</h3>
              <p className="text-muted-foreground max-w-sm mb-4">
                LanePilot generates context packs and agent prompts for your coding tasks.
              </p>
              <Button onClick={createThread} disabled={isCreatingThread}>
                {isCreatingThread && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                New Chat
              </Button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Bot className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Chat with LanePilot</h3>
              <p className="text-muted-foreground max-w-sm">
                Describe what you want to implement. LanePilot will analyze your codebase
                and generate context packs and agent prompts.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'flex gap-3',
                  message.sender === 'USER' ? 'justify-end' : 'justify-start'
                )}
              >
                {message.sender === 'LANEPILOT' && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[80%] rounded-lg p-4',
                    message.sender === 'USER'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  )}
                >
                  {message.sender === 'LANEPILOT' ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          pre: ({ children, ...props }) => {
                            const content = String(children)
                            const blockId = `code-${message.id}-${content.slice(0, 20)}`
                            return (
                              <div className="relative group">
                                <pre {...props} className="bg-background/50 p-3 rounded-md overflow-x-auto">
                                  {children}
                                </pre>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => copyToClipboard(content, blockId)}
                                >
                                  {copiedBlock === blockId ? (
                                    <Check className="h-4 w-4" />
                                  ) : (
                                    <Copy className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            )
                          },
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  )}
                </div>
                {message.sender === 'USER' && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                    <User className="h-4 w-4 text-primary-foreground" />
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </CardContent>

        {activeThread && (
          <div className="p-4 border-t">
            <form onSubmit={sendMessage} className="flex gap-2">
              <Textarea
                placeholder="Describe what you want to implement..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="min-h-[60px] max-h-[200px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage(e)
                  }
                }}
              />
              <Button
                type="submit"
                size="icon"
                className="h-[60px] w-[60px]"
                disabled={isLoading || !input.trim()}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
          </div>
        )}
      </Card>
    </div>
  )
}
