'use client'

import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Building2,
  Code2,
  Sparkles,
  Wrench,
  FileText,
  GitBranch,
  BookOpen,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  X,
} from 'lucide-react'
import {
  DOC_TYPES,
  type DocType,
  type DocJobStatus,
  type DocGenerationPhase,
  getDocTypesInOrder,
} from '@laneshare/shared'
import { cn } from '@/lib/utils'

// ============================================
// Types
// ============================================

interface ParallelDocGenProgress {
  phase: DocGenerationPhase
  jobs: Record<DocType, {
    status: DocJobStatus
    startedAt?: string
    completedAt?: string
    error?: string
  }>
  pagesGenerated: number
  totalPages: number
  startedAt?: string
  lastUpdated?: string
}

interface DocGenerationProgressProps {
  progress: ParallelDocGenProgress | null
  isGenerating: boolean
  onCancel?: () => void
  isCancelling?: boolean
}

// ============================================
// Icons for each document type
// ============================================

const docTypeIcons: Record<DocType, React.ReactNode> = {
  AGENTS_SUMMARY: <FileText className="h-3 w-3" />,
  ARCHITECTURE: <Building2 className="h-3 w-3" />,
  FEATURES: <Sparkles className="h-3 w-3" />,
  APIS: <Code2 className="h-3 w-3" />,
  RUNBOOK: <Wrench className="h-3 w-3" />,
  ADRS: <GitBranch className="h-3 w-3" />,
  SUMMARY: <BookOpen className="h-3 w-3" />,
}

// ============================================
// Status colors
// ============================================

function getStatusColor(status: DocJobStatus): string {
  switch (status) {
    case 'pending':
      return 'bg-gray-200 dark:bg-gray-700'
    case 'running':
      return 'bg-blue-500 animate-pulse'
    case 'completed':
      return 'bg-green-500'
    case 'failed':
      return 'bg-red-500'
    default:
      return 'bg-gray-200'
  }
}

function getStatusIcon(status: DocJobStatus): React.ReactNode {
  switch (status) {
    case 'pending':
      return <Clock className="h-3 w-3 text-gray-400" />
    case 'running':
      return <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
    case 'completed':
      return <CheckCircle className="h-3 w-3 text-green-500" />
    case 'failed':
      return <XCircle className="h-3 w-3 text-red-500" />
    default:
      return null
  }
}

// ============================================
// Phase labels
// ============================================

function getPhaseLabel(phase: DocGenerationPhase): string {
  switch (phase) {
    case 'context':
      return 'Gathering context...'
    case 'agents_summary':
      return 'Generating Agents Summary...'
    case 'parallel':
      return 'Generating documents in parallel...'
    case 'assembly':
      return 'Saving documentation...'
    case 'complete':
      return 'Complete'
    case 'error':
      return 'Error occurred'
    default:
      return 'Processing...'
  }
}

// ============================================
// Component
// ============================================

export function DocGenerationProgress({
  progress,
  isGenerating,
  onCancel,
  isCancelling,
}: DocGenerationProgressProps) {
  const docTypes = useMemo(() => getDocTypesInOrder(), [])

  // Calculate elapsed time
  const elapsedTime = useMemo(() => {
    if (!progress?.startedAt) return null
    const start = new Date(progress.startedAt).getTime()
    const now = Date.now()
    const seconds = Math.floor((now - start) / 1000)
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
  }, [progress?.startedAt])

  if (!isGenerating || !progress) {
    return null
  }

  const completedCount = Object.values(progress.jobs).filter(j => j.status === 'completed').length
  const failedCount = Object.values(progress.jobs).filter(j => j.status === 'failed').length
  const runningCount = Object.values(progress.jobs).filter(j => j.status === 'running').length

  return (
    <div className="space-y-3 bg-gray-50 dark:bg-gray-900/50 p-3 rounded-md border border-gray-200 dark:border-gray-700">
      {/* Header with phase and cancel button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {getPhaseLabel(progress.phase)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {elapsedTime && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {elapsedTime}
            </span>
          )}
          <Badge variant="secondary" className="text-xs">
            {completedCount}/{progress.totalPages}
          </Badge>
          {onCancel && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
              onClick={onCancel}
              disabled={isCancelling}
              title="Cancel generation"
            >
              {isCancelling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <X className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Document status grid */}
      <div className="space-y-1">
        {docTypes.map((docType) => {
          const job = progress.jobs[docType]
          const info = DOC_TYPES[docType]

          return (
            <div
              key={docType}
              className={cn(
                'flex items-center gap-2 px-2 py-1 rounded text-xs',
                job?.status === 'running' && 'bg-blue-50 dark:bg-blue-950/30',
                job?.status === 'completed' && 'bg-green-50 dark:bg-green-950/30',
                job?.status === 'failed' && 'bg-red-50 dark:bg-red-950/30'
              )}
            >
              {/* Status icon */}
              <div className="w-4 h-4 flex items-center justify-center">
                {getStatusIcon(job?.status || 'pending')}
              </div>

              {/* Document icon */}
              <div className="text-gray-500 dark:text-gray-400">
                {docTypeIcons[docType]}
              </div>

              {/* Document title */}
              <span className={cn(
                'flex-1 truncate',
                job?.status === 'pending' && 'text-gray-400',
                job?.status === 'running' && 'text-blue-700 dark:text-blue-300 font-medium',
                job?.status === 'completed' && 'text-green-700 dark:text-green-300',
                job?.status === 'failed' && 'text-red-700 dark:text-red-300'
              )}>
                {info.title}
              </span>

              {/* Status badge for running/failed */}
              {job?.status === 'running' && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 bg-blue-100 dark:bg-blue-900">
                  Running
                </Badge>
              )}
              {job?.status === 'failed' && job.error && (
                <span className="text-[10px] text-red-500 truncate max-w-[100px]" title={job.error}>
                  {job.error.slice(0, 20)}...
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-purple-500 rounded-full transition-all duration-500"
            style={{
              width: `${Math.round((completedCount / progress.totalPages) * 100)}%`
            }}
          />
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {completedCount} of {progress.totalPages}
        </span>
      </div>

      {/* Summary stats */}
      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        {runningCount > 0 && (
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            {runningCount} running
          </span>
        )}
        {completedCount > 0 && (
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            {completedCount} done
          </span>
        )}
        {failedCount > 0 && (
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            {failedCount} failed
          </span>
        )}
      </div>
    </div>
  )
}

// ============================================
// Compact version for sidebar
// ============================================

interface CompactProgressProps {
  progress: ParallelDocGenProgress | null
}

export function CompactDocGenerationProgress({ progress }: CompactProgressProps) {
  const docTypes = useMemo(() => getDocTypesInOrder(), [])

  if (!progress) {
    return null
  }

  return (
    <div className="flex items-center gap-1">
      {docTypes.map((docType) => {
        const job = progress.jobs[docType]
        return (
          <div
            key={docType}
            className={cn(
              'w-2 h-2 rounded-full transition-colors',
              getStatusColor(job?.status || 'pending')
            )}
            title={`${DOC_TYPES[docType].title}: ${job?.status || 'pending'}`}
          />
        )
      })}
    </div>
  )
}
