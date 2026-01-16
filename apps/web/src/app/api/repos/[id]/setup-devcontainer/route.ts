/**
 * Setup Devcontainer API
 * POST /api/repos/[id]/setup-devcontainer
 *
 * Automatically creates or updates .devcontainer/devcontainer.json
 * in the repository to enable ttyd, Claude Code, and LaneShare bridge.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { GitHubCodeEditor } from '@/lib/github-code-editor'
import { NextResponse } from 'next/server'

interface DevcontainerConfig {
  name?: string
  image?: string
  features?: Record<string, unknown>
  postCreateCommand?: string
  postStartCommand?: string
  forwardPorts?: number[]
  portsAttributes?: Record<string, { label?: string; onAutoForward?: string; visibility?: string }>
  containerEnv?: Record<string, string>
  secrets?: Record<string, { description: string }>
  customizations?: {
    vscode?: {
      extensions?: string[]
      settings?: Record<string, unknown>
    }
  }
  // Allow additional properties for flexibility
  [key: string]: unknown
}

/**
 * Generate the devcontainer.json configuration for LaneShare workspaces
 */
function generateDevcontainerConfig(): DevcontainerConfig {
  return {
    name: "LaneShare Workspace",
    image: "mcr.microsoft.com/devcontainers/universal:2",
    features: {
      "ghcr.io/devcontainers/features/node:1": {
        version: "20"
      }
    },
    // Install ttyd and Claude Code, then start ttyd in background
    postCreateCommand: "sudo apt-get update && sudo apt-get install -y ttyd && npm install -g @anthropic-ai/claude-code",
    // Start ttyd on every Codespace start (runs in background)
    postStartCommand: "nohup ttyd -W -p 7681 bash > /tmp/ttyd.log 2>&1 &",
    // Forward the ttyd port
    forwardPorts: [7681],
    // Make port 7681 public so external apps can connect
    portsAttributes: {
      "7681": {
        label: "ttyd Terminal",
        onAutoForward: "silent",
        visibility: "public"
      }
    },
    customizations: {
      vscode: {
        extensions: [
          "anthropics.claude-code"
        ]
      }
    }
  }
}

/**
 * Merge new config into existing config, preserving user customizations
 */
