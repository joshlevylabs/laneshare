'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Maximize2,
  Minimize2,
  Terminal as TerminalIcon,
  X,
  ExternalLink,
  Code2,
  Copy,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface WorkspaceTerminalProps {
  codespaceUrl: string
  codespaceName: string
  repoName: string
  onClose?: () => void
  isActive?: boolean
}

type ViewMode = 'embedded' | 'terminal' | 'instructions'

export function WorkspaceTerminal({
  codespaceUrl,
  codespaceName,
  repoName,
  onClose,
  isActive = true,
}: WorkspaceTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<any>(null)
  const fitAddonRef = useRef<any>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Default to 'terminal' to try connecting automatically
  const [viewMode, setViewMode] = useState<ViewMode>('terminal')
  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null)
  const [connectionAttempt, setConnectionAttempt] = useState(0)

  // Terminal WebSocket URL for ttyd
  const getTerminalWsUrl = useCallback(() => {
    const port = 7681
    return `wss://${codespaceName}-${port}.app.github.dev/ws`
  }, [codespaceName])

  // Retry connection function
  const retryConnection = useCallback(() => {
    setTerminalError(null)
    wsRef.current?.close()
    xtermRef.current?.dispose()
    xtermRef.current = null
    setConnectionAttempt((prev) => prev + 1)
  }, [])

  // Initialize terminal (for ttyd mode)
  useEffect(() => {
    if (viewMode !== 'terminal' || !terminalRef.current || !isActive) return

    let mounted = true

    const initTerminal = async () => {
      setIsConnecting(true)
      setTerminalError(null)

      try {
        const { Terminal } = await import('xterm')
        const { FitAddon } = await import('xterm-addon-fit')
        const { WebLinksAddon } = await import('xterm-addon-web-links')
        await import('xterm/css/xterm.css')

        if (!mounted || !terminalRef.current) return

        const term = new Terminal({
          cursorBlink: true,
          fontSize: 14,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          theme: {
            background: '#1e1e1e',
            foreground: '#d4d4d4',
            cursor: '#d4d4d4',
            cursorAccent: '#1e1e1e',
            selectionBackground: '#264f78',
          },
        })

        const fitAddon = new FitAddon()
        const webLinksAddon = new WebLinksAddon()

        term.loadAddon(fitAddon)
        term.loadAddon(webLinksAddon)
        term.open(terminalRef.current)
        fitAddon.fit()

        xtermRef.current = term
        fitAddonRef.current = fitAddon

        term.write('\x1b[90mConnecting to Codespace terminal...\x1b[0m\r\n')

        // Try to connect to ttyd
        const wsUrl = getTerminalWsUrl()
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          setIsConnecting(false)
          setIsConnected(true)
          term.write('\r\n\x1b[32m✓ Connected to Codespace terminal\x1b[0m\r\n')
          term.write('\x1b[90mRun "claude login" then "claude" to start coding with AI\x1b[0m\r\n\r\n')
        }

        ws.onmessage = (event) => {
          if (typeof event.data === 'string') {
            term.write(event.data)
          } else if (event.data instanceof Blob) {
            event.data.arrayBuffer().then((buffer) => {
              term.write(new Uint8Array(buffer))
            })
          }
        }

        ws.onerror = () => {
          setTerminalError('Terminal not available. ttyd needs to be running in your Codespace.')
          setIsConnecting(false)
          setIsConnected(false)
        }

        ws.onclose = () => {
          if (mounted && isConnected) {
            setIsConnected(false)
          }
        }

        term.onData((data: string) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data)
          }
        })

        const resizeObserver = new ResizeObserver(() => {
          if (fitAddonRef.current) {
            fitAddonRef.current.fit()
          }
        })
        resizeObserver.observe(terminalRef.current)

        return () => resizeObserver.disconnect()
      } catch (err) {
        console.error('Failed to initialize terminal:', err)
        setTerminalError('Failed to initialize terminal')
        setIsConnecting(false)
      }
    }

    initTerminal()

    return () => {
      mounted = false
      wsRef.current?.close()
      xtermRef.current?.dispose()
    }
  }, [viewMode, isActive, getTerminalWsUrl, connectionAttempt])

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedCommand(id)
    setTimeout(() => setCopiedCommand(null), 2000)
  }

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen)
    setTimeout(() => fitAddonRef.current?.fit(), 100)
  }

  const openInNewTab = () => {
    window.open(codespaceUrl, '_blank')
  }

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-[#1e1e1e] rounded-lg overflow-hidden border border-border',
        isFullscreen && 'fixed inset-4 z-50'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#252526] border-b border-[#3c3c3c]">
        <div className="flex items-center gap-2">
          <TerminalIcon className="h-4 w-4 text-gray-400" />
          <span className="text-sm text-gray-300 font-medium">{repoName}</span>
          {viewMode === 'terminal' && (
            <Badge
              variant="outline"
              className={cn(
                'text-xs',
                isConnected
                  ? 'border-green-500/50 text-green-400'
                  : isConnecting
                  ? 'border-yellow-500/50 text-yellow-400'
                  : 'border-red-500/50 text-red-400'
              )}
            >
              {isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-gray-400 hover:text-gray-200"
            onClick={openInNewTab}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            New Tab
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-gray-400 hover:text-gray-200"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-gray-400 hover:text-red-400"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* View mode tabs */}
      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)} className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b border-[#3c3c3c] bg-[#252526] h-8">
          <TabsTrigger value="embedded" className="text-xs data-[state=active]:bg-[#1e1e1e]">
            <Code2 className="h-3 w-3 mr-1" />
            VS Code
          </TabsTrigger>
          <TabsTrigger value="terminal" className="text-xs data-[state=active]:bg-[#1e1e1e]">
            <TerminalIcon className="h-3 w-3 mr-1" />
            Terminal
          </TabsTrigger>
          <TabsTrigger value="instructions" className="text-xs data-[state=active]:bg-[#1e1e1e]">
            Setup
          </TabsTrigger>
        </TabsList>

        {/* VS Code - Opens in new tab due to GitHub CSP restrictions */}
        <TabsContent value="embedded" className="flex-1 m-0 relative">
          <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e]">
            <div className="text-center max-w-md px-4">
              <Code2 className="h-12 w-12 text-blue-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-200 mb-2">Open VS Code</h3>
              <p className="text-sm text-gray-400 mb-4">
                GitHub Codespaces cannot be embedded in other websites due to security restrictions.
                Click below to open VS Code in a new browser tab.
              </p>
              <Button size="lg" onClick={openInNewTab} className="mb-4">
                <ExternalLink className="h-4 w-4 mr-2" />
                Open VS Code in New Tab
              </Button>
              <p className="text-xs text-gray-500">
                Tip: Use the <span className="text-gray-400">Setup</span> tab to see how to run Claude Code
              </p>
            </div>
          </div>
        </TabsContent>

        {/* Terminal (ttyd) */}
        <TabsContent value="terminal" className="flex-1 m-0 relative">
          {terminalError && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e] z-10">
              <div className="text-center max-w-lg px-4">
                <AlertTriangle className="h-10 w-10 text-yellow-500 mx-auto mb-3" />
                <h3 className="text-lg font-medium text-gray-200 mb-2">Terminal Setup Required</h3>
                <p className="text-sm text-gray-400 mb-4">
                  To use the embedded terminal, ttyd needs to be running in your Codespace.
                </p>

                <div className="bg-[#252526] rounded-lg p-4 mb-4 text-left">
                  <p className="text-xs text-gray-400 mb-2">Run this in your Codespace terminal:</p>
                  <div className="relative">
                    <pre className="bg-[#1e1e1e] p-2 rounded text-xs text-gray-300 pr-10 overflow-x-auto">
                      sudo apt-get update && sudo apt-get install -y ttyd && ttyd -W -p 7681 bash
                    </pre>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-1 right-1 h-6 w-6 p-0 text-gray-400 hover:text-gray-200"
                      onClick={() => handleCopy('sudo apt-get update && sudo apt-get install -y ttyd && ttyd -W -p 7681 bash', 'ttyd-error')}
                    >
                      {copiedCommand === 'ttyd-error' ? (
                        <CheckCircle className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="flex gap-2 justify-center">
                  <Button size="sm" onClick={retryConnection}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry Connection
                  </Button>
                  <Button variant="outline" size="sm" onClick={openInNewTab}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open VS Code
                  </Button>
                </div>
              </div>
            </div>
          )}
          {isConnecting && !terminalError && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e] z-10">
              <div className="text-center">
                <Loader2 className="h-8 w-8 text-blue-400 mx-auto mb-2 animate-spin" />
                <p className="text-gray-400">Connecting to terminal...</p>
              </div>
            </div>
          )}
          <div ref={terminalRef} className={cn('h-full', (terminalError || isConnecting) && 'opacity-0')} />
        </TabsContent>

        {/* Setup instructions */}
        <TabsContent value="instructions" className="flex-1 m-0 overflow-auto bg-[#1e1e1e]">
          <div className="p-6 max-w-2xl mx-auto">
            <h3 className="text-lg font-semibold text-gray-200 mb-4">Setup Claude Code in your Codespace</h3>

            {/* Enable embedded terminal - now first and prominent */}
            <div className="mb-6 p-4 bg-blue-950/30 rounded-lg border border-blue-500/30">
              <h4 className="text-gray-200 font-medium mb-2 flex items-center gap-2">
                <TerminalIcon className="h-4 w-4 text-blue-400" />
                Enable Embedded Terminal (Recommended)
              </h4>
              <p className="text-sm text-gray-400 mb-3">
                Run this one-time setup command in your Codespace to enable the Terminal tab:
              </p>
              <div className="relative">
                <pre className="bg-[#1e1e1e] p-3 rounded text-xs text-gray-300 pr-12 overflow-x-auto">
                  sudo apt-get update && sudo apt-get install -y ttyd && ttyd -W -p 7681 bash
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-1.5 right-1.5 h-7 w-7 p-0 text-gray-400 hover:text-gray-200"
                  onClick={() => handleCopy('sudo apt-get update && sudo apt-get install -y ttyd && ttyd -W -p 7681 bash', 'ttyd')}
                >
                  {copiedCommand === 'ttyd' ? (
                    <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={openInNewTab}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open VS Code to Run Command
                </Button>
                <Button size="sm" onClick={retryConnection}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Then Click Here to Connect
                </Button>
              </div>
            </div>

            <div className="space-y-6">
              {/* Step 1: Install Claude Code */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-medium">
                  1
                </div>
                <div className="flex-1">
                  <h4 className="text-gray-200 font-medium mb-2">Install Claude Code</h4>
                  <p className="text-sm text-gray-400 mb-3">
                    In the Codespace terminal, run:
                  </p>
                  <div className="relative">
                    <pre className="bg-[#252526] p-3 rounded text-sm text-gray-300 pr-12">
                      npm install -g @anthropic-ai/claude-code
                    </pre>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-1.5 right-1.5 h-7 w-7 p-0 text-gray-400 hover:text-gray-200"
                      onClick={() => handleCopy('npm install -g @anthropic-ai/claude-code', 'install')}
                    >
                      {copiedCommand === 'install' ? (
                        <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Step 2: Login */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-medium">
                  2
                </div>
                <div className="flex-1">
                  <h4 className="text-gray-200 font-medium mb-2">Login to Claude</h4>
                  <p className="text-sm text-gray-400 mb-3">
                    Authenticate with your Claude subscription (Max/Pro):
                  </p>
                  <div className="relative">
                    <pre className="bg-[#252526] p-3 rounded text-sm text-gray-300 pr-12">
                      claude login
                    </pre>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-1.5 right-1.5 h-7 w-7 p-0 text-gray-400 hover:text-gray-200"
                      onClick={() => handleCopy('claude login', 'login')}
                    >
                      {copiedCommand === 'login' ? (
                        <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Step 3: Start Claude */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-medium">
                  3
                </div>
                <div className="flex-1">
                  <h4 className="text-gray-200 font-medium mb-2">Start Claude Code</h4>
                  <p className="text-sm text-gray-400 mb-3">
                    Launch Claude Code to start coding:
                  </p>
                  <div className="relative">
                    <pre className="bg-[#252526] p-3 rounded text-sm text-gray-300 pr-12">
                      claude
                    </pre>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-1.5 right-1.5 h-7 w-7 p-0 text-gray-400 hover:text-gray-200"
                      onClick={() => handleCopy('claude', 'start')}
                    >
                      {copiedCommand === 'start' ? (
                        <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* devcontainer tip */}
              <div className="mt-8 p-4 bg-[#252526] rounded-lg border border-[#3c3c3c]">
                <h4 className="text-gray-200 font-medium mb-2 flex items-center gap-2">
                  <Code2 className="h-4 w-4" />
                  Pro Tip: Auto-start ttyd
                </h4>
                <p className="text-sm text-gray-400 mb-3">
                  Add this to your <code className="text-blue-400">.devcontainer/devcontainer.json</code> to auto-start ttyd:
                </p>
                <div className="relative">
                  <pre className="bg-[#1e1e1e] p-3 rounded text-xs text-gray-300 pr-12 overflow-x-auto">
{`"postStartCommand": "ttyd -W -p 7681 bash &",
"forwardPorts": [7681]`}
                  </pre>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1.5 right-1.5 h-7 w-7 p-0 text-gray-400 hover:text-gray-200"
                    onClick={() => handleCopy('"postStartCommand": "ttyd -W -p 7681 bash &",\n"forwardPorts": [7681]', 'devcontainer')}
                  >
                    {copiedCommand === 'devcontainer' ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
