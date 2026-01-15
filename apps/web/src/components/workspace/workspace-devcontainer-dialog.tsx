'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Copy, CheckCircle, Settings, FileCode, Terminal } from 'lucide-react'

interface WorkspaceDevcontainerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  sessionId: string
  apiKey?: string
}

export function WorkspaceDevcontainerDialog({
  open,
  onOpenChange,
  projectId,
  sessionId,
  apiKey,
}: WorkspaceDevcontainerDialogProps) {
  const [copiedSection, setCopiedSection] = useState<string | null>(null)

  const apiUrl = typeof window !== 'undefined' ? window.location.origin : 'https://laneshare.dev'

  const devcontainerJson = `{
  "name": "LaneShare Workspace",
  "image": "mcr.microsoft.com/devcontainers/universal:2",
  "features": {
    "ghcr.io/devcontainers/features/node:1": {
      "version": "20"
    }
  },
  "postStartCommand": "npx @laneshare/bridge start",
  "secrets": {
    "LANESHARE_API_KEY": {
      "description": "LaneShare Bridge API Key"
    }
  },
  "containerEnv": {
    "LANESHARE_API_URL": "${apiUrl}",
    "LANESHARE_PROJECT_ID": "${projectId}",
    "LANESHARE_SESSION_ID": "${sessionId}"
  },
  "customizations": {
    "vscode": {
      "extensions": [
        "anthropics.claude-code"
      ]
    }
  }
}`

  const manualCommand = `npx @laneshare/bridge start \\
  --api-url ${apiUrl} \\
  --project ${projectId} \\
  --session ${sessionId} \\
  --api-key YOUR_API_KEY`

  const handleCopy = async (text: string, section: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedSection(section)
    setTimeout(() => setCopiedSection(null), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Connect Bridge Agent
          </DialogTitle>
          <DialogDescription>
            Set up the bridge agent to connect your Codespace to LaneShare
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="devcontainer" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="devcontainer" className="flex items-center gap-2">
              <FileCode className="h-4 w-4" />
              Dev Container (Auto)
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              Manual
            </TabsTrigger>
          </TabsList>

          <TabsContent value="devcontainer" className="space-y-4 mt-4">
            <Alert>
              <AlertDescription>
                Add this <code className="text-xs bg-muted px-1 rounded">.devcontainer/devcontainer.json</code> to your repository.
                The bridge will auto-start when you open the Codespace.
              </AlertDescription>
            </Alert>

            <div className="relative">
              <pre className="p-4 bg-muted rounded-lg text-sm overflow-x-auto">
                <code>{devcontainerJson}</code>
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2 right-2"
                onClick={() => handleCopy(devcontainerJson, 'devcontainer')}
              >
                {copiedSection === 'devcontainer' ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>

            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Steps:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Create <code className="bg-muted px-1 rounded">.devcontainer/devcontainer.json</code> in your repo</li>
                <li>Paste the configuration above</li>
                <li>Commit and push the changes</li>
                <li>In GitHub, go to Settings → Secrets → Codespaces</li>
                <li>Add <code className="bg-muted px-1 rounded">LANESHARE_API_KEY</code> with your bridge API key</li>
                <li>Create a new Codespace from this repository</li>
              </ol>
            </div>

            {!apiKey && (
              <Alert variant="destructive">
                <AlertDescription>
                  You need to create a Bridge API Key first. Go to Project Settings → Bridge API Keys.
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          <TabsContent value="manual" className="space-y-4 mt-4">
            <Alert>
              <AlertDescription>
                Run this command in your Codespace terminal to manually start the bridge agent.
              </AlertDescription>
            </Alert>

            <div className="relative">
              <pre className="p-4 bg-muted rounded-lg text-sm overflow-x-auto">
                <code>{manualCommand}</code>
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2 right-2"
                onClick={() => handleCopy(manualCommand, 'manual')}
              >
                {copiedSection === 'manual' ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>

            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Steps:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Open your Codespace in the browser or VS Code</li>
                <li>Open a terminal</li>
                <li>Replace <code className="bg-muted px-1 rounded">YOUR_API_KEY</code> with your bridge API key</li>
                <li>Run the command above</li>
                <li>Keep the terminal open while working</li>
              </ol>
            </div>

            <Alert>
              <AlertDescription className="text-xs">
                <strong>Tip:</strong> You can also set environment variables instead of passing flags:
                <br />
                <code className="bg-muted px-1 rounded">export LANESHARE_API_KEY=your_key</code>
              </AlertDescription>
            </Alert>
          </TabsContent>
        </Tabs>

        <div className="mt-4 pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            The bridge agent connects Claude Code in your Codespace to LaneShare,
            enabling real-time file activity streaming and remote prompting.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
