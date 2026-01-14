'use client'

import { Monitor, Server, Layers, Database, Cog, Cloud, GripVertical } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NODE_TYPE_CONFIG, type SystemNodeType } from '@laneshare/shared'

const NODE_ICONS: Record<SystemNodeType, typeof Monitor> = {
  UI: Monitor,
  API: Server,
  SERVICE: Layers,
  DATA: Database,
  WORKER: Cog,
  EXTERNAL: Cloud,
}

const NODE_TYPES: SystemNodeType[] = ['UI', 'API', 'SERVICE', 'DATA', 'WORKER', 'EXTERNAL']

interface NodePaletteProps {
  className?: string
}

export function NodePalette({ className }: NodePaletteProps) {
  const handleDragStart = (event: React.DragEvent, nodeType: SystemNodeType) => {
    event.dataTransfer.setData('application/reactflow-type', nodeType)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Components</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {NODE_TYPES.map((nodeType) => {
          const config = NODE_TYPE_CONFIG[nodeType]
          const Icon = NODE_ICONS[nodeType]

          return (
            <div
              key={nodeType}
              draggable
              onDragStart={(e) => handleDragStart(e, nodeType)}
              className="
                flex items-center gap-3 p-2 rounded-lg border
                cursor-grab active:cursor-grabbing
                hover:bg-accent hover:border-accent-foreground/20
                transition-colors
              "
            >
              <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div
                className="p-1.5 rounded flex-shrink-0"
                style={{ backgroundColor: `${config.color}20` }}
              >
                <Icon className="h-4 w-4" style={{ color: config.color }} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{config.label}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {config.description}
                </div>
              </div>
            </div>
          )
        })}

        <div className="pt-3 border-t">
          <p className="text-xs text-muted-foreground">
            Drag components onto the canvas to build your flowchart.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
