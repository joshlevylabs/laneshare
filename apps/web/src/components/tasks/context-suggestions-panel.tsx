'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import {
  Loader2,
  Check,
  X,
  Sparkles,
  Server,
  Database,
  GitBranch,
  FileText,
  Ticket,
  RefreshCw,
  BookOpen,
} from 'lucide-react'
import type { ContextAISuggestion, ContextSuggestionType } from '@laneshare/shared'

interface ContextSuggestionsPanelProps {
  projectId: string
  taskId: string
  onLinkContext: (type: ContextSuggestionType, id: string) => Promise<void>
}

const TYPE_ICONS: Record<ContextSuggestionType, React.ElementType> = {
  service: Server,
  asset: Database,
  repo: GitBranch,
  doc: FileText,
  feature: Sparkles,
  ticket: Ticket,
  repo_doc: BookOpen,
}

const TYPE_COLORS: Record<ContextSuggestionType, string> = {
  service: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  asset: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  repo: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  doc: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  feature: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  ticket: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
  repo_doc: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
}

export function ContextSuggestionsPanel({
  projectId,
  taskId,
  onLinkContext,
}: ContextSuggestionsPanelProps) {
  const { toast } = useToast()
  const [suggestions, setSuggestions] = useState<ContextAISuggestion[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasFetched, setHasFetched] = useState(false)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [linkingIds, setLinkingIds] = useState<Set<string>>(new Set())

  const fetchSuggestions = async () => {
    setIsLoading(true)
    setDismissedIds(new Set())
    try {
      const response = await fetch(
        `/api/projects/${projectId}/tasks/${taskId}/context-ai/suggest`,
        { method: 'POST' }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to get suggestions')
      }

      const data = await response.json()
      setSuggestions(data.suggestions || [])
      setHasFetched(true)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to get suggestions',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleApprove = async (suggestion: ContextAISuggestion) => {
    setLinkingIds((prev) => new Set([...Array.from(prev), suggestion.id]))
    try {
      await onLinkContext(suggestion.type, suggestion.id)
      // Remove from suggestions after successful link
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id))
      toast({ title: 'Context linked successfully' })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to link context',
      })
    } finally {
      setLinkingIds((prev) => {
        const next = new Set(prev)
        next.delete(suggestion.id)
        return next
      })
    }
  }

  const handleDismiss = (suggestionId: string) => {
    setDismissedIds((prev) => new Set([...Array.from(prev), suggestionId]))
  }

  const visibleSuggestions = suggestions.filter((s) => !dismissedIds.has(s.id))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">AI Suggestions</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchSuggestions}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : hasFetched ? (
            <>
              <RefreshCw className="h-3 w-3 mr-1" />
              Refresh
            </>
          ) : (
            'Get Suggestions'
          )}
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Analyzing task context...
          </span>
        </div>
      )}

      {!isLoading && hasFetched && visibleSuggestions.length === 0 && (
        <div className="text-center py-6 text-sm text-muted-foreground">
          {suggestions.length === 0
            ? 'No suggestions found for this task'
            : 'All suggestions have been processed'}
        </div>
      )}

      {!isLoading && visibleSuggestions.length > 0 && (
        <div className="space-y-2">
          {visibleSuggestions.map((suggestion) => {
            const Icon = TYPE_ICONS[suggestion.type] || FileText
            const isLinking = linkingIds.has(suggestion.id)
            const confidencePercent = Math.round((suggestion.confidence || 0.5) * 100)

            return (
              <div
                key={suggestion.id}
                className="flex items-start gap-3 p-3 border rounded-lg bg-muted/30"
              >
                <div className="shrink-0 mt-0.5">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">
                      {suggestion.name}
                    </span>
                    <Badge
                      variant="secondary"
                      className={`text-xs ${TYPE_COLORS[suggestion.type]}`}
                    >
                      {suggestion.type}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {confidencePercent}%
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {suggestion.reason}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-100"
                    onClick={() => handleApprove(suggestion)}
                    disabled={isLinking}
                  >
                    {isLinking ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDismiss(suggestion.id)}
                    disabled={isLinking}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!hasFetched && !isLoading && (
        <div className="text-center py-6">
          <p className="text-sm text-muted-foreground mb-3">
            Let AI analyze this task and suggest relevant context items
          </p>
          <Button onClick={fetchSuggestions} size="sm">
            <Sparkles className="h-4 w-4 mr-2" />
            Get AI Suggestions
          </Button>
        </div>
      )}
    </div>
  )
}
