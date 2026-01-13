'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Plus,
  Map,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronRight,
  Boxes,
} from 'lucide-react'
import { formatRelativeTime } from '@laneshare/shared'
import type { SystemStatus } from '@laneshare/shared'

interface SystemWithCounts {
  id: string
  project_id: string
  name: string
  slug: string
  description?: string
  in_scope?: string
  out_of_scope?: string
  keywords: string[]
  repo_ids: string[]
  status: SystemStatus
  created_by: string
  created_at: string
  updated_at: string
  node_count?: number
  latest_snapshot?: {
    id: string
    version: number
    generated_at: string
  }
  verified_count: number
}

interface SystemsListViewProps {
  projectId: string
  projectName: string
  systems: SystemWithCounts[]
  isAdmin: boolean
}

const STATUS_CONFIG: Record<SystemStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  DRAFT: { label: 'Draft', color: 'bg-gray-500', icon: Clock },
  NEEDS_AGENT_OUTPUT: { label: 'Needs Agent Output', color: 'bg-yellow-500', icon: AlertCircle },
  GROUNDED: { label: 'Grounded', color: 'bg-green-500', icon: CheckCircle2 },
  NEEDS_REVIEW: { label: 'Needs Review', color: 'bg-blue-500', icon: AlertCircle },
}

export function SystemsListView({
  projectId,
  projectName,
  systems,
  isAdmin,
}: SystemsListViewProps) {
  const router = useRouter()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Boxes className="h-6 w-6" />
            System Maps
          </h1>
          <p className="text-muted-foreground">
            Define and document bounded systems within {projectName}
          </p>
        </div>

        {isAdmin && (
          <Button asChild>
            <Link href={`/projects/${projectId}/systems/new`}>
              <Plus className="h-4 w-4 mr-2" />
              New System
            </Link>
          </Button>
        )}
      </div>

      {/* Systems Grid */}
      {systems.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Boxes className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Systems Yet</h3>
            <p className="text-muted-foreground mb-4">
              Systems are bounded areas of your codebase (like "Authentication" or "Billing").
              {' '}Create your first system to start documenting your architecture.
            </p>
            {isAdmin && (
              <Button asChild>
                <Link href={`/projects/${projectId}/systems/new`}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create First System
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {systems.map((system) => {
            const statusConfig = STATUS_CONFIG[system.status]
            const StatusIcon = statusConfig.icon

            return (
              <Card
                key={system.id}
                className="hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => router.push(`/projects/${projectId}/systems/${system.id}`)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{system.name}</CardTitle>
                    <Badge
                      variant="outline"
                      className="flex items-center gap-1"
                    >
                      <span className={`w-2 h-2 rounded-full ${statusConfig.color}`} />
                      {statusConfig.label}
                    </Badge>
                  </div>
                  {system.description && (
                    <CardDescription className="line-clamp-2">
                      {system.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <div className="flex items-center gap-4">
                      {system.node_count !== undefined && (
                        <span className="flex items-center gap-1">
                          <Map className="h-4 w-4" />
                          {system.node_count} nodes
                        </span>
                      )}
                      {system.verified_count > 0 && (
                        <span className="flex items-center gap-1 text-green-600">
                          <CheckCircle2 className="h-4 w-4" />
                          {system.verified_count} verified
                        </span>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4" />
                  </div>

                  {system.latest_snapshot && (
                    <div className="mt-2 pt-2 border-t text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Updated {formatRelativeTime(system.latest_snapshot.generated_at)}
                      <Badge variant="outline" className="ml-auto text-xs">
                        v{system.latest_snapshot.version}
                      </Badge>
                    </div>
                  )}

                  {system.keywords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {system.keywords.slice(0, 3).map((keyword) => (
                        <Badge key={keyword} variant="secondary" className="text-xs">
                          {keyword}
                        </Badge>
                      ))}
                      {system.keywords.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{system.keywords.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
