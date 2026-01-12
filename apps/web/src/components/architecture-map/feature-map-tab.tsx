'use client'

import { useState, useMemo } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Monitor,
  Server,
  Database,
  Cloud,
  MousePointer,
  ArrowDown,
  FileText,
  ChevronRight,
} from 'lucide-react'
import type { Feature, ArchitectureGraph, FlowStep, ArchNode } from '@laneshare/shared'

interface FeatureMapTabProps {
  features: Feature[]
  graph: ArchitectureGraph
  onStepClick: (nodeId: string, label: string) => void
}

const stepTypeConfig: Record<FlowStep['type'], { icon: typeof Monitor; color: string; label: string }> = {
  screen: { icon: Monitor, color: '#3b82f6', label: 'Screen' },
  action: { icon: MousePointer, color: '#8b5cf6', label: 'Action' },
  api_call: { icon: Server, color: '#10b981', label: 'API Call' },
  db_operation: { icon: Database, color: '#ef4444', label: 'Database' },
  external_call: { icon: Cloud, color: '#6b7280', label: 'External' },
}

export function FeatureMapTab({ features, graph, onStepClick }: FeatureMapTabProps) {
  const [selectedFeature, setSelectedFeature] = useState<string>(
    features[0]?.slug || ''
  )

  const feature = useMemo(
    () => features.find((f) => f.slug === selectedFeature),
    [features, selectedFeature]
  )

  const getNodeLabel = (nodeId: string): string => {
    const node = graph.nodes.find((n) => n.id === nodeId)
    return node?.label || nodeId
  }

  if (features.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Features Detected</CardTitle>
          <CardDescription>
            The analyzer did not detect any distinct features in your codebase.
            This could be because the project structure doesn't match common patterns.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Feature Selector */}
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">Select Feature:</span>
        <Select value={selectedFeature} onValueChange={setSelectedFeature}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Choose a feature" />
          </SelectTrigger>
          <SelectContent>
            {features.map((f) => (
              <SelectItem key={f.slug} value={f.slug}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {feature && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Feature Info */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>{feature.name}</CardTitle>
              {feature.description && (
                <CardDescription>{feature.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2">Screens</h4>
                <div className="flex flex-wrap gap-1">
                  {feature.screens.length > 0 ? (
                    feature.screens.map((screenId) => (
                      <Badge
                        key={screenId}
                        variant="secondary"
                        className="cursor-pointer hover:bg-secondary/80"
                        onClick={() => onStepClick(screenId, getNodeLabel(screenId))}
                      >
                        <Monitor className="h-3 w-3 mr-1" />
                        {getNodeLabel(screenId)}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">None</span>
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">Endpoints</h4>
                <div className="flex flex-wrap gap-1">
                  {feature.endpoints.length > 0 ? (
                    feature.endpoints.map((endpointId) => (
                      <Badge
                        key={endpointId}
                        variant="secondary"
                        className="cursor-pointer hover:bg-secondary/80"
                        onClick={() => onStepClick(endpointId, getNodeLabel(endpointId))}
                      >
                        <Server className="h-3 w-3 mr-1" />
                        {getNodeLabel(endpointId)}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">None</span>
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">Tables</h4>
                <div className="flex flex-wrap gap-1">
                  {feature.tables.length > 0 ? (
                    feature.tables.map((tableId) => (
                      <Badge
                        key={tableId}
                        variant="secondary"
                        className="cursor-pointer hover:bg-secondary/80"
                        onClick={() => onStepClick(tableId, getNodeLabel(tableId))}
                      >
                        <Database className="h-3 w-3 mr-1" />
                        {getNodeLabel(tableId)}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">None</span>
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">Services</h4>
                <div className="flex flex-wrap gap-1">
                  {feature.services.length > 0 ? (
                    feature.services.map((serviceId) => (
                      <Badge
                        key={serviceId}
                        variant="secondary"
                        className="cursor-pointer hover:bg-secondary/80"
                        onClick={() => onStepClick(serviceId, getNodeLabel(serviceId))}
                      >
                        <Cloud className="h-3 w-3 mr-1" />
                        {getNodeLabel(serviceId)}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">None</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Flow Timeline */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                User Flow
              </CardTitle>
              <CardDescription>
                Step-by-step flow showing how users interact with this feature
              </CardDescription>
            </CardHeader>
            <CardContent>
              {feature.flow.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No flow steps detected for this feature.
                </p>
              ) : (
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border" />

                  {/* Flow steps */}
                  <div className="space-y-4">
                    {feature.flow.map((step, index) => {
                      const config = stepTypeConfig[step.type]
                      const Icon = config.icon

                      return (
                        <div key={step.order} className="relative flex items-start gap-4">
                          {/* Timeline dot */}
                          <div
                            className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 bg-background"
                            style={{ borderColor: config.color }}
                          >
                            <Icon className="h-5 w-5" style={{ color: config.color }} />
                          </div>

                          {/* Step content */}
                          <div
                            className="flex-1 rounded-lg border p-4 cursor-pointer hover:border-primary/50 transition-colors"
                            onClick={() => onStepClick(step.nodeId, step.label)}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{step.label}</span>
                                <Badge
                                  variant="outline"
                                  className="text-xs"
                                  style={{ borderColor: config.color, color: config.color }}
                                >
                                  {config.label}
                                </Badge>
                              </div>
                              <Badge variant="secondary" className="text-xs">
                                Step {step.order}
                              </Badge>
                            </div>
                            {step.description && (
                              <p className="text-sm text-muted-foreground">{step.description}</p>
                            )}
                            {step.evidenceIds.length > 0 && (
                              <p className="text-xs text-muted-foreground mt-2">
                                {step.evidenceIds.length} evidence item(s)
                              </p>
                            )}
                          </div>

                          {/* Arrow to next step */}
                          {index < feature.flow.length - 1 && (
                            <div className="absolute left-[22px] top-14 text-muted-foreground">
                              <ArrowDown className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
