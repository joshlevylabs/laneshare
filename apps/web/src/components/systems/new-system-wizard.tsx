'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Plus,
  X,
  Boxes,
} from 'lucide-react'

interface NewSystemWizardProps {
  projectId: string
  projectName: string
  repos: Array<{ id: string; owner: string; name: string }>
}

type WizardStep = 'basics' | 'scope' | 'repos' | 'review'

export function NewSystemWizard({
  projectId,
  projectName,
  repos,
}: NewSystemWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState<WizardStep>('basics')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [inScope, setInScope] = useState('')
  const [outOfScope, setOutOfScope] = useState('')
  const [keywords, setKeywords] = useState<string[]>([])
  const [keywordInput, setKeywordInput] = useState('')
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>([])

  const addKeyword = useCallback(() => {
    const kw = keywordInput.trim().toLowerCase()
    if (kw && !keywords.includes(kw)) {
      setKeywords([...keywords, kw])
    }
    setKeywordInput('')
  }, [keywordInput, keywords])

  const removeKeyword = useCallback((kw: string) => {
    setKeywords(keywords.filter((k) => k !== kw))
  }, [keywords])

  const toggleRepo = useCallback((repoId: string) => {
    setSelectedRepoIds((prev) =>
      prev.includes(repoId)
        ? prev.filter((id) => id !== repoId)
        : [...prev, repoId]
    )
  }, [])

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
          in_scope: inScope.trim() || undefined,
          out_of_scope: outOfScope.trim() || undefined,
          keywords,
          repo_ids: selectedRepoIds.length > 0 ? selectedRepoIds : undefined,
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
  }, [projectId, name, description, inScope, outOfScope, keywords, selectedRepoIds, router])

  const canProceed = step === 'basics' ? name.trim().length > 0 : true

  const steps: { key: WizardStep; label: string }[] = [
    { key: 'basics', label: 'Basics' },
    { key: 'scope', label: 'Scope' },
    { key: 'repos', label: 'Repos' },
    { key: 'review', label: 'Review' },
  ]

  const currentStepIndex = steps.findIndex((s) => s.key === step)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
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
            Define a bounded system within {projectName}
          </p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div
              className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                ${i < currentStepIndex
                  ? 'bg-primary text-primary-foreground'
                  : i === currentStepIndex
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }
              `}
            >
              {i < currentStepIndex ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`ml-2 text-sm ${i === currentStepIndex ? 'font-medium' : 'text-muted-foreground'}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div className={`w-8 h-0.5 mx-2 ${i < currentStepIndex ? 'bg-primary' : 'bg-muted'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <Card>
        <CardHeader>
          <CardTitle>
            {step === 'basics' && 'System Basics'}
            {step === 'scope' && 'Define Scope'}
            {step === 'repos' && 'Select Repositories'}
            {step === 'review' && 'Review & Create'}
          </CardTitle>
          <CardDescription>
            {step === 'basics' && 'Name and describe your system'}
            {step === 'scope' && 'Define what is and isn\'t part of this system'}
            {step === 'repos' && 'Select which repos contain this system\'s code'}
            {step === 'review' && 'Review your system definition before creating'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'basics' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="name">System Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., Authentication, Billing, Repo Sync"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Briefly describe what this system does and its purpose..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Keywords</Label>
                <p className="text-sm text-muted-foreground">
                  Add keywords to help find relevant code and documentation
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Add keyword..."
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addKeyword()
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={addKeyword}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {keywords.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {keywords.map((kw) => (
                      <Badge key={kw} variant="secondary" className="flex items-center gap-1">
                        {kw}
                        <button
                          type="button"
                          onClick={() => removeKeyword(kw)}
                          className="ml-1 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {step === 'scope' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="inScope">In Scope</Label>
                <Textarea
                  id="inScope"
                  placeholder="What IS part of this system? e.g., Login flow, password reset, session management..."
                  value={inScope}
                  onChange={(e) => setInScope(e.target.value)}
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="outOfScope">Out of Scope</Label>
                <Textarea
                  id="outOfScope"
                  placeholder="What is NOT part of this system? e.g., User profile management, billing..."
                  value={outOfScope}
                  onChange={(e) => setOutOfScope(e.target.value)}
                  rows={4}
                />
              </div>
            </>
          )}

          {step === 'repos' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Select the repositories that contain code for this system.
                Leave empty to include all project repos.
              </p>
              {repos.length === 0 ? (
                <p className="text-muted-foreground">
                  No repositories connected to this project yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {repos.map((repo) => (
                    <div
                      key={repo.id}
                      className="flex items-center space-x-2 p-2 rounded border hover:bg-muted/50"
                    >
                      <Checkbox
                        id={repo.id}
                        checked={selectedRepoIds.includes(repo.id)}
                        onCheckedChange={() => toggleRepo(repo.id)}
                      />
                      <Label htmlFor={repo.id} className="flex-1 cursor-pointer">
                        {repo.owner}/{repo.name}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-4">
              <div>
                <Label className="text-muted-foreground">Name</Label>
                <p className="font-medium">{name}</p>
              </div>
              {description && (
                <div>
                  <Label className="text-muted-foreground">Description</Label>
                  <p>{description}</p>
                </div>
              )}
              {inScope && (
                <div>
                  <Label className="text-muted-foreground">In Scope</Label>
                  <p className="whitespace-pre-wrap">{inScope}</p>
                </div>
              )}
              {outOfScope && (
                <div>
                  <Label className="text-muted-foreground">Out of Scope</Label>
                  <p className="whitespace-pre-wrap">{outOfScope}</p>
                </div>
              )}
              {keywords.length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Keywords</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {keywords.map((kw) => (
                      <Badge key={kw} variant="secondary">{kw}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {selectedRepoIds.length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Repositories</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {selectedRepoIds.map((id) => {
                      const repo = repos.find((r) => r.id === id)
                      return repo ? (
                        <Badge key={id} variant="outline">{repo.owner}/{repo.name}</Badge>
                      ) : null
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => {
            const prevStep = steps[currentStepIndex - 1]
            if (prevStep) setStep(prevStep.key)
          }}
          disabled={currentStepIndex === 0}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        {step === 'review' ? (
          <Button onClick={handleSubmit} disabled={isSubmitting}>
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
        ) : (
          <Button
            onClick={() => {
              const nextStep = steps[currentStepIndex + 1]
              if (nextStep) setStep(nextStep.key)
            }}
            disabled={!canProceed}
          >
            Next
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        )}
      </div>
    </div>
  )
}
