'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Bot, AlertCircle } from 'lucide-react'
import { ImplementDialog } from './implement-dialog'
import type { Task } from '@laneshare/shared'
import { extractAcceptanceCriteria } from '@laneshare/shared'

interface Repo {
  id: string
  owner: string
  name: string
  default_branch: string
  sync_status?: string
  github_installation_token?: string
}

interface ImplementButtonProps {
  task: Task
  projectId: string
  repos: Repo[]
  variant?: 'default' | 'outline' | 'ghost' | 'secondary'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  className?: string
}

export function ImplementButton({
  task,
  projectId,
  repos,
  variant = 'outline',
  size = 'sm',
  className,
}: ImplementButtonProps) {
  const [showDialog, setShowDialog] = useState(false)

  // Check if there are synced repos available
  const syncedRepos = repos.filter(
    (r) => r.sync_status === 'SYNCED' && r.github_installation_token
  )

  // Extract acceptance criteria from task description
  const acceptanceCriteria = extractAcceptanceCriteria(task)

  // Determine if the button should be enabled
  const hasAcceptanceCriteria = acceptanceCriteria.length > 0
  const hasSyncedRepos = syncedRepos.length > 0
  const isEnabled = hasAcceptanceCriteria && hasSyncedRepos

  // Build tooltip message if disabled
  let tooltipMessage = 'Start AI implementation'
  if (!hasSyncedRepos) {
    tooltipMessage = 'No synced repositories available. Connect and sync a repo first.'
  } else if (!hasAcceptanceCriteria) {
    tooltipMessage = 'Add acceptance criteria to the task description first.'
  }

  const button = (
    <Button
      variant={variant}
      size={size}
      onClick={() => setShowDialog(true)}
      disabled={!isEnabled}
      className={className}
    >
      {!isEnabled ? (
        <AlertCircle className="h-4 w-4 mr-2" />
      ) : (
        <Bot className="h-4 w-4 mr-2" />
      )}
      Implement
    </Button>
  )

  return (
    <>
      {!isEnabled ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              {tooltipMessage}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        button
      )}

      <ImplementDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        task={task}
        projectId={projectId}
        repos={syncedRepos}
        acceptanceCriteria={acceptanceCriteria}
      />
    </>
  )
}
