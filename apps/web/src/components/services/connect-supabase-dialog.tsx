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
import { useToast } from '@/hooks/use-toast'
import { Loader2, Plus, CheckCircle2, Database } from 'lucide-react'

interface ConnectSupabaseDialogProps {
  projectId: string
}

export function ConnectSupabaseDialog({ projectId }: ConnectSupabaseDialogProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'form' | 'validating' | 'success'>('form')
  const [isLoading, setIsLoading] = useState(false)

  const [supabaseUrl, setSupabaseUrl] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [displayName, setDisplayName] = useState('')

  const handleValidate = async () => {
    setIsLoading(true)
    setStep('validating')

    try {
      const response = await fetch(`/api/projects/${projectId}/services/supabase/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supabase_url: supabaseUrl,
          access_token: accessToken,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Validation failed')
      }

      // Connection valid, proceed to connect
      await handleConnect()
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Validation failed',
        description: error instanceof Error ? error.message : 'Could not validate connection',
      })
      setStep('form')
    } finally {
      setIsLoading(false)
    }
  }

  const handleConnect = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/services/supabase/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supabase_url: supabaseUrl,
          access_token: accessToken,
          display_name: displayName || extractProjectName(supabaseUrl),
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Connection failed')
      }

      setStep('success')

      toast({
        title: 'Connected successfully',
        description: 'Supabase is now connected. Starting initial sync...',
      })

      // Trigger initial sync
      await fetch(`/api/projects/${projectId}/services/supabase/sync`, {
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
    }
  }

  const handleClose = () => {
    setOpen(false)
    setStep('form')
    setSupabaseUrl('')
    setAccessToken('')
    setDisplayName('')
  }

  const extractProjectName = (url: string): string => {
    try {
      const hostname = new URL(url).hostname
      const match = hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)
      return match ? match[1] : 'Supabase Project'
    } catch {
      return 'Supabase Project'
    }
  }

  const isValid = supabaseUrl.length > 0 && accessToken.length > 20

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Connect Supabase
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Connect Supabase
          </DialogTitle>
          <DialogDescription>
            Connect your Supabase project to sync database schema, policies, and more.
          </DialogDescription>
        </DialogHeader>

        {step === 'form' && (
          <>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="supabase-url">Supabase URL</Label>
                <Input
                  id="supabase-url"
                  placeholder="https://your-project.supabase.co"
                  value={supabaseUrl}
                  onChange={(e) => setSupabaseUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Find this in your Supabase dashboard under Project Settings &gt; API
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="access-token">Access Token</Label>
                <Input
                  id="access-token"
                  type="password"
                  placeholder="sbp_..."
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Create an access token at{' '}
                  <a
                    href="https://supabase.com/dashboard/account/tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    supabase.com/dashboard/account/tokens
                  </a>
                  . It will be encrypted and stored securely.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="display-name">Display Name (optional)</Label>
                <Input
                  id="display-name"
                  placeholder="Production Database"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleValidate} disabled={!isValid || isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Test & Connect
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'validating' && (
          <div className="py-8 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              Validating connection and syncing assets...
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
