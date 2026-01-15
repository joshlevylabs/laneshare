'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, X, Cloud } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GitHubCodespace } from '@/lib/github'

export interface WorkspaceTab {
  id: string
  codespace: GitHubCodespace
  repoName: string
  repoOwner: string
}

interface WorkspaceTabsProps {
  tabs: WorkspaceTab[]
  activeTabId: string | null
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onAddTab: () => void
}

export function WorkspaceTabs({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddTab,
}: WorkspaceTabsProps) {
  return (
    <div className="flex items-center border-b bg-muted/30 overflow-x-auto">
      <div className="flex items-center min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isRunning = tab.codespace.state === 'Available'

          return (
            <div
              key={tab.id}
              className={cn(
                'group flex items-center gap-2 px-4 py-2 border-r cursor-pointer transition-colors min-w-0',
                isActive
                  ? 'bg-background border-b-2 border-b-primary'
                  : 'hover:bg-muted/50'
              )}
              onClick={() => onSelectTab(tab.id)}
            >
              {/* Status indicator */}
              <div
                className={cn(
                  'w-2 h-2 rounded-full flex-shrink-0',
                  isRunning ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'
                )}
              />

              {/* Repo name */}
              <span
                className={cn(
                  'text-sm truncate max-w-[150px]',
                  isActive ? 'font-medium' : 'text-muted-foreground'
                )}
                title={`${tab.repoOwner}/${tab.repoName}`}
              >
                {tab.repoName}
              </span>

              {/* Codespace state badge */}
              {!isRunning && (
                <Badge variant="outline" className="text-[10px] px-1 py-0">
                  {tab.codespace.state}
                </Badge>
              )}

              {/* Close button */}
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity',
                  isActive && 'opacity-50'
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )
        })}
      </div>

      {/* Add tab button */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-3 flex-shrink-0"
        onClick={onAddTab}
      >
        <Plus className="h-4 w-4 mr-1" />
        Add Codespace
      </Button>

      {/* Empty state helper */}
      {tabs.length === 0 && (
        <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
          <Cloud className="h-4 w-4" />
          <span>No Codespaces connected. Click "Add Codespace" to get started.</span>
        </div>
      )}
    </div>
  )
}
