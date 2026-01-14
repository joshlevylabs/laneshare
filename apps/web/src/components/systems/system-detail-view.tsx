'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  Boxes,
  Pencil,
} from 'lucide-react'
import { formatRelativeTime } from '@laneshare/shared'
import type {
  System,
  SystemStatus,
  SystemFlowSnapshot,
  SystemGraph,
} from '@laneshare/shared'
import { FlowchartBuilder } from './flowchart-builder'

interface SystemDetailViewProps {
  projectId: string
  system: System
  latestSnapshot?: SystemFlowSnapshot
  isAdmin: boolean
}

const STATUS_CONFIG: Record<SystemStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  DRAFT: { label: 'Draft', color: 'bg-gray-500', icon: Clock },
  ACTIVE: { label: 'Active', color: 'bg-green-500', icon: CheckCircle2 },
}

export function SystemDetailView({
  projectId,
  system,
  latestSnapshot,
  isAdmin,
}: SystemDetailViewProps) {
  const router = useRouter()

  const statusConfig = STATUS_CONFIG[system.status] || STATUS_CONFIG.DRAFT
  const graph = latestSnapshot?.graph_json as SystemGraph | undefined

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/projects/${projectId}/systems`)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Systems
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2 mt-2">
            <Boxes className="h-6 w-6" />
            {system.name}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${statusConfig.color}`} />
              {statusConfig.label}
            </Badge>
            {latestSnapshot && (
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                v{latestSnapshot.version} - Updated {formatRelativeTime(latestSnapshot.generated_at)}
              </span>
            )}
          </div>
          {system.description && (
            <p className="text-muted-foreground mt-2 max-w-2xl">
              {system.description}
            </p>
          )}
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => router.push(`/projects/${projectId}/systems/${system.id}/edit`)}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Edit Details
            </Button>
          </div>
        )}
      </div>

      {/* Flowchart Builder */}
      <Card>
        <CardHeader>
          <CardTitle>System Flowchart</CardTitle>
          <CardDescription>
            {isAdmin
              ? 'Drag components from the palette to build your system architecture flowchart.'
              : 'Visual representation of how components in this system interact.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FlowchartBuilder
            projectId={projectId}
            systemId={system.id}
            systemTitle={system.name}
            initialGraph={graph}
            isAdmin={isAdmin}
          />
        </CardContent>
      </Card>

      {/* Stats */}
      {graph && graph.nodes.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{graph.nodes.length}</div>
              <p className="text-xs text-muted-foreground">Components</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{graph.edges.length}</div>
              <p className="text-xs text-muted-foreground">Connections</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{latestSnapshot?.version || 0}</div>
              <p className="text-xs text-muted-foreground">Version</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">
                {new Set(graph.nodes.map(n => n.type)).size}
              </div>
              <p className="text-xs text-muted-foreground">Component Types</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
