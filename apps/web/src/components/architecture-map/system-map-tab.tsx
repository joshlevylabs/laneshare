'use client'

import { useMemo, useCallback, useState, useEffect } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Panel,
  ConnectionLineType,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Search,
  GitBranch,
  Monitor,
  Server,
  Database,
  Cloud,
  Lock,
  HardDrive,
  Package,
  Box,
  Layers,
} from 'lucide-react'
import type { ArchitectureGraph, ArchNode, NodeType, ArchEdge } from '@laneshare/shared'

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
  worker: { icon: Layers, color: '#f59e0b', bgColor: '#fffbeb' },
  table: { icon: Database, color: '#ef4444', bgColor: '#fef2f2' },
  function: { icon: Database, color: '#f97316', bgColor: '#fff7ed' },
  storage: { icon: HardDrive, color: '#14b8a6', bgColor: '#f0fdfa' },
  auth: { icon: Lock, color: '#8b5cf6', bgColor: '#f5f3ff' },
  external_service: { icon: Cloud, color: '#6b7280', bgColor: '#f9fafb' },
  deployment: { icon: Cloud, color: '#06b6d4', bgColor: '#ecfeff' },
  package: { icon: Package, color: '#a855f7', bgColor: '#faf5ff' },
}

// Custom node component
function ArchNodeComponent({ data }: { data: { node: ArchNode; onClick: () => void } }) {
  const config = nodeConfig[data.node.type]
  const Icon = config.icon

  return (
    <div
      className="px-3 py-2 rounded-lg border-2 shadow-sm cursor-pointer hover:shadow-md transition-shadow min-w-[100px] max-w-[180px]"
      style={{
        backgroundColor: config.bgColor,
        borderColor: config.color,
      }}
      onClick={data.onClick}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 flex-shrink-0" style={{ color: config.color }} />
        <span className="text-sm font-medium truncate" title={data.node.label}>
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
  archNode: ArchNodeComponent,
}

// Hierarchical layout algorithm
function computeHierarchicalLayout(
  nodes: ArchNode[],
  edges: ArchEdge[],
  onNodeClick: (nodeId: string, label: string) => void
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] }
  }

  // Build adjacency maps for hierarchy
  const childrenMap = new Map<string, string[]>() // parent -> children
  const parentMap = new Map<string, string>() // child -> parent

  // Build parent-child relationships from "contains" edges
  for (const edge of edges) {
    if (edge.type === 'contains') {
      if (!childrenMap.has(edge.source)) {
        childrenMap.set(edge.source, [])
      }
      childrenMap.get(edge.source)!.push(edge.target)
      parentMap.set(edge.target, edge.source)
    }
  }

  // Find root nodes (nodes with no parent)
  const nodeIds = new Set(nodes.map(n => n.id))
  const rootNodes = nodes.filter(n => !parentMap.has(n.id))

  // Calculate depth for each node using BFS
  const depthMap = new Map<string, number>()
  const queue: { id: string; depth: number }[] = []

  // Start with root nodes at depth 0
  for (const root of rootNodes) {
    queue.push({ id: root.id, depth: 0 })
    depthMap.set(root.id, 0)
  }

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!
    const children = childrenMap.get(id) || []
    for (const childId of children) {
      if (!depthMap.has(childId) && nodeIds.has(childId)) {
        depthMap.set(childId, depth + 1)
        queue.push({ id: childId, depth: depth + 1 })
      }
    }
  }

  // Assign depth based on node type for nodes without parent
  const typeDepth: Record<NodeType, number> = {
    deployment: 0,
    repo: 1,
    app: 2,
    screen: 3,
    endpoint: 3,
    worker: 3,
    table: 4,
    function: 4,
    storage: 4,
    auth: 4,
    external_service: 5,
    package: 5,
  }

  for (const node of nodes) {
    if (!depthMap.has(node.id)) {
      depthMap.set(node.id, typeDepth[node.type] || 2)
    }
  }

  // Group nodes by depth and parent
  const nodesByDepth = new Map<number, ArchNode[]>()
  for (const node of nodes) {
    const depth = depthMap.get(node.id) || 0
    if (!nodesByDepth.has(depth)) {
      nodesByDepth.set(depth, [])
    }
    nodesByDepth.get(depth)!.push(node)
  }

  // Sort depths
  const depths = Array.from(nodesByDepth.keys()).sort((a, b) => a - b)

  // Layout parameters
  const xSpacing = 200
  const ySpacing = 150
  const startX = 50
  const startY = 50

  // Position nodes
  const positionedNodes: Node[] = []
  const nodePositions = new Map<string, { x: number; y: number }>()

  for (const depth of depths) {
    const depthNodes = nodesByDepth.get(depth) || []

    // Group by parent for better organization
    const byParent = new Map<string | undefined, ArchNode[]>()
    for (const node of depthNodes) {
      const parent = parentMap.get(node.id)
      if (!byParent.has(parent)) {
        byParent.set(parent, [])
      }
      byParent.get(parent)!.push(node)
    }

    // Calculate positions for each parent group
    let currentX = startX
    const y = startY + depth * ySpacing

    for (const [parentId, groupNodes] of Array.from(byParent.entries())) {
      // Sort nodes by label within group
      groupNodes.sort((a, b) => a.label.localeCompare(b.label))

      // If there's a parent, try to center children under it
      if (parentId && nodePositions.has(parentId)) {
        const parentPos = nodePositions.get(parentId)!
        const groupWidth = (groupNodes.length - 1) * xSpacing
        currentX = Math.max(currentX, parentPos.x - groupWidth / 2)
      }

      for (const node of groupNodes) {
        const position = { x: currentX, y }
        nodePositions.set(node.id, position)

        positionedNodes.push({
          id: node.id,
          type: 'archNode',
          position,
          data: {
            node,
            onClick: () => onNodeClick(node.id, node.label),
          },
        })

        currentX += xSpacing
      }

      // Add some extra spacing between groups
      currentX += xSpacing / 2
    }
  }

  // Create edges with proper styling
  const positionedEdges: Edge[] = edges
    .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: edge.type === 'calls' || edge.type === 'calls_external',
      style: {
        stroke: getEdgeColor(edge.type, edge.confidence),
        strokeWidth: edge.type === 'contains' ? 1 : 2,
        opacity: edge.confidence === 'low' ? 0.4 : 0.8,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: getEdgeColor(edge.type, edge.confidence),
        width: 15,
        height: 15,
      },
      label: edge.type !== 'contains' ? edge.label || edge.type : undefined,
      labelStyle: { fontSize: 10, fill: '#666' },
      labelBgStyle: { fill: 'white', fillOpacity: 0.8 },
      data: { edge },
    }))

  return { nodes: positionedNodes, edges: positionedEdges }
}

