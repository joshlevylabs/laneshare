'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { EDGE_KIND_CONFIG, type SystemEdgeKind } from '@laneshare/shared'

const EDGE_KINDS: SystemEdgeKind[] = ['CALLS', 'READS', 'WRITES', 'TRIGGERS', 'CONFIGURES']

interface EdgeTypeSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceLabel: string
  targetLabel: string
  onSelect: (kind: SystemEdgeKind, label?: string) => void
}

export function EdgeTypeSelector({
  open,
  onOpenChange,
  sourceLabel,
  targetLabel,
  onSelect,
}: EdgeTypeSelectorProps) {
  const [selectedKind, setSelectedKind] = useState<SystemEdgeKind>('CALLS')
  const [edgeLabel, setEdgeLabel] = useState('')

  const handleSubmit = () => {
    onSelect(selectedKind, edgeLabel.trim() || undefined)
    setSelectedKind('CALLS')
    setEdgeLabel('')
  }

  const handleCancel = () => {
    setSelectedKind('CALLS')
    setEdgeLabel('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Components</DialogTitle>
          <DialogDescription className="flex items-center gap-2 pt-2">
            <span className="font-medium text-foreground">{sourceLabel}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-foreground">{targetLabel}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Connection Type</Label>
            <RadioGroup
              value={selectedKind}
              onValueChange={(v) => setSelectedKind(v as SystemEdgeKind)}
              className="space-y-2"
            >
              {EDGE_KINDS.map((kind) => {
                const config = EDGE_KIND_CONFIG[kind]
                return (
                  <label
                    key={kind}
                    className="flex items-center space-x-3 p-2 rounded-lg border cursor-pointer hover:bg-accent"
                  >
                    <RadioGroupItem value={kind} id={kind} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-8 h-0.5 rounded"
                          style={{
                            backgroundColor: config.color,
                            borderStyle: config.dashed ? 'dashed' : 'solid',
                          }}
                        />
                        <span className="font-medium text-sm">{config.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {config.description}
                      </p>
                    </div>
                  </label>
                )
              })}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edge-label">Label (optional)</Label>
            <Input
              id="edge-label"
              value={edgeLabel}
              onChange={(e) => setEdgeLabel(e.target.value)}
              placeholder="e.g., 'via REST API', 'on submit'"
            />
            <p className="text-xs text-muted-foreground">
              Add a label to describe this specific connection.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            Create Connection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
