'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import { GitBranch, MessageSquare, CheckCircle2, Clock, Pause, Archive, Sparkles } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import type { Sidequest } from '@laneshare/shared'

interface SidequestCardProps {
  sidequest: Sidequest
  projectId: string
}

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ElementType }
> = {
  PLANNING: { label: 'Planning', variant: 'secondary', icon: MessageSquare },
  READY: { label: 'Ready', variant: 'default', icon: CheckCircle2 },
  IN_PROGRESS: { label: 'In Progress', variant: 'default', icon: Sparkles },
  PAUSED: { label: 'Paused', variant: 'outline', icon: Pause },
  COMPLETED: { label: 'Completed', variant: 'secondary', icon: CheckCircle2 },
  ARCHIVED: { label: 'Archived', variant: 'outline', icon: Archive },
}

export function SidequestCard({ sidequest, projectId }: SidequestCardProps) {
  const statusConfig = STATUS_CONFIG[sidequest.status] || STATUS_CONFIG.PLANNING
  const StatusIcon = statusConfig.icon

  const progress =
    sidequest.total_tickets > 0
      ? Math.round((sidequest.completed_tickets / sidequest.total_tickets) * 100)
      : 0

  return (
    <Link href={`/projects/${projectId}/sidequests/${sidequest.id}`}>
      <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg truncate">{sidequest.title}</CardTitle>
              <CardDescription className="line-clamp-2 mt-1">
                {sidequest.description || 'No description'}
              </CardDescription>
            </div>
            <Badge variant={statusConfig.variant} className="shrink-0">
              <StatusIcon className="h-3 w-3 mr-1" />
              {statusConfig.label}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Progress */}
          {sidequest.total_tickets > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">
                  {sidequest.completed_tickets} / {sidequest.total_tickets} tickets
                </span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {/* Repos */}
          {sidequest.repos && sidequest.repos.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <GitBranch className="h-4 w-4" />
              <span className="truncate">
                {sidequest.repos.map((r) => `${r.owner}/${r.name}`).join(', ')}
              </span>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="flex items-center gap-2">
              {sidequest.creator && (
                <Avatar className="h-6 w-6">
                  <AvatarImage src={sidequest.creator.avatar_url} />
                  <AvatarFallback className="text-xs">
                    {sidequest.creator.full_name?.[0] || sidequest.creator.email?.[0] || '?'}
                  </AvatarFallback>
                </Avatar>
              )}
              <span className="text-xs text-muted-foreground">
                {sidequest.creator?.full_name || sidequest.creator?.email}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(sidequest.created_at), { addSuffix: true })}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
