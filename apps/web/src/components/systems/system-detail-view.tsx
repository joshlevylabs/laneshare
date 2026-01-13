'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft,
  Map,
  FileText,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Copy,
  Check,
  Play,
  Boxes,
} from 'lucide-react'
import { formatRelativeTime } from '@laneshare/shared'
import type {
  System,
  SystemStatus,
  SystemArtifact,
  SystemEvidence,
  SystemFlowSnapshot,
  SystemNodeVerification,
  SystemGraph,
  ArtifactKind,
  AgentTool,
} from '@laneshare/shared'
import { SystemFlowCanvas } from './system-flow-canvas'
import { SystemEvidencePanel } from './system-evidence-panel'

interface SystemDetailViewProps {
  projectId: string
  projectName: string
  system: System
  latestSnapshot?: SystemFlowSnapshot
  artifacts: SystemArtifact[]
  evidence: SystemEvidence[]
  verifications: SystemNodeVerification[]
  repos: Array<{ id: string; owner: string; name: string }>
  isAdmin: boolean
}

const STATUS_CONFIG: Record<SystemStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  DRAFT: { label: 'Draft', color: 'bg-gray-500', icon: Clock },
  NEEDS_AGENT_OUTPUT: { label: 'Needs Agent Output', color: 'bg-yellow-500', icon: AlertCircle },
  GROUNDED: { label: 'Grounded', color: 'bg-green-500', icon: CheckCircle2 },
  NEEDS_REVIEW: { label: 'Needs Review', color: 'bg-blue-500', icon: AlertCircle },
}

