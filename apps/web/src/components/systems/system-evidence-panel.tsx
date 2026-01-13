'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  FileText,
  GitBranch,
  Bot,
  Search,
  ExternalLink,
} from 'lucide-react'
import type {
  SystemEvidence,
  SystemGraph,
  EvidenceSourceType,
  EvidenceConfidence,
} from '@laneshare/shared'

interface SystemEvidencePanelProps {
  evidence: SystemEvidence[]
  selectedNodeId: string | null
  graph?: SystemGraph
}

const SOURCE_TYPE_CONFIG: Record<EvidenceSourceType, { label: string; icon: typeof FileText; color: string }> = {
  DOC: { label: 'Documentation', icon: FileText, color: 'text-blue-500' },
  REPO: { label: 'Code', icon: GitBranch, color: 'text-green-500' },
  AGENT: { label: 'Agent Output', icon: Bot, color: 'text-purple-500' },
}

const CONFIDENCE_CONFIG: Record<EvidenceConfidence, { label: string; color: string }> = {
  HIGH: { label: 'High', color: 'bg-green-500' },
  MED: { label: 'Medium', color: 'bg-yellow-500' },
  LOW: { label: 'Low', color: 'bg-red-500' },
}

export function SystemEvidencePanel({
  evidence,
  selectedNodeId,
  graph,
}: SystemEvidencePanelProps) {
  // Filter evidence if a node is selected
  const filteredEvidence = useMemo(() => {
    if (!selectedNodeId || !graph) return evidence

    // Find the selected node
    const node = graph.nodes.find((n) => n.id === selectedNodeId)
    if (!node) return evidence

    // Get evidence IDs referenced by this node
    const evidenceIds = new Set(node.refs.map((r) => r.evidenceId))

    // Also include edges that connect to this node
    const connectedEdges = graph.edges.filter(
      (e) => e.from === selectedNodeId || e.to === selectedNodeId
    )
    for (const edge of connectedEdges) {
      for (const ref of edge.refs) {
        evidenceIds.add(ref.evidenceId)
      }
    }

    return evidence.filter((e) => evidenceIds.has(e.id))
  }, [evidence, selectedNodeId, graph])

  // Group by source type
  const evidenceByType = useMemo(() => {
    const byType = new Map<EvidenceSourceType, SystemEvidence[]>()
    for (const e of filteredEvidence) {
      const list = byType.get(e.source_type) || []
      list.push(e)
      byType.set(e.source_type, list)
    }
    return byType
  }, [filteredEvidence])

  if (evidence.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Evidence Yet</h3>
          <p className="text-muted-foreground">
            Evidence will be collected when you analyze the system and process agent output.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {selectedNodeId && (
        <Card className="bg-muted/50">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">
                Showing evidence for selected node
              </span>
              <Badge variant="outline">
                {filteredEvidence.length} of {evidence.length} items
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {(['DOC', 'REPO', 'AGENT'] as EvidenceSourceType[]).map((sourceType) => {
          const items = evidenceByType.get(sourceType) || []
          const config = SOURCE_TYPE_CONFIG[sourceType]
          const Icon = config.icon

          return (
            <Card key={sourceType}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${config.color}`} />
                  {config.label}
                  <Badge variant="secondary" className="ml-auto">
                    {items.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No {config.label.toLowerCase()} evidence
                  </p>
                ) : (
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-3">
                      {items.map((item) => {
                        const confConfig = CONFIDENCE_CONFIG[item.confidence]
                        const metadata = item.metadata as {
                          file_path?: string
                          symbol?: string
                          line_start?: number
                          line_end?: number
                          url?: string
                          doc_slug?: string
                          doc_title?: string
                        }

                        return (
                          <div
                            key={item.id}
                            className="p-2 rounded border text-sm"
                          >
                            <div className="flex items-start justify-between mb-1">
                              <span className="font-medium truncate flex-1">
                                {metadata.file_path || metadata.doc_title || item.source_ref}
                              </span>
                              <span
                                className={`w-2 h-2 rounded-full flex-shrink-0 ml-2 ${confConfig.color}`}
                                title={`${confConfig.label} confidence`}
                              />
                            </div>

                            {metadata.symbol && (
                              <div className="text-xs text-muted-foreground mb-1">
                                Symbol: <code>{metadata.symbol}</code>
                              </div>
                            )}

                            {metadata.line_start && (
                              <div className="text-xs text-muted-foreground mb-1">
                                Lines {metadata.line_start}
                                {metadata.line_end ? `-${metadata.line_end}` : ''}
                              </div>
                            )}

                            <p className="text-xs bg-muted p-1.5 rounded font-mono whitespace-pre-wrap line-clamp-3">
                              {item.excerpt}
                            </p>

                            {metadata.url && (
                              <a
                                href={metadata.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1 mt-1"
                              >
                                View source
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
