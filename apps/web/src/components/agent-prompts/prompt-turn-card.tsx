'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
  Loader2,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
} from 'lucide-react'
import { AnalysisResults } from './analysis-results'
import type { AgentPromptTurn, AgentTool } from '@laneshare/shared'

interface PromptTurnCardProps {
  turn: AgentPromptTurn
  sessionId: string
  taskId: string
  projectId: string
  onTurnUpdate: (turn: AgentPromptTurn) => void
}

const AGENT_TOOLS: { value: AgentTool; label: string }[] = [
  { value: 'cursor', label: 'Cursor' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'copilot', label: 'GitHub Copilot' },
  { value: 'aider', label: 'Aider' },
  { value: 'windsurf', label: 'Windsurf' },
  { value: 'other', label: 'Other' },
]

const STATUS_CONFIG = {
  PENDING_RESPONSE: {
    label: 'Waiting for Response',
    Icon: Clock,
    color: 'bg-yellow-100 text-yellow-800',
  },
  ANALYZING: {
    label: 'Analyzing...',
    Icon: Loader2,
    color: 'bg-blue-100 text-blue-800',
  },
  COMPLETED: {
    label: 'Completed',
    Icon: CheckCircle2,
    color: 'bg-green-100 text-green-800',
  },
  NEEDS_FOLLOW_UP: {
    label: 'Needs Follow-up',
    Icon: RefreshCw,
    color: 'bg-orange-100 text-orange-800',
  },
}

export function PromptTurnCard({
  turn,
  sessionId,
  taskId,
  projectId,
  onTurnUpdate,
}: PromptTurnCardProps) {
  const { toast } = useToast()
  const [isPromptOpen, setIsPromptOpen] = useState(turn.status === 'PENDING_RESPONSE')
  const [isCopied, setIsCopied] = useState(false)
  const [agentResponse, setAgentResponse] = useState('')
  const [agentTool, setAgentTool] = useState<AgentTool>('cursor')
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const statusConfig = STATUS_CONFIG[turn.status]
  const StatusIcon = statusConfig.Icon

  const handleCopyPrompt = async () => {
    await navigator.clipboard.writeText(turn.prompt_content)
    setIsCopied(true)
    toast({ title: 'Prompt copied to clipboard' })
    setTimeout(() => setIsCopied(false), 2000)
  }

  const handleAnalyze = async () => {
    if (!agentResponse.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please paste the AI agent response first',
      })
      return
    }

    setIsAnalyzing(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/tasks/${taskId}/agent-prompts/${sessionId}/turns/${turn.id}/analyze`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentResponse: agentResponse.trim(),
            agentTool,
          }),
        }
      )

      if (!response.ok) {
        throw new Error('Failed to analyze response')
      }

      const result = await response.json()
      onTurnUpdate(result.turn)
      toast({ title: 'Response analyzed' })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to analyze response',
      })
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Turn {turn.turn_number}</span>
          <Badge variant="secondary" className={cn('text-xs', statusConfig.color)}>
            <StatusIcon
              className={cn('h-3 w-3 mr-1', turn.status === 'ANALYZING' && 'animate-spin')}
            />
            {statusConfig.label}
          </Badge>
        </div>
      </div>

      {/* Prompt section */}
      <Collapsible open={isPromptOpen} onOpenChange={setIsPromptOpen}>
        <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/30 transition-colors">
          <span className="text-sm font-medium">Generated Prompt</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handleCopyPrompt()
              }}
            >
              {isCopied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
            {isPromptOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4">
            <pre className="text-xs bg-muted rounded-lg p-4 overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap">
              {turn.prompt_content}
            </pre>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Response input section */}
      {turn.status === 'PENDING_RESPONSE' && (
        <div className="px-4 pb-4 space-y-3 border-t">
          <div className="pt-3">
            <Label className="text-sm">Paste AI Agent Response</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Copy the prompt above, use it in your AI coding agent, then paste the
              response here.
            </p>
            <Textarea
              value={agentResponse}
              onChange={(e) => setAgentResponse(e.target.value)}
              placeholder="Paste the AI agent's response here..."
              rows={6}
              className="font-mono text-xs"
            />
          </div>

          <div className="flex items-end gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Agent Used</Label>
              <Select
                value={agentTool}
                onValueChange={(v) => setAgentTool(v as AgentTool)}
              >
                <SelectTrigger className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_TOOLS.map((tool) => (
                    <SelectItem key={tool.value} value={tool.value}>
                      {tool.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !agentResponse.trim()}
            >
              {isAnalyzing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Analyze Response
            </Button>
          </div>
        </div>
      )}

      {/* Analysis results section */}
      {turn.analysis_result && (
        <div className="border-t">
          <AnalysisResults
            turn={turn}
            sessionId={sessionId}
            taskId={taskId}
            projectId={projectId}
            onTurnUpdate={onTurnUpdate}
          />
        </div>
      )}

      {/* Show pasted response if available */}
      {turn.agent_response && turn.status !== 'PENDING_RESPONSE' && (
        <Collapsible>
          <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/30 transition-colors border-t">
            <span className="text-sm font-medium">Agent Response</span>
            <div className="flex items-center gap-2">
              {turn.agent_tool && (
                <Badge variant="outline" className="text-xs">
                  {AGENT_TOOLS.find((t) => t.value === turn.agent_tool)?.label ||
                    turn.agent_tool}
                </Badge>
              )}
              <ChevronRight className="h-4 w-4" />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4">
              <pre className="text-xs bg-muted rounded-lg p-4 overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap">
                {turn.agent_response}
              </pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
