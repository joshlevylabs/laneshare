'use client'

import { useCallback, useMemo, useEffect, useState } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  MarkerType,
  Position,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  CheckCircle2,
  AlertCircle,
  Monitor,
  Server,
  Layers,
  Database,
  Cog,
  Cloud,
  FileText,
  HelpCircle,
} from 'lucide-react'
import type {
  SystemGraph,
  SystemNode,
  SystemNodeType,
  SystemEdgeKind,
  SystemNodeVerification,
  EvidenceConfidence,
} from '@laneshare/shared'

interface SystemFlowCanvasProps {
  graph: SystemGraph
  verifications: SystemNodeVerification[]
  isAdmin: boolean
  onNodeSelect: (nodeId: string | null) => void
  onVerifyNode: (nodeId: string, isVerified: boolean) => void
}

const NODE_TYPE_ICONS: Record<SystemNodeType, typeof Monitor> = {
  UI: Monitor,
  API: Server,
  SERVICE: Layers,
  DATA: Database,
  WORKER: Cog,
  EXTERNAL: Cloud,
  DOC: FileText,
  UNKNOWN: HelpCircle,
}

const NODE_TYPE_COLORS: Record<SystemNodeType, string> = {
  UI: '#3b82f6',
  API: '#10b981',
  SERVICE: '#8b5cf6',
  DATA: '#ef4444',
  WORKER: '#f59e0b',
  EXTERNAL: '#6b7280',
  DOC: '#06b6d4',
  UNKNOWN: '#9ca3af',
}

const EDGE_KIND_COLORS: Record<SystemEdgeKind, string> = {
  CALLS: '#3b82f6',
  READS: '#10b981',
  WRITES: '#f59e0b',
  TRIGGERS: '#8b5cf6',
  CONFIGURES: '#6b7280',
}

const CONFIDENCE_COLORS: Record<EvidenceConfidence, string> = {
  HIGH: '#10b981',
  MED: '#f59e0b',
  LOW: '#ef4444',
}

function SystemNodeComponent({
  data,
}: {
  data: {
    node: SystemNode
    isVerified: boolean
    isAdmin: boolean
    onVerify: (isVerified: boolean) => void
    onSelect: () => void
  }
}) {
  const { node, isVerified, isAdmin, onVerify, onSelect } = data
  const Icon = NODE_TYPE_ICONS[node.type]
  const color = NODE_TYPE_COLORS[node.type]
  const confidenceColor = CONFIDENCE_COLORS[node.confidence]

  return (
    <Card
      className="p-3 min-w-[180px] max-w-[250px] cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
      style={{ borderColor: color, borderWidth: 2 }}
      onClick={onSelect}
    >
      <div className="flex items-start gap-2">
        <div
          className="p-1.5 rounded"
          style={{ backgroundColor: `${color}20` }}
        >
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-medium text-sm truncate">{node.label}</span>
            {isVerified && (
              <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              {node.type}
            </Badge>
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: confidenceColor }}
              title={`${node.confidence} confidence`}
            />
          </div>
        </div>
      </div>
      {node.details && (
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
          {node.details}
        </p>
      )}
      {isAdmin && !isVerified && (
        <Button
          size="sm"
          variant="ghost"
          className="w-full mt-2 h-7 text-xs"
          onClick={(e) => {
            e.stopPropagation()
            onVerify(true)
          }}
        >
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Verify
        </Button>
      )}
      {node.refs.length > 0 && (
        <div className="mt-2 text-xs text-muted-foreground">
          {node.refs.length} evidence ref{node.refs.length !== 1 ? 's' : ''}
        </div>
      )}
    </Card>
  )
}

const nodeTypes = {
  systemNode: SystemNodeComponent,
}

export function SystemFlowCanvas({
  graph,
  verifications,
  isAdmin,
  onNodeSelect,
  onVerifyNode,
}: SystemFlowCanvasProps) {
  const verificationMap = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const v of verifications) {
      map.set(v.node_id, v.is_verified)
    }
    return map
  }, [verifications])

  // Build hierarchical layout
  const { initialNodes, initialEdges } = useMemo(() => {
    // Group nodes by type for swimlane layout
    const nodesByType = new Map<SystemNodeType, SystemNode[]>()
    for (const node of graph.nodes) {
      const nodes = nodesByType.get(node.type) || []
      nodes.push(node)
      nodesByType.set(node.type, nodes)
    }

    // Define type order for vertical layout
    const typeOrder: SystemNodeType[] = ['UI', 'API', 'SERVICE', 'WORKER', 'DATA', 'EXTERNAL', 'DOC', 'UNKNOWN']

    // Calculate positions
    const nodeWidth = 220
    const nodeHeight = 120
    const horizontalSpacing = 40
    const verticalSpacing = 60
    const swimlaneHeight = 180

    const flowNodes: Node[] = []
    let currentY = 0

    for (const type of typeOrder) {
      const nodesOfType = nodesByType.get(type) || []
      if (nodesOfType.length === 0) continue

      let currentX = 0
      for (const node of nodesOfType) {
        flowNodes.push({
          id: node.id,
          type: 'systemNode',
          position: { x: currentX, y: currentY },
          data: {
            node,
            isVerified: verificationMap.get(node.id) || false,
            isAdmin,
            onVerify: (isVerified: boolean) => onVerifyNode(node.id, isVerified),
            onSelect: () => onNodeSelect(node.id),
          },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
        })
        currentX += nodeWidth + horizontalSpacing
      }
      currentY += swimlaneHeight
    }

    // Build edges
    const flowEdges: Edge[] = graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: edge.label || edge.kind,
      type: 'smoothstep',
      animated: edge.kind === 'TRIGGERS',
      style: {
        stroke: EDGE_KIND_COLORS[edge.kind],
        strokeWidth: 2,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: EDGE_KIND_COLORS[edge.kind],
      },
      labelStyle: {
        fontSize: 10,
        fill: '#666',
      },
      labelBgStyle: {
        fill: '#fff',
        fillOpacity: 0.8,
      },
    }))

    return { initialNodes: flowNodes, initialEdges: flowEdges }
  }, [graph, verificationMap, isAdmin, onNodeSelect, onVerifyNode])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Sync nodes/edges when graph changes
  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  return (
    <div className="h-[600px] border rounded-lg bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
      >
        <Background />
        <Controls />
        <MiniMap
          nodeColor={(n) => {
            const nodeType = n.data?.node?.type as SystemNodeType | undefined
            return nodeType ? NODE_TYPE_COLORS[nodeType] : '#ccc'
          }}
        />
      </ReactFlow>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-background/90 border rounded-lg p-3 text-xs space-y-2">
        <div className="font-medium">Node Types</div>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(NODE_TYPE_COLORS).slice(0, 6).map(([type, color]) => {
            const Icon = NODE_TYPE_ICONS[type as SystemNodeType]
            return (
              <div key={type} className="flex items-center gap-1">
                <Icon className="h-3 w-3" style={{ color }} />
                <span>{type}</span>
              </div>
            )
          })}
        </div>
        <div className="font-medium pt-2 border-t">Confidence</div>
        <div className="flex gap-3">
          {Object.entries(CONFIDENCE_COLORS).map(([level, color]) => (
            <div key={level} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span>{level}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
