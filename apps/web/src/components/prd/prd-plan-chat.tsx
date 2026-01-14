'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { Loader2, Send, Bot, User, Check, FileText, Sparkles, ChevronRight, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatOption {
  label: string
  value: string
  recommended?: boolean
}

interface ChatMessage {
  id: string
  sender: 'USER' | 'AI'
  content: string
  suggested_section?: { type: string; content: string } | null
  options?: ChatOption[]
  created_at: string
}

interface PRDPlanChatProps {
  projectId: string
  prdId: string
  prdTitle: string
  initialDescription?: string
  onMarkdownUpdate: (markdown: string) => void
  onFinishPlanning: (markdown?: string) => void
  onConvertAndGenerate?: () => void
}

export function PRDPlanChat({
  projectId,
  prdId,
  prdTitle,
  initialDescription,
  onMarkdownUpdate,
  onFinishPlanning,
  onConvertAndGenerate,
}: PRDPlanChatProps) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isFetchingHistory, setIsFetchingHistory] = useState(true)
  const [currentPrdMarkdown, setCurrentPrdMarkdown] = useState('')
  const [otherInputMessageId, setOtherInputMessageId] = useState<string | null>(null)
  const [otherInputValue, setOtherInputValue] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const otherInputRef = useRef<HTMLInputElement>(null)

  // Use refs to prevent race conditions
  const isLoadingRef = useRef(false)
  const initialSentRef = useRef(false)
  const fetchedRef = useRef(false)
  const lastSentContentRef = useRef<string>('')
  const lastSentTimeRef = useRef<number>(0)

  // Send a message programmatically
  const sendMessage = useCallback(async (messageContent: string) => {
    // Use ref for synchronous check to prevent double-sends
    if (isLoadingRef.current) {
      console.log('Already loading, skipping duplicate send')
      return
    }

    // Additional check: prevent duplicate content within 2 seconds
    const now = Date.now()
    if (messageContent === lastSentContentRef.current && now - lastSentTimeRef.current < 2000) {
      console.log('Duplicate content within 2 seconds, skipping')
      return
    }

    isLoadingRef.current = true
    lastSentContentRef.current = messageContent
    lastSentTimeRef.current = now
    setIsLoading(true)

    const tempId = `temp-${Date.now()}`
    const tempUserMsg: ChatMessage = {
      id: tempId,
      sender: 'USER',
      content: messageContent,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, tempUserMsg])

    try {
      const response = await fetch(`/api/projects/${projectId}/prd/${prdId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: messageContent }),
      })

      if (!response.ok) {
        throw new Error('Failed to send message')
      }

      const result = await response.json()

      // Parse options from AI response if present
      let options: ChatOption[] | undefined
      const aiContent = result.aiMessage?.content || ''

      // Extract options if AI suggests them with [OPTIONS] tag
      const optionsMatch = aiContent.match(/\[OPTIONS\]([\s\S]*?)\[\/OPTIONS\]/i)
      if (optionsMatch) {
        const optionsContent = optionsMatch[1].trim()
        try {
          // Try to parse as JSON array
          const parsed = JSON.parse(optionsContent)
          if (Array.isArray(parsed)) {
            options = parsed.map((opt: { label?: string; value?: string; recommended?: boolean } | string, idx: number) => {
              if (typeof opt === 'string') {
                const isRecommended = opt.includes('(Recommended)')
                const cleanLabel = opt.replace(/\s*\(Recommended\)\s*/i, '').trim()
                return { label: cleanLabel, value: cleanLabel, recommended: isRecommended }
              }
              const isRecommended = opt.recommended || opt.label?.includes('(Recommended)') || idx === 0
              const cleanLabel = (opt.label || '').replace(/\s*\(Recommended\)\s*/i, '').trim()
              return {
                label: cleanLabel,
                value: opt.value || cleanLabel,
                recommended: isRecommended,
              }
            })
          }
        } catch {
          // Fallback: Parse numbered list format (1. Option text)
          const lines = optionsContent.split('\n')
          const parsedOptions = lines
            .filter((line: string) => line.trim().match(/^\d+\./))
            .map((line: string, idx: number) => {
              const text = line.replace(/^\d+\.\s*/, '').trim()
              const isRecommended = text.includes('(Recommended)') || idx === 0
              const cleanLabel = text.replace(/\s*\(Recommended\)\s*/i, '').trim()
              return { label: cleanLabel, value: cleanLabel, recommended: isRecommended }
            })
          if (parsedOptions.length > 0) {
            options = parsedOptions
          }
        }
      }

      setMessages(prev => {
        // Filter out the temp message
        const filteredPrev = prev.filter(m => m.id !== tempId)

        // Deduplicate by ID to prevent race condition duplicates
        const existingIds = new Set(filteredPrev.map(m => m.id))
        const newMessages: ChatMessage[] = []

        if (result.userMessage && !existingIds.has(result.userMessage.id)) {
          newMessages.push(result.userMessage)
        }
        if (result.aiMessage && !existingIds.has(result.aiMessage.id)) {
          newMessages.push({ ...result.aiMessage, options })
        }

        return [...filteredPrev, ...newMessages]
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to send message. Please try again.',
        variant: 'destructive',
      })
      setMessages(prev => prev.filter(m => m.id !== tempId))
    } finally {
      isLoadingRef.current = false
      setIsLoading(false)
    }
  }, [projectId, prdId, toast])

  // Extract PRD content from the entire conversation
  const extractPRDFromConversation = useCallback((msgs: ChatMessage[]) => {
    // Get all AI messages
    const aiMessages = msgs.filter(m => m.sender === 'AI')
    if (aiMessages.length === 0) return ''

    // Find the message with user stories (look for patterns like US-001, user story, acceptance criteria)
    let prdContent = ''

    for (const msg of aiMessages) {
      const content = msg.content

      // Check if this message contains user stories
      const hasUserStories = /US-\d+|user stor(y|ies)/i.test(content) &&
        /acceptance criteria|priority|description/i.test(content)

      if (hasUserStories) {
        // This message likely contains the PRD content
        // Clean up JSON code blocks if present
        let cleaned = content
          .replace(/```json[\s\S]*?```/g, (match) => {
            // Try to extract readable content from JSON
            try {
              const jsonStr = match.replace(/```json\s*/, '').replace(/```\s*$/, '')
              const parsed = JSON.parse(jsonStr)
              if (parsed.type === 'user_story' && parsed.content) {
                const s = parsed.content
                return `### ${s.id}: ${s.title}

${s.description}

**Acceptance Criteria:**
${(s.acceptanceCriteria || []).map((c: string) => `- ${c}`).join('\n')}

**Priority:** ${s.priority}
**Story Points:** ${s.estimatedPoints || 'TBD'}
`
              }
            } catch {
              // Not valid JSON, return as is
            }
            return match.replace(/```json\s*/, '').replace(/```\s*$/, '')
          })
          .replace(/\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/gi, '')
          .replace(/\[PRD_SECTION:\w+\]([\s\S]*?)\[\/PRD_SECTION\]/gi, '$1')
          .trim()

        prdContent += cleaned + '\n\n'
      }
    }

    // If we didn't find structured user stories, use the last substantial AI response
    if (!prdContent.trim()) {
      const lastAiMsg = aiMessages[aiMessages.length - 1]
      if (lastAiMsg) {
        prdContent = lastAiMsg.content
          .replace(/\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/gi, '')
          .replace(/\[PRD_SECTION:\w+\]([\s\S]*?)\[\/PRD_SECTION\]/gi, '$1')
          .trim()
      }
    }

    return `# ${prdTitle}

${prdContent}`.trim()
  }, [prdTitle])

  // Fetch chat history on mount
  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    const fetchHistory = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/prd/${prdId}/chat`)
        if (response.ok) {
          const history = await response.json()

          // Only set messages if we don't already have any (prevent overwriting)
          setMessages(prev => {
            if (prev.length > 0) return prev
            return history
          })

          // If no history and we have an initial description, auto-send it
          if (history.length === 0 && initialDescription && !initialSentRef.current) {
            initialSentRef.current = true
            setIsFetchingHistory(false)
            // Send initial description after state updates
            setTimeout(() => {
              sendMessage(initialDescription)
            }, 200)
            return
          }
        }
      } catch (error) {
        console.error('Error fetching chat history:', error)
      } finally {
        setIsFetchingHistory(false)
      }
    }

    fetchHistory()
  }, [projectId, prdId, initialDescription, sendMessage])

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isLoadingRef.current) return

    const userMessage = input.trim()
    setInput('')
    await sendMessage(userMessage)
  }

  const handleOptionClick = async (option: ChatOption) => {
    if (isLoadingRef.current) return
    await sendMessage(option.value)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleAcceptSection = (section: { type: string; content: string }) => {
    const newMarkdown = currentPrdMarkdown
      ? `${currentPrdMarkdown}\n\n${section.content}`
      : section.content
    setCurrentPrdMarkdown(newMarkdown)
    onMarkdownUpdate(newMarkdown)
    toast({
      title: 'Section Added',
      description: 'Content added to your PRD draft',
    })
  }

  const handleFinish = async () => {
    // Extract PRD content from conversation
    const extractedMarkdown = extractPRDFromConversation(messages)

    if (extractedMarkdown && extractedMarkdown.length > prdTitle.length + 10) {
      setCurrentPrdMarkdown(extractedMarkdown)

      // Save to the database
      try {
        await fetch(`/api/projects/${projectId}/prd/${prdId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw_markdown: extractedMarkdown }),
        })
        toast({
          title: 'PRD Saved',
          description: 'Your PRD has been extracted and saved. Ready to convert to user stories.',
        })
      } catch (error) {
        console.error('Error saving PRD:', error)
      }

      // Pass markdown directly to avoid race condition
      onFinishPlanning(extractedMarkdown)
    } else {
      toast({
        title: 'No Content Found',
        description: 'Continue chatting to develop your PRD before finishing.',
        variant: 'destructive',
      })
      return
    }
  }

  const handleConvertNow = async () => {
    // First extract and save, then trigger convert
    const extractedMarkdown = currentPrdMarkdown || extractPRDFromConversation(messages)

    if (extractedMarkdown && extractedMarkdown.length > prdTitle.length + 10) {
      // Save to the database first
      try {
        await fetch(`/api/projects/${projectId}/prd/${prdId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw_markdown: extractedMarkdown }),
        })
      } catch (error) {
        console.error('Error saving PRD:', error)
      }

      // Pass markdown directly to onFinishPlanning to avoid race condition
      onFinishPlanning(extractedMarkdown)

      // Give time for state to update, then trigger convert
      setTimeout(() => {
        onConvertAndGenerate?.()
      }, 500)
    }
  }

  const formatContent = (content: string) => {
    // Remove OPTIONS and PRD_SECTION tags for display
    return content
      .replace(/\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/gi, '')
      .replace(/\[PRD_SECTION:\w+\]([\s\S]*?)\[\/PRD_SECTION\]/gi, '$1')
      .trim()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Bot className="h-4 w-4" />
          Planning: {prdTitle}
        </h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleFinish} disabled={messages.length === 0}>
            <Check className="h-4 w-4 mr-2" />
            Finish Planning
          </Button>
          {messages.length > 0 && (
            <Button size="sm" onClick={handleConvertNow}>
              <Sparkles className="h-4 w-4 mr-2" />
              Create Tasks
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="h-[400px] rounded-md border p-4" ref={scrollRef}>
        {isFetchingHistory ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Bot className="h-12 w-12 mb-4 opacity-50" />
            <p className="font-medium">Start planning your PRD</p>
            <p className="text-sm">
              Tell me about what you're building and I'll help you create a detailed PRD
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div key={message.id || index}>
                <div
                  className={cn(
                    'flex gap-3',
                    message.sender === 'USER' ? 'justify-end' : 'justify-start'
                  )}
                >
                  {message.sender === 'AI' && (
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        <Bot className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div
                    className={cn(
                      'rounded-lg px-4 py-2 max-w-[80%]',
                      message.sender === 'USER'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    )}
                  >
                    <div className="whitespace-pre-wrap text-sm">
                      {formatContent(message.content)}
                    </div>
                    {message.suggested_section && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="h-3 w-3" />
                          <span className="text-xs font-medium">
                            Suggested {message.suggested_section.type}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleAcceptSection(message.suggested_section!)}
                          className="text-xs"
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Add to PRD
                        </Button>
                      </div>
                    )}
                  </div>
                  {message.sender === 'USER' && (
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback>
                        <User className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>

                {/* Quick action options from AI - styled like Claude Code selector */}
                {message.sender === 'AI' && message.options && message.options.length > 0 && (
                  <div className="ml-11 mt-3 space-y-2">
                    <p className="text-xs text-muted-foreground font-medium mb-2">Select an option:</p>
                    <div className="grid gap-2">
                      {message.options.map((option, optIdx) => (
                        <button
                          key={optIdx}
                          onClick={() => handleOptionClick(option)}
                          disabled={isLoading}
                          className={cn(
                            "w-full text-left px-4 py-3 rounded-lg border transition-all",
                            "hover:bg-accent hover:border-primary/50",
                            "focus:outline-none focus:ring-2 focus:ring-primary/50",
                            "disabled:opacity-50 disabled:cursor-not-allowed",
                            option.recommended
                              ? "bg-primary/5 border-primary/30"
                              : "bg-background border-border"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium",
                              option.recommended
                                ? "bg-primary text-primary-foreground"
                                : "bg-primary/10 text-primary"
                            )}>
                              {optIdx + 1}
                            </div>
                            <span className="text-sm flex-1">{option.label}</span>
                            {option.recommended && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                Recommended
                              </Badge>
                            )}
                          </div>
                        </button>
                      ))}
                      {/* Other option */}
                      {otherInputMessageId === message.id ? (
                        <div className="flex gap-2">
                          <Input
                            ref={otherInputRef}
                            value={otherInputValue}
                            onChange={(e) => setOtherInputValue(e.target.value)}
                            placeholder="Type your custom response..."
                            className="flex-1"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && otherInputValue.trim()) {
                                sendMessage(otherInputValue.trim())
                                setOtherInputMessageId(null)
                                setOtherInputValue('')
                              }
                              if (e.key === 'Escape') {
                                setOtherInputMessageId(null)
                                setOtherInputValue('')
                              }
                            }}
                            autoFocus
                          />
                          <Button
                            size="sm"
                            onClick={() => {
                              if (otherInputValue.trim()) {
                                sendMessage(otherInputValue.trim())
                                setOtherInputMessageId(null)
                                setOtherInputValue('')
                              }
                            }}
                            disabled={!otherInputValue.trim() || isLoading}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setOtherInputMessageId(null)
                              setOtherInputValue('')
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setOtherInputMessageId(message.id)
                            setOtherInputValue('')
                          }}
                          disabled={isLoading}
                          className={cn(
                            "w-full text-left px-4 py-3 rounded-lg border transition-all",
                            "hover:bg-accent hover:border-primary/50",
                            "focus:outline-none focus:ring-2 focus:ring-primary/50",
                            "disabled:opacity-50 disabled:cursor-not-allowed",
                            "bg-background border-dashed border-muted-foreground/30"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                              <MessageSquare className="h-3 w-3 text-muted-foreground" />
                            </div>
                            <span className="text-sm text-muted-foreground">Other (type your own response)</span>
                          </div>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-3">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="bg-muted rounded-lg px-4 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Quick response options */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => sendMessage("That looks good, I accept this plan")}
          disabled={isLoading || messages.length === 0}
        >
          <Check className="h-3 w-3 mr-1" />
          Accept Plan
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => sendMessage("Can you add more detail to the user stories?")}
          disabled={isLoading || messages.length === 0}
        >
          More Detail
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => sendMessage("What other features should we consider?")}
          disabled={isLoading || messages.length === 0}
        >
          Suggest More Features
        </Button>
      </div>

      <div className="flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you want to build... (Enter to send)"
          className="min-h-[80px] resize-none"
          disabled={isLoading}
        />
        <Button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          className="px-3"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>

      {currentPrdMarkdown && (
        <div className="rounded-md border p-3 bg-muted/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span className="text-sm font-medium">Current PRD Draft</span>
            </div>
            <Button size="sm" variant="secondary" onClick={handleConvertNow}>
              <Sparkles className="h-3 w-3 mr-1" />
              Convert to Tasks
            </Button>
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap max-h-[150px] overflow-y-auto">
            {currentPrdMarkdown}
          </pre>
        </div>
      )}
    </div>
  )
}
