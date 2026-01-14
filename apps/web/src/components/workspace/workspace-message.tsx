'use client'

import { cn } from '@/lib/utils'
import { User, Bot, Wrench, CheckCircle, XCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { WorkspaceMessageData } from './workspace-view'

interface WorkspaceMessageProps {
  message: WorkspaceMessageData
}

export function WorkspaceMessage({ message }: WorkspaceMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (message.role === 'user') {
    return (
      <div className="flex gap-3 p-4">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <User className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground mb-1">You</div>
          <div className="text-sm whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    )
  }

  if (message.role === 'assistant') {
    return (
      <div className="flex gap-3 p-4 bg-muted/30">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center">
          <Bot className="h-4 w-4 text-orange-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground mb-1">Claude</div>
          <div className="text-sm whitespace-pre-wrap prose prose-sm dark:prose-invert max-w-none">
            {message.content}
          </div>
        </div>
      </div>
    )
  }

  if (message.role === 'tool_use') {
    return (
      <div className="flex gap-3 p-4 bg-blue-500/5 border-l-2 border-blue-500">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
          <Wrench className="h-4 w-4 text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <button
            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-medium mb-1 hover:underline"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Tool: {message.toolName}
          </button>
          {isExpanded && message.toolInput && (
            <pre className="text-xs bg-muted rounded p-2 overflow-x-auto">
              {JSON.stringify(message.toolInput, null, 2)}
            </pre>
          )}
        </div>
      </div>
    )
  }

  if (message.role === 'tool_result') {
    const isSuccess = !message.content.toLowerCase().includes('error')
    return (
      <div className={cn(
        'flex gap-3 p-4 border-l-2',
        isSuccess ? 'bg-green-500/5 border-green-500' : 'bg-red-500/5 border-red-500'
      )}>
        <div className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          isSuccess ? 'bg-green-500/10' : 'bg-red-500/10'
        )}>
          {isSuccess ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-red-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <button
            className={cn(
              'flex items-center gap-1 text-xs font-medium mb-1 hover:underline',
              isSuccess ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
            )}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Result
          </button>
          {isExpanded && (
            <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-[200px]">
              {message.content}
            </pre>
          )}
        </div>
      </div>
    )
  }

  if (message.role === 'system') {
    return (
      <div className="flex justify-center p-2">
        <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    )
  }

  return null
}
