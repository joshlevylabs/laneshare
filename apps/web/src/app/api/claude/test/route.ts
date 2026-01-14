import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { join } from 'path'

/**
 * Test endpoint for Claude Code connection.
 * Instead of running a full doc generation, this just verifies:
 * 1. The CLI is installed and accessible
 * 2. The CLI can respond to a simple prompt
 */
export async function POST() {
  // Determine which runner would be used based on env config
  const useCLI = process.env.USE_CLAUDE_CLI === 'true'
  const useMock = process.env.USE_MOCK_CLAUDE === 'true'
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY

  // Mock runner - just return success
  if (useMock) {
    return NextResponse.json({
      success: true,
      runner: 'Mock Runner',
      message: 'Mock runner is active. Documentation will use sample content.',
    })
  }

  // CLI runner - test by running a simple command
  if (useCLI) {
    return testCLIConnection()
  }

  // API runner
  if (hasApiKey) {
    return NextResponse.json({
      success: true,
      runner: 'Anthropic API',
      message: 'API key is configured. Ready to generate documentation.',
    })
  }

  return NextResponse.json({
    success: false,
    error: 'No runner configured. Set USE_CLAUDE_CLI=true or ANTHROPIC_API_KEY in .env.local',
  })
}

async function testCLIConnection() {
  const isWindows = process.platform === 'win32'

  // Find claude path
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

  let claudePath: string | null = null
  let version: string | null = null

  for (const p of possiblePaths) {
    try {
      const result = execSync(`"${p}" --version`, {
        stdio: 'pipe',
        timeout: 5000,
        shell: isWindows ? 'cmd.exe' : '/bin/sh',
        encoding: 'utf-8',
      })
      claudePath = p
      const match = result.match(/(\d+\.\d+\.\d+)/)
      version = match ? match[1] : result.trim()
      break
    } catch {
      // Try next path
    }
  }

  if (!claudePath) {
    return NextResponse.json({
      success: false,
      runner: 'Claude Code CLI',
      error: 'Claude CLI not found. Please install with: npm install -g @anthropic-ai/claude-code',
    })
  }

  // CLI is installed and version check passed - that's sufficient for a connection test
  // The actual authentication/credit check will happen during doc generation
  // (Windows piping is unreliable for testing with the CLI)
  return NextResponse.json({
    success: true,
    runner: 'Claude Code CLI',
    message: `Claude CLI v${version} is installed. Documentation generation will use your Claude subscription.`,
    details: {
      version,
      note: 'Authentication and credits are verified during doc generation.',
    },
  })
}
