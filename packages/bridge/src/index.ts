/**
 * LaneShare Bridge Agent
 *
 * This package provides a bridge agent that connects development environments
 * (like GitHub Codespaces) to LaneShare for real-time collaborative coding
 * with Claude Code agents.
 *
 * @example
 * ```typescript
 * import { Bridge } from '@laneshare/bridge'
 *
 * const bridge = new Bridge({
 *   apiUrl: 'https://laneshare.dev',
 *   projectId: 'project-123',
 *   sessionId: 'session-456',
 *   apiKey: 'your-api-key',
 *   workDir: '/workspaces/my-repo'
 * })
 *
 * await bridge.start()
 * ```
 */

export { Bridge } from './bridge.js'
export * from './types.js'