export function SystemDetailView({
  projectId,
  projectName,
  system,
  latestSnapshot,
  artifacts,
  evidence,
  verifications,
  repos,
  isAdmin,
}: SystemDetailViewProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<string>('canvas')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isProcessingAgent, setIsProcessingAgent] = useState(false)
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false)
  const [generatedDoc, setGeneratedDoc] = useState<{ slug: string; markdown: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [agentPrompt, setAgentPrompt] = useState<string | null>(null)
  const [agentOutputDialog, setAgentOutputDialog] = useState(false)
  const [agentTool, setAgentTool] = useState<AgentTool>('cursor')
  const [agentOutput, setAgentOutput] = useState('')
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const statusConfig = STATUS_CONFIG[system.status]
  const graph = latestSnapshot?.graph_json as SystemGraph | undefined

  // Get agent prompt artifact
  const promptArtifact = artifacts.find((a) => a.kind === 'AGENT_PROMPT')
  const displayPrompt = agentPrompt || promptArtifact?.content

  const handleAnalyze = useCallback(async () => {
    setIsAnalyzing(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}/systems/${system.id}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          include_repos: true,
          include_docs: true,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze system')
      }

      setAgentPrompt(data.agentPrompt)
      router.refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Analysis failed'
      setError(message)
    } finally {
      setIsAnalyzing(false)
    }
  }, [projectId, system.id, router])

  const handleCopyPrompt = useCallback(async () => {
    if (displayPrompt) {
      await navigator.clipboard.writeText(displayPrompt)
      setCopiedPrompt(true)
      setTimeout(() => setCopiedPrompt(false), 2000)
    }
  }, [displayPrompt])

  const handleSubmitAgentOutput = useCallback(async () => {
    if (!agentOutput.trim()) {
      setError('Please paste the agent output')
      return
    }

    setIsProcessingAgent(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}/systems/${system.id}/agent-output`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentTool,
          output: agentOutput,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process agent output')
      }

      setAgentOutputDialog(false)
      setAgentOutput('')
      router.refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Processing failed'
      setError(message)
    } finally {
      setIsProcessingAgent(false)
    }
  }, [projectId, system.id, agentTool, agentOutput, router])

  const handleVerifyNode = useCallback(async (nodeId: string, isVerified: boolean) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/systems/${system.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, isVerified }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to verify node')
      }

      router.refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Verification failed'
      setError(message)
    }
  }, [projectId, system.id, router])

  const handleGenerateDoc = useCallback(async () => {
    setIsGeneratingDoc(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}/systems/${system.id}/generate-doc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate documentation')
      }

      setGeneratedDoc({ slug: data.slug, markdown: data.markdown })
      router.refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Doc generation failed'
      setError(message)
    } finally {
      setIsGeneratingDoc(false)
    }
  }, [projectId, system.id, router])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/projects/${projectId}/systems`)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Systems
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2 mt-2">
            <Boxes className="h-6 w-6" />
            {system.name}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${statusConfig.color}`} />
              {statusConfig.label}
            </Badge>
            {latestSnapshot && (
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                v{latestSnapshot.version} • Updated {formatRelativeTime(latestSnapshot.generated_at)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              {system.status === 'DRAFT' && (
                <Button onClick={handleAnalyze} disabled={isAnalyzing}>
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4 mr-2" />
                      Analyze System
                    </>
                  )}
                </Button>
              )}
              {(system.status === 'NEEDS_AGENT_OUTPUT' || displayPrompt) && (
                <Button variant="outline" onClick={() => setAgentOutputDialog(true)}>
                  <Play className="h-4 w-4 mr-2" />
                  Paste Agent Output
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="py-3 text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {/* Agent Prompt Section - Show when available */}
      {displayPrompt && system.status !== 'GROUNDED' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Agent Context Prompt</span>
              <Button variant="outline" size="sm" onClick={handleCopyPrompt}>
                {copiedPrompt ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Prompt
                  </>
                )}
              </Button>
            </CardTitle>
            <CardDescription>
              Copy this prompt and paste it into your coding agent (Cursor, Claude Code, etc.)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-64">
              {displayPrompt}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="canvas" className="flex items-center gap-2">
            <Map className="h-4 w-4" />
            Flow Canvas
          </TabsTrigger>
          <TabsTrigger value="evidence" className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            Evidence
            {evidence.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {evidence.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="docs" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Documentation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="canvas" className="mt-4">
          {graph && graph.nodes.length > 0 ? (
            <SystemFlowCanvas
              graph={graph}
              verifications={verifications}
              isAdmin={isAdmin}
              onNodeSelect={setSelectedNodeId}
              onVerifyNode={handleVerifyNode}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Map className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Flow Diagram Yet</h3>
                <p className="text-muted-foreground mb-4">
                  {system.status === 'DRAFT'
                    ? 'Analyze the system to discover components and generate an agent prompt.'
                    : system.status === 'NEEDS_AGENT_OUTPUT'
                      ? 'Use the agent prompt above to explore your codebase, then paste the output here.'
                      : 'Process agent output to generate the system flow diagram.'}
                </p>
                {isAdmin && system.status === 'DRAFT' && (
                  <Button onClick={handleAnalyze} disabled={isAnalyzing}>
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4 mr-2" />
                        Analyze System
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="evidence" className="mt-4">
          <SystemEvidencePanel
            evidence={evidence}
            selectedNodeId={selectedNodeId}
            graph={graph}
          />
        </TabsContent>

        <TabsContent value="docs" className="mt-4">
          {generatedDoc ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Generated Documentation</CardTitle>
                  <CardDescription>
                    Saved to <code className="text-xs bg-muted px-1 rounded">docs/{generatedDoc.slug}</code>
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a href={`/projects/${projectId}/docs`}>
                    View All Docs
                  </a>
                </Button>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg overflow-auto max-h-[500px]">
                    {generatedDoc.markdown}
                  </pre>
                </div>
              </CardContent>
            </Card>
          ) : graph && graph.nodes.length > 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Generate Documentation</h3>
                <p className="text-muted-foreground mb-4">
                  Generate comprehensive documentation from the system flow diagram.
                </p>
                {isAdmin && (
                  <Button onClick={handleGenerateDoc} disabled={isGeneratingDoc}>
                    {isGeneratingDoc ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <FileText className="h-4 w-4 mr-2" />
                        Generate Documentation
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Documentation</h3>
                <p className="text-muted-foreground">
                  Complete the flow diagram first to generate documentation.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Agent Output Dialog */}
      <Dialog open={agentOutputDialog} onOpenChange={setAgentOutputDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Paste Agent Output</DialogTitle>
            <DialogDescription>
              Paste the output from your coding agent below. This will be analyzed to extract
              system components and relationships.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Agent Tool</label>
              <Select value={agentTool} onValueChange={(v) => setAgentTool(v as AgentTool)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cursor">Cursor</SelectItem>
                  <SelectItem value="claude-code">Claude Code</SelectItem>
                  <SelectItem value="copilot">GitHub Copilot</SelectItem>
                  <SelectItem value="aider">Aider</SelectItem>
                  <SelectItem value="windsurf">Windsurf</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Agent Output</label>
              <Textarea
                placeholder="Paste the agent's response here..."
                value={agentOutput}
                onChange={(e) => setAgentOutput(e.target.value)}
                rows={15}
                className="font-mono text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAgentOutputDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitAgentOutput} disabled={isProcessingAgent || !agentOutput.trim()}>
              {isProcessingAgent ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Process Output
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
