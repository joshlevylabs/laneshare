'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Send, Loader2, AlertCircle } from 'lucide-react'
import { WorkspaceMessage } from './workspace-message'
import type { WorkspaceSessionData, WorkspaceMessageData } from './workspace-view'

interface WorkspaceSessionProps {
  session: WorkspaceSessionData
  localServerUrl: string
  onStatusChange: (status: WorkspaceSessionData['status']) => void
  onMessagesUpdate: (messages: WorkspaceMessageData[]) => void
}

export function WorkspaceSession({
  session,
  localServerUrl,
  onStatusChange,
  onMessagesUpdate,
}: WorkspaceSessionProps) {
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [session.messages])

  // Connect to WebSocket for streaming
  useEffect(() => {
    if (!session.local_session_id || session.status !== 'CONNECTED') return

    const wsUrl = `${localServerUrl.replace('http', 'ws')}/sessions/${session.local_session_id}/stream`

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        console.log('WebSocket connected for session:', session.id)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          if (data.type === 'message') {
            const newMessage: WorkspaceMessageData = {
              id: data.id || crypto.randomUUID(),
              role: data.role,
              content: data.content,
              toolName: data.tool_name,
              toolInput: data.tool_input,
              toolResult: data.tool_result,
              timestamp: new Date(data.timestamp || Date.now()),
            }
            onMessagesUpdate([...session.messages, newMessage])
          } else if (data.type === 'stream_start') {
            setIsStreaming(true)
          } else if (data.type === 'stream_end') {
            setIsStreaming(false)
          } else if (data.type === 'error') {
            setError(data.message)
            setIsStreaming(false)
          }
        } catch (e) {
          console.error('Error parsing WebSocket message:', e)
        }
      }

      ws.onerror = (event) => {
        console.error('WebSocket error:', event)
        setError('Connection error. Please check if the local server is running.')
      }

      ws.onclose = () => {
        console.log('WebSocket closed for session:', session.id)
        onStatusChange('DISCONNECTED')
      }

      return () => {
        ws.close()
      }
    } catch (e) {
      console.error('Failed to connect WebSocket:', e)
      setError('Failed to connect to local server.')
    }
  }, [session.local_session_id, session.status, localServerUrl, session.id, session.messages, onMessagesUpdate, onStatusChange])

  const handleSend = async () => {
    if (!input.trim() || isStreaming || !session.local_session_id) return

    const userMessage: WorkspaceMessageData = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }

    onMessagesUpdate([...session.messages, userMessage])
    setInput('')
    setError(null)
    setIsStreaming(true)

    try {
      const response = await fetch(`${localServerUrl}/sessions/${session.local_session_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: userMessage.content }),
      })

      if (!response.ok) {
        throw new Error('Failed to send message')
      }
    } catch (e) {
      setError('Failed to send message. Please check if the local server is running.')
      setIsStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (session.status === 'CONNECTING') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Connecting to local server...</p>
        </div>
      </div>
    )
  }

  if (session.status === 'ERROR') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 mx-auto mb-4 text-destructive" />
          <p className="text-destructive font-medium">Connection Error</p>
          <p className="text-sm text-muted-foreground mt-2">
            {session.error_message || 'Failed to connect to local server'}
          </p>
        </div>
      </div>
    )
  }

  if (session.status === 'DISCONNECTED') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-8 w-8 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground font-medium">Session Disconnected</p>
          <p className="text-sm text-muted-foreground mt-2">
            The connection to the local server was lost.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Messages area */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="divide-y">
          {session.messages.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p>No messages yet.</p>
              <p className="text-sm mt-2">
                Send a message to start working on: <strong>{session.task?.title || 'this task'}</strong>
              </p>
            </div>
          ) : (
            session.messages.map((message) => (
              <WorkspaceMessage key={message.id} message={message} />
            ))
          )}
          {isStreaming && (
            <div className="p-4 flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Claude is thinking...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Input area */}
      <div className="border-t p-4">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message to Claude..."
            className="min-h-[80px] resize-none"
            disabled={isStreaming}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="self-end"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
