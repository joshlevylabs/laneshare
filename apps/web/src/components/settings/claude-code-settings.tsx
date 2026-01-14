'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import {
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Terminal,
  Key,
  Sparkles,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ClaudeCodeStatus {
  cliInstalled: boolean
  cliVersion?: string
  cliAuthenticated: boolean
  apiKeyConfigured: boolean
  activeRunner: 'cli' | 'api' | 'mock' | 'none'
  userEmail?: string
  error?: string
}

interface TestResult {
  success: boolean
  runner?: string
  message?: string
  error?: string
  details?: {
    version?: string
    authenticated?: boolean
    creditsAvailable?: boolean
  }
}

export function ClaudeCodeSettings() {
  const { toast } = useToast()
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/claude/status')
      const data = await response.json()
      setStatus(data)
    } catch (error) {
      setStatus({
        cliInstalled: false,
        cliAuthenticated: false,
        apiKeyConfigured: false,
        activeRunner: 'none',
        error: 'Failed to check status',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  const handleRefresh = async () => {
    setLoading(true)
    setTestResult(null)
    await fetchStatus()
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const response = await fetch('/api/claude/test', { method: 'POST' })
      const data: TestResult = await response.json()
      setTestResult(data)

      if (data.success) {
        toast({
          title: 'Connection Successful',
          description: data.message || `Ready to generate documentation using ${data.runner}.`,
        })
      } else {
        toast({
          variant: 'destructive',
          title: 'Connection Failed',
          description: data.error || 'Failed to connect to Claude Code.',
        })
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to test connection.',
      })
    } finally {
      setTesting(false)
    }
  }

  const copyCommand = (command: string) => {
    navigator.clipboard.writeText(command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const isReady = status?.activeRunner === 'cli' || status?.activeRunner === 'api'
  const needsSetup = !status?.cliInstalled && !status?.apiKeyConfigured
  const isCLIActive = status?.activeRunner === 'cli'
  const isAPIActive = status?.activeRunner === 'api'

  return (
    <div className="space-y-6">
      {/* Status Overview */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* CLI Status Card */}
        <div className={cn(
          "flex items-center gap-3 p-4 rounded-lg border",
          isCLIActive ? "border-green-500/50 bg-green-500/5" : "bg-card"
        )}>
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full',
              status?.cliInstalled && status?.cliAuthenticated
                ? 'bg-green-500/10 text-green-500'
                : 'bg-muted text-muted-foreground'
            )}
          >
            <Terminal className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">Claude CLI</span>
              {isCLIActive && (
                <Badge variant="default" className="bg-green-500 text-white text-xs">
                  ACTIVE
                </Badge>
              )}
              {status?.cliInstalled && !isCLIActive && status?.apiKeyConfigured && (
                <Badge variant="outline" className="text-xs">
                  Backup
                </Badge>
              )}
              {status?.cliInstalled && status?.cliAuthenticated ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : status?.cliInstalled ? (
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
              ) : (
                <XCircle className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {status?.cliInstalled
                ? status?.cliAuthenticated
                  ? `v${status.cliVersion}${status.userEmail ? ` • ${status.userEmail}` : ''}`
                  : 'Installed - run "claude login"'
                : 'Not installed'}
            </p>
          </div>
        </div>

        {/* API Key Status Card */}
        <div className={cn(
          "flex items-center gap-3 p-4 rounded-lg border",
          isAPIActive ? "border-green-500/50 bg-green-500/5" : "bg-card"
        )}>
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full',
              status?.apiKeyConfigured
                ? 'bg-green-500/10 text-green-500'
                : 'bg-muted text-muted-foreground'
            )}
          >
            <Key className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">API Key</span>
              {isAPIActive && (
                <Badge variant="default" className="bg-green-500 text-white text-xs">
                  ACTIVE
                </Badge>
              )}
              {status?.apiKeyConfigured && !isAPIActive && isCLIActive && (
                <Badge variant="outline" className="text-xs">
                  Backup
                </Badge>
              )}
              {status?.apiKeyConfigured ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {status?.apiKeyConfigured ? 'Configured in .env.local' : 'Not configured'}
            </p>
          </div>
        </div>
      </div>

      {/* Priority Note - when both are configured */}
      {status?.cliInstalled && status?.apiKeyConfigured && (
        <p className="text-xs text-muted-foreground">
          Note: Claude CLI takes priority when both are configured. API key serves as backup.
        </p>
      )}

      {/* Test Result Display */}
      {testResult && (
        <div className={cn(
          "p-4 rounded-lg border",
          testResult.success
            ? "bg-green-500/5 border-green-500/20"
            : "bg-destructive/5 border-destructive/20"
        )}>
          <div className="flex items-start gap-3">
            {testResult.success ? (
              <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
            ) : (
              <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
            )}
            <div className="flex-1">
              <p className={cn(
                "font-medium",
                testResult.success ? "text-green-700 dark:text-green-400" : "text-destructive"
              )}>
                {testResult.success ? 'Connection Successful' : 'Connection Failed'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {testResult.success ? testResult.message : testResult.error}
              </p>
              {testResult.details && !testResult.success && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {testResult.details.authenticated === true && testResult.details.creditsAvailable === false && (
                    <p>
                      Your account is authenticated but has no credits available.{' '}
                      <a
                        href="https://claude.ai/settings"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        Check your subscription
                      </a>
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Setup Instructions - Only show if nothing is configured */}
      {needsSetup && (
        <div className="space-y-4">
          <h4 className="font-medium">Setup Required</h4>
          <p className="text-sm text-muted-foreground">
            Choose one of the following options to enable AI documentation generation:
          </p>

          {/* CLI Setup */}
          <div className="p-4 rounded-lg border space-y-3">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              <span className="font-medium">Option 1: Claude Code CLI (Recommended)</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Use your Claude Code subscription for documentation generation.
            </p>
            <div className="space-y-2">
              <p className="text-sm">Install Claude Code CLI:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 rounded bg-muted text-sm font-mono">
                  npm install -g @anthropic-ai/claude-code
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyCommand('npm install -g @anthropic-ai/claude-code')}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Then run <code className="px-1 py-0.5 rounded bg-muted">claude login</code> to authenticate.
              </p>
            </div>
          </div>

          {/* API Key Setup */}
          <div className="p-4 rounded-lg border space-y-3">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              <span className="font-medium">Option 2: Anthropic API Key</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Use an API key from Anthropic Console for pay-as-you-go usage.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a
                  href="https://console.anthropic.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Get API Key
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Add <code className="px-1 py-0.5 rounded bg-muted">ANTHROPIC_API_KEY</code> to your{' '}
              <code className="px-1 py-0.5 rounded bg-muted">.env.local</code> file.
            </p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={handleRefresh} disabled={loading}>
          <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
          Refresh Status
        </Button>
        {isReady && (
          <Button
            onClick={handleTestConnection}
            disabled={testing}
          >
            {testing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Test Connection
              </>
            )}
          </Button>
        )}
      </div>

      {status?.error && (
        <p className="text-sm text-destructive">{status.error}</p>
      )}
    </div>
  )
}
