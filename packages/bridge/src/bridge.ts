/**
 * Bridge Agent
 *
 * Connects to LaneShare server and enables Claude Code to run in Codespaces
 * with real-time activity streaming back to the workspace UI.
 *
 * Uses REST API + SSE for communication (compatible with serverless deployments).
 */

import EventSource from 'eventsource'
import { spawn, ChildProcess } from 'child_process'
import { simpleGit, SimpleGit } from 'simple-git'
import chokidar, { FSWatcher } from 'chokidar'
import {
  BridgeConfig,
  PromptPayload,
  FileActivityPayload,
  GitStatusPayload,
} from './types.js'

const BRIDGE_VERSION = '1.0.0'
const RECONNECT_INTERVAL = 5000
const GIT_STATUS_INTERVAL = 10000

export class Bridge {
  private config: BridgeConfig
  private eventSource: EventSource | null = null
  private connectionId: string | null = null
  private git: SimpleGit
  private watcher: FSWatcher | null = null
  private claudeProcess: ChildProcess | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private gitStatusTimer: NodeJS.Timeout | null = null
  private isShuttingDown = false
  private currentSessionMessageId: string | null = null

  constructor(config: BridgeConfig) {
    this.config = config
    this.git = simpleGit(config.workDir)
  }

  async start(): Promise<void> {
    this.log('Starting bridge agent...')
    this.log(`Work directory: ${this.config.workDir}`)

    // Verify git repository
    const isRepo = await this.git.checkIsRepo()
    if (!isRepo) {
      throw new Error(`${this.config.workDir} is not a git repository`)
    }

    // Start file watcher
    this.startFileWatcher()

    // Connect to LaneShare
    await this.connect()

    // Start git status polling
    this.startGitStatusPolling()

    this.log('Bridge agent started successfully')
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true
    this.log('Stopping bridge agent...')

    // Clear timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.gitStatusTimer) {
      clearInterval(this.gitStatusTimer)
      this.gitStatusTimer = null
    }

