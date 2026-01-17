'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Sparkles, ArrowRight, Check, FileText, MessageSquare, Layers } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

interface PRD {
  id: string
  title: string
  description?: string
  status: string
  prd_json?: {
    userStories?: Array<{ id: string; title: string }>
  }
}

interface PrdMigrationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  prd: PRD
}

export function PrdMigrationDialog({
  open,
  onOpenChange,
  projectId,
  prd,
}: PrdMigrationDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<{
    sidequest: { id: string; title: string }
    tickets_created: number
    chat_messages_migrated: number
  } | null>(null)

  const handleMigrate = async () => {
    setIsLoading(true)
    setResult(null)

    try {
      const response = await fetch(`/api/projects/${projectId}/sidequests/migrate-prd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prd_id: prd.id }),
      })

      if (!response.ok) {
        const data = await response.json()
        if (response.status === 409 && data.sidequest_id) {
          toast({ title: 'Already Migrated', description: 'This PRD has already been migrated' })
          router.push(`/projects/${projectId}/sidequests/${data.sidequest_id}`)
          onOpenChange(false)
          return
        }
        throw new Error(data.error || 'Failed to migrate')
      }

      const data = await response.json()
      setResult(data)
      toast({ title: 'Success', description: 'PRD migrated successfully!' })
    } catch (error) {
      console.error('Migration error:', error)
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to migrate', variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleViewSidequest = () => {
    if (result?.sidequest) {
      router.push(`/projects/${projectId}/sidequests/${result.sidequest.id}`)
      onOpenChange(false)
    }
  }

  const storyCount = prd.prd_json?.userStories?.length || 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Migrate to Sidequest
          </DialogTitle>
          <DialogDescription>
            Convert this PRD to the new Sidequest format for enhanced planning and implementation
            capabilities.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <>
            <div className="space-y-4 py-4">
              {/* PRD summary */}
              <div className="bg-muted/50 rounded-lg p-4">
                <h4 className="font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {prd.title}
                </h4>
                {prd.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {prd.description}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-3">
                  <Badge variant="outline">{prd.status}</Badge>
                  {storyCount > 0 && (
                    <Badge variant="secondary">{storyCount} stories</Badge>
                  )}
                </div>
              </div>

              {/* What will be migrated */}
              <div>
                <h4 className="font-medium mb-2">What will be migrated:</h4>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    PRD title and description
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      Chat history (planning conversation)
                    </span>
                  </li>
                  {storyCount > 0 && (
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-500" />
                      <span className="flex items-center gap-1">
                        <Layers className="h-3 w-3" />
                        {storyCount} user stories as tickets
                      </span>
                    </li>
                  )}
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    Context links (repos, docs, features)
                  </li>
                </ul>
              </div>

              {/* Benefits */}
              <div className="bg-primary/5 rounded-lg p-4">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  New Capabilities
                </h4>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li>• Hierarchical plan view (Epics → Stories → Tasks → Subtasks)</li>
                  <li>• AI-powered sprint organization</li>
                  <li>• Sequential implementation with review</li>
                  <li>• Automatic context analysis for tickets</li>
                </ul>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                Cancel
              </Button>
              <Button onClick={handleMigrate} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Migrating...
                  </>
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4 mr-2" />
                    Migrate to Sidequest
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="py-8 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
                <Check className="h-6 w-6 text-green-600" />
              </div>
              <h3 className="text-lg font-medium mb-2">Migration Complete!</h3>
              <p className="text-muted-foreground">
                Your PRD has been converted to a Sidequest
              </p>

              <div className="grid grid-cols-2 gap-4 mt-6">
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="text-2xl font-bold">{result.tickets_created}</div>
                  <div className="text-sm text-muted-foreground">Tickets Created</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <div className="text-2xl font-bold">{result.chat_messages_migrated}</div>
                  <div className="text-sm text-muted-foreground">Messages Migrated</div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={handleViewSidequest}>
                <Sparkles className="h-4 w-4 mr-2" />
                View Sidequest
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
