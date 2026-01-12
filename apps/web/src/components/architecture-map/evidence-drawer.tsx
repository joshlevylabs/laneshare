'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  ExternalLink,
  Copy,
  Check,
  FileCode,
  Database,
  Cloud,
  Settings,
  Package,
  Shield,
  Loader2,
} from 'lucide-react'
import type { EvidenceKind, Confidence } from '@laneshare/shared'

interface EvidenceItem {
  id: string
  kind: EvidenceKind
  nodeId: string
  edgeId?: string
  filePath?: string
  symbol?: string
  lineStart?: number
  lineEnd?: number
  excerpt?: string
  confidence: Confidence
  metadata: Record<string, unknown>
  repo?: { owner: string; name: string }
  url?: string
}

interface EvidenceDrawerProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  snapshotId: string
  nodeId?: string
  edgeId?: string
  title: string
}

const evidenceKindConfig: Record<EvidenceKind, { icon: typeof FileCode; label: string; color: string }> = {
  ROUTE_DEF: { icon: FileCode, label: 'Route', color: '#3b82f6' },
  API_HANDLER: { icon: FileCode, label: 'API Handler', color: '#10b981' },
  PAGE_COMPONENT: { icon: FileCode, label: 'Page', color: '#8b5cf6' },
  DB_TABLE: { icon: Database, label: 'Table', color: '#ef4444' },
  DB_FUNCTION: { icon: Database, label: 'Function', color: '#f97316' },
  SQL_MIGRATION: { icon: Database, label: 'Migration', color: '#f59e0b' },
  ENV_VAR: { icon: Settings, label: 'Env Var', color: '#6b7280' },
  FETCH_CALL: { icon: Cloud, label: 'Fetch', color: '#06b6d4' },
  SUPABASE_CLIENT: { icon: Database, label: 'Supabase', color: '#10b981' },
  VERCEL_CONFIG: { icon: Cloud, label: 'Vercel', color: '#000000' },
  PACKAGE_DEP: { icon: Package, label: 'Package', color: '#a855f7' },
  IMPORT_STMT: { icon: FileCode, label: 'Import', color: '#6366f1' },
  EXTERNAL_API: { icon: Cloud, label: 'External API', color: '#6b7280' },
  COMPONENT_USAGE: { icon: FileCode, label: 'Component', color: '#ec4899' },
  RLS_POLICY: { icon: Shield, label: 'RLS Policy', color: '#f59e0b' },
}

const confidenceColors: Record<Confidence, string> = {
  high: '#10b981',
  medium: '#f59e0b',
  low: '#9ca3af',
}

export function EvidenceDrawer({
  isOpen,
  onClose,
  projectId,
  snapshotId,
  nodeId,
  edgeId,
  title,
}: EvidenceDrawerProps) {
  const [evidence, setEvidence] = useState<EvidenceItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || (!nodeId && !edgeId)) {
      return
    }

    const fetchEvidence = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          snapshotId,
          ...(nodeId && { nodeId }),
          ...(edgeId && { edgeId }),
        })

        const response = await fetch(
          `/api/projects/${projectId}/map/evidence?${params}`
        )
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch evidence')
        }

        setEvidence(data.evidence || [])
      } catch (err: any) {
        setError(err.message)
        setEvidence([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchEvidence()
  }, [isOpen, projectId, snapshotId, nodeId, edgeId])

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // Ignore clipboard errors
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Evidence: {title}</DialogTitle>
          <DialogDescription>
            Code references and configuration that support this discovery
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-destructive">
              <p>{error}</p>
            </div>
          ) : evidence.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No evidence found for this item.</p>
            </div>
          ) : (
            evidence.map((item) => {
              const config = evidenceKindConfig[item.kind]
              const Icon = config.icon

              return (
                <Card key={item.id} className="overflow-hidden">
                  <CardContent className="pt-4">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          style={{
                            borderColor: config.color,
                            color: config.color,
                          }}
                        >
                          <Icon className="h-3 w-3 mr-1" />
                          {config.label}
                        </Badge>
                        <Badge
                          variant="secondary"
                          style={{
                            backgroundColor: `${confidenceColors[item.confidence]}20`,
                            color: confidenceColors[item.confidence],
                          }}
                        >
                          {item.confidence}
                        </Badge>
                      </div>

                      {item.url && (
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          className="h-8"
                        >
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-4 w-4 mr-1" />
                            View
                          </a>
                        </Button>
                      )}
                    </div>

                    {/* File path */}
                    {item.filePath && (
                      <div className="flex items-center gap-2 text-sm mb-2">
                        <span className="text-muted-foreground">
                          {item.repo
                            ? `${item.repo.owner}/${item.repo.name}/`
                            : ''}
                        </span>
                        <span className="font-mono text-foreground">
                          {item.filePath}
                          {item.lineStart && `:${item.lineStart}`}
                        </span>
                      </div>
                    )}

                    {/* Symbol */}
                    {item.symbol && (
                      <div className="text-sm mb-2">
                        <span className="text-muted-foreground">Symbol: </span>
                        <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">
                          {item.symbol}
                        </code>
                      </div>
                    )}

                    {/* Excerpt */}
                    {item.excerpt && (
                      <div className="relative mt-3">
                        <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
                          <code>{item.excerpt}</code>
                        </pre>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute top-2 right-2 h-7"
                          onClick={() => copyToClipboard(item.excerpt!, item.id)}
                        >
                          {copiedId === item.id ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    )}

                    {/* Metadata */}
                    {Object.keys(item.metadata).length > 0 && (
                      <div className="mt-3 pt-3 border-t">
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(item.metadata).map(([key, value]) => (
                            <Badge key={key} variant="secondary" className="text-xs">
                              {key}: {String(value)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>

        {/* Footer */}
        {evidence.length > 0 && (
          <div className="pt-4 border-t text-sm text-muted-foreground">
            {evidence.length} evidence item{evidence.length !== 1 ? 's' : ''} found
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