    // Stop file watcher
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }

    // Kill Claude process if running
    if (this.claudeProcess) {
      this.claudeProcess.kill()
      this.claudeProcess = null
    }

    // Close EventSource
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    this.log('Bridge agent stopped')
  }

  private async connect(): Promise<void> {
    this.log('Connecting to LaneShare...')

    // First, register the connection via REST API
    const gitBranch = await this.getCurrentBranch()
    const gitRemote = await this.getRemoteUrl()

    const connectResponse = await fetch(`${this.config.apiUrl}/api/bridge/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        sessionId: this.config.sessionId,
        bridgeVersion: BRIDGE_VERSION,
        workDir: this.config.workDir,
        gitBranch,
        gitRemote,
      }),
    })

    if (!connectResponse.ok) {
      const error = await connectResponse.text()
      throw new Error(`Failed to connect: ${error}`)
    }

    const { connectionId, pendingPrompt } = await connectResponse.json()
    this.connectionId = connectionId

    this.log(`Connected with connection ID: ${connectionId}`)

    // Handle any pending prompt immediately
    if (pendingPrompt) {
      this.handlePrompt(pendingPrompt)
    }

    // Start SSE stream to receive prompts
    this.startEventStream()
  }

  private startEventStream(): void {
    const url = `${this.config.apiUrl}/api/bridge/stream?connectionId=${this.connectionId}&sessionId=${this.config.sessionId}`

    this.log('Starting event stream...')

    this.eventSource = new EventSource(url, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    })

    this.eventSource.onopen = () => {
      this.log('Event stream connected')
    }

    this.eventSource.addEventListener('connected', (event: MessageEvent) => {
      this.log('Received connected event')
    })

    this.eventSource.addEventListener('prompt', (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as PromptPayload
        this.handlePrompt(payload)
      } catch (err) {
        this.log(`Failed to parse prompt event: ${err}`)
      }
    })

    this.eventSource.onerror = (err: Event) => {
      this.log('Event stream error, will reconnect...')
      if (this.eventSource) {
        this.eventSource.close()
        this.eventSource = null
      }

      if (!this.isShuttingDown) {
        this.scheduleReconnect()
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return

    this.log(`Reconnecting in ${RECONNECT_INTERVAL / 1000}s...`)
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      try {
        await this.connect()
      } catch (err) {
        this.log(`Reconnection failed: ${err}`)
        this.scheduleReconnect()
      }
    }, RECONNECT_INTERVAL)
  }

  private async handlePrompt(payload: PromptPayload): Promise<void> {
    this.log(`Received prompt: ${payload.prompt.substring(0, 100)}...`)
    this.currentSessionMessageId = payload.sessionMessageId

    // Kill any existing Claude process
    if (this.claudeProcess) {
      this.claudeProcess.kill()
      this.claudeProcess = null
    }

    // Run Claude Code with the prompt
    await this.runClaudeCode(payload.prompt, payload.sessionMessageId)
  }

  private async runClaudeCode(
    prompt: string,
    sessionMessageId: string
  ): Promise<void> {
    this.log('Starting Claude Code...')

    // Run claude in the work directory
    this.claudeProcess = spawn(
      'claude',
      ['--print', '--output-format', 'stream-json', prompt],
      {
        cwd: this.config.workDir,
        shell: true,
        env: {
          ...process.env,
          // Disable interactive mode
          CI: 'true',
        },
      }
    )

    let buffer = ''

    this.claudeProcess.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString()

      // Process complete JSON lines
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue

        try {
          const event = JSON.parse(line)
          this.processClaudeEvent(event, sessionMessageId)
        } catch {
          // Not JSON, send as raw output
          this.sendOutput(sessionMessageId, line, false)
        }
      }
    })

    this.claudeProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      if (this.config.debug) {
        this.log(`Claude stderr: ${text}`)
      }
    })

    this.claudeProcess.on('close', (code) => {
      this.log(`Claude Code exited with code ${code}`)

      // Process any remaining buffer
      if (buffer.trim()) {
        this.sendOutput(sessionMessageId, buffer, false)
      }

      // Send completion
      this.sendOutput(sessionMessageId, '', true)

      this.claudeProcess = null
      this.currentSessionMessageId = null
    })

    this.claudeProcess.on('error', (err) => {
      this.log(`Claude Code error: ${err.message}`)
      this.sendOutput(sessionMessageId, `Error: ${err.message}`, true)
    })
  }

  private processClaudeEvent(
    event: Record<string, unknown>,
    sessionMessageId: string
  ): void {
    // Handle different event types from Claude's stream-json output
    switch (event.type) {
      case 'assistant':
        if (typeof event.message === 'string') {
          this.sendOutput(sessionMessageId, event.message, false)
        }
        break

      case 'tool_use':
        this.sendOutputWithTool(sessionMessageId, '', false, {
          tool: event.tool as string,
          input: event.input as Record<string, unknown>,
        })
        break

      case 'result':
        // Final result
        if (typeof event.result === 'string') {
          this.sendOutput(sessionMessageId, event.result, false)
        }
        break

      default:
        // Forward unknown events as-is
        if (this.config.debug) {
          this.log(`Unknown Claude event: ${JSON.stringify(event)}`)
        }
    }
  }

  private async sendOutput(
    sessionMessageId: string,
    content: string,
    isComplete: boolean
  ): Promise<void> {
    await this.sendOutputWithTool(sessionMessageId, content, isComplete)
  }

  private async sendOutputWithTool(
    sessionMessageId: string,
    content: string,
    isComplete: boolean,
    toolUse?: { tool: string; input: Record<string, unknown> }
  ): Promise<void> {
    if (!this.connectionId) return

    try {
      await fetch(`${this.config.apiUrl}/api/bridge/output`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          connectionId: this.connectionId,
          sessionMessageId,
          content,
          isComplete,
          toolUse,
        }),
      })
    } catch (err) {
      if (this.config.debug) {
        this.log(`Failed to send output: ${err}`)
      }
    }
  }

  private startFileWatcher(): void {
    this.log('Starting file watcher...')

    this.watcher = chokidar.watch(this.config.workDir, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/*.log',
      ],
      persistent: true,
      ignoreInitial: true,
    })

    this.watcher.on('add', (path) => this.sendFileActivity('create', path))
    this.watcher.on('change', (path) => this.sendFileActivity('write', path))
    this.watcher.on('unlink', (path) => this.sendFileActivity('delete', path))
  }

  private async sendFileActivity(
    type: FileActivityPayload['type'],
    path: string
  ): Promise<void> {
    if (!this.connectionId) return

    // Make path relative to workDir
    const relativePath = path.replace(this.config.workDir, '').replace(/^[\\/]/, '')

    try {
      await fetch(`${this.config.apiUrl}/api/bridge/activity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          connectionId: this.connectionId,
          type: 'file_activity',
          payload: {
            type,
            path: relativePath,
            timestamp: new Date().toISOString(),
          },
        }),
      })
    } catch (err) {
      if (this.config.debug) {
        this.log(`Failed to send file activity: ${err}`)
      }
    }
  }

  private startGitStatusPolling(): void {
    this.gitStatusTimer = setInterval(async () => {
      await this.sendGitStatus()
    }, GIT_STATUS_INTERVAL)

    // Send initial status
    this.sendGitStatus()
  }

  private async sendGitStatus(): Promise<void> {
    if (!this.connectionId) return

    try {
      const status = await this.git.status()
      const branch = await this.getCurrentBranch()

      const payload: GitStatusPayload = {
        branch,
        ahead: status.ahead,
        behind: status.behind,
        hasUncommittedChanges: !status.isClean(),
        hasUnpushedChanges: status.ahead > 0,
        modifiedFiles: status.modified,
        stagedFiles: status.staged,
        untrackedFiles: status.not_added,
      }

      await fetch(`${this.config.apiUrl}/api/bridge/activity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          connectionId: this.connectionId,
          type: 'git_status',
          payload,
        }),
      })
    } catch (err) {
      if (this.config.debug) {
        this.log(`Failed to get/send git status: ${err}`)
      }
    }
  }

  private async getCurrentBranch(): Promise<string> {
    try {
      const branch = await this.git.revparse(['--abbrev-ref', 'HEAD'])
      return branch.trim()
    } catch {
      return 'unknown'
    }
  }

  private async getRemoteUrl(): Promise<string> {
    try {
      const remotes = await this.git.getRemotes(true)
      const origin = remotes.find((r) => r.name === 'origin')
      return origin?.refs?.fetch || ''
    } catch {
      return ''
    }
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString()
    console.log(`[${timestamp}] [Bridge] ${message}`)
  }
}
