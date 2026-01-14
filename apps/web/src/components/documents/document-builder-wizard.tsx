'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategory,
  type DocumentBuilderSession,
  type GeneratedPrompt,
} from '@laneshare/shared'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  FileText,
  MessageSquare,
  Settings2,
  Wand2,
  Edit3,
  Bot,
  User,
  Send,
  Copy,
  GitBranch,
  Server,
  Boxes,
  CheckSquare,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const STEPS = [
  { id: 'basics', label: 'Basics', icon: Settings2 },
  { id: 'interview', label: 'Interview', icon: MessageSquare },
  { id: 'context', label: 'Context', icon: Boxes },
  { id: 'prompts', label: 'Prompts', icon: Wand2 },
  { id: 'editor', label: 'Write', icon: Edit3 },
]

const CATEGORY_OPTIONS: { value: DocumentCategory; label: string }[] = [
  { value: 'architecture', label: 'Architecture' },
  { value: 'api', label: 'API' },
  { value: 'feature_guide', label: 'Feature Guide' },
  { value: 'runbook', label: 'Runbook / Ops' },
  { value: 'decision', label: 'Decision / ADR' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'meeting_notes', label: 'Meeting Notes' },
  { value: 'other', label: 'Other' },
]

interface AvailableContext {
  repos: Array<{ id: string; owner: string; name: string; default_branch?: string; status?: string }>
  services: Array<{ id: string; service: string; display_name: string; status?: string }>
  systems: Array<{ id: string; name: string; slug: string; description?: string }>
  tasks: Array<{ id: string; key: string; title: string; status: string; type: string }>
  docs: Array<{ id: string; title: string; slug: string; category: string }>
}

interface DocumentBuilderWizardProps {
  projectId: string
  projectName: string
  userId: string
  existingSession: DocumentBuilderSession | null
  availableContext: AvailableContext
}

interface InterviewMessage {
  id: string
  sender: 'USER' | 'AI'
  content: string
  timestamp: string
}

