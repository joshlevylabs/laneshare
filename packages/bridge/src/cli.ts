#!/usr/bin/env node
/**
 * LaneShare Bridge CLI
 *
 * Connects a local/Codespace environment to LaneShare for real-time
 * collaborative coding with Claude Code agents.
 *
 * Usage:
 *   laneshare-bridge start --project <id> --session <id> --api-key <key>
 *
 * Environment variables:
 *   LANESHARE_API_URL - API endpoint (default: https://laneshare.dev)
 *   LANESHARE_PROJECT_ID - Project ID
 *   LANESHARE_SESSION_ID - Session ID
 *   LANESHARE_API_KEY - API key for authentication
 */

import { Command } from 'commander'
import { Bridge } from './bridge.js'
import { BridgeConfig } from './types.js'

const program = new Command()

program
  .name('laneshare-bridge')
  .description('LaneShare Bridge Agent - Connect your dev environment to LaneShare')
  .version('1.0.0')

program
  .command('start')
  .description('Start the bridge agent and connect to LaneShare')
  .option('-u, --api-url <url>', 'LaneShare API URL', process.env.LANESHARE_API_URL || 'https://laneshare.dev')
  .option('-p, --project <id>', 'Project ID', process.env.LANESHARE_PROJECT_ID)
  .option('-s, --session <id>', 'Session ID', process.env.LANESHARE_SESSION_ID)
  .option('-k, --api-key <key>', 'API key', process.env.LANESHARE_API_KEY)
  .option('-d, --work-dir <path>', 'Working directory', process.cwd())
  .option('--debug', 'Enable debug logging', false)
  .action(async (options) => {
    // Validate required options
    if (!options.project) {
      console.error('Error: Project ID is required (--project or LANESHARE_PROJECT_ID)')
      process.exit(1)
    }
    if (!options.session) {
      console.error('Error: Session ID is required (--session or LANESHARE_SESSION_ID)')
      process.exit(1)
    }
    if (!options.apiKey) {
      console.error('Error: API key is required (--api-key or LANESHARE_API_KEY)')
      process.exit(1)
    }

    const config: BridgeConfig = {
      apiUrl: options.apiUrl,
      projectId: options.project,
      sessionId: options.session,
      apiKey: options.apiKey,
      workDir: options.workDir,
      debug: options.debug,
    }

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                   LaneShare Bridge Agent                  ║
╠═══════════════════════════════════════════════════════════╣
║  Connecting your dev environment to LaneShare...          ║
╚═══════════════════════════════════════════════════════════╝
`)
    console.log(`  API URL:    ${config.apiUrl}`)
    console.log(`  Project:    ${config.projectId}`)
    console.log(`  Session:    ${config.sessionId}`)
    console.log(`  Work Dir:   ${config.workDir}`)
    console.log('')

    const bridge = new Bridge(config)

    // Handle shutdown signals
    const shutdown = async () => {
      console.log('\nShutting down...')
      await bridge.stop()
      process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    try {
      await bridge.start()
      console.log('\n✓ Bridge is running. Press Ctrl+C to stop.\n')
    } catch (err) {
      console.error('Failed to start bridge:', err)
      process.exit(1)
    }
  })

program
  .command('status')
  .description('Check bridge connection status')
  .action(() => {
    console.log('Status command not yet implemented')
    // TODO: Check if bridge is running and connected
  })

program.parse()
