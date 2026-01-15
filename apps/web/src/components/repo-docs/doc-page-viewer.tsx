'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  Edit,
  Save,
  X,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  FileCode,
  Loader2,
  CheckCircle,
  Check,
  Copy,
  ClipboardPaste,
  MessageSquare,
  GitCompare,
  Wand2,
  Send,
} from 'lucide-react'
import type { RepoDocPage, DocEvidence } from '@laneshare/shared'
import { generateVerificationPrompt, generateImprovementPrompt } from '@laneshare/shared'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

interface DocPageViewerProps {
  projectId: string
  repoId: string
  repoOwner?: string
  repoName?: string
  pageId: string
  onUpdate?: () => void
}

interface PageWithNavigation {
  page: RepoDocPage
  navigation: {
    prev: { id: string; slug: string; title: string } | null
    next: { id: string; slug: string; title: string } | null
  }
}

interface AgentResult {
  verification_result?: 'accurate' | 'needs_correction' | 'mostly_wrong'
  confidence_score?: number
  issues_found?: Array<{
    type: string
    description: string
    location?: string
    suggested_fix?: string
  }>
  corrected_markdown?: string
  new_evidence?: DocEvidence[]
  summary?: string
  // For improvement results
  investigation_result?: 'feedback_valid' | 'feedback_invalid' | 'partially_valid'
  findings?: string
  updated_markdown?: string
  evidence?: DocEvidence[]
}