export function DocumentBuilderWizard({
  projectId,
  projectName,
  userId,
  existingSession,
  availableContext,
}: DocumentBuilderWizardProps) {
  const router = useRouter()
  const { toast } = useToast()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Session state
  const [sessionId, setSessionId] = useState<string | null>(existingSession?.id || null)
  const [currentStep, setCurrentStep] = useState(0)
  const [isLoading, setIsLoading] = useState(false)

  // Step 1: Basics
  const [title, setTitle] = useState(existingSession?.title || '')
  const [category, setCategory] = useState<DocumentCategory>(existingSession?.category || 'other')
  const [description, setDescription] = useState(existingSession?.description || '')
  const [tags, setTags] = useState<string[]>(existingSession?.tags || [])
  const [tagInput, setTagInput] = useState('')

  // Step 2: Interview
  const [messages, setMessages] = useState<InterviewMessage[]>(
    (existingSession?.interview_messages as InterviewMessage[]) || []
  )
  const [messageInput, setMessageInput] = useState('')
  const [isSendingMessage, setIsSendingMessage] = useState(false)

  // Step 3: Context
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>(
    existingSession?.selected_repo_ids || []
  )
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(
    existingSession?.selected_service_ids || []
  )
  const [selectedSystemIds, setSelectedSystemIds] = useState<string[]>(
    existingSession?.selected_system_ids || []
  )
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>(
    existingSession?.selected_task_ids || []
  )
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(
    existingSession?.selected_doc_ids || []
  )
  const [keywords, setKeywords] = useState<string[]>(existingSession?.context_keywords || [])
  const [keywordInput, setKeywordInput] = useState('')

  // Step 4: Prompts
  const [outlineMarkdown, setOutlineMarkdown] = useState(existingSession?.outline_markdown || '')
  const [generatedPrompts, setGeneratedPrompts] = useState<GeneratedPrompt[]>(
    (existingSession?.generated_prompts as GeneratedPrompt[]) || []
  )
  const [isGenerating, setIsGenerating] = useState(false)
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null)

  // Step 5: Editor
  const [documentContent, setDocumentContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Create or update session
  const saveSession = useCallback(async (updates: Partial<DocumentBuilderSession>) => {
    try {
      if (sessionId) {
        await fetch(`/api/projects/${projectId}/documents/builder/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
      } else {
        const response = await fetch(`/api/projects/${projectId}/documents/builder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            category,
            description,
          }),
        })
        const data = await response.json()
        setSessionId(data.id)
        router.replace(`/projects/${projectId}/documents/new?sessionId=${data.id}`)
      }
    } catch (error) {
      console.error('Failed to save session:', error)
    }
  }, [sessionId, projectId, title, category, description, router])

  // Step navigation
  const canProceed = useCallback(() => {
    switch (currentStep) {
      case 0: // Basics
        return title.trim().length > 0
      case 1: // Interview
        return true // Optional
      case 2: // Context
        return true // Optional but recommended
      case 3: // Prompts
        return generatedPrompts.length > 0
      case 4: // Editor
        return documentContent.trim().length > 0
      default:
        return true
    }
  }, [currentStep, title, generatedPrompts, documentContent])

  const handleNext = async () => {
    if (currentStep === 0) {
      // Save basics
      await saveSession({ title, category, description, tags })
    } else if (currentStep === 2) {
      // Save context selections
      await saveSession({
        selected_repo_ids: selectedRepoIds,
        selected_service_ids: selectedServiceIds,
        selected_system_ids: selectedSystemIds,
        selected_task_ids: selectedTaskIds,
        selected_doc_ids: selectedDocIds,
        context_keywords: keywords,
        status: 'CONTEXT',
      })
    }

    if (currentStep < STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }

  // Interview chat
  const sendMessage = async () => {
    if (!messageInput.trim() || isSendingMessage) return

    // Ensure session exists
    if (!sessionId) {
      await saveSession({ title, category, description })
    }

    setIsSendingMessage(true)
    const userContent = messageInput.trim()
    setMessageInput('')

    // Optimistic update
    const tempUserMessage: InterviewMessage = {
      id: `temp-${Date.now()}`,
      sender: 'USER',
      content: userContent,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMessage])

    try {
      const response = await fetch(
        `/api/projects/${projectId}/documents/builder/${sessionId}/message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: userContent }),
        }
      )

      if (!response.ok) throw new Error('Failed to send message')

      const data = await response.json()
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempUserMessage.id),
        data.userMessage,
        data.aiMessage,
      ])
    } catch (error) {
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id))
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to send message',
      })
    } finally {
      setIsSendingMessage(false)
    }
  }

  // Generate prompts
  const generatePrompts = async () => {
    if (!sessionId) return

    setIsGenerating(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/documents/builder/${sessionId}/generate-prompts`,
        { method: 'POST' }
      )

      if (!response.ok) throw new Error('Failed to generate prompts')

      const data = await response.json()
      setOutlineMarkdown(data.outline)
      setGeneratedPrompts(data.prompts)
      // Pre-fill editor with outline
      setDocumentContent(data.outline)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to generate prompts',
      })
    } finally {
      setIsGenerating(false)
    }
  }

  // Copy prompt
  const copyPrompt = (prompt: GeneratedPrompt) => {
    navigator.clipboard.writeText(prompt.prompt)
    setCopiedPromptId(prompt.id)
    setTimeout(() => setCopiedPromptId(null), 2000)
    toast({
      title: 'Copied',
      description: 'Prompt copied to clipboard',
    })
  }

  // Finalize and create document
  const finalizeDocument = async () => {
    if (!sessionId || !documentContent.trim()) return

    setIsSaving(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/documents/builder/${sessionId}/finalize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            markdown: documentContent,
            title,
            category,
            description,
            tags,
          }),
        }
      )

      if (!response.ok) throw new Error('Failed to create document')

      const document = await response.json()
      toast({
        title: 'Document Created',
        description: 'Your document has been saved.',
      })
      router.push(`/projects/${projectId}/documents/${document.id}`)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create document',
      })
    } finally {
      setIsSaving(false)
    }
  }

  // Tag handling
  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()])
      setTagInput('')
    }
  }

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }

  // Keyword handling
  const addKeyword = () => {
    if (keywordInput.trim() && !keywords.includes(keywordInput.trim())) {
      setKeywords([...keywords, keywordInput.trim()])
      setKeywordInput('')
    }
  }

  const removeKeyword = (keyword: string) => {
    setKeywords(keywords.filter((k) => k !== keyword))
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/projects/${projectId}/documents`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Documents
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-6 w-6" />
              Document Builder
            </h1>
            <p className="text-muted-foreground">
              Create a new document for {projectName}
            </p>
          </div>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-between">
        {STEPS.map((step, index) => {
          const Icon = step.icon
          const isCompleted = index < currentStep
          const isCurrent = index === currentStep

          return (
            <div key={step.id} className="flex items-center">
              <div
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg transition-colors',
                  isCurrent && 'bg-primary text-primary-foreground',
                  isCompleted && 'text-primary',
                  !isCurrent && !isCompleted && 'text-muted-foreground'
                )}
              >
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center',
                    isCurrent && 'bg-primary-foreground/20',
                    isCompleted && 'bg-primary/10',
                    !isCurrent && !isCompleted && 'bg-muted'
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </div>
                <span className="text-sm font-medium hidden sm:inline">
                  {step.label}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={cn(
                    'w-8 h-0.5 mx-2',
                    index < currentStep ? 'bg-primary' : 'bg-muted'
                  )}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Step content */}
      <Card>
        <CardContent className="p-6">
          {/* Step 1: Basics */}
          {currentStep === 0 && (
            <div className="space-y-6">
              <div>
                <CardTitle>Document Basics</CardTitle>
                <CardDescription>
                  Start by defining what this document will be about.
                </CardDescription>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Title *</Label>
                  <Input
                    id="title"
                    placeholder="e.g., Authentication System Architecture"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Category *</Label>
                  <Select value={category} onValueChange={(v) => setCategory(v as DocumentCategory)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Textarea
                    id="description"
                    placeholder="Brief description of what this document covers..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Tags (optional)</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add a tag..."
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                    />
                    <Button type="button" variant="outline" onClick={addTag}>
                      Add
                    </Button>
                  </div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="gap-1">
                          {tag}
                          <button onClick={() => removeTag(tag)} className="hover:text-destructive">
                            ×
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Interview */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div>
                <CardTitle>LanePilot Interview</CardTitle>
                <CardDescription>
                  Chat with LanePilot to clarify what this document should cover.
                  This is optional but helps generate better prompts.
                </CardDescription>
              </div>

              <div className="border rounded-lg h-[400px] flex flex-col">
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                      <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Start a conversation with LanePilot to plan your document.</p>
                      <p className="text-sm mt-2">
                        Ask about structure, content, or what context you need.
                      </p>
                    </div>
                  ) : (
                    messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={cn(
                          'flex gap-3',
                          msg.sender === 'USER' ? 'justify-end' : 'justify-start'
                        )}
                      >
                        {msg.sender === 'AI' && (
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Bot className="h-4 w-4 text-primary" />
                          </div>
                        )}
                        <div
                          className={cn(
                            'max-w-[80%] rounded-lg p-3',
                            msg.sender === 'USER'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted'
                          )}
                        >
                          {msg.sender === 'AI' ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <p className="text-sm">{msg.content}</p>
                          )}
                        </div>
                        {msg.sender === 'USER' && (
                          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                            <User className="h-4 w-4 text-primary-foreground" />
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="border-t p-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Ask LanePilot about your document..."
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
                      disabled={isSendingMessage}
                    />
                    <Button onClick={sendMessage} disabled={isSendingMessage || !messageInput.trim()}>
                      {isSendingMessage ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Context */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <CardTitle>Select Context</CardTitle>
                <CardDescription>
                  Choose the sources LanePilot should consider when generating prompts.
                </CardDescription>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                {/* Repositories */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-green-600" />
                    Repositories
                  </Label>
                  <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                    {availableContext.repos.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No repositories connected</p>
                    ) : (
                      availableContext.repos.map((repo) => (
                        <label key={repo.id} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={selectedRepoIds.includes(repo.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedRepoIds([...selectedRepoIds, repo.id])
                              } else {
                                setSelectedRepoIds(selectedRepoIds.filter((id) => id !== repo.id))
                              }
                            }}
                          />
                          <span className="text-sm">{repo.owner}/{repo.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                {/* Services */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-purple-600" />
                    Services
                  </Label>
                  <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                    {availableContext.services.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No services connected</p>
                    ) : (
                      availableContext.services.map((service) => (
                        <label key={service.id} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={selectedServiceIds.includes(service.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedServiceIds([...selectedServiceIds, service.id])
                              } else {
                                setSelectedServiceIds(selectedServiceIds.filter((id) => id !== service.id))
                              }
                            }}
                          />
                          <span className="text-sm">{service.display_name}</span>
                          <Badge variant="outline" className="text-xs">{service.service}</Badge>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                {/* Systems */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-cyan-600" />
                    Systems
                  </Label>
                  <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                    {availableContext.systems.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No systems defined</p>
                    ) : (
                      availableContext.systems.map((system) => (
                        <label key={system.id} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={selectedSystemIds.includes(system.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedSystemIds([...selectedSystemIds, system.id])
                              } else {
                                setSelectedSystemIds(selectedSystemIds.filter((id) => id !== system.id))
                              }
                            }}
                          />
                          <span className="text-sm">{system.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                {/* Tasks */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <CheckSquare className="h-4 w-4 text-blue-600" />
                    Related Tasks
                  </Label>
                  <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                    {availableContext.tasks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No tasks available</p>
                    ) : (
                      availableContext.tasks.slice(0, 20).map((task) => (
                        <label key={task.id} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={selectedTaskIds.includes(task.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedTaskIds([...selectedTaskIds, task.id])
                              } else {
                                setSelectedTaskIds(selectedTaskIds.filter((id) => id !== task.id))
                              }
                            }}
                          />
                          <span className="font-mono text-xs">{task.key}</span>
                          <span className="text-sm truncate">{task.title}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Keywords */}
              <div className="space-y-2">
                <Label>Keywords (optional)</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Add keywords to focus the search..."
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                  />
                  <Button type="button" variant="outline" onClick={addKeyword}>
                    Add
                  </Button>
                </div>
                {keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {keywords.map((keyword) => (
                      <Badge key={keyword} variant="secondary" className="gap-1">
                        {keyword}
                        <button onClick={() => removeKeyword(keyword)} className="hover:text-destructive">
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Prompts */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle>Generated Prompts</CardTitle>
                  <CardDescription>
                    Copy these prompts to your coding agent to generate content.
                  </CardDescription>
                </div>
                <Button onClick={generatePrompts} disabled={isGenerating}>
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : generatedPrompts.length > 0 ? (
                    <>
                      <Wand2 className="h-4 w-4 mr-2" />
                      Regenerate
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4 mr-2" />
                      Generate Prompts
                    </>
                  )}
                </Button>
              </div>

              {generatedPrompts.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Wand2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Click "Generate Prompts" to create coding agent prompts</p>
                  <p className="text-sm mt-2">
                    LanePilot will analyze your selections and create targeted prompts.
                  </p>
                </div>
              ) : (
                <>
                  {outlineMarkdown && (
                    <div className="space-y-2">
                      <Label>Document Outline</Label>
                      <div className="border rounded-lg p-4 bg-muted/50">
                        <pre className="text-sm whitespace-pre-wrap font-mono">
                          {outlineMarkdown}
                        </pre>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    {generatedPrompts.map((prompt) => (
                      <Card key={prompt.id}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CardTitle className="text-base">{prompt.title}</CardTitle>
                              <Badge variant="outline">{prompt.type}</Badge>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => copyPrompt(prompt)}
                            >
                              {copiedPromptId === prompt.id ? (
                                <>
                                  <Check className="h-4 w-4 mr-2" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="h-4 w-4 mr-2" />
                                  Copy
                                </>
                              )}
                            </Button>
                          </div>
                          {prompt.targetContext && (
                            <CardDescription>{prompt.targetContext}</CardDescription>
                          )}
                        </CardHeader>
                        <CardContent>
                          <div className="bg-muted rounded-lg p-4 max-h-60 overflow-y-auto">
                            <pre className="text-sm whitespace-pre-wrap font-mono">
                              {prompt.prompt}
                            </pre>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 5: Editor */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <div>
                <CardTitle>Write Document</CardTitle>
                <CardDescription>
                  Paste the output from your coding agent and edit as needed.
                </CardDescription>
              </div>

              <div className="grid grid-cols-2 gap-4 h-[500px]">
                <div className="space-y-2">
                  <Label>Markdown Editor</Label>
                  <Textarea
                    value={documentContent}
                    onChange={(e) => setDocumentContent(e.target.value)}
                    placeholder="Paste your coding agent output here, or write your document directly..."
                    className="h-[calc(100%-2rem)] font-mono text-sm resize-none"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Preview</Label>
                  <div className="border rounded-lg p-4 h-[calc(100%-2rem)] overflow-y-auto bg-background">
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {documentContent || '*Start writing to see preview...*'}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={currentStep === 0}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <div className="flex gap-2">
          {currentStep < STEPS.length - 1 ? (
            <Button onClick={handleNext} disabled={!canProceed()}>
              Next
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={finalizeDocument}
              disabled={!canProceed() || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Create Document
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
