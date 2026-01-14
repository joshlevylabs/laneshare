'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { PRDPlanChat } from './prd-plan-chat'
import { PRDStoryList } from './prd-story-list'
import { GenerateSprintDialog } from './generate-sprint-dialog'
import {
  FileText,
  MessageSquare,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
  Play,
  CheckCircle2,
  AlertCircle
} from 'lucide-react'
import type { PRDJson, PRDUserStory, Sprint } from '@laneshare/shared'

interface PRDData {
  id: string
  title: string
  description: string | null
  raw_markdown: string | null
  prd_json: PRDJson | null
  status: 'DRAFT' | 'PLANNING' | 'READY' | 'PROCESSING' | 'COMPLETED'
  version: number
  created_at: string
  sprint_count?: number
  completed_sprint_count?: number
  story_count?: number
  completed_story_count?: number
}

interface Member {
  id: string
  email: string
  full_name: string | null
}

interface PRDInputSectionProps {
  projectId: string
  members: Member[]
  sprints: Sprint[]
  onSprintCreated?: (sprint: Sprint) => void
  onTasksCreated?: () => void
}

export function PRDInputSection({
  projectId,
  members,
  sprints,
  onSprintCreated,
  onTasksCreated,
}: PRDInputSectionProps) {
  const { toast } = useToast()
  const [isExpanded, setIsExpanded] = useState(false)
  const [mode, setMode] = useState<'paste' | 'plan'>('paste')
  const [activePrd, setActivePrd] = useState<PRDData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isConverting, setIsConverting] = useState(false)

  // Paste mode state
  const [prdTitle, setPrdTitle] = useState('')
  const [prdDescription, setPrdDescription] = useState('')
  const [prdMarkdown, setPrdMarkdown] = useState('')

  // Selected stories for sprint generation
  const [selectedStories, setSelectedStories] = useState<string[]>([])
  const [showGenerateDialog, setShowGenerateDialog] = useState(false)

  const handleCreatePRD = async () => {
    if (!prdTitle.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a PRD title',
        variant: 'destructive',
      })
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/prd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: prdTitle,
          description: prdDescription || null,
          raw_markdown: prdMarkdown || null,
          mode,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create PRD')
      }

      const prd = await response.json()
      setActivePrd(prd)
      toast({
        title: 'PRD Created',
        description: mode === 'plan' ? 'Start chatting to build your PRD!' : 'PRD saved. Ready to convert.',
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create PRD',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleConvertToJson = async () => {
    if (!activePrd) return

    setIsConverting(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/prd/${activePrd.id}/convert`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to convert PRD')
      }

      const result = await response.json()
      setActivePrd({
        ...activePrd,
        prd_json: result.prd_json,
        status: 'READY',
        version: result.prd.version,
      })
      toast({
        title: 'PRD Converted',
        description: `Generated ${result.story_count} user stories`,
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to convert PRD',
        variant: 'destructive',
      })
    } finally {
      setIsConverting(false)
    }
  }

  const handleUpdateMarkdown = async (markdown: string) => {
    if (!activePrd) return

    try {
      const response = await fetch(`/api/projects/${projectId}/prd/${activePrd.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_markdown: markdown }),
      })

      if (!response.ok) {
        throw new Error('Failed to update PRD')
      }

      setActivePrd({ ...activePrd, raw_markdown: markdown })
    } catch (error) {
      console.error('Error updating PRD:', error)
    }
  }

  const handleStorySelect = (storyId: string, selected: boolean) => {
    if (selected) {
      setSelectedStories([...selectedStories, storyId])
    } else {
      setSelectedStories(selectedStories.filter(id => id !== storyId))
    }
  }

  const handleSelectAll = () => {
    if (!activePrd?.prd_json?.userStories) return
    setSelectedStories(activePrd.prd_json.userStories.map((s: PRDUserStory) => s.id))
  }

  const handleSprintGenerated = (sprint: Sprint) => {
    setShowGenerateDialog(false)
    setSelectedStories([])
    onSprintCreated?.(sprint)
    onTasksCreated?.()
    toast({
      title: 'Sprint Created',
      description: `Sprint "${sprint.name}" created with tasks for selected stories`,
    })
  }

  const getStatusBadge = (status: PRDData['status']) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'outline'; label: string }> = {
      DRAFT: { variant: 'secondary', label: 'Draft' },
      PLANNING: { variant: 'outline', label: 'Planning' },
      READY: { variant: 'default', label: 'Ready' },
      PROCESSING: { variant: 'default', label: 'Processing' },
      COMPLETED: { variant: 'default', label: 'Completed' },
    }
    const { variant, label } = variants[status] || variants.DRAFT
    return <Badge variant={variant}>{label}</Badge>
  }

  return (
    <Card className="mb-6">
      <CardHeader
        className="cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">PRD to Sprint</CardTitle>
              <CardDescription>
                Create tasks from a Product Requirements Document
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activePrd && getStatusBadge(activePrd.status)}
            <Button variant="ghost" size="icon">
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          {!activePrd ? (
            // PRD Creation Form
            <>
              <Tabs value={mode} onValueChange={(v) => setMode(v as 'paste' | 'plan')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="paste" className="gap-2">
                    <FileText className="h-4 w-4" />
                    Paste PRD
                  </TabsTrigger>
                  <TabsTrigger value="plan" className="gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Plan Mode
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="paste" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="prd-title">PRD Title</Label>
                    <Input
                      id="prd-title"
                      placeholder="e.g., User Authentication System"
                      value={prdTitle}
                      onChange={(e) => setPrdTitle(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="prd-description">Description (optional)</Label>
                    <Input
                      id="prd-description"
                      placeholder="Brief description of the PRD"
                      value={prdDescription}
                      onChange={(e) => setPrdDescription(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="prd-markdown">PRD Content (Markdown)</Label>
                    <Textarea
                      id="prd-markdown"
                      placeholder="Paste your PRD markdown here...

# User Stories

## US-001: User Registration
As a new user, I want to register an account so that I can access the platform.

### Acceptance Criteria
- User can enter email and password
- Email validation is performed
- Password must be at least 8 characters
..."
                      value={prdMarkdown}
                      onChange={(e) => setPrdMarkdown(e.target.value)}
                      className="min-h-[200px] font-mono text-sm"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="plan" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="plan-title">PRD Title</Label>
                    <Input
                      id="plan-title"
                      placeholder="What are you building?"
                      value={prdTitle}
                      onChange={(e) => setPrdTitle(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="plan-description">Initial Description</Label>
                    <Textarea
                      id="plan-description"
                      placeholder="Describe what you want to build. The AI will help you refine this into a detailed PRD..."
                      value={prdDescription}
                      onChange={(e) => setPrdDescription(e.target.value)}
                      className="min-h-[100px]"
                    />
                  </div>
                </TabsContent>
              </Tabs>

              <Button
                onClick={handleCreatePRD}
                disabled={isLoading || !prdTitle.trim()}
                className="w-full"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : mode === 'plan' ? (
                  <MessageSquare className="h-4 w-4 mr-2" />
                ) : (
                  <FileText className="h-4 w-4 mr-2" />
                )}
                {mode === 'plan' ? 'Start Planning' : 'Create PRD'}
              </Button>
            </>
          ) : activePrd.status === 'PLANNING' ? (
            // Plan Mode Chat
            <PRDPlanChat
              projectId={projectId}
              prdId={activePrd.id}
              prdTitle={activePrd.title}
              initialDescription={activePrd.description || undefined}
              onMarkdownUpdate={handleUpdateMarkdown}
              onFinishPlanning={(markdown?: string) => {
                // Include markdown in state update to avoid race condition
                setActivePrd({
                  ...activePrd,
                  status: 'DRAFT',
                  raw_markdown: markdown || activePrd.raw_markdown,
                })
              }}
              onConvertAndGenerate={handleConvertToJson}
            />
          ) : activePrd.status === 'DRAFT' || !activePrd.prd_json ? (
            // Show markdown and convert button
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{activePrd.title}</h3>
                {getStatusBadge(activePrd.status)}
              </div>

              {activePrd.raw_markdown && (
                <div className="rounded-md border p-4 bg-muted/50">
                  <pre className="whitespace-pre-wrap text-sm font-mono max-h-[300px] overflow-y-auto">
                    {activePrd.raw_markdown}
                  </pre>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={handleConvertToJson}
                  disabled={isConverting || !activePrd.raw_markdown}
                  className="flex-1"
                >
                  {isConverting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Convert to User Stories
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setActivePrd(null)}
                >
                  Start Over
                </Button>
              </div>
            </div>
          ) : (
            // Show converted stories and sprint generation
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{activePrd.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {activePrd.prd_json.userStories.length} user stories
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(activePrd.status)}
                  <Button variant="outline" size="sm" onClick={() => setActivePrd(null)}>
                    New PRD
                  </Button>
                </div>
              </div>

              <PRDStoryList
                stories={activePrd.prd_json.userStories}
                selectedStories={selectedStories}
                onStorySelect={handleStorySelect}
                onSelectAll={handleSelectAll}
              />

              <div className="flex gap-2">
                <Button
                  onClick={() => setShowGenerateDialog(true)}
                  disabled={selectedStories.length === 0}
                  className="flex-1"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Generate Sprint ({selectedStories.length} stories)
                </Button>
                <Button
                  variant="secondary"
                  disabled
                  className="gap-2"
                  title="Coming soon: Implement with Claude Code"
                >
                  <Sparkles className="h-4 w-4" />
                  Implement
                </Button>
              </div>

              <GenerateSprintDialog
                open={showGenerateDialog}
                onOpenChange={setShowGenerateDialog}
                projectId={projectId}
                prdId={activePrd.id}
                selectedStoryIds={selectedStories}
                members={members}
                onSprintGenerated={handleSprintGenerated}
              />
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
