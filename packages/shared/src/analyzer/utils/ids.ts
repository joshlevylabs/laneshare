// ID generation utilities for architecture nodes, edges, and evidence
// Uses deterministic hashing to ensure stable IDs across runs

import { createHash } from 'crypto'

/**
 * Generate a deterministic node ID based on type and identifying properties
 */
export function generateNodeId(type: string, ...parts: string[]): string {
  const input = [type, ...parts].join(':')
  return `node_${hashString(input).slice(0, 16)}`
}

/**
 * Generate a deterministic edge ID based on source, target, and type
 */
export function generateEdgeId(source: string, target: string, type: string): string {
  const input = [source, target, type].join(':')
  return `edge_${hashString(input).slice(0, 16)}`
}

/**
 * Generate a deterministic evidence ID
 */
export function generateEvidenceId(
  kind: string,
  nodeId: string,
  filePath?: string,
  lineStart?: number
): string {
  const input = [kind, nodeId, filePath || '', lineStart?.toString() || ''].join(':')
  return `evid_${hashString(input).slice(0, 16)}`
}

/**
 * Hash a string to create a stable identifier
 */
function hashString(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}
