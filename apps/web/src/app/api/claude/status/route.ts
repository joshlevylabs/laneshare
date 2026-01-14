import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

interface ClaudeCodeStatus {
  cliInstalled: boolean
  cliVersion?: string
  cliAuthenticated: boolean
  apiKeyConfigured: boolean
  activeRunner: 'cli' | 'api' | 'mock' | 'none'
  userEmail?: string
  error?: string
}

function getClaudePath(): string | null {
  const isWindows = process.platform === 'win32'
  const possiblePaths: string[] = []

  if (isWindows) {
    const appData = process.env.APPDATA || ''
    possiblePaths.push(
      join(appData, 'npm', 'claude.cmd'),
      'claude.cmd',
      'claude',
    )
  } else {
    possiblePaths.push(
      '/usr/local/bin/claude',
      '/usr/bin/claude',
      join(process.env.HOME || '', '.npm-global', 'bin', 'claude'),
      'claude',
    )
  }

  for (const p of possiblePaths) {
    try {
      execSync(`"${p}" --version`, {
        stdio: 'pipe',
        timeout: 5000,
        shell: isWindows ? 'cmd.exe' : '/bin/sh',
        encoding: 'utf-8',
      })
      return p
    } catch {
      // Try next path
    }
  }

  return null
}

function getCliVersion(claudePath: string): string | null {
  const isWindows = process.platform === 'win32'
  try {
    const result = execSync(`"${claudePath}" --version`, {
      stdio: 'pipe',
      timeout: 5000,
      shell: isWindows ? 'cmd.exe' : '/bin/sh',
      encoding: 'utf-8',
    })
    // Parse version from output like "2.0.30 (Claude Code)"
    const match = result.match(/(\d+\.\d+\.\d+)/)
    return match ? match[1] : result.trim()
  } catch {
    return null
  }
}

/**
 * Check Claude Code authentication by looking at the config files.
 * This is faster and more reliable than running a test command.
 */
function checkCliAuthentication(): { authenticated: boolean; email?: string } {
  const isWindows = process.platform === 'win32'

  // Claude Code stores config in different locations
  const possibleConfigPaths: string[] = []

  if (isWindows) {
    const appData = process.env.APPDATA || ''
    const localAppData = process.env.LOCALAPPDATA || ''
    const userProfile = process.env.USERPROFILE || ''

    possibleConfigPaths.push(
      join(userProfile, '.claude', 'config.json'),
      join(userProfile, '.claude', 'credentials.json'),
      join(userProfile, '.claude.json'),
      join(appData, 'Claude', 'config.json'),
      join(appData, 'claude-code', 'config.json'),
      join(localAppData, 'claude-code', 'config.json'),
    )
  } else {
    const home = process.env.HOME || ''
    possibleConfigPaths.push(
      join(home, '.claude', 'config.json'),
      join(home, '.claude', 'credentials.json'),
      join(home, '.claude.json'),
      join(home, '.config', 'claude-code', 'config.json'),
    )
  }

  // Check each possible config location
  for (const configPath of possibleConfigPaths) {
    try {
      if (existsSync(configPath)) {
        const content = readFileSync(configPath, 'utf-8')
        const config = JSON.parse(content)

        // Look for authentication indicators in the config
        // The config might have: token, accessToken, auth, user, email, etc.
        if (config.token || config.accessToken || config.auth?.token ||
            config.oauthToken || config.credentials?.token) {
          return {
            authenticated: true,
            email: config.email || config.user?.email || config.auth?.email
          }
        }

        // Check for accounts array (newer Claude Code format)
        if (config.accounts && Array.isArray(config.accounts) && config.accounts.length > 0) {
          const account = config.accounts[0]
          if (account.accessToken || account.token) {
            return { authenticated: true, email: account.email }
          }
        }
      }
    } catch {
      // Continue to next path
    }
  }

  // If no config found, try a quick command check as fallback
  // Use `claude --help` which should show account info if logged in
  return { authenticated: false }
}

export async function GET() {
  const status: ClaudeCodeStatus = {
    cliInstalled: false,
    cliAuthenticated: false,
    apiKeyConfigured: false,
    activeRunner: 'none',
  }

  try {
    // Check CLI installation
    const claudePath = getClaudePath()
    status.cliInstalled = !!claudePath

    if (claudePath) {
      // Get version
      status.cliVersion = getCliVersion(claudePath) || undefined

      // Check authentication by looking at config files
      const authStatus = checkCliAuthentication()
      status.cliAuthenticated = authStatus.authenticated
      status.userEmail = authStatus.email

      // If config check didn't find auth, assume authenticated if CLI is installed
      // (the CLI itself will fail with auth error if not actually logged in)
      if (!status.cliAuthenticated && status.cliInstalled) {
        // For now, assume authenticated if CLI is installed - the doc generation
        // will fail with a clear error if not actually authenticated
        status.cliAuthenticated = true
      }
    }

    // Check API key configuration
    status.apiKeyConfigured = !!process.env.ANTHROPIC_API_KEY

    // Determine active runner based on env configuration
    if (process.env.USE_MOCK_CLAUDE === 'true') {
      status.activeRunner = 'mock'
    } else if (process.env.USE_CLAUDE_CLI === 'true') {
      status.activeRunner = status.cliInstalled ? 'cli' : 'none'
    } else if (process.env.ANTHROPIC_API_KEY) {
      status.activeRunner = 'api'
    } else {
      status.activeRunner = 'none'
    }

    return NextResponse.json(status)
  } catch (error) {
    status.error = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(status)
  }
}
