'use client'

import { useMemo, useCallback, useState } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  Position,
  MarkerType,
  Panel,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  GitBranch,
  Monitor,
  Server,
  Database,
  Cloud,
  Lock,
  HardDrive,
  Package,
  Box,
} from 'lucide-react'
import type { ArchitectureGraph, ArchNode, NodeType } from '@laneshare/shared'

interface SystemMapTabProps {
  graph: ArchitectureGraph
  onNodeClick: (nodeId: string, label: string) => void
  onEdgeClick: (edgeId: string, label: string) => void
}

// Node type icons and colors
const nodeConfig: Record<NodeType, { icon: typeof GitBranch; color: string; bgColor: string }> = {
  repo: { icon: GitBranch, color: '#6366f1', bgColor: '#eef2ff' },
  app: { icon: Box, color: '#8b5cf6', bgColor: '#f5f3ff' },
  screen: { icon: Monitor, color: '#3b82f6', bgColor: '#eff6ff' },
  endpoint: { icon: Server, color: '#10b981', bgColor: '#ecfdf5' },
  worker: { icon: Server, color: '#f59e0b', bgColor: '#fffbeb' },
  table: { icon: Database, color: '#ef4444', bgColor: '#fef2f2' },
  function: { icon: Database, color: '#f97316', bgColor: '#fff7ed' },
  storage: { icon: HardDrive, color: '#14b8a6', bgColor: '#f0fdfa' },
  auth: { icon: Lock, color: '#8b5cf6', bgColor: '#f5f3ff' },
  external_service: { icon: Cloud, color: '#6b7280', bgColor: '#f9fafb' },
  deployment: { icon: Cloud, color: '#06b6d4', bgColor: '#ecfeff' },
  package: { icon: Package, color: '#a855f7', bgColor: '#faf5ff' },
}

// Custom node component
function ArchNode({ data }: { data: { node: ArchNode; onClick: () => void } }) {
  const config = nodeConfig[data.node.type]
  const Icon = config.icon

  return (
    <div
      className="px-3 py-2 rounded-lg border-2 shadow-sm cursor-pointer hover:shadow-md transition-shadow min-w-[120px]"
      style={{
        backgroundColor: config.bgColor,
        borderColor: config.color,
      }}
      onClick={data.onClick}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color: config.color }} />
        <span className="text-sm font-medium truncate max-w-[150px]" title={data.node.label}>
          {data.node.label}
        </span>
      </div>
      <div className="text-xs text-muted-foreground mt-1 capitalize">
        {data.node.type.replace('_', ' ')}
      </div>
    </div>
  )
}

const nodeTypes = {
  archNode: ArchNode,
}

