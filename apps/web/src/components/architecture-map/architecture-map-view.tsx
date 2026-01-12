'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RefreshCw, Map, List, GitMerge, Clock, AlertCircle } from 'lucide-react'
import { formatRelativeTime } from '@laneshare/shared'
import { SystemMapTab } from './system-map-tab'
import { FeatureMapTab } from './feature-map-tab'
import { InventoryTab } from './inventory-tab'
import { EvidenceDrawer } from './evidence-drawer'
import type { ArchitectureGraph, ArchitectureSummary, Feature } from '@laneshare/shared'

interface ArchitectureMapViewProps {
  projectId: string
  initialSnapshot: {
    id: string
    generatedAt: string
    analyzerVersion: string
    graph: ArchitectureGraph
    summary: ArchitectureSummary
    status: string
  } | null
  initialFeatures: Feature[]
  repos: Array<{ id: string; owner: string; name: string }>
}

export function ArchitectureMapView({
  projectId,
  initialSnapshot,
  initialFeatures,
  repos,
}: ArchitectureMapViewProps) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [features, setFeatures] = useState(initialFeatures)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRepoId, setSelectedRepoId] = useState<string>('all')
  const [minConfidence, setMinConfidence] = useState<string>('all')
  const [evidenceDrawer, setEvidenceDrawer] = useState<{
    isOpen: boolean
    nodeId?: string
    edgeId?: string
    title: string
  }>({ isOpen: false, title: '' })

  const handleRegenerate = useCallback(async (force: boolean = false) => {
    setIsRegenerating(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}/map/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to regenerate map')
      }

      // Refresh the page to get new data
      router.refresh()

      if (!data.cached) {
        // Fetch the new snapshot
        const mapResponse = await fetch(`/api/projects/${projectId}/map`)
        const mapData = await mapResponse.json()

        if (mapData.snapshot) {
          setSnapshot(mapData.snapshot)
          setFeatures(mapData.features || [])
        }
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsRegenerating(false)
    }
  }, [projectId, router])

  const openEvidenceDrawer = useCallback((nodeId?: string, edgeId?: string, title?: string) => {
    setEvidenceDrawer({
      isOpen: true,
      nodeId,
      edgeId,
      title: title || 'Evidence',
    })
  }, [])

  const closeEvidenceDrawer = useCallback(() => {
    setEvidenceDrawer({ isOpen: false, title: '' })
  }, [])

  // Filter graph data based on selected filters
  const filteredGraph = snapshot?.graph ? {
    ...snapshot.graph,
    nodes: snapshot.graph.nodes.filter((node) => {
      if (selectedRepoId !== 'all' && node.repoId) {
        const repoNodeId = `node_${selectedRepoId.slice(0, 16)}`
        if (node.repoId !== repoNodeId) return false
      }
      return true
    }),
    edges: snapshot.graph.edges.filter((edge) => {
      if (minConfidence !== 'all') {
        const confidenceOrder = { high: 3, medium: 2, low: 1 }
        if (confidenceOrder[edge.confidence] < confidenceOrder[minConfidence as keyof typeof confidenceOrder]) {
          return false
        }
      }
      return true
    }),
  } : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Map className="h-6 w-6" />
            Architecture Map
          </h1>
          <p className="text-muted-foreground">
            Visualize your system architecture across all connected repositories
          </p>
        </div>

        <div className="flex items-center gap-4">
          {snapshot && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Generated {formatRelativeTime(snapshot.generatedAt)}</span>
              <Badge variant="outline" className="ml-1">
                v{snapshot.analyzerVersion}
              </Badge>
            </div>
          )}

          <Button
            onClick={() => handleRegenerate(false)}
            disabled={isRegenerating}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRegenerating ? 'animate-spin' : ''}`} />
            {isRegenerating ? 'Analyzing...' : snapshot ? 'Regenerate' : 'Generate Map'}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {!snapshot ? (
        <Card>
          <CardHeader>
            <CardTitle>No Architecture Map Available</CardTitle>
            <CardDescription>
              Generate an architecture map to visualize your system's structure,
              including routes, endpoints, database tables, and external services.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => handleRegenerate(false)} disabled={isRegenerating}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isRegenerating ? 'animate-spin' : ''}`} />
              {isRegenerating ? 'Analyzing...' : 'Generate Architecture Map'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stats Bar */}
          <div className="grid gap-4 md:grid-cols-5">
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{snapshot.summary.nodeCount.total}</div>
                <div className="text-sm text-muted-foreground">Total Nodes</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{snapshot.summary.nodeCount.byType.screen || 0}</div>
                <div className="text-sm text-muted-foreground">Screens</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{snapshot.summary.nodeCount.byType.endpoint || 0}</div>
                <div className="text-sm text-muted-foreground">Endpoints</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{snapshot.summary.nodeCount.byType.table || 0}</div>
                <div className="text-sm text-muted-foreground">Tables</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{features.length}</div>
                <div className="text-sm text-muted-foreground">Features</div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Repository:</span>
              <Select value={selectedRepoId} onValueChange={setSelectedRepoId}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All repositories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All repositories</SelectItem>
                  {repos.map((repo) => (
                    <SelectItem key={repo.id} value={repo.id}>
                      {repo.owner}/{repo.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Confidence:</span>
              <Select value={minConfidence} onValueChange={setMinConfidence}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="high">High only</SelectItem>
                  <SelectItem value="medium">Medium+</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Main Content Tabs */}
          <Tabs defaultValue="system" className="w-full">
            <TabsList>
              <TabsTrigger value="system" className="flex items-center gap-2">
                <GitMerge className="h-4 w-4" />
                System Map
              </TabsTrigger>
              <TabsTrigger value="features" className="flex items-center gap-2">
                <Map className="h-4 w-4" />
                Feature Map
              </TabsTrigger>
              <TabsTrigger value="inventory" className="flex items-center gap-2">
                <List className="h-4 w-4" />
                Inventory
              </TabsTrigger>
            </TabsList>

            <TabsContent value="system" className="mt-4">
              <SystemMapTab
                graph={filteredGraph!}
                onNodeClick={(nodeId, label) => openEvidenceDrawer(nodeId, undefined, label)}
                onEdgeClick={(edgeId, label) => openEvidenceDrawer(undefined, edgeId, label)}
              />
            </TabsContent>

            <TabsContent value="features" className="mt-4">
              <FeatureMapTab
                features={features}
                graph={snapshot.graph}
                onStepClick={(nodeId, label) => openEvidenceDrawer(nodeId, undefined, label)}
              />
            </TabsContent>

            <TabsContent value="inventory" className="mt-4">
              <InventoryTab
                nodes={filteredGraph!.nodes}
                features={features}
                onNodeClick={(nodeId, label) => openEvidenceDrawer(nodeId, undefined, label)}
              />
            </TabsContent>
          </Tabs>

          {/* Evidence Drawer */}
          <EvidenceDrawer
            isOpen={evidenceDrawer.isOpen}
            onClose={closeEvidenceDrawer}
            projectId={projectId}
            snapshotId={snapshot.id}
            nodeId={evidenceDrawer.nodeId}
            edgeId={evidenceDrawer.edgeId}
            title={evidenceDrawer.title}
          />
        </>
      )}
    </div>
  )
}
