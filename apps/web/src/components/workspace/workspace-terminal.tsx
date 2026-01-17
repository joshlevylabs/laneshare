'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  Wand2,
  GitBranch,
  MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ClaudeChatUI } from './claude-chat-ui'
import type { ChatMessage, ClaudeStreamMessage, AssistantMessage, ResultMessage } from './claude-chat-types'
import { parseStreamLine } from './claude-chat-types'

interface WorkspaceTerminalProps {
  codespaceUrl: string
  codespaceName: string
  repoName: string
  repoId?: string
  onClose?: () => void
  isActive?: boolean
  // Automation callbacks
  onTerminalConnected?: () => void
  onClaudeReady?: () => void
  // Auto-task: when Claude is ready, send this task automatically
  initialTask?: string
  // Expose sendChatMessage for external control
  sendChatMessageRef?: React.MutableRefObject<((message: string) => void) | null>
}

type ViewMode = 'terminal' | 'instructions' | 'chat'

export function WorkspaceTerminal({
  codespaceUrl,
  codespaceName,
  repoName,
  repoId,
  onClose,
  isActive = true,
  onTerminalConnected,
  onClaudeReady,
  initialTask,
  sendChatMessageRef,
}: WorkspaceTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<any>(null)
  const fitAddonRef = useRef<any>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Check if Claude was previously installed for this Codespace
  const cachedClaudeStatus = typeof window !== 'undefined'
    ? localStorage.getItem(`claude-status-${codespaceName}`)
    : null

  // Default to 'chat' if Claude is known to be installed, otherwise 'terminal'
  const [viewMode, setViewMode] = useState<ViewMode>(
    cachedClaudeStatus === 'installed' ? 'chat' : 'terminal'
  )

  // Set claudeRunning on mount if cached as installed
  useEffect(() => {
    if (cachedClaudeStatus === 'installed') {
      setClaudeStatus('installed')
      setClaudeRunning(true)
    }
  }, [cachedClaudeStatus])
  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const [isSettingUpDevcontainer, setIsSettingUpDevcontainer] = useState(false)
  const [devcontainerSetupResult, setDevcontainerSetupResult] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [claudeStatus, setClaudeStatus] = useState<'checking' | 'installed' | 'not_installed' | 'dismissed'>('checking')
  const [isInstallingClaude, setIsInstallingClaude] = useState(false)
  const [claudeRunning, setClaudeRunning] = useState(false)
  const outputBufferRef = useRef<string>('')

  // Chat mode state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null)
  const [claudeModel, setClaudeModel] = useState<string | null>(null)
  const jsonBufferRef = useRef<string>('')
  const currentToolUseRef = useRef<{ id: string; name: string; input: Record<string, unknown> } | null>(null)

  // Refs to avoid stale closures in WebSocket handler
  const isChatLoadingRef = useRef(false)
  const processClaudeJsonLineRef = useRef<((line: string) => void) | null>(null)

  // Automation refs
  const initialTaskSentRef = useRef(false)
  const terminalConnectedCallbackRef = useRef(false)
  const claudeReadyCallbackRef = useRef(false)

  // Terminal WebSocket URL for ttyd
  const getTerminalWsUrl = useCallback(() => {
    const port = 7681
    return `wss://${codespaceName}-${port}.app.github.dev/ws`
  }, [codespaceName])

  // Retry connection function
  const retryConnection = useCallback(() => {
    setTerminalError(null)
    setClaudeStatus('checking')
    setIsInstallingClaude(false)
    setClaudeRunning(false)
    outputBufferRef.current = ''
    wsRef.current?.close()
    xtermRef.current?.dispose()
    xtermRef.current = null
    setConnectionAttempt((prev) => prev + 1)
  }, [])

  // Auto-setup devcontainer.json
  const setupDevcontainer = useCallback(async () => {
    if (!repoId) return
    setIsSettingUpDevcontainer(true)
    setDevcontainerSetupResult(null)
    try {
      const response = await fetch(`/api/repos/${repoId}/setup-devcontainer`, {
        method: 'POST',
      })
      const data = await response.json()
      if (response.ok) {
        setDevcontainerSetupResult({
          success: true,
          message: data.wasUpdated
            ? 'Updated devcontainer.json - Please rebuild your Codespace'
            : 'Created devcontainer.json - Please rebuild your Codespace',
        })
      } else {
        setDevcontainerSetupResult({
          success: false,
          message: data.error || 'Failed to setup devcontainer',
        })
      }
    } catch (error) {
      setDevcontainerSetupResult({
        success: false,
        message: 'Network error - please try again',
      })
    } finally {
      setIsSettingUpDevcontainer(false)
    }
  }, [repoId])

  // Send a command through the terminal
  const sendTerminalCommand = useCallback((command: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // ttyd expects: '0' + input data
      console.log('[ttyd] Sending command:', command.slice(0, 100))
      wsRef.current.send('0' + command + '\r')
    } else {
      console.log('[ttyd] Cannot send - WebSocket not open')
    }
  }, [])

  // Install Claude Code
  const installClaudeCode = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    setIsInstallingClaude(true)
    // Send the install command, then check again
    sendTerminalCommand('npm install -g @anthropic-ai/claude-code && echo "CLAUDE_INSTALL_COMPLETE"')
  }, [sendTerminalCommand])

  // Keep refs in sync to avoid stale closures
  useEffect(() => {
    isChatLoadingRef.current = isChatLoading
  }, [isChatLoading])

  // Process JSON line from Claude's stream output
  const processClaudeJsonLine = useCallback((line: string) => {
    console.log('[Chat] processClaudeJsonLine:', line.slice(0, 100))
    const parsed = parseStreamLine(line)
    if (!parsed) {
      console.log('[Chat] Failed to parse line')
      return
    }
    console.log('[Chat] Parsed message type:', parsed.type)

    if (parsed.type === 'system' && 'subtype' in parsed && parsed.subtype === 'init') {
      // Init message - capture session info
      setClaudeSessionId(parsed.session_id)
      setClaudeModel(parsed.model)
    } else if (parsed.type === 'assistant') {
      const msg = parsed as AssistantMessage
      // Process assistant content blocks
      for (const block of msg.message.content) {
        if (block.type === 'text') {
          // Text content - add or update assistant message
          setChatMessages((prev) => {
            const lastMsg = prev[prev.length - 1]
            if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.toolUse && lastMsg.isStreaming) {
              // Update existing streaming message
              return [
                ...prev.slice(0, -1),
                { ...lastMsg, content: lastMsg.content + block.text },
              ]
            } else {
              // New assistant message
              return [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: block.text,
                  timestamp: new Date(),
                  isStreaming: true,
                },
              ]
            }
          })
        } else if (block.type === 'tool_use') {
          // Tool use - store for later pairing with result
          currentToolUseRef.current = {
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          }
          // Add tool use message (will be updated with result)
          setChatMessages((prev) => [
            ...prev,
            {
              id: block.id,
              role: 'assistant',
              content: '',
              timestamp: new Date(),
              toolUse: currentToolUseRef.current!,
            },
          ])
        }
      }
    } else if (parsed.type === 'user') {
      // User message (usually tool results)
      for (const block of parsed.message.content) {
        if (block.type === 'tool_result') {
          // Update the corresponding tool use message with result
          setChatMessages((prev) =>
            prev.map((msg) =>
              msg.toolUse?.id === block.tool_use_id
                ? {
                    ...msg,
                    toolResult: {
                      toolUseId: block.tool_use_id,
                      content: block.content,
                      isError: block.is_error,
                    },
                  }
                : msg
            )
          )
        }
      }
    } else if (parsed.type === 'result') {
      const result = parsed as ResultMessage
      // Mark streaming as complete
      setChatMessages((prev) =>
        prev.map((msg) => (msg.isStreaming ? { ...msg, isStreaming: false } : msg))
      )
      setIsChatLoading(false)
      // Update session ID for continuation
      if (result.session_id) {
        setClaudeSessionId(result.session_id)
      }
    }
  }, [])

  // Keep processClaudeJsonLine ref in sync
  useEffect(() => {
    processClaudeJsonLineRef.current = processClaudeJsonLine
  }, [processClaudeJsonLine])

  // Send a chat message to Claude
  const sendChatMessage = useCallback((message: string) => {
    console.log('[Chat] sendChatMessage called:', message)
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.log('[Chat] WebSocket not ready, state:', wsRef.current?.readyState)
      return
    }

    // Add user message to chat
    setChatMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: message,
        timestamp: new Date(),
      },
    ])

    setIsChatLoading(true)
    jsonBufferRef.current = ''
    currentToolUseRef.current = null

    // Build the Claude command
    // Use --output-format stream-json for structured output (requires --verbose with -p)
    // Use --resume to continue the conversation if we have a session ID
    const escapedMessage = message.replace(/'/g, "'\\''")
    let command = `claude -p '${escapedMessage}' --output-format stream-json --verbose`
    if (claudeSessionId) {
      command += ` --resume '${claudeSessionId}'`
    }
    // Don't suppress stderr so we can see auth errors

    console.log('[Chat] Sending command:', command)
    // Clear terminal and send command
    sendTerminalCommand(command)
  }, [claudeSessionId, sendTerminalCommand])

  // Cancel current Claude request
  const cancelClaudeRequest = useCallback(() => {
    // Send Ctrl+C to cancel
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send('0\x03')
    }
    setIsChatLoading(false)
    setChatMessages((prev) =>
      prev.map((msg) => (msg.isStreaming ? { ...msg, isStreaming: false } : msg))
    )
  }, [])

  // Expose sendChatMessage via ref for external control
  useEffect(() => {
    if (sendChatMessageRef) {
      sendChatMessageRef.current = sendChatMessage
    }
  }, [sendChatMessage, sendChatMessageRef])

  // Call onTerminalConnected when terminal connects
  useEffect(() => {
    if (isConnected && !terminalConnectedCallbackRef.current) {
      terminalConnectedCallbackRef.current = true
      onTerminalConnected?.()
    }
  }, [isConnected, onTerminalConnected])

  // Call onClaudeReady when Claude is ready
  useEffect(() => {
    if (claudeRunning && !claudeReadyCallbackRef.current) {
      claudeReadyCallbackRef.current = true
      onClaudeReady?.()
    }
  }, [claudeRunning, onClaudeReady])

  // Auto-send initial task when Claude is ready
  useEffect(() => {
    if (
      claudeRunning &&
      isConnected &&
      initialTask &&
      !initialTaskSentRef.current &&
      !isChatLoading
    ) {
      initialTaskSentRef.current = true
      // Small delay to ensure everything is ready
      const timer = setTimeout(() => {
        sendChatMessage(initialTask)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [claudeRunning, isConnected, initialTask, isChatLoading, sendChatMessage])

  // Initialize terminal (for ttyd mode or chat mode - both need the connection)
  useEffect(() => {
    // Need connection for terminal mode or chat mode
    if ((viewMode !== 'terminal' && viewMode !== 'chat') || !terminalRef.current || !isActive) return

    let mounted = true

    const initTerminal = async () => {
      setIsConnecting(true)
      setTerminalError(null)

      try {
        const { Terminal } = await import('xterm')
        const { FitAddon } = await import('xterm-addon-fit')
        const { WebLinksAddon } = await import('xterm-addon-web-links')
        // @ts-expect-error - CSS import works at runtime
        await import('xterm/css/xterm.css')

        if (!mounted || !terminalRef.current) return

        const term = new Terminal({
          cursorBlink: true,
          fontSize: 14,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          scrollback: 10000,
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

        // Try to connect to ttyd with the 'tty' subprotocol
        const wsUrl = getTerminalWsUrl()
        console.log('[ttyd] Connecting to:', wsUrl)
        const ws = new WebSocket(wsUrl, ['tty'])
        wsRef.current = ws

        // ttyd protocol uses ASCII characters as type prefixes
        const TTYD_OUTPUT = '0'.charCodeAt(0) // Server -> Client: terminal output (ASCII '0' = 48)
        const TTYD_INPUT = '0' // Client -> Server: input prefix
        const TTYD_RESIZE = '1' // Client -> Server: resize prefix

        // Debounced resize to avoid flooding
        let resizeTimeout: NodeJS.Timeout | null = null
        const sendResize = () => {
          if (resizeTimeout) clearTimeout(resizeTimeout)
          resizeTimeout = setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN && term.cols && term.rows) {
              // ttyd resize format: '1' + JSON
              const resizeMsg = TTYD_RESIZE + JSON.stringify({ columns: term.cols, rows: term.rows })
              console.log('[ttyd] Sending resize:', resizeMsg)
              ws.send(resizeMsg)
            }
          }, 100)
        }

        ws.binaryType = 'arraybuffer'

        ws.onopen = () => {
          console.log('[ttyd] WebSocket opened, protocol:', ws.protocol)
          setIsConnecting(false)
          setIsConnected(true)
          // Send authentication (empty token for no-auth ttyd)
          const authMsg = JSON.stringify({ AuthToken: '' })
          console.log('[ttyd] Sending auth:', authMsg)
          ws.send(authMsg)
          // Send initial terminal size after a brief delay
          setTimeout(sendResize, 200)
          // Check if Claude is installed after terminal is ready
          setTimeout(() => {
            // Check localStorage first
            const cachedStatus = localStorage.getItem(`claude-status-${codespaceName}`)
            if (cachedStatus === 'installed') {
              // Already know Claude is installed - don't start interactive TUI
              // Chat mode will use headless -p flag instead
              setClaudeStatus('installed')
              setClaudeRunning(true)
            } else {
              // Send command to check if claude is installed
              ws.send('0' + 'which claude && echo "CLAUDE_CHECK_FOUND" || echo "CLAUDE_CHECK_NOT_FOUND"' + '\r')
            }
          }, 1000)
        }

        // Helper to check for Claude markers in output
        const checkClaudeMarkers = (text: string) => {
          outputBufferRef.current += text
          // Keep buffer manageable
          if (outputBufferRef.current.length > 5000) {
            outputBufferRef.current = outputBufferRef.current.slice(-2000)
          }

          // Process JSON lines when chat is loading (headless mode output)
          // Use refs to avoid stale closure issues
          if (isChatLoadingRef.current) {
            console.log('[Chat] Received text while loading:', text.slice(0, 200))
            jsonBufferRef.current += text

            // Check if we got back to prompt without JSON output (command failed)
            // The prompt contains the $ character after color codes
            if (text.includes('$ ') && !jsonBufferRef.current.includes('{"type"')) {
              console.log('[Chat] Detected prompt return without JSON - command may have failed')
              // Check for common error messages
              const buffer = jsonBufferRef.current
              let errorMessage = 'Claude Code command failed. '
              if (buffer.includes('not authenticated') || buffer.includes('login')) {
                errorMessage += 'Please run "claude login" in the terminal to authenticate.'
              } else if (buffer.includes('command not found') || buffer.includes('not found')) {
                errorMessage += 'Claude Code is not installed. Please install it first.'
              } else {
                errorMessage += 'Check the terminal tab for error details.'
              }

              // Add error message to chat
              setChatMessages((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: 'system',
                  content: errorMessage,
                  timestamp: new Date(),
                },
              ])
              setIsChatLoading(false)
              jsonBufferRef.current = ''
              return
            }

            // Process complete lines
            const lines = jsonBufferRef.current.split('\n')
            // Keep the last incomplete line in buffer
            jsonBufferRef.current = lines.pop() || ''
            for (const line of lines) {
              const trimmed = line.trim()
              if (trimmed.startsWith('{')) {
                console.log('[Chat] Processing JSON line:', trimmed.slice(0, 100))
                processClaudeJsonLineRef.current?.(trimmed)
              }
            }
          }

          // Check for our markers
          if (outputBufferRef.current.includes('CLAUDE_CHECK_FOUND')) {
            setClaudeStatus('installed')
            localStorage.setItem(`claude-status-${codespaceName}`, 'installed')
            outputBufferRef.current = ''
            // Don't auto-start terminal Claude - we'll use chat mode instead
            setClaudeRunning(true)
            setViewMode('chat')
          } else if (outputBufferRef.current.includes('CLAUDE_CHECK_NOT_FOUND')) {
            setClaudeStatus('not_installed')
            outputBufferRef.current = ''
          } else if (outputBufferRef.current.includes('CLAUDE_INSTALL_COMPLETE')) {
            setClaudeStatus('installed')
            setIsInstallingClaude(false)
            localStorage.setItem(`claude-status-${codespaceName}`, 'installed')
            outputBufferRef.current = ''
            // Switch to chat mode after install
            setClaudeRunning(true)
            setViewMode('chat')
          }
        }

        ws.onmessage = (event) => {
          // ttyd sends binary messages with ASCII type prefix
          if (event.data instanceof ArrayBuffer) {
            const data = new Uint8Array(event.data)
            if (data.length > 0) {
              const msgType = data[0]
              const payload = data.slice(1)
              // '0' (ASCII 48) = terminal output
              if (msgType === TTYD_OUTPUT && payload.length > 0) {
                term.write(payload)
                // Check for Claude markers
                const text = new TextDecoder().decode(payload)
                checkClaudeMarkers(text)
              }
            }
          } else if (typeof event.data === 'string') {
            // Some ttyd versions send string data
            if (event.data.length > 1 && event.data[0] === '0') {
              term.write(event.data.slice(1))
              checkClaudeMarkers(event.data.slice(1))
            }
          } else if (event.data instanceof Blob) {
            event.data.arrayBuffer().then((buffer) => {
              const data = new Uint8Array(buffer)
              if (data.length > 0) {
                const msgType = data[0]
                const payload = data.slice(1)
                if (msgType === TTYD_OUTPUT && payload.length > 0) {
                  term.write(payload)
                  const text = new TextDecoder().decode(payload)
                  checkClaudeMarkers(text)
                }
              }
            })
          }
        }

        ws.onerror = (err) => {
          console.error('[ttyd] WebSocket error:', err)
          setTerminalError('Terminal not available. ttyd needs to be running in your Codespace.')
          setIsConnecting(false)
          setIsConnected(false)
        }

        ws.onclose = (event) => {
          console.log('[ttyd] WebSocket closed:', { code: event.code, reason: event.reason })
          if (mounted && isConnected) {
            setIsConnected(false)
          }
        }

        // Send input to ttyd with ASCII prefix
        term.onData((data: string) => {
          if (ws.readyState === WebSocket.OPEN) {
            // ttyd expects: '0' + input data as string
            console.log('[ttyd] Sending input:', data.length, 'chars')
            ws.send(TTYD_INPUT + data)
          }
        })

        const resizeObserver = new ResizeObserver(() => {
          if (fitAddonRef.current) {
            fitAddonRef.current.fit()
            // Send new size to ttyd after fitting
            sendResize()
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

  // Re-fit terminal when banner state or mode changes
  useEffect(() => {
    if (fitAddonRef.current && xtermRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit()
      }, 100)
    }
  }, [claudeStatus, claudeRunning])

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

  // Determine if we should show Claude chat mode
  const showChatMode = viewMode === 'chat' && claudeRunning && isConnected && !terminalError

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-[#1e1e1e] rounded-lg overflow-hidden border border-border',
        isFullscreen && 'fixed inset-4 z-50'
      )}
    >
      {/* Header - switches between Claude mode and regular mode */}
      {showChatMode ? (
        <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-amber-900/50 to-[#252526] border-b border-amber-500/30">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-amber-500" />
            <span className="text-sm text-amber-200 font-medium">Claude Code</span>
            <span className="text-xs text-gray-500">•</span>
            <span className="text-xs text-gray-400">{repoName}</span>
            <Badge variant="outline" className="text-xs border-green-500/50 text-green-400 ml-2">
              Active
            </Badge>
          </div>
          <div className="flex items-center gap-1">
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
      ) : (
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
              VS Code
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
      )}

      {/* Chat UI when in chat mode */}
      {showChatMode && (
        <div className="flex-1 min-h-0">
          <ClaudeChatUI
            messages={chatMessages}
            isLoading={isChatLoading}
            sessionId={claudeSessionId || undefined}
            modelName={claudeModel || undefined}
            onSendMessage={sendChatMessage}
            onCancel={cancelClaudeRequest}
          />
        </div>
      )}

      {/* Main content area - terminal is ALWAYS rendered to maintain connection (positioned off-screen when chat mode) */}
      <div className={cn(
        'flex-1 relative',
        showChatMode && 'absolute -left-[9999px] w-[400px] h-[300px]',
        !showChatMode && viewMode !== 'terminal' && 'hidden'
      )}>
        {/* Overlays for non-Claude mode */}
        {!showChatMode && terminalError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e] z-10">
            <div className="text-center max-w-lg px-4">
              <AlertTriangle className="h-10 w-10 text-yellow-500 mx-auto mb-3" />
              <h3 className="text-lg font-medium text-gray-200 mb-2">Terminal Setup Required</h3>
              <p className="text-sm text-gray-400 mb-4">
                To use the embedded terminal, ttyd needs to be running and the port must be public.
              </p>

              <div className="bg-[#252526] rounded-lg p-4 mb-4 text-left space-y-3">
                <div>
                  <p className="text-xs text-gray-400 mb-2">1. Run this in your Codespace terminal:</p>
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
                <p className="text-xs text-yellow-400">
                  2. In VS Code, go to <strong>Ports</strong> tab → Right-click port <strong>7681</strong> → <strong>Port Visibility</strong> → <strong>Public</strong>
                </p>
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
        {!showChatMode && isConnecting && !terminalError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e] z-10">
            <div className="text-center">
              <Loader2 className="h-8 w-8 text-blue-400 mx-auto mb-2 animate-spin" />
              <p className="text-gray-400">Connecting to terminal...</p>
            </div>
          </div>
        )}
        {/* Checking Claude status indicator */}
        {!showChatMode && isConnected && claudeStatus === 'checking' && !terminalError && (
          <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-gray-800/90 to-gray-800/70 p-2 border-b border-gray-600/30">
            <div className="flex items-center justify-center gap-2 text-gray-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Checking if Claude Code is installed...</span>
            </div>
          </div>
        )}
        {/* Install Claude Code banner - only shows when not installed */}
        {!showChatMode && isConnected && claudeStatus === 'not_installed' && !terminalError && (
          <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-amber-900/90 to-amber-900/70 p-3 border-b border-amber-500/30">
            <div className="flex items-center justify-between max-w-2xl mx-auto">
              <div className="flex items-center gap-3">
                <Wand2 className="h-5 w-5 text-amber-300" />
                <div>
                  <p className="text-sm font-medium text-amber-100">Install Claude Code</p>
                  <p className="text-xs text-amber-300">One-click install to start using Claude in this terminal</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={installClaudeCode}
                  disabled={isInstallingClaude}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {isInstallingClaude ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                      Installing...
                    </>
                  ) : (
                    'Install Now'
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setClaudeStatus('dismissed')}
                  className="text-amber-300 hover:text-amber-100 hover:bg-amber-800/50"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
        {/* Single terminal div - always in DOM */}
        <div
          ref={terminalRef}
          className={cn(
            'absolute inset-0',
            !showChatMode && (terminalError || isConnecting) && 'opacity-0',
            !showChatMode && isConnected && (claudeStatus === 'checking' || claudeStatus === 'not_installed') && 'top-12'
          )}
        />
      </div>

      {/* Tabs - show appropriate tabs based on Claude status */}
      <div className="border-t border-[#3c3c3c]">
        <div className="flex bg-[#252526]">
          {/* Chat tab - only show when Claude is installed */}
          {claudeRunning && (
            <button
              onClick={() => setViewMode('chat')}
              className={cn(
                'px-4 py-1.5 text-xs flex items-center gap-1',
                viewMode === 'chat' ? 'bg-[#1e1e1e] text-amber-300' : 'text-gray-400 hover:text-gray-200'
              )}
            >
              <MessageSquare className="h-3 w-3" />
              Chat
            </button>
          )}
          <button
            onClick={() => setViewMode('terminal')}
            className={cn(
              'px-4 py-1.5 text-xs flex items-center gap-1',
              viewMode === 'terminal' && !showChatMode ? 'bg-[#1e1e1e] text-gray-200' : 'text-gray-400 hover:text-gray-200'
            )}
          >
            <TerminalIcon className="h-3 w-3" />
            Terminal
          </button>
          <button
            onClick={() => setViewMode('instructions')}
            className={cn(
              'px-4 py-1.5 text-xs',
                viewMode === 'instructions' ? 'bg-[#1e1e1e] text-gray-200' : 'text-gray-400 hover:text-gray-200'
              )}
            >
              Setup
            </button>
          </div>
        </div>

      {/* Setup instructions panel - only show when in setup mode */}
      {viewMode === 'instructions' && (
        <div className="flex-1 overflow-auto bg-[#1e1e1e]">
          <div className="p-6 max-w-2xl mx-auto">
            <h3 className="text-lg font-semibold text-gray-200 mb-4">Setup Claude Code in your Codespace</h3>

            {/* Automatic Setup - Most prominent */}
            {repoId && (
              <div className="mb-6 p-4 bg-green-950/30 rounded-lg border border-green-500/30">
                <h4 className="text-gray-200 font-medium mb-2 flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-green-400" />
                  Automatic Setup (Recommended)
                </h4>
                <p className="text-sm text-gray-400 mb-3">
                  Automatically configure your repo so ttyd and Claude Code are installed on every Codespace startup.
                  This creates a <code className="text-green-400">.devcontainer/devcontainer.json</code> file.
                </p>
                {devcontainerSetupResult ? (
                  <div className={cn(
                    'p-3 rounded-lg mb-3 flex items-start gap-2',
                    devcontainerSetupResult.success ? 'bg-green-900/30' : 'bg-red-900/30'
                  )}>
                    {devcontainerSetupResult.success ? (
                      <CheckCircle className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="text-sm">
                      <p className={devcontainerSetupResult.success ? 'text-green-300' : 'text-red-300'}>
                        {devcontainerSetupResult.message}
                      </p>
                      {devcontainerSetupResult.success && (
                        <p className="text-gray-400 mt-1 text-xs">
                          Go to your Codespace and click "Rebuild Container" in the command palette (F1).
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
                <Button
                  size="sm"
                  onClick={setupDevcontainer}
                  disabled={isSettingUpDevcontainer}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isSettingUpDevcontainer ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Setting up...
                    </>
                  ) : (
                    <>
                      <GitBranch className="h-4 w-4 mr-2" />
                      Setup Repository Automatically
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* Enable embedded terminal - manual method */}
            <div className="mb-6 p-4 bg-blue-950/30 rounded-lg border border-blue-500/30">
              <h4 className="text-gray-200 font-medium mb-2 flex items-center gap-2">
                <TerminalIcon className="h-4 w-4 text-blue-400" />
                Manual Setup (Current Session Only)
              </h4>
              <p className="text-sm text-gray-400 mb-3">
                Follow these steps in your Codespace:
              </p>
              <ol className="text-sm text-gray-400 mb-3 list-decimal list-inside space-y-2">
                <li>Run this command to install and start ttyd:</li>
              </ol>
              <div className="relative mb-3">
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
              <ol start={2} className="text-sm text-gray-400 mb-3 list-decimal list-inside space-y-2">
                <li>
                  <strong className="text-yellow-400">Important:</strong> In VS Code, go to the <strong>Ports</strong> tab (bottom panel),
                  find port <code className="bg-[#1e1e1e] px-1 rounded">7681</code>, right-click → <strong>Port Visibility</strong> → <strong>Public</strong>
                </li>
                <li>Click "Retry Connection" below</li>
              </ol>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={openInNewTab}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open VS Code to Run Command
                </Button>
                <Button size="sm" onClick={retryConnection}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry Connection
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
        </div>
      )}
    </div>
  )
}
