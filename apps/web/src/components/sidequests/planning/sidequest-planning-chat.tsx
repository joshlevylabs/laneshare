'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Send, Loader2, Sparkles, User, RefreshCw, CheckCircle2 } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import type { SidequestChatMessage, SidequestChatOption } from '@laneshare/shared'

interface SidequestPlanningChatProps {
  sidequestId: string
  projectId: string
  onPlanUpdated?: () => void
}

export function SidequestPlanningChat({
  sidequestId,
  projectId,
  onPlanUpdated,
}: SidequestPlanningChatProps) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<SidequestChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch chat history
  const fetchMessages = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/sidequests/${sidequestId}/chat`)
      if (!response.ok) throw new Error('Failed to fetch messages')
      const data = await response.json()
      setMessages(data)
    } catch (error) {
      console.error('Fetch messages error:', error)
      toast({ title: 'Error', description: 'Failed to load chat history', variant: 'destructive' })
    } finally {
      setIsFetching(false)
    }
  }, [projectId, sidequestId, toast])

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Send message
  const sendMessage = async (content: string) => {
    if (!content.trim() || isLoading) return

    setIsLoading(true)
    setInput('')

    // Optimistic update
    const tempId = `temp-${Date.now()}`
    const tempUserMessage: SidequestChatMessage = {
      id: tempId,
      sidequest_id: sidequestId,
      project_id: projectId,
      sender: 'USER',
      content: content.trim(),
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMessage])

    try {
      const response = await fetch(`/api/projects/${projectId}/sidequests/${sidequestId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim() }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to send message')
      }

      const { user_message, ai_message } = await response.json()

      // Replace temp message and add AI response
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempId),
        user_message,
        ai_message,
      ])

      // Notify parent that plan may have been updated
      if (ai_message.plan_suggestions && ai_message.plan_suggestions.length > 0) {
        onPlanUpdated?.()
      }
    } catch (error) {
      console.error('Send message error:', error)
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to send message', variant: 'destructive' })
      // Remove temp message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const handleOptionClick = (option: SidequestChatOption) => {
    sendMessage(option.value)
  }

  if (isFetching) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <ScrollArea className="flex-1 pr-4">
        <div className="space-y-4 pb-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.sender === 'USER' ? 'flex-row-reverse' : ''}`}
            >
              {/* Avatar */}
              <Avatar className="h-8 w-8 shrink-0">
                {message.sender === 'AI' ? (
                  <>
                    <AvatarFallback className="bg-primary">
                      <Sparkles className="h-4 w-4 text-primary-foreground" />
                    </AvatarFallback>
                  </>
                ) : message.sender === 'SYSTEM' ? (
                  <>
                    <AvatarFallback className="bg-muted">
                      <RefreshCw className="h-4 w-4" />
                    </AvatarFallback>
                  </>
                ) : (
                  <>
                    <AvatarFallback className="bg-secondary">
                      <User className="h-4 w-4" />
                    </AvatarFallback>
                  </>
                )}
              </Avatar>

              {/* Message content */}
              <div
                className={`flex-1 max-w-[85%] ${
                  message.sender === 'USER' ? 'text-right' : ''
                }`}
              >
                <div
                  className={`inline-block rounded-lg px-4 py-2 ${
                    message.sender === 'USER'
                      ? 'bg-primary text-primary-foreground'
                      : message.sender === 'SYSTEM'
                      ? 'bg-muted/50 text-muted-foreground italic'
                      : 'bg-muted'
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                </div>

                {/* Options */}
                {message.options && message.options.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {message.options.map((option, idx) => (
                      <Card
                        key={idx}
                        className={`cursor-pointer hover:border-primary/50 transition-colors ${
                          option.recommended ? 'border-primary/30 bg-primary/5' : ''
                        }`}
                        onClick={() => handleOptionClick(option)}
                      >
                        <CardContent className="p-3">
                          <div className="flex items-start gap-2">
                            <Badge
                              variant={option.recommended ? 'default' : 'outline'}
                              className="shrink-0 mt-0.5"
                            >
                              {idx + 1}
                            </Badge>
                            <div className="flex-1">
                              <p className="font-medium text-sm">{option.label}</p>
                              {option.recommended && (
                                <Badge variant="secondary" className="mt-1 text-xs">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Recommended
                                </Badge>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}

                    {/* Custom response option */}
                    <div className="text-xs text-muted-foreground pl-2">
                      Or type your own response below
                    </div>
                  </div>
                )}

                {/* Plan suggestions indicator */}
                {message.plan_suggestions && message.plan_suggestions.length > 0 && (
                  <div className="mt-2">
                    <Badge variant="outline" className="text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {message.plan_suggestions.length} plan update
                      {message.plan_suggestions.length !== 1 ? 's' : ''} applied
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex gap-3">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="bg-primary">
                  <Sparkles className="h-4 w-4 text-primary-foreground" />
                </AvatarFallback>
              </Avatar>
              <div className="flex items-center gap-2 bg-muted rounded-lg px-4 py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Thinking...</span>
              </div>
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t pt-4 mt-4">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            placeholder="Type your message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            className="flex-1"
          />
          <Button
            onClick={() => sendMessage(input)}
            disabled={isLoading || !input.trim()}
            size="icon"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendMessage("That looks good, let's proceed")}
            disabled={isLoading}
          >
            Accept Plan
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendMessage('Can you add more detail to the stories?')}
            disabled={isLoading}
          >
            More Detail
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendMessage('What other features should we consider?')}
            disabled={isLoading}
          >
            Suggest Features
          </Button>
        </div>
      </div>
    </div>
  )
}
