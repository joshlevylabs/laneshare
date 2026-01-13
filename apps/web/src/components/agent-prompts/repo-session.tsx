'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { Loader2, Sparkles, RefreshCw, Send } from 'lucide-react'
import { PromptTurnCard } from './prompt-turn-card'
import type { AgentPromptSession, AgentPromptTurn } from '@laneshare/shared'

interface RepoSessionProps {
  session: AgentPromptSession
  repo: { id: string; owner: string; name: string }
  taskId: string
  projectId: string
  onSessionUpdate: (session: AgentPromptSession) => void
}

export function RepoSession({
  session,
  repo,
  taskId,
  projectId,
  onSessionUpdate,
}: RepoSessionProps) {
  const { toast } = useToast()
  const [isGenerating, setIsGenerating] = useState(false)
  const [additionalInstructions, setAdditionalInstructions] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const turns = (session.turns || []).sort((a, b) => a.turn_number - b.turn_number)
  const lastTurn = turns[turns.length - 1]
  const canGenerateNew =
    !lastTurn ||
    lastTurn.status === 'COMPLETED' ||
    lastTurn.status === 'NEEDS_FOLLOW_UP'

  const handleGeneratePrompt = async () => {
    if (isGenerating) return

    setIsGenerating(true)
    try {
      const response = await fetch(
        `/api/projects/${projectId}/tasks/${taskId}/agent-prompts/${session.id}/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            additionalInstructions: additionalInstructions.trim() || undefined,
          }),
        }
      )

      if (!response.ok) {
        throw new Error('Failed to generate prompt')
      }

      const newTurn = await response.json()

      // Update session with new turn
      onSessionUpdate({
        ...session,
        turns: [...(session.turns || []), newTurn],
      })

      // Clear the input
      setAdditionalInstructions('')

      toast({ title: 'Prompt generated' })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to generate prompt',
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canGenerateNew) {
        handleGeneratePrompt()
      }
    }
  }

  const handleTurnUpdate = (updatedTurn: AgentPromptTurn) => {
    onSessionUpdate({
      ...session,
      turns: (session.turns || []).map((t) =>
        t.id === updatedTurn.id ? updatedTurn : t
      ),
    })
  }

  return (
    <div className="space-y-4">
      {/* Header with repo info */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-medium text-sm">
            {repo.owner}/{repo.name}
          </h4>
          <p className="text-xs text-muted-foreground">
            {turns.length} turn{turns.length !== 1 ? 's' : ''} in this session
          </p>
        </div>
      </div>

      {/* Prompt input with generate */}
      {canGenerateNew && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Textarea
              ref={textareaRef}
              value={additionalInstructions}
              onChange={(e) => setAdditionalInstructions(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add specific instructions... (Enter to generate, Shift+Enter for new line)"
              className="min-h-[60px] max-h-[120px] resize-none text-sm"
              disabled={isGenerating}
            />
            <Button
              size="icon"
              className="shrink-0 h-[60px] w-[60px]"
              onClick={handleGeneratePrompt}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : lastTurn?.status === 'NEEDS_FOLLOW_UP' ? (
                <RefreshCw className="h-5 w-5" />
              ) : (
                <Sparkles className="h-5 w-5" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {additionalInstructions.trim()
              ? 'Your instructions will be included in the generated prompt'
              : 'Leave empty to use only the task context'}
          </p>
        </div>
      )}

      {/* Turn cards */}
      {turns.length === 0 ? (
        <div className="text-center py-4 text-sm text-muted-foreground">
          Press Enter or click the button to generate your first AI agent prompt
          for this repository.
        </div>
      ) : (
        <div className="space-y-4">
          {turns.map((turn) => (
            <PromptTurnCard
              key={turn.id}
              turn={turn}
              sessionId={session.id}
              taskId={taskId}
              projectId={projectId}
              onTurnUpdate={handleTurnUpdate}
            />
          ))}
        </div>
      )}
    </div>
  )
}
