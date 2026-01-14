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
import { Loader2, CheckCircle, XCircle, Terminal, Server } from 'lucide-react'

interface WorkspaceConnectionSetupProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentUrl: string
  onConnect: (url: string) => void
}

export function WorkspaceConnectionSetup({
  open,
  onOpenChange,
  currentUrl,
  onConnect,
}: WorkspaceConnectionSetupProps) {
  const [url, setUrl] = useState(currentUrl || 'http://localhost:7890')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const testConnection = async () => {
    setTestStatus('testing')
    setErrorMessage('')

    try {
      const response = await fetch(`${url}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })

      if (response.ok) {
        setTestStatus('success')
      } else {
        setTestStatus('error')
        setErrorMessage(`Server responded with status ${response.status}`)
      }
    } catch (error) {
      setTestStatus('error')
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          setErrorMessage('Connection timed out. Is the server running?')
        } else {
          setErrorMessage('Could not connect to server. Make sure the local bridge is running.')
        }
      } else {
        setErrorMessage('An unexpected error occurred')
      }
    }
  }

  const handleConnect = () => {
    onConnect(url)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Connect to Local Server
          </DialogTitle>
          <DialogDescription>
            Configure the connection to your local Claude Code bridge server.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert>
            <Terminal className="h-4 w-4" />
            <AlertDescription>
              To use the Workspace feature, you need to run the local Claude Code bridge server
              on your machine. This allows LaneShare to communicate with Claude Code sessions.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="server-url">Server URL</Label>
            <Input
              id="server-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setTestStatus('idle')
              }}
              placeholder="http://localhost:7890"
            />
            <p className="text-xs text-muted-foreground">
              Default: http://localhost:7890
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={testStatus === 'testing'}
            >
              {testStatus === 'testing' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Test Connection
            </Button>

            {testStatus === 'success' && (
              <div className="flex items-center gap-1 text-green-600 text-sm">
                <CheckCircle className="h-4 w-4" />
                Connected
              </div>
            )}

            {testStatus === 'error' && (
              <div className="flex items-center gap-1 text-destructive text-sm">
                <XCircle className="h-4 w-4" />
                Failed
              </div>
            )}
          </div>

          {errorMessage && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className="rounded-md border p-4 space-y-2">
            <p className="font-medium text-sm">How to start the local server:</p>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Open a terminal in your project directory</li>
              <li>Run: <code className="bg-muted px-1 rounded">npx laneshare-bridge</code></li>
              <li>The server will start on port 7890 by default</li>
            </ol>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConnect} disabled={testStatus !== 'success'}>
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