function getEdgeColor(type: string, confidence: string): string {
  // Color by edge type
  switch (type) {
    case 'contains':
      return '#cbd5e1' // slate-300
    case 'calls':
    case 'calls_external':
      return '#3b82f6' // blue-500
    case 'reads':
      return '#10b981' // green-500
    case 'writes':
      return '#f59e0b' // amber-500
    case 'depends_on':
      return '#8b5cf6' // violet-500
    default:
      return confidence === 'high' ? '#10b981' : confidence === 'medium' ? '#f59e0b' : '#9ca3af'
  }
}

export function SystemMapTab({ graph, onNodeClick, onEdgeClick }: SystemMapTabProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<Set<NodeType>>(new Set())

  // Filter and compute layout
  const { layoutNodes, layoutEdges } = useMemo(() => {
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

    const filteredNodeIds = new Set(filteredNodes.map(n => n.id))

    // Filter edges to only those connecting filtered nodes
    const filteredEdges = graph.edges.filter(
      edge => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)
    )

    const layout = computeHierarchicalLayout(filteredNodes, filteredEdges, onNodeClick)
    return { layoutNodes: layout.nodes, layoutEdges: layout.edges }
  }, [graph.nodes, graph.edges, searchQuery, selectedTypes, onNodeClick])

  // Use React Flow state hooks
  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges)

  // Sync state when layout changes (important!)
  useEffect(() => {
    setNodes(layoutNodes)
    setEdges(layoutEdges)
  }, [layoutNodes, layoutEdges, setNodes, setEdges])

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

  // Edge stats for display
  const edgeStats = useMemo(() => {
    const stats = { contains: 0, calls: 0, reads: 0, writes: 0, other: 0 }
    for (const edge of graph.edges) {
      if (edge.type === 'contains') stats.contains++
      else if (edge.type === 'calls' || edge.type === 'calls_external') stats.calls++
      else if (edge.type === 'reads') stats.reads++
      else if (edge.type === 'writes') stats.writes++
      else stats.other++
    }
    return stats
  }, [graph.edges])

  return (
    <div className="h-[700px] border rounded-lg overflow-hidden bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeClick={onEdgeClickHandler}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        defaultViewport={{ x: 0, y: 0, zoom: 0.5 }}
      >
        <Background color="#e5e7eb" gap={20} />
        <Controls />
        <MiniMap
          nodeColor={(node: Node) => nodeConfig[(node.data?.node as ArchNode)?.type]?.color || '#888'}
          maskColor="rgba(0, 0, 0, 0.1)"
          pannable
          zoomable
        />

        {/* Search and Filter Panel */}
        <Panel position="top-left" className="bg-background/95 backdrop-blur-sm p-3 rounded-lg border shadow-sm max-w-[320px]">
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search nodes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
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
          <div className="text-xs space-y-2">
            <div className="font-medium mb-2">Edge Types</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5" style={{ backgroundColor: getEdgeColor('contains', 'high') }} />
                <span>Contains ({edgeStats.contains})</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5" style={{ backgroundColor: getEdgeColor('calls', 'high') }} />
                <span>Calls ({edgeStats.calls})</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5" style={{ backgroundColor: getEdgeColor('reads', 'high') }} />
                <span>Reads ({edgeStats.reads})</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5" style={{ backgroundColor: getEdgeColor('writes', 'high') }} />
                <span>Writes ({edgeStats.writes})</span>
              </div>
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}
