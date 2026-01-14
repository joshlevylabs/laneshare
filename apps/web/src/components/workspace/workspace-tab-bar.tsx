'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Plus, X, Terminal } from 'lucide-react'
import type { WorkspaceSessionData } from './workspace-view'

interface WorkspaceTabBarProps {
  sessions: WorkspaceSessionData[]
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onCloseSession: (id: string) => void
  onNewSession: () => void
}

const STATUS_COLORS = {
  CONNECTING: 'bg-yellow-500',
  CONNECTED: 'bg-green-500',
  DISCONNECTED: 'bg-gray-400',
  ERROR: 'bg-red-500',
}

export function WorkspaceTabBar({
  sessions,
  activeSessionId,
  onSelectSession,
  onCloseSession,
  onNewSession,
}: WorkspaceTabBarProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-2 border-b bg-muted/30 overflow-x-auto">
      {sessions.map((session) => (
        <div
          key={session.id}
          className={cn(
            'group flex items-center gap-2 px-3 py-1.5 rounded-md text-sm cursor-pointer transition-colors',
            activeSessionId === session.id
              ? 'bg-background shadow-sm border'
              : 'hover:bg-muted'
          )}
          onClick={() => onSelectSession(session.id)}
        >
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-xs text-muted-foreground">
            {session.task?.key || 'Session'}
          </span>
          <span className="truncate max-w-[120px]">
            {session.task?.title || 'Untitled'}
          </span>
          <div
            className={cn(
              'w-2 h-2 rounded-full',
              STATUS_COLORS[session.status]
            )}
            title={session.status}
          />
          <button
            className="opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20 rounded p-0.5 transition-opacity"
            onClick={(e) => {
              e.stopPropagation()
              onCloseSession(session.id)
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 shrink-0"
        onClick={onNewSession}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  )
}
