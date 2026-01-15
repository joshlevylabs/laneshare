'use client'

import { useState } from 'react'
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
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import {
  Loader2,
  Key,
  ExternalLink,
  CheckCircle,
  AlertTriangle,
  Trash2,
  Cloud,
  Settings,
  Copy,
  Terminal,
} from 'lucide-react'

interface CodespacesTokenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: string
  repoName: string
  hasToken: boolean
  onTokenUpdated: () => void
}

export function CodespacesTokenDialog({
  open,
  onOpenChange,
  repoId,
  repoName,
  hasToken,
  onTokenUpdated,
}: CodespacesTokenDialogProps) {
  const { toast } = useToast()
  const [token, setToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [error, setError] = useState('')
  const [copiedSection, setCopiedSection] = useState<string | null>(null)

  const handleSaveToken = async () => {
    if (!token.trim()) {
      setError('Please enter a GitHub personal access token')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/repos/${repoId}/codespaces-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save token')
      }

      toast({
        title: 'Token Configured',
        description: 'GitHub Codespaces access has been enabled for this repository.',
      })

      setToken('')
      onTokenUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save token')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRemoveToken = async () => {
    setIsRemoving(true)
    setError('')

    try {
      const response = await fetch(`/api/repos/${repoId}/codespaces-token`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to remove token')
      }

      toast({
        title: 'Token Removed',
        description: 'GitHub Codespaces access has been disabled for this repository.',
      })

      onTokenUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove token')
    } finally {
      setIsRemoving(false)
    }
  }

  const handleCopy = async (text: string, section: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedSection(section)
    setTimeout(() => setCopiedSection(null), 2000)
  }

  // Devcontainer.json template - includes ttyd for embedded terminal access
  const devcontainerJson = `{
  "name": "LaneShare Workspace",
  "image": "mcr.microsoft.com/devcontainers/universal:2",
  "features": {
    "ghcr.io/devcontainers/features/node:1": {
      "version": "20"
    }
  },
  "forwardPorts": [7681],
  "portsAttributes": {
    "7681": {
      "label": "Terminal",
      "onAutoForward": "silent"
    }
  },
  "postCreateCommand": "npm install -g @anthropic-ai/claude-code && sudo apt-get update && sudo apt-get install -y ttyd",
  "postStartCommand": "nohup ttyd -W -p 7681 bash > /tmp/ttyd.log 2>&1 &",
  "customizations": {
    "vscode": {
      "extensions": [
        "anthropics.claude-code"
      ]
    }
  }
}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Workspace Setup
          </DialogTitle>
          <DialogDescription>
            Configure Codespaces and Claude Code for <strong>{repoName}</strong>
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="github" className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="github" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              GitHub Token
            </TabsTrigger>
            <TabsTrigger value="bridge" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Claude Code Setup
            </TabsTrigger>
          </TabsList>

          {/* GitHub Token Tab */}
          <TabsContent value="github" className="space-y-4 mt-4">
            {/* Current status */}
            {hasToken && (
              <Alert className="border-green-500/30 bg-green-50 dark:bg-green-950/20">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800 dark:text-green-200">
                  GitHub token is configured. You can create Codespaces for this repo.
                </AlertDescription>
              </Alert>
            )}

            {/* Instructions */}
            <div className="rounded-md border bg-muted/30 p-4 space-y-3">
              <p className="font-medium text-sm">To enable Codespaces:</p>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>
                  <a
                    href="https://github.com/settings/tokens/new?scopes=codespace,repo"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Create a GitHub Personal Access Token
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>
                  Select the <code className="bg-muted px-1 rounded text-xs">codespace</code> and{' '}
                  <code className="bg-muted px-1 rounded text-xs">repo</code> scopes
                </li>
                <li>Copy the token and paste it below</li>
              </ol>
            </div>

            {/* Token input */}
            <div className="space-y-2">
              <Label htmlFor="token" className="flex items-center gap-2">
                <Key className="h-4 w-4" />
                GitHub Personal Access Token
              </Label>
              <Input
                id="token"
                type="password"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value)
                  setError('')
                }}
                placeholder={hasToken ? '••••••••••••••••••••' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                {hasToken
                  ? 'Enter a new token to update, or leave empty to keep the current one'
                  : 'Your token will be encrypted and stored securely'}
              </p>
            </div>

            {/* Required scopes info */}
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Required scopes:</strong>{' '}
                <code className="text-xs bg-muted px-1 rounded">codespace</code>,{' '}
                <code className="text-xs bg-muted px-1 rounded">repo</code>
              </AlertDescription>
            </Alert>

            {/* Error */}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            <div className="flex justify-between gap-2 pt-2">
              {hasToken && (
                <Button
                  variant="outline"
                  onClick={handleRemoveToken}
                  disabled={isRemoving || isLoading}
                  className="text-destructive hover:text-destructive"
                >
                  {isRemoving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Remove Token
                </Button>
              )}

              <Button
                onClick={handleSaveToken}
                disabled={isLoading || (!token.trim() && !hasToken)}
                className={hasToken ? '' : 'ml-auto'}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Validating...
                  </>
                ) : hasToken ? (
                  'Update Token'
                ) : (
                  'Save Token'
                )}
              </Button>
            </div>
          </TabsContent>

          {/* Claude Code Setup Tab */}
          <TabsContent value="bridge" className="space-y-4 mt-4">
            <Alert className="border-blue-500/30 bg-blue-50 dark:bg-blue-950/20">
              <Terminal className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800 dark:text-blue-200">
                Claude Code uses your personal Claude subscription. Each user logs in with their own account.
              </AlertDescription>
            </Alert>

            {/* Step 1: Devcontainer */}
            <div className="space-y-3">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">1</span>
                Add devcontainer.json to your repository
              </h4>
              <p className="text-sm text-muted-foreground">
                Create <code className="bg-muted px-1 rounded text-xs">.devcontainer/devcontainer.json</code> in your repo:
              </p>
              <div className="relative">
                <pre className="p-3 bg-muted rounded-lg text-xs overflow-x-auto max-h-48">
                  <code>{devcontainerJson}</code>
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2 h-7"
                  onClick={() => handleCopy(devcontainerJson, 'devcontainer')}
                >
                  {copiedSection === 'devcontainer' ? (
                    <CheckCircle className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>

            {/* Step 2: Create Codespace */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">2</span>
                Create a Codespace
              </h4>
              <p className="text-sm text-muted-foreground">
                Go to the <strong>Workspace</strong> tab and create a Codespace for this repository.
              </p>
            </div>

            {/* Step 3: Claude Login */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">3</span>
                Login to Claude Code
              </h4>
              <p className="text-sm text-muted-foreground">
                In the Codespace terminal, run:
              </p>
              <div className="relative">
                <pre className="p-3 bg-muted rounded-lg text-sm font-mono">
                  claude login
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-1.5 right-2 h-7"
                  onClick={() => handleCopy('claude login', 'login')}
                >
                  {copiedSection === 'login' ? (
                    <CheckCircle className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This authenticates Claude Code with your personal Claude subscription (Max/Pro).
              </p>
            </div>

            {/* Step 4: Start coding */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">4</span>
                Start coding with Claude
              </h4>
              <p className="text-sm text-muted-foreground">
                Once logged in, you can use Claude Code in the Codespace terminal:
              </p>
              <div className="relative">
                <pre className="p-3 bg-muted rounded-lg text-sm font-mono">
                  claude
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-1.5 right-2 h-7"
                  onClick={() => handleCopy('claude', 'start')}
                >
                  {copiedSection === 'start' ? (
                    <CheckCircle className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Note:</strong> Claude Code uses your personal Claude subscription (Max/Pro plan).
                You won&apos;t be charged API tokens - it uses your monthly subscription quota.
              </AlertDescription>
            </Alert>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
