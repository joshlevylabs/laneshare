'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Plus, CheckCircle2, FileJson, ChevronDown, X, Key } from 'lucide-react'

interface ConnectOpenApiDialogProps {
  projectId: string
}

interface ValidationResult {
  ok: boolean
  title?: string
  version?: string
  description?: string
  base_url?: string
  endpoint_count?: number
  schema_count?: number
  tag_count?: number
  suggested_slug?: string
}

interface HeaderEntry {
  key: string
  value: string
}

export function ConnectOpenApiDialog({ projectId }: ConnectOpenApiDialogProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'form' | 'validating' | 'success'>('form')
  const [isLoading, setIsLoading] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [openapiUrl, setOpenapiUrl] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [headers, setHeaders] = useState<HeaderEntry[]>([])

  const addHeader = () => {
    setHeaders([...headers, { key: '', value: '' }])
  }

  const removeHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index))
  }

  const updateHeader = (index: number, field: 'key' | 'value', value: string) => {
    const newHeaders = [...headers]
    newHeaders[index][field] = value
    setHeaders(newHeaders)
  }

  const getHeadersObject = (): Record<string, string> | undefined => {
    const validHeaders = headers.filter((h) => h.key.trim() && h.value.trim())
    if (validHeaders.length === 0) return undefined
    return Object.fromEntries(validHeaders.map((h) => [h.key, h.value]))
  }

  const handleValidate = async () => {
    setIsLoading(true)
    setStep('validating')

    try {
      const response = await fetch(`/api/projects/${projectId}/services/openapi/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openapi_url: openapiUrl,
          headers: getHeadersObject(),
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Validation failed')
      }

      setValidationResult(result)

      // Auto-fill display name if not set
      if (!displayName && result.title) {
        setDisplayName(result.title)
      }

      // Show summary before connecting
      setStep('form')
      setIsLoading(false)
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Validation failed',
        description: error instanceof Error ? error.message : 'Could not validate OpenAPI spec',
      })
      setStep('form')
      setIsLoading(false)
    }
  }

  const handleConnect = async () => {
    setIsLoading(true)
    setStep('validating')

    try {
      const response = await fetch(`/api/projects/${projectId}/services/openapi/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openapi_url: openapiUrl,
          display_name: displayName || validationResult?.title || extractApiName(openapiUrl),
          headers: getHeadersObject(),
          api_slug: validationResult?.suggested_slug,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Connection failed')
      }

      setStep('success')

      toast({
        title: 'Connected successfully',
        description: 'OpenAPI spec is now connected. Starting initial sync...',
      })

      // Trigger initial sync
      await fetch(`/api/projects/${projectId}/services/openapi/sync`, {
        method: 'POST',
      })

      router.refresh()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Connection failed',
        description: error instanceof Error ? error.message : 'Could not connect',
      })
      setStep('form')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setOpen(false)
    setStep('form')
    setOpenapiUrl('')
    setDisplayName('')
    setHeaders([])
    setValidationResult(null)
    setShowAdvanced(false)
  }

  const extractApiName = (url: string): string => {
    try {
      const hostname = new URL(url).hostname
      return hostname.split('.')[0] || 'API'
    } catch {
      return 'API'
    }
  }

  const isValid = openapiUrl.length > 0

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Connect OpenAPI
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            Connect OpenAPI / Swagger
          </DialogTitle>
          <DialogDescription>
            Connect an OpenAPI or Swagger spec to sync API endpoints and schemas.
          </DialogDescription>
        </DialogHeader>

        {step === 'form' && (
          <>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="openapi-url">OpenAPI Spec URL</Label>
                <Input
                  id="openapi-url"
                  placeholder="https://api.example.com/openapi.json"
                  value={openapiUrl}
                  onChange={(e) => {
                    setOpenapiUrl(e.target.value)
                    setValidationResult(null)
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Enter the URL to your OpenAPI 3.x or Swagger 2.0 spec (JSON or YAML).
                </p>
              </div>

              {validationResult && (
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-md text-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="font-medium">Spec validated</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">{validationResult.title}</span>
                      <span className="text-xs ml-1">v{validationResult.version}</span>
                    </div>
                    <div className="text-right">
                      {validationResult.endpoint_count} endpoints
                    </div>
                    {validationResult.base_url && (
                      <div className="col-span-2 text-xs truncate">
                        Base: {validationResult.base_url}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="display-name">Display Name</Label>
                <Input
                  id="display-name"
                  placeholder={validationResult?.title || 'My API'}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  A friendly name for this API connection.
                </p>
              </div>

              <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between">
                    Advanced Options
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="flex items-center gap-2">
                        <Key className="h-4 w-4" />
                        Custom Headers
                      </Label>
                      <Button type="button" variant="outline" size="sm" onClick={addHeader}>
                        <Plus className="h-3 w-3 mr-1" />
                        Add
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Add headers to authenticate when fetching the spec (e.g., Authorization).
                      These will be encrypted.
                    </p>
                    {headers.map((header, index) => (
                      <div key={index} className="flex gap-2">
                        <Input
                          placeholder="Header name"
                          value={header.key}
                          onChange={(e) => updateHeader(index, 'key', e.target.value)}
                          className="flex-1"
                        />
                        <Input
                          type="password"
                          placeholder="Value"
                          value={header.value}
                          onChange={(e) => updateHeader(index, 'value', e.target.value)}
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeHeader(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              {!validationResult ? (
                <Button onClick={handleValidate} disabled={!isValid || isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Test Connection
                </Button>
              ) : (
                <Button onClick={handleConnect} disabled={isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Connect & Sync
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {step === 'validating' && (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              {validationResult ? 'Connecting and syncing...' : 'Validating OpenAPI spec...'}
            </p>
          </div>
        )}

        {step === 'success' && (
          <div className="py-8 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-green-600" />
            <p className="mt-4 font-medium">Connected Successfully!</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Initial sync is running in the background.
            </p>
            <Button className="mt-4" onClick={handleClose}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