function mergeDevcontainerConfigs(existing: DevcontainerConfig, laneshare: DevcontainerConfig): DevcontainerConfig {
  const merged = { ...existing }

  // Merge name (prefer existing if set)
  if (!merged.name) {
    merged.name = laneshare.name
  }

  // Merge image (prefer existing if set)
  if (!merged.image) {
    merged.image = laneshare.image
  }

  // Merge features
  merged.features = {
    ...laneshare.features,
    ...merged.features,
  }

  // Merge postCreateCommand - append if existing
  if (merged.postCreateCommand && laneshare.postCreateCommand) {
    // Check if already contains our commands
    if (!merged.postCreateCommand.includes('ttyd') && !merged.postCreateCommand.includes('claude-code')) {
      merged.postCreateCommand = `${merged.postCreateCommand} && ${laneshare.postCreateCommand}`
    }
  } else if (!merged.postCreateCommand) {
    merged.postCreateCommand = laneshare.postCreateCommand
  }

  // Merge postStartCommand - append if existing
  if (merged.postStartCommand && laneshare.postStartCommand) {
    // Check if already contains ttyd start
    if (!merged.postStartCommand.includes('ttyd')) {
      merged.postStartCommand = `${merged.postStartCommand} && ${laneshare.postStartCommand}`
    }
  } else if (!merged.postStartCommand) {
    merged.postStartCommand = laneshare.postStartCommand
  }

  // Merge forwardPorts - add 7681 if not present
  merged.forwardPorts = merged.forwardPorts || []
  if (!merged.forwardPorts.includes(7681)) {
    merged.forwardPorts.push(7681)
  }

  // Merge portsAttributes - ensure 7681 is public
  merged.portsAttributes = merged.portsAttributes || {}
  if (!merged.portsAttributes['7681']) {
    merged.portsAttributes['7681'] = {
      label: "ttyd Terminal",
      onAutoForward: "silent",
      visibility: "public"
    }
  } else if (merged.portsAttributes['7681'].visibility !== 'public') {
    // Update existing port config to be public
    merged.portsAttributes['7681'].visibility = 'public'
  }

  // Merge customizations
  merged.customizations = merged.customizations || {}
  merged.customizations.vscode = merged.customizations.vscode || {}
  merged.customizations.vscode.extensions = merged.customizations.vscode.extensions || []

  // Add Claude Code extension if not present
  if (!merged.customizations.vscode.extensions.includes('anthropics.claude-code')) {
    merged.customizations.vscode.extensions.push('anthropics.claude-code')
  }

  return merged
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get the repo
  const { data: repo, error: repoError } = await supabase
    .from('repos')
    .select('id, owner, name, default_branch, selected_branch, project_id, github_token_encrypted')
    .eq('id', params.id)
    .single()

  if (repoError || !repo) {
    return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
  }

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', repo.project_id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Need GitHub token to commit
  if (!repo.github_token_encrypted) {
    return NextResponse.json(
      { error: 'Repository has no GitHub token configured. Please add a token in repo settings.' },
      { status: 400 }
    )
  }

  const branch = repo.selected_branch || repo.default_branch || 'main'
  const devcontainerPath = '.devcontainer/devcontainer.json'

  try {
    const githubEditor = await GitHubCodeEditor.fromEncryptedToken(repo.github_token_encrypted)

    // Check if devcontainer.json already exists
    let existingConfig: DevcontainerConfig | null = null
    let existingSha: string | undefined

    try {
      const existingContent = await githubEditor.getFileContentDecoded(
        repo.owner,
        repo.name,
        devcontainerPath,
        branch
      )
      if (existingContent) {
        existingConfig = JSON.parse(existingContent)
        existingSha = await githubEditor.getFileSha(repo.owner, repo.name, devcontainerPath, branch)
      }
    } catch {
      // File doesn't exist, that's fine
    }

    // Generate the LaneShare config
    const laneshareConfig = generateDevcontainerConfig()

    // Merge or create config
    let finalConfig: DevcontainerConfig
    let commitMessage: string

    if (existingConfig) {
      finalConfig = mergeDevcontainerConfigs(existingConfig, laneshareConfig)
      commitMessage = 'chore: Add LaneShare workspace configuration to devcontainer'
    } else {
      finalConfig = laneshareConfig
      commitMessage = 'chore: Add devcontainer.json for LaneShare workspace'
    }

    // Format JSON nicely
    const configJson = JSON.stringify(finalConfig, null, 2)

    // Commit the file
    const result = await githubEditor.createOrUpdateFile(
      repo.owner,
      repo.name,
      devcontainerPath,
      configJson,
      commitMessage,
      branch,
      existingSha
    )

    // Note: devcontainer_configured column will be tracked once migration is applied
    // For now, the GET endpoint checks the actual file to determine status

    return NextResponse.json({
      success: true,
      message: existingConfig
        ? 'Updated existing devcontainer.json with LaneShare configuration'
        : 'Created devcontainer.json with LaneShare configuration',
      commitSha: result.commit.sha,
      branch,
      wasUpdated: !!existingConfig
    })

  } catch (error) {
    console.error('[Setup Devcontainer] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to setup devcontainer' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/repos/[id]/setup-devcontainer
 * Check if devcontainer is already configured
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get the repo
  const { data: repo, error: repoError } = await supabase
    .from('repos')
    .select('id, owner, name, default_branch, selected_branch, project_id, github_token_encrypted')
    .eq('id', params.id)
    .single()

  if (repoError || !repo) {
    return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
  }

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', repo.project_id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  if (!repo.github_token_encrypted) {
    return NextResponse.json({
      hasDevcontainer: false,
      hasLaneshareConfig: false,
      error: 'No GitHub token configured'
    })
  }

  const branch = repo.selected_branch || repo.default_branch || 'main'
  const devcontainerPath = '.devcontainer/devcontainer.json'

  try {
    const githubEditor = await GitHubCodeEditor.fromEncryptedToken(repo.github_token_encrypted)

    const existingContent = await githubEditor.getFileContentDecoded(
      repo.owner,
      repo.name,
      devcontainerPath,
      branch
    )

    if (!existingContent) {
      return NextResponse.json({
        hasDevcontainer: false,
        hasLaneshareConfig: false
      })
    }

    const config: DevcontainerConfig = JSON.parse(existingContent)

    // Check if it has LaneShare configuration
    const hasTtyd = config.postStartCommand?.includes('ttyd') || config.postCreateCommand?.includes('ttyd')
    const hasClaudeCode = config.postCreateCommand?.includes('claude-code') ||
                          config.customizations?.vscode?.extensions?.includes('anthropics.claude-code')
    const hasPort7681 = config.forwardPorts?.includes(7681)

    return NextResponse.json({
      hasDevcontainer: true,
      hasLaneshareConfig: hasTtyd && hasClaudeCode && hasPort7681,
      hasTtyd,
      hasClaudeCode,
      hasPort7681,
      config
    })

  } catch (error) {
    console.error('[Setup Devcontainer] Error checking config:', error)
    return NextResponse.json({
      hasDevcontainer: false,
      hasLaneshareConfig: false,
      error: error instanceof Error ? error.message : 'Failed to check devcontainer'
    })
  }
}
