'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ArrowLeft,
  Check,
  Loader2,
  Boxes,
} from 'lucide-react'

interface NewSystemWizardProps {
  projectId: string
  projectName: string
}

export function NewSystemWizard({
  projectId,
  projectName,
}: NewSystemWizardProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) {
      setError('System name is required')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}/systems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create system')
      }

      // Redirect to the new system's page
      router.push(`/projects/${projectId}/systems/${data.id}`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create system'
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }, [projectId, name, description, router])

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/projects/${projectId}/systems`)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Systems
        </Button>
        <h1 className="text-2xl font-bold flex items-center gap-2 mt-2">
          <Boxes className="h-6 w-6" />
          New System
        </h1>
        <p className="text-muted-foreground">
          Create a new system flowchart for {projectName}
        </p>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>System Details</CardTitle>
          <CardDescription>
            Give your system a name and optional description. You can build the flowchart after creating it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">System Name *</Label>
            <Input
              id="name"
              placeholder="e.g., Authentication Flow, Payment Processing, User Onboarding"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Briefly describe what this system does and its purpose..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => router.push(`/projects/${projectId}/systems`)}
        >
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={isSubmitting || !name.trim()}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-2" />
              Create System
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
