'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Plus,
  Map,
  CheckCircle2,
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
}

interface SystemsListViewProps {
  projectId: string
  projectName: string
  systems: SystemWithCounts[]
  isAdmin: boolean
}

const STATUS_CONFIG: Record<SystemStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  DRAFT: { label: 'Draft', color: 'bg-gray-500', icon: Clock },
  ACTIVE: { label: 'Active', color: 'bg-green-500', icon: CheckCircle2 },
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
            Systems
          </h1>
          <p className="text-muted-foreground">
            Create and manage system flowcharts for {projectName}
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
              Create systems to document how different parts of your codebase work together.
              Each system can have its own flowchart showing components and their interactions.
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
            const statusConfig = STATUS_CONFIG[system.status] || STATUS_CONFIG.DRAFT

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
                      <span className="flex items-center gap-1">
                        <Map className="h-4 w-4" />
                        {system.node_count || 0} components
                      </span>
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
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