export function SystemMapTab({ graph, onNodeClick, onEdgeClick }: SystemMapTabProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<Set<NodeType>>(new Set())

  // Convert graph to React Flow format
  const { initialNodes, initialEdges } = useMemo(() => {
    // Filter nodes by search and type
    const filteredNodes = graph.nodes.filter((node) => {
      if (searchQuery && !node.label.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false
      }
      if (selectedTypes.size > 0 && !selectedTypes.has(node.type)) {
        return false
      }
      return true
    })

    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id))

    // Auto-layout nodes in a hierarchical manner
    const typeOrder: NodeType[] = [
      'deployment',
      'repo',
      'app',
      'screen',
      'endpoint',
      'table',
      'function',
      'auth',
      'storage',
      'external_service',
      'package',
      'worker',
    ]

    const nodesByType = new Map<NodeType, ArchNode[]>()
    for (const node of filteredNodes) {
      if (!nodesByType.has(node.type)) {
        nodesByType.set(node.type, [])
      }
      nodesByType.get(node.type)!.push(node)
    }

    const nodes: Node[] = []
    let currentY = 0
    const xSpacing = 220
    const ySpacing = 120

    for (const type of typeOrder) {
      const typeNodes = nodesByType.get(type) || []
      if (typeNodes.length === 0) continue

      let currentX = 0
      const maxPerRow = 5
      let rowCount = 0

      for (let i = 0; i < typeNodes.length; i++) {
        const archNode = typeNodes[i]
        nodes.push({
          id: archNode.id,
          type: 'archNode',
          position: { x: currentX, y: currentY + (rowCount * ySpacing) },
          data: {
            node: archNode,
            onClick: () => onNodeClick(archNode.id, archNode.label),
          },
        })

        currentX += xSpacing
        if ((i + 1) % maxPerRow === 0) {
          currentX = 0
          rowCount++
        }
      }

      currentY += (rowCount + 1) * ySpacing + 40
    }

    // Create edges
    const edges: Edge[] = graph.edges
      .filter((edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        animated: edge.type === 'calls' || edge.type === 'calls_external',
        style: {
          stroke: getEdgeColor(edge.confidence),
          strokeWidth: edge.confidence === 'high' ? 2 : 1,
          opacity: edge.confidence === 'low' ? 0.5 : 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: getEdgeColor(edge.confidence),
        },
        label: edge.label,
        labelStyle: { fontSize: 10 },
        data: { edge },
      }))

    return { initialNodes: nodes, initialEdges: edges }
  }, [graph, searchQuery, selectedTypes, onNodeClick])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const onEdgeClickHandler = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      onEdgeClick(edge.id, edge.label as string || edge.id)
    },
    [onEdgeClick]
  )

  const toggleType = useCallback((type: NodeType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }, [])

  // Get unique types in the graph
  const availableTypes = useMemo(() => {
    const types = new Set<NodeType>()
    for (const node of graph.nodes) {
      types.add(node.type)
    }
    return Array.from(types)
  }, [graph.nodes])

  return (
    <div className="h-[600px] border rounded-lg overflow-hidden bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeClick={onEdgeClickHandler}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
      >
        <Background color="#e5e7eb" gap={20} />
        <Controls />
        <MiniMap
          nodeColor={(node: Node) => nodeConfig[(node.data?.node as ArchNode)?.type]?.color || '#888'}
          maskColor="rgba(0, 0, 0, 0.1)"
        />

        {/* Search and Filter Panel */}
        <Panel position="top-left" className="bg-background/95 backdrop-blur-sm p-3 rounded-lg border shadow-sm">
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search nodes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 w-64"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {availableTypes.map((type) => {
                const config = nodeConfig[type]
                const isSelected = selectedTypes.has(type)
                const count = graph.nodes.filter((n) => n.type === type).length

                return (
                  <Badge
                    key={type}
                    variant={isSelected || selectedTypes.size === 0 ? 'default' : 'outline'}
                    className="cursor-pointer text-xs capitalize"
                    style={{
                      backgroundColor: isSelected || selectedTypes.size === 0 ? config.color : undefined,
                      borderColor: config.color,
                      color: isSelected || selectedTypes.size === 0 ? 'white' : config.color,
                    }}
                    onClick={() => toggleType(type)}
                  >
                    {type.replace('_', ' ')} ({count})
                  </Badge>
                )
              })}
            </div>
          </div>
        </Panel>

        {/* Legend Panel */}
        <Panel position="bottom-right" className="bg-background/95 backdrop-blur-sm p-3 rounded-lg border shadow-sm">
          <div className="text-xs space-y-1">
            <div className="font-medium mb-2">Edge Confidence</div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5" style={{ backgroundColor: getEdgeColor('high') }} />
              <span>High</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5" style={{ backgroundColor: getEdgeColor('medium') }} />
              <span>Medium</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5 opacity-50" style={{ backgroundColor: getEdgeColor('low') }} />
              <span>Low</span>
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}

function getEdgeColor(confidence: string): string {
  switch (confidence) {
    case 'high':
      return '#10b981'
    case 'medium':
      return '#f59e0b'
    case 'low':
      return '#9ca3af'
    default:
      return '#6b7280'
  }
}
