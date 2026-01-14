'use client'

import { memo, useState, useCallback } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { Monitor, Server, Layers, Database, Cog, Cloud, X, Pencil } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { NODE_TYPE_CONFIG, type SystemNodeType } from '@laneshare/shared'

const NODE_ICONS: Record<SystemNodeType, typeof Monitor> = {
  UI: Monitor,
  API: Server,
  SERVICE: Layers,
  DATA: Database,
  WORKER: Cog,
  EXTERNAL: Cloud,
}

export interface SystemNodeData {
  type: SystemNodeType
  label: string
  details?: string
  onLabelChange?: (id: string, label: string) => void
  onDetailsChange?: (id: string, details: string) => void
  onDelete?: (id: string) => void
  isEditing?: boolean
}

function EditableSystemNodeComponent({ id, data, selected }: NodeProps<SystemNodeData>) {
  const [isEditingLabel, setIsEditingLabel] = useState(false)
  const [editedLabel, setEditedLabel] = useState(data.label)
  const [editedDetails, setEditedDetails] = useState(data.details || '')
  const [showDetailsPopover, setShowDetailsPopover] = useState(false)

  const config = NODE_TYPE_CONFIG[data.type]
  const Icon = NODE_ICONS[data.type]

  const handleLabelSubmit = useCallback(() => {
    if (editedLabel.trim() && data.onLabelChange) {
      data.onLabelChange(id, editedLabel.trim())
    }
    setIsEditingLabel(false)
  }, [id, editedLabel, data])

  const handleDetailsSubmit = useCallback(() => {
    if (data.onDetailsChange) {
      data.onDetailsChange(id, editedDetails)
    }
    setShowDetailsPopover(false)
  }, [id, editedDetails, data])

  const handleDelete = useCallback(() => {
    if (data.onDelete) {
      data.onDelete(id)
    }
  }, [id, data])

  return (
    <div
      className={`
        relative px-4 py-3 rounded-lg border-2 bg-white dark:bg-gray-900
        min-w-[180px] max-w-[250px] shadow-sm
        transition-all duration-200
        ${selected ? 'ring-2 ring-primary ring-offset-2' : ''}
      `}
      style={{ borderColor: config.color }}
    >
      {/* Connection handles */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-gray-400 hover:!bg-gray-600"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-gray-400 hover:!bg-gray-600"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left-target"
        className="!w-3 !h-3 !bg-gray-400 hover:!bg-gray-600"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right-source"
        className="!w-3 !h-3 !bg-gray-400 hover:!bg-gray-600"
      />

      {/* Delete button - shown when selected or hovered */}
      {data.onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className={`
            absolute -top-2 -right-2 h-6 w-6 rounded-full
            bg-red-500 hover:bg-red-600 text-white
            opacity-0 group-hover:opacity-100 transition-opacity
            ${selected ? 'opacity-100' : ''}
          `}
          onClick={handleDelete}
        >
          <X className="h-3 w-3" />
        </Button>
      )}

      {/* Header with icon and type */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="p-1.5 rounded"
          style={{ backgroundColor: `${config.color}20` }}
        >
          <Icon className="h-4 w-4" style={{ color: config.color }} />
        </div>
        <span
          className="text-xs font-medium uppercase tracking-wide"
          style={{ color: config.color }}
        >
          {config.label}
        </span>
      </div>

      {/* Editable label */}
      {isEditingLabel ? (
        <Input
          value={editedLabel}
          onChange={(e) => setEditedLabel(e.target.value)}
          onBlur={handleLabelSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleLabelSubmit()
            if (e.key === 'Escape') {
              setEditedLabel(data.label)
              setIsEditingLabel(false)
            }
          }}
          autoFocus
          className="h-7 text-sm font-semibold"
        />
      ) : (
        <div
          className="font-semibold text-sm cursor-text hover:bg-gray-100 dark:hover:bg-gray-800 px-1 py-0.5 rounded -mx-1"
          onClick={() => setIsEditingLabel(true)}
          title="Click to edit"
        >
          {data.label}
        </div>
      )}

      {/* Details section */}
      {data.details && (
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {data.details}
        </p>
      )}

      {/* Edit details button */}
      {data.onDetailsChange && (
        <Popover open={showDetailsPopover} onOpenChange={setShowDetailsPopover}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-6 text-xs w-full justify-start text-muted-foreground"
            >
              <Pencil className="h-3 w-3 mr-1" />
              {data.details ? 'Edit details' : 'Add details'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="details">Description</Label>
                <Textarea
                  id="details"
                  value={editedDetails}
                  onChange={(e) => setEditedDetails(e.target.value)}
                  placeholder="Describe what this component does..."
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditedDetails(data.details || '')
                    setShowDetailsPopover(false)
                  }}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={handleDetailsSubmit}>
                  Save
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

// Wrap with group class for hover effects
function EditableSystemNodeWrapper(props: NodeProps<SystemNodeData>) {
  return (
    <div className="group">
      <EditableSystemNodeComponent {...props} />
    </div>
  )
}

export const EditableSystemNode = memo(EditableSystemNodeWrapper)
