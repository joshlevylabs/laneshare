'use client'

import { useState, useCallback, useRef, useMemo } from 'react'
import ReactFlow, {
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  MarkerType,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Save, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { NodePalette } from './node-palette'
import { EditableSystemNode, type SystemNodeData } from './editable-system-node'
import { EdgeTypeSelector } from './edge-type-selector'
import {
  generateNodeId,
  generateEdgeId,
  EDGE_KIND_CONFIG,
  type SystemGraph,
  type SystemNode,
  type SystemEdge,
  type SystemNodeType,
  type SystemEdgeKind,
} from '@laneshare/shared'

interface FlowchartBuilderProps {
  projectId: string
  systemId: string
  systemTitle: string
  initialGraph?: SystemGraph
  isAdmin: boolean
}

function FlowchartBuilderInner({
  projectId,
  systemId,
  systemTitle,
  initialGraph,
  isAdmin,
}: FlowchartBuilderProps) {
  const { toast } = useToast()
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()

  // Convert SystemGraph to ReactFlow format
  const initialNodes: Node<SystemNodeData>[] = useMemo(() => {
    return (initialGraph?.nodes || []).map((node) => ({
      id: node.id,
      type: 'editableNode',
      position: node.position || { x: Math.random() * 400, y: Math.random() * 400 },
      data: {
        type: node.type,
        label: node.label,
        details: node.details,
      },
    }))
  }, [initialGraph])

  const initialEdges: Edge[] = useMemo(() => {
    return (initialGraph?.edges || []).map((edge) => {
      const config = EDGE_KIND_CONFIG[edge.kind]
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'smoothstep',
        animated: edge.kind === 'TRIGGERS',
        label: edge.label,
        style: {
          stroke: config.color,
          strokeDasharray: config.dashed ? '5,5' : undefined,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: config.color,
        },
        data: { kind: edge.kind },
      }
    })
  }, [initialGraph])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Edge creation state
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null)
  const [showEdgeSelector, setShowEdgeSelector] = useState(false)

  // Custom node types
  const nodeTypes: NodeTypes = useMemo(() => ({
    editableNode: EditableSystemNode,
  }), [])

  // Handle node label change
  const handleLabelChange = useCallback((nodeId: string, newLabel: string) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, label: newLabel } }
          : node
      )
    )
    setHasChanges(true)
  }, [setNodes])

  // Handle node details change
  const handleDetailsChange = useCallback((nodeId: string, newDetails: string) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, details: newDetails } }
          : node
      )
    )
    setHasChanges(true)
  }, [setNodes])

  // Handle node delete
  const handleNodeDelete = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((node) => node.id !== nodeId))
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
    setHasChanges(true)
  }, [setNodes, setEdges])

  // Update nodes with handlers
  const nodesWithHandlers = useMemo(() => {
    if (!isAdmin) return nodes
    return nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        onLabelChange: handleLabelChange,
        onDetailsChange: handleDetailsChange,
        onDelete: handleNodeDelete,
      },
    }))
  }, [nodes, isAdmin, handleLabelChange, handleDetailsChange, handleNodeDelete])

  // Handle connection start
  const onConnect = useCallback((connection: Connection) => {
    if (!isAdmin) return
    setPendingConnection(connection)
    setShowEdgeSelector(true)
  }, [isAdmin])

  // Handle edge type selection
  const handleEdgeTypeSelect = useCallback((kind: SystemEdgeKind, label?: string) => {
    if (!pendingConnection) return

    const config = EDGE_KIND_CONFIG[kind]
    const edgeId = generateEdgeId(pendingConnection.source!, pendingConnection.target!, kind)

    const newEdge: Edge = {
      id: edgeId,
      source: pendingConnection.source!,
      target: pendingConnection.target!,
      type: 'smoothstep',
      animated: kind === 'TRIGGERS',
      label,
      style: {
        stroke: config.color,
        strokeDasharray: config.dashed ? '5,5' : undefined,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: config.color,
      },
      data: { kind },
    }

    setEdges((eds) => addEdge(newEdge, eds))
    setPendingConnection(null)
    setShowEdgeSelector(false)
    setHasChanges(true)
  }, [pendingConnection, setEdges])

  // Handle drag over
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  // Handle drop
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      if (!isAdmin) return

      const type = event.dataTransfer.getData('application/reactflow-type') as SystemNodeType
      if (!type) return

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const nodeId = generateNodeId(type, 'New Component')

      const newNode: Node<SystemNodeData> = {
        id: nodeId,
        type: 'editableNode',
        position,
        data: {
          type,
          label: 'New Component',
        },
      }

      setNodes((nds) => nds.concat(newNode))
      setHasChanges(true)
    },
    [isAdmin, screenToFlowPosition, setNodes]
  )

  // Track changes
  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    onNodesChange(changes)
    // Only set hasChanges for position changes (not selection)
    if (changes.some((c) => c.type === 'position' && c.position)) {
      setHasChanges(true)
    }
  }, [onNodesChange])

  const handleEdgesChange = useCallback((changes: Parameters<typeof onEdgesChange>[0]) => {
    onEdgesChange(changes)
    if (changes.some((c) => c.type === 'remove')) {
      setHasChanges(true)
    }
  }, [onEdgesChange])

  // Save flowchart
  const handleSave = useCallback(async () => {
    setIsSaving(true)

    try {
      // Convert ReactFlow format back to SystemGraph
      const systemNodes: SystemNode[] = nodes.map((node) => ({
        id: node.id,
        type: node.data.type,
        label: node.data.label,
        details: node.data.details,
        position: node.position,
      }))

      const systemEdges: SystemEdge[] = edges.map((edge) => ({
        id: edge.id,
        from: edge.source,
        to: edge.target,
        kind: edge.data?.kind || 'CALLS',
        label: edge.label as string | undefined,
      }))

      const response = await fetch(`/api/projects/${projectId}/systems/${systemId}/flowchart`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: systemNodes,
          edges: systemEdges,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save flowchart')
      }

      setHasChanges(false)
      toast({
        title: 'Flowchart saved',
        description: 'Your changes have been saved successfully.',
      })
    } catch (error) {
      toast({
        title: 'Failed to save',
        description: error instanceof Error ? error.message : 'An error occurred',
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }, [nodes, edges, projectId, systemId, toast])

  // Reset to initial state
  const handleReset = useCallback(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
    setHasChanges(false)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  // Get source/target labels for edge selector
  const sourceNode = nodes.find((n) => n.id === pendingConnection?.source)
  const targetNode = nodes.find((n) => n.id === pendingConnection?.target)

  return (
    <div className="flex h-[600px] border rounded-lg overflow-hidden bg-background">
      {/* Node palette */}
      {isAdmin && (
        <div className="w-64 border-r overflow-y-auto">
          <NodePalette className="border-0 shadow-none rounded-none" />
        </div>
      )}

      {/* Flow canvas */}
      <div className="flex-1 relative" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodesWithHandlers}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid
          snapGrid={[15, 15]}
          nodesDraggable={isAdmin}
          nodesConnectable={isAdmin}
          elementsSelectable={isAdmin}
          deleteKeyCode={isAdmin ? ['Backspace', 'Delete'] : null}
        >
          <Controls />
          <MiniMap
            nodeStrokeWidth={3}
            zoomable
            pannable
          />
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        </ReactFlow>

        {/* Toolbar */}
        {isAdmin && (
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!hasChanges || isSaving}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </>
              )}
            </Button>
          </div>
        )}

        {/* Empty state */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="text-muted-foreground mb-2">
                {isAdmin
                  ? 'Drag components from the palette to start building your flowchart.'
                  : 'No flowchart has been created yet.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Edge type selector dialog */}
      <EdgeTypeSelector
        open={showEdgeSelector}
        onOpenChange={(open) => {
          setShowEdgeSelector(open)
          if (!open) setPendingConnection(null)
        }}
        sourceLabel={sourceNode?.data.label || 'Source'}
        targetLabel={targetNode?.data.label || 'Target'}
        onSelect={handleEdgeTypeSelect}
      />
    </div>
  )
}

export function FlowchartBuilder(props: FlowchartBuilderProps) {
  return (
    <ReactFlowProvider>
      <FlowchartBuilderInner {...props} />
    </ReactFlowProvider>
  )
}
