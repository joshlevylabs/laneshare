'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  MessageSquare,
  Send,
  Clock,
  User,
  GitBranch,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle,
  XCircle,
} from 'lucide-react'
import type { CrossSessionRequestEvent } from '@/hooks/use-orchestrator-events'

interface CrossSessionPanelProps {
  pendingRequests: CrossSessionRequestEvent[]
  onRespond: (
    requestId: string,
    response: string,
    responseData?: Record<string, any>
  ) => Promise<{ success: boolean; error?: string }>
  isConnected: boolean
}

export function CrossSessionPanel({
  pendingRequests,
  onRespond,
  isConnected,
}: CrossSessionPanelProps) {
  const [isExpanded, setIsExpanded] = useState(pendingRequests.length > 0)

  if (pendingRequests.length === 0 && !isExpanded) {
    return null
  }

  return (
    <Card className="border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-blue-500" />
                <CardTitle className="text-sm">Cross-Session Requests</CardTitle>
                {pendingRequests.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                  >
                    {pendingRequests.length} pending
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    isConnected
                      ? 'border-green-500 text-green-600'
                      : 'border-red-500 text-red-600'
                  }`}
                >
                  {isConnected ? 'Connected' : 'Disconnected'}
                </Badge>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </div>
            </div>
            <CardDescription className="text-xs">
              Other sessions can send queries to you through the orchestrator
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0">
            {pendingRequests.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                No pending requests
              </div>
            ) : (
              <div className="space-y-3">
                {pendingRequests.map((request) => (
                  <CrossSessionRequestItem
                    key={request.requestId}
                    request={request}
                    onRespond={onRespond}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

interface CrossSessionRequestItemProps {
  request: CrossSessionRequestEvent
  onRespond: (
    requestId: string,
    response: string,
    responseData?: Record<string, any>
  ) => Promise<{ success: boolean; error?: string }>
}

function CrossSessionRequestItem({
  request,
  onRespond,
}: CrossSessionRequestItemProps) {
  const [response, setResponse] = useState('')
  const [isResponding, setIsResponding] = useState(false)
  const [responseStatus, setResponseStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleRespond = async () => {
    if (!response.trim()) return

    setIsResponding(true)
    setError(null)

    const result = await onRespond(request.requestId, response.trim())

    setIsResponding(false)

    if (result.success) {
      setResponseStatus('success')
    } else {
      setResponseStatus('error')
      setError(result.error || 'Failed to send response')
    }
  }

  const isExpired = new Date(request.expiresAt) < new Date()
  const timeRemaining = Math.max(
    0,
    Math.floor((new Date(request.expiresAt).getTime() - Date.now()) / 1000)
  )

  if (responseStatus === 'success') {
    return (
      <div className="rounded-md border border-green-500/30 bg-green-50 dark:bg-green-950/20 p-3">
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
          <CheckCircle className="h-4 w-4" />
          <span className="text-sm">Response sent successfully</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`rounded-md border p-3 ${
        isExpired
          ? 'border-gray-300 bg-gray-50 dark:bg-gray-900/30 opacity-60'
          : 'border-blue-500/30 bg-white dark:bg-gray-900/50'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{request.sourceSession.userName}</span>
          {request.sourceSession.repoName && (
            <>
              <span className="text-muted-foreground">from</span>
              <Badge variant="outline" className="text-xs">
                <GitBranch className="h-3 w-3 mr-1" />
                {request.sourceSession.repoName.split('/')[1]}
              </Badge>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {isExpired ? (
            <span className="text-red-500">Expired</span>
          ) : (
            <span>{timeRemaining}s left</span>
          )}
        </div>
      </div>

      {/* Query */}
      <div className="bg-muted/50 rounded p-2 mb-3">
        <div className="text-xs text-muted-foreground mb-1">
          {request.messageType === 'query'
            ? 'Query'
            : request.messageType === 'command'
            ? 'Command'
            : 'Sync Request'}
        </div>
        <div className="text-sm">{request.query}</div>
      </div>

      {/* Response input */}
      {!isExpired && (
        <div className="space-y-2">
          <Textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Type your response..."
            className="min-h-[60px] text-sm"
            disabled={isResponding}
          />

          {error && (
            <div className="flex items-center gap-1 text-xs text-red-500">
              <XCircle className="h-3 w-3" />
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleRespond}
              disabled={!response.trim() || isResponding}
            >
              {isResponding ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-1" />
                  Send Response
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {isExpired && (
        <div className="text-xs text-muted-foreground text-center">
          This request has expired
        </div>
      )}
    </div>
  )
}