export function DocPageViewer({ projectId, repoId, repoOwner = '', repoName = '', pageId, onUpdate }: DocPageViewerProps) {
  const { toast } = useToast()
  const [data, setData] = useState<PageWithNavigation | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editedMarkdown, setEditedMarkdown] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [isMarkingReviewed, setIsMarkingReviewed] = useState(false)

  // New states for agent features
  const [showPromptDialog, setShowPromptDialog] = useState(false)
  const [showPasteDialog, setShowPasteDialog] = useState(false)
  const [showChatDialog, setShowChatDialog] = useState(false)
  const [showCompareDialog, setShowCompareDialog] = useState(false)
  const [generatedPrompt, setGeneratedPrompt] = useState('')
  const [pastedResult, setPastedResult] = useState('')
  const [parsedResult, setParsedResult] = useState<AgentResult | null>(null)
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [chatInput, setChatInput] = useState('')
  const [isProcessingPaste, setIsProcessingPaste] = useState(false)
  const [isSendingChat, setIsSendingChat] = useState(false)

  useEffect(() => {
    fetchPage()
  }, [pageId])

  const fetchPage = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/repos/${repoId}/docs/pages/${pageId}`
      )
      if (response.ok) {
        const pageData = await response.json()
        setData(pageData)
        setEditedMarkdown(pageData.page.markdown)
      }
    } catch (error) {
      console.error('Failed to fetch page:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!data) return

    setIsSaving(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/repos/${repoId}/docs/pages/${pageId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: editedMarkdown }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save')
      }

      toast({
        title: 'Page Saved',
        description: 'Your changes have been saved.',
      })

      setIsEditing(false)
      fetchPage()
      onUpdate?.()
    } catch (error) {
      toast({
        title: 'Save Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setEditedMarkdown(data?.page.markdown || '')
    setIsEditing(false)
  }

  const handleMarkReviewed = async (reviewed: boolean) => {
    if (!data) return

    setIsMarkingReviewed(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/repos/${repoId}/docs/pages/${pageId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewed }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update')
      }

      toast({
        title: reviewed ? 'Marked as Reviewed' : 'Review Status Cleared',
        description: reviewed
          ? 'This page has been verified as correct.'
          : 'This page is no longer marked as reviewed.',
      })

      fetchPage()
      onUpdate?.()
    } catch (error) {
      toast({
        title: 'Update Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setIsMarkingReviewed(false)
    }
  }

  // Generate verification prompt for coding agent
  const handleGeneratePrompt = () => {
    if (!data) return

    const { page } = data
    const evidence = page.evidence_json as DocEvidence[]

    const prompt = generateVerificationPrompt({
      repoOwner: repoOwner || 'unknown',
      repoName: repoName || 'unknown',
      pageTitle: page.title,
      pageCategory: page.category,
      pageSlug: page.slug,
      markdown: page.markdown,
      evidence: evidence.length > 0 ? evidence : undefined,
    })

    setGeneratedPrompt(prompt)
    setShowPromptDialog(true)
  }

  // Copy prompt to clipboard
  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(generatedPrompt)
      toast({
        title: 'Copied!',
        description: 'Prompt copied to clipboard. Paste it into Claude Code.',
      })
    } catch (error) {
      toast({
        title: 'Copy Failed',
        description: 'Could not copy to clipboard',
        variant: 'destructive',
      })
    }
  }

  // Parse pasted agent result
  const handleParsePastedResult = () => {
    setIsProcessingPaste(true)
    try {
      // Try to extract JSON from the pasted content
      const jsonMatch = pastedResult.match(/```json\s*([\s\S]*?)\s*```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : pastedResult

      const parsed = JSON.parse(jsonStr) as AgentResult
      setParsedResult(parsed)

      toast({
        title: 'Result Parsed',
        description: `Found ${parsed.issues_found?.length || 0} issues. Verification: ${parsed.verification_result || parsed.investigation_result || 'unknown'}`,
      })
    } catch (error) {
      toast({
        title: 'Parse Error',
        description: 'Could not parse JSON from pasted content. Make sure you copied the full response.',
        variant: 'destructive',
      })
      setParsedResult(null)
    } finally {
      setIsProcessingPaste(false)
    }
  }

  // Apply corrected markdown from agent result
  const handleApplyCorrection = async () => {
    if (!parsedResult) return

    const correctedMarkdown = parsedResult.corrected_markdown || parsedResult.updated_markdown
    if (!correctedMarkdown) {
      toast({
        title: 'No Corrections',
        description: 'The agent result does not contain corrected markdown.',
        variant: 'destructive',
      })
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/repos/${repoId}/docs/pages/${pageId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: correctedMarkdown }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save')
      }

      toast({
        title: 'Corrections Applied',
        description: 'The corrected documentation has been saved.',
      })

      setShowPasteDialog(false)
      setPastedResult('')
      setParsedResult(null)
      fetchPage()
      onUpdate?.()
    } catch (error) {
      toast({
        title: 'Save Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  // AI Chat for document improvement
  const handleSendChatMessage = async () => {
    if (!chatInput.trim() || !data) return

    const userMessage = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setIsSendingChat(true)

    try {
      // Generate improvement prompt
      const { page } = data
      const evidence = page.evidence_json as DocEvidence[]

      const improvementPrompt = generateImprovementPrompt(
        {
          repoOwner: repoOwner || 'unknown',
          repoName: repoName || 'unknown',
          pageTitle: page.title,
          pageCategory: page.category,
          pageSlug: page.slug,
          markdown: page.markdown,
          evidence: evidence.length > 0 ? evidence : undefined,
        },
        userMessage
      )

      // For now, show the prompt that would be sent to Claude
      // In a full implementation, this would call an AI endpoint
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `I've generated an improvement prompt based on your feedback. Copy this to Claude Code to investigate:\n\n\`\`\`\n${improvementPrompt.slice(0, 500)}...\n\`\`\`\n\nOnce Claude Code responds, use the "Paste Agent Result" button to apply the corrections.`
      }])
    } catch (error) {
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error generating the improvement prompt.'
      }])
    } finally {
      setIsSendingChat(false)
    }
  }

  // Show comparison between original and current
  const handleShowComparison = () => {
    if (!data) return
    setShowCompareDialog(true)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Page not found
      </div>
    )
  }

  const { page, navigation } = data
  const evidence = page.evidence_json as DocEvidence[]

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline">{page.category}</Badge>
          <span className="text-muted-foreground text-sm">{page.slug}</span>
          {page.reviewed && (
            <Badge variant="secondary" className="gap-1 bg-green-600">
              <CheckCircle className="h-3 w-3" />
              Reviewed
            </Badge>
          )}
          {page.needs_review && !page.reviewed && (
            <Badge variant="secondary" className="gap-1 bg-yellow-600">
              <AlertCircle className="h-3 w-3" />
              Needs Review
            </Badge>
          )}
          {page.user_edited && (
            <Badge variant="secondary" className="gap-1 bg-blue-600">
              <Edit className="h-3 w-3" />
              User Edited
            </Badge>
          )}
          {page.verification_score !== undefined && page.verification_score > 0 && (
            <Badge variant="outline" className={page.verification_score >= 70 ? 'text-green-600' : page.verification_score >= 40 ? 'text-yellow-600' : 'text-red-600'}>
              {page.verification_score}% verified
            </Badge>
          )}
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{page.title}</h1>
          <div className="flex gap-2 flex-wrap">
            {isEditing ? (
              <>
                <Button variant="outline" onClick={handleCancelEdit} disabled={isSaving}>
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save
                </Button>
              </>
            ) : (
              <>
                {/* Agent Tools */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGeneratePrompt}
                  title="Generate a verification prompt for Claude Code"
                >
                  <Wand2 className="h-4 w-4 mr-2" />
                  Verify with Agent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPasteDialog(true)}
                  title="Paste results from Claude Code"
                >
                  <ClipboardPaste className="h-4 w-4 mr-2" />
                  Paste Result
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowChatDialog(true)}
                  title="Chat with AI to improve this document"
                >
                  <MessageSquare className="h-4 w-4 mr-2" />
                  AI Chat
                </Button>
                {page.original_markdown && page.original_markdown !== page.markdown && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleShowComparison}
                    title="Compare original vs current"
                  >
                    <GitCompare className="h-4 w-4 mr-2" />
                    Compare
                  </Button>
                )}

                {/* Review & Edit */}
                {page.reviewed ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleMarkReviewed(false)}
                    disabled={isMarkingReviewed}
                    className="text-muted-foreground"
                  >
                    {isMarkingReviewed ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <X className="h-4 w-4 mr-2" />
                    )}
                    Unmark Reviewed
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleMarkReviewed(true)}
                    disabled={isMarkingReviewed}
                    className="text-green-600 border-green-600 hover:bg-green-600/10"
                  >
                    {isMarkingReviewed ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4 mr-2" />
                    )}
                    Mark as Reviewed
                  </Button>
                )}
                <Button variant="outline" onClick={() => setIsEditing(true)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {isEditing ? (
        <div className="space-y-4">
          <Textarea
            value={editedMarkdown}
            onChange={(e) => setEditedMarkdown(e.target.value)}
            className="min-h-[500px] font-mono text-sm"
          />
          <div className="text-sm text-muted-foreground">
            Markdown supported. Changes will be tracked as user edits.
          </div>
        </div>
      ) : (
        <div className="prose prose-slate dark:prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ node, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '')
                const inline = !match && !className
                return !inline && match ? (
                  <SyntaxHighlighter
                    style={oneDark}
                    language={match[1]}
                    PreTag="div"
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                ) : (
                  <code className={className} {...props}>
                    {children}
                  </code>
                )
              },
            }}
          >
            {page.markdown}
          </ReactMarkdown>
        </div>
      )}

      {/* Evidence Section */}
      {evidence.length > 0 && !isEditing && (
        <Collapsible open={evidenceOpen} onOpenChange={setEvidenceOpen} className="mt-8">
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              <div className="flex items-center gap-2">
                <FileCode className="h-4 w-4" />
                Evidence ({evidence.length} sources)
              </div>
              <ChevronRight className={`h-4 w-4 transition-transform ${evidenceOpen ? 'rotate-90' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 space-y-4">
            {evidence.map((item, index) => (
              <Card key={index}>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm font-mono flex items-center gap-2">
                    <FileCode className="h-4 w-4" />
                    {item.file_path}
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-3">
                  <p className="text-sm text-muted-foreground mb-2">{item.reason}</p>
                  <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                    <code>{item.excerpt}</code>
                  </pre>
                </CardContent>
              </Card>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8 pt-8 border-t">
        {navigation.prev ? (
          <Button
            variant="ghost"
            onClick={() => {
              window.location.href = `?page=${navigation.prev!.id}`
            }}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            {navigation.prev.title}
          </Button>
        ) : (
          <div />
        )}
        {navigation.next && (
          <Button
            variant="ghost"
            onClick={() => {
              window.location.href = `?page=${navigation.next!.id}`
            }}
          >
            {navigation.next.title}
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        )}
      </div>

      {/* Metadata */}
      <div className="mt-8 pt-4 border-t text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>
            Created: {new Date(page.created_at).toLocaleString()}
          </span>
          <span>
            Updated: {new Date(page.updated_at).toLocaleString()}
          </span>
        </div>
        {page.user_edited_at && (
          <div className="mt-1">
            Last user edit: {new Date(page.user_edited_at).toLocaleString()}
          </div>
        )}
        {page.reviewed_at && (
          <div className="mt-1 text-green-600">
            Reviewed: {new Date(page.reviewed_at).toLocaleString()}
          </div>
        )}
      </div>

      {/* Generate Prompt Dialog */}
      <Dialog open={showPromptDialog} onOpenChange={setShowPromptDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Verification Prompt for Claude Code</DialogTitle>
            <DialogDescription>
              Copy this prompt and paste it into Claude Code (or another coding agent) running in your repository.
              The agent will verify the documentation against the actual code.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <pre className="bg-muted p-4 rounded text-xs overflow-auto max-h-[50vh]">
              {generatedPrompt}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPromptDialog(false)}>
              Close
            </Button>
            <Button onClick={handleCopyPrompt}>
              <Copy className="h-4 w-4 mr-2" />
              Copy to Clipboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Paste Result Dialog */}
      <Dialog open={showPasteDialog} onOpenChange={setShowPasteDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Paste Agent Result</DialogTitle>
            <DialogDescription>
              Paste the JSON response from Claude Code. The system will parse it and let you apply corrections.
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="paste" className="flex-1 overflow-hidden flex flex-col">
            <TabsList>
              <TabsTrigger value="paste">Paste Result</TabsTrigger>
              <TabsTrigger value="review" disabled={!parsedResult}>Review Changes</TabsTrigger>
            </TabsList>
            <TabsContent value="paste" className="flex-1 overflow-auto">
              <div className="space-y-4">
                <Textarea
                  placeholder="Paste the JSON response from Claude Code here..."
                  value={pastedResult}
                  onChange={(e) => setPastedResult(e.target.value)}
                  className="min-h-[300px] font-mono text-xs"
                />
                <Button onClick={handleParsePastedResult} disabled={!pastedResult || isProcessingPaste}>
                  {isProcessingPaste ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : null}
                  Parse Result
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="review" className="flex-1 overflow-auto">
              {parsedResult && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Card>
                      <CardHeader className="py-2">
                        <CardTitle className="text-sm">Verification Result</CardTitle>
                      </CardHeader>
                      <CardContent className="py-2">
                        <Badge className={
                          parsedResult.verification_result === 'accurate' ? 'bg-green-600' :
                          parsedResult.verification_result === 'mostly_wrong' ? 'bg-red-600' : 'bg-yellow-600'
                        }>
                          {parsedResult.verification_result || parsedResult.investigation_result || 'Unknown'}
                        </Badge>
                        {parsedResult.confidence_score !== undefined && (
                          <span className="ml-2 text-sm text-muted-foreground">
                            {parsedResult.confidence_score}% confidence
                          </span>
                        )}
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="py-2">
                        <CardTitle className="text-sm">Issues Found</CardTitle>
                      </CardHeader>
                      <CardContent className="py-2">
                        <span className="text-2xl font-bold">{parsedResult.issues_found?.length || 0}</span>
                      </CardContent>
                    </Card>
                  </div>

                  {parsedResult.summary && (
                    <Card>
                      <CardHeader className="py-2">
                        <CardTitle className="text-sm">Summary</CardTitle>
                      </CardHeader>
                      <CardContent className="py-2 text-sm">
                        {parsedResult.summary || parsedResult.findings}
                      </CardContent>
                    </Card>
                  )}

                  {parsedResult.issues_found && parsedResult.issues_found.length > 0 && (
                    <Card>
                      <CardHeader className="py-2">
                        <CardTitle className="text-sm">Issues</CardTitle>
                      </CardHeader>
                      <CardContent className="py-2">
                        <div className="space-y-2">
                          {parsedResult.issues_found.map((issue, i) => (
                            <div key={i} className="border-l-2 border-yellow-500 pl-3 py-1">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">{issue.type}</Badge>
                                {issue.location && <span className="text-xs text-muted-foreground">{issue.location}</span>}
                              </div>
                              <p className="text-sm mt-1">{issue.description}</p>
                              {issue.suggested_fix && (
                                <p className="text-xs text-green-600 mt-1">Fix: {issue.suggested_fix}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {(parsedResult.corrected_markdown || parsedResult.updated_markdown) && (
                    <Card>
                      <CardHeader className="py-2">
                        <CardTitle className="text-sm">Corrected Content Preview</CardTitle>
                      </CardHeader>
                      <CardContent className="py-2">
                        <pre className="bg-muted p-3 rounded text-xs max-h-[200px] overflow-auto">
                          {(parsedResult.corrected_markdown || parsedResult.updated_markdown || '').slice(0, 1000)}...
                        </pre>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowPasteDialog(false)
              setPastedResult('')
              setParsedResult(null)
            }}>
              Cancel
            </Button>
            {parsedResult && (parsedResult.corrected_markdown || parsedResult.updated_markdown) && (
              <Button onClick={handleApplyCorrection} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Apply Corrections
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Chat Dialog */}
      <Dialog open={showChatDialog} onOpenChange={setShowChatDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>AI Document Improvement</DialogTitle>
            <DialogDescription>
              Describe what's wrong or what you'd like to improve. The AI will generate a prompt for Claude Code.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto space-y-4 min-h-[300px]">
            {chatMessages.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Start a conversation to improve this document.</p>
                <p className="text-xs mt-2">Examples:</p>
                <ul className="text-xs mt-1 space-y-1">
                  <li>"This feature description seems wrong - we actually use WebSockets not REST"</li>
                  <li>"Can you check if the authentication flow is documented correctly?"</li>
                  <li>"Add more details about the database schema"</li>
                </ul>
              </div>
            ) : (
              chatMessages.map((msg, i) => (
                <div key={i} className={`p-3 rounded ${msg.role === 'user' ? 'bg-blue-100 dark:bg-blue-900/30 ml-8' : 'bg-muted mr-8'}`}>
                  <p className="text-xs text-muted-foreground mb-1">{msg.role === 'user' ? 'You' : 'Assistant'}</p>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2 pt-4 border-t">
            <Input
              placeholder="Describe what needs to be improved..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendChatMessage()}
              disabled={isSendingChat}
            />
            <Button onClick={handleSendChatMessage} disabled={!chatInput.trim() || isSendingChat}>
              {isSendingChat ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Compare Dialog */}
      <Dialog open={showCompareDialog} onOpenChange={setShowCompareDialog}>
        <DialogContent className="max-w-6xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Compare: Original vs Current</DialogTitle>
            <DialogDescription>
              Side-by-side comparison of the auto-generated content versus the current (edited) content.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold mb-2 text-sm">Original (Auto-Generated)</h3>
                <div className="bg-muted p-4 rounded max-h-[50vh] overflow-auto">
                  <pre className="text-xs whitespace-pre-wrap">{page.original_markdown || 'No original saved'}</pre>
                </div>
              </div>
              <div>
                <h3 className="font-semibold mb-2 text-sm">Current</h3>
                <div className="bg-muted p-4 rounded max-h-[50vh] overflow-auto">
                  <pre className="text-xs whitespace-pre-wrap">{page.markdown}</pre>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCompareDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
