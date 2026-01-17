'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Wand2,
  ClipboardPaste,
  MessageSquare,
  GitCompare,
  Copy,
  Loader2,
  Send,
  FileCode,
  ChevronRight,
  Check,
  X,
  AlertCircle,
  CheckCircle,
  Pencil,
  Bot,
} from 'lucide-react'
import { generateVerificationPrompt, generateImprovementPrompt } from '@laneshare/shared'
import type { DocEvidence } from '@laneshare/shared'

interface DocumentReviewData {
  id: string
  title: string
  category: string
  slug: string
  markdown: string
  original_markdown?: string
  evidence_json?: DocEvidence[]
  verification_score?: number
  needs_review?: boolean
  reviewed?: boolean
  reviewed_at?: string
  user_edited?: boolean
  user_edited_at?: string
  source_repo?: {
    id: string
    owner: string
    name: string
  }
}

interface DocumentReviewToolsProps {
  projectId: string
  document: DocumentReviewData
  onUpdate?: () => void
  onMarkdownChange?: (markdown: string) => void
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
  investigation_result?: 'feedback_valid' | 'feedback_invalid' | 'partially_valid'
  findings?: string
  updated_markdown?: string
  evidence?: DocEvidence[]
}

export function DocumentReviewTools({
  projectId,
  document,
  onUpdate,
  onMarkdownChange,
}: DocumentReviewToolsProps) {
  const { toast } = useToast()

  // Dialog states
  const [showPromptDialog, setShowPromptDialog] = useState(false)
  const [showPasteDialog, setShowPasteDialog] = useState(false)
  const [showChatDialog, setShowChatDialog] = useState(false)
  const [showCompareDialog, setShowCompareDialog] = useState(false)

  // Processing states
  const [generatedPrompt, setGeneratedPrompt] = useState('')
  const [pastedResult, setPastedResult] = useState('')
  const [parsedResult, setParsedResult] = useState<AgentResult | null>(null)
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [chatInput, setChatInput] = useState('')
  const [isProcessingPaste, setIsProcessingPaste] = useState(false)
  const [isSendingChat, setIsSendingChat] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isMarkingReviewed, setIsMarkingReviewed] = useState(false)
  const [evidenceOpen, setEvidenceOpen] = useState(false)

  const evidence = document.evidence_json || []
  const repoName = document.source_repo?.name || 'unknown'
  const repoOwner = document.source_repo?.owner || 'unknown'

  // Generate verification prompt for coding agent
  const handleGeneratePrompt = () => {
    const prompt = generateVerificationPrompt({
      repoOwner,
      repoName,
      pageTitle: document.title,
      pageCategory: document.category,
      pageSlug: document.slug,
      markdown: document.markdown,
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
      const response = await fetch(`/api/projects/${projectId}/documents/${document.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown: correctedMarkdown,
          user_edited: true,
        }),
      })

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
      onUpdate?.()
      onMarkdownChange?.(correctedMarkdown)
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

  // Mark as reviewed
  const handleMarkReviewed = async (reviewed: boolean) => {
    setIsMarkingReviewed(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/documents/${document.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewed }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update')
      }

      toast({
        title: reviewed ? 'Marked as Reviewed' : 'Review Status Cleared',
        description: reviewed
          ? 'This document has been verified as correct.'
          : 'This document is no longer marked as reviewed.',
      })

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

  // AI Chat for document improvement
  const handleSendChatMessage = async () => {
    if (!chatInput.trim()) return

    const userMessage = chatInput.trim()
    setChatInput('')
    setChatMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setIsSendingChat(true)

    try {
      const improvementPrompt = generateImprovementPrompt(
        {
          repoOwner,
          repoName,
          pageTitle: document.title,
          pageCategory: document.category,
          pageSlug: document.slug,
          markdown: document.markdown,
          evidence: evidence.length > 0 ? evidence : undefined,
        },
        userMessage
      )

      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `I've generated an improvement prompt based on your feedback. Copy this to Claude Code to investigate:\n\n\`\`\`\n${improvementPrompt.slice(0, 500)}...\n\`\`\`\n\nOnce Claude Code responds, use the "Paste Agent Result" button to apply the corrections.`,
        },
      ])
    } catch (error) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error generating the improvement prompt.',
        },
      ])
    } finally {
      setIsSendingChat(false)
    }
  }

  const hasOriginalDiff = document.original_markdown && document.original_markdown !== document.markdown

  return (
    <>
      {/* Review Status Bar */}
      <div className="flex items-center gap-2 flex-wrap mb-4 p-3 bg-muted/50 rounded-lg">
        <Badge
          variant="outline"
          className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800"
        >
          <Bot className="h-3 w-3 mr-1" />
          Auto-generated
        </Badge>

        {document.needs_review && !document.reviewed && (
          <Badge
            variant="outline"
            className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800"
          >
            <AlertCircle className="h-3 w-3 mr-1" />
            Needs Review
          </Badge>
        )}

        {document.reviewed && (
          <Badge
            variant="outline"
            className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800"
          >
            <CheckCircle className="h-3 w-3 mr-1" />
            Reviewed
          </Badge>
        )}

        {document.user_edited && (
          <Badge
            variant="outline"
            className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800"
          >
            <Pencil className="h-3 w-3 mr-1" />
            Edited
          </Badge>
        )}

        {document.verification_score !== undefined && document.verification_score > 0 && (
          <Badge
            variant="outline"
            className={
              document.verification_score >= 80
                ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400'
                : document.verification_score >= 50
                ? 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400'
                : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400'
            }
          >
            Score: {document.verification_score}%
          </Badge>
        )}

        <div className="flex-1" />

        {/* Action buttons */}
        <Button variant="outline" size="sm" onClick={handleGeneratePrompt} title="Generate a verification prompt for Claude Code">
          <Wand2 className="h-4 w-4 mr-2" />
          Verify with Agent
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowPasteDialog(true)} title="Paste results from Claude Code">
          <ClipboardPaste className="h-4 w-4 mr-2" />
          Paste Result
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowChatDialog(true)} title="Chat with AI to improve this document">
          <MessageSquare className="h-4 w-4 mr-2" />
          AI Chat
        </Button>
        {hasOriginalDiff && (
          <Button variant="outline" size="sm" onClick={() => setShowCompareDialog(true)} title="Compare original vs current">
            <GitCompare className="h-4 w-4 mr-2" />
            Compare
          </Button>
        )}

        {document.reviewed ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleMarkReviewed(false)}
            disabled={isMarkingReviewed}
            className="text-muted-foreground"
          >
            {isMarkingReviewed ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <X className="h-4 w-4 mr-2" />}
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
            {isMarkingReviewed ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
            Mark as Reviewed
          </Button>
        )}
      </div>

      {/* Evidence Section */}
      {evidence.length > 0 && (
        <Collapsible open={evidenceOpen} onOpenChange={setEvidenceOpen} className="mb-4">
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

      {/* Generate Prompt Dialog */}
      <Dialog open={showPromptDialog} onOpenChange={setShowPromptDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Verification Prompt for Claude Code</DialogTitle>
            <DialogDescription>
              Copy this prompt and paste it into Claude Code (or another coding agent) running in your repository. The agent will
              verify the documentation against the actual code.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <pre className="bg-muted p-4 rounded text-xs overflow-auto max-h-[50vh]">{generatedPrompt}</pre>
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
              <TabsTrigger value="review" disabled={!parsedResult}>
                Review Changes
              </TabsTrigger>
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
                  {isProcessingPaste ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
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
                        <Badge
                          className={
                            parsedResult.verification_result === 'accurate'
                              ? 'bg-green-600'
                              : parsedResult.verification_result === 'mostly_wrong'
                              ? 'bg-red-600'
                              : 'bg-yellow-600'
                          }
                        >
                          {parsedResult.verification_result || parsedResult.investigation_result || 'Unknown'}
                        </Badge>
                        {parsedResult.confidence_score !== undefined && (
                          <span className="ml-2 text-sm text-muted-foreground">{parsedResult.confidence_score}% confidence</span>
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
                      <CardContent className="py-2 text-sm">{parsedResult.summary || parsedResult.findings}</CardContent>
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
                                <Badge variant="outline" className="text-xs">
                                  {issue.type}
                                </Badge>
                                {issue.location && <span className="text-xs text-muted-foreground">{issue.location}</span>}
                              </div>
                              <p className="text-sm mt-1">{issue.description}</p>
                              {issue.suggested_fix && <p className="text-xs text-green-600 mt-1">Fix: {issue.suggested_fix}</p>}
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
            <Button
              variant="outline"
              onClick={() => {
                setShowPasteDialog(false)
                setPastedResult('')
                setParsedResult(null)
              }}
            >
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
                <div
                  key={i}
                  className={`p-3 rounded ${msg.role === 'user' ? 'bg-blue-100 dark:bg-blue-900/30 ml-8' : 'bg-muted mr-8'}`}
                >
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
                  <pre className="text-xs whitespace-pre-wrap">{document.original_markdown || 'No original saved'}</pre>
                </div>
              </div>
              <div>
                <h3 className="font-semibold mb-2 text-sm">Current</h3>
                <div className="bg-muted p-4 rounded max-h-[50vh] overflow-auto">
                  <pre className="text-xs whitespace-pre-wrap">{document.markdown}</pre>
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
    </>
  )
}
