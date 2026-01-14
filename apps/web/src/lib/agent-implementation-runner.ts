/**
 * Agent Implementation Runner
 *
 * Background runner for the implementation loop.
 * Follows the "Ralph Wiggum Loop" pattern - persist until success or stuck.
 */

import Anthropic from '@anthropic-ai/sdk'
import { GitHubCodeEditor, type CommitFile } from './github-code-editor'
import {
  buildImplementationPrompt,
  buildPRDescription,
  extractAcceptanceCriteria,
  parseImplementationResult,
  extractKeywords,
  IMPLEMENTATION_SYSTEM_PROMPT,
} from '@laneshare/shared'
import type {
  Task,
  Repo,
  AgentExecutionStatus,
  AgentLoopStage,
  AgentProgressInfo,
  FileChangeSummary,
  AgentIteration,
  ImplementationContext,
  ImplementationResult,
} from '@laneshare/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

// ===========================================
// Types
// ===========================================

interface RunnerConfig {
  maxIterations: number
  pauseBetweenIterations: number // ms
  feedbackTimeout: number // ms
}

const DEFAULT_CONFIG: RunnerConfig = {
  maxIterations: 10,
  pauseBetweenIterations: 2000,
  feedbackTimeout: 3600000, // 1 hour
}

// ===========================================
// Main Runner Function
// ===========================================

/**
 * Run the implementation loop for a task
 *
 * This function runs in the background and:
 * 1. Creates a branch for the implementation
 * 2. Calls Claude to generate file changes
 * 3. Applies changes via GitHub API
 * 4. Verifies against acceptance criteria
 * 5. Repeats until all criteria pass or gets stuck
 * 6. Creates a PR when complete
 */
export async function runImplementationLoop(
  sessionId: string,
  projectId: string,
  taskId: string,
  repoId: string,
  userId: string,
  supabase: SupabaseClient
): Promise<void> {
  const cfg = DEFAULT_CONFIG

  // ===========================================
  // Helper Functions
  // ===========================================

  const updateProgress = async (
    stage: AgentLoopStage,
    message: string,
    extra: Partial<AgentProgressInfo> = {}
  ) => {
    const progress: AgentProgressInfo = {
      stage,
      message,
      filesModified: extra.filesModified ?? 0,
      criteriaChecked: extra.criteriaChecked ?? 0,
      criteriaPassed: extra.criteriaPassed ?? 0,
      criteriaTotal: extra.criteriaTotal ?? 0,
      currentFile: extra.currentFile,
      lastUpdated: new Date().toISOString(),
    }

    await supabase
      .from('agent_execution_sessions')
      .update({ stage, progress_json: progress })
      .eq('id', sessionId)
  }

  const updateStatus = async (
    status: AgentExecutionStatus,
    extra: Record<string, unknown> = {}
  ) => {
    await supabase
      .from('agent_execution_sessions')
      .update({ status, ...extra })
      .eq('id', sessionId)
  }

  const log = (message: string) => {
    console.log(`[AgentRunner:${sessionId.slice(0, 8)}] ${message}`)
  }

  // ===========================================
  // Main Execution
  // ===========================================

  try {
    // Mark as running
    await updateStatus('RUNNING', { started_at: new Date().toISOString() })
    await updateProgress('INITIALIZING', 'Loading task and repository context...')

    log('Starting implementation loop')

    // Load task
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single()

    if (taskError || !task) {
      throw new Error('Task not found')
    }

    // Load repo
    const { data: repo, error: repoError } = await supabase
      .from('repos')
      .select('*')
      .eq('id', repoId)
      .single()

    if (repoError || !repo) {
      throw new Error('Repository not found')
    }

    // Get session details
    const { data: session } = await supabase
      .from('agent_execution_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (!session) {
      throw new Error('Session not found')
    }

    // Extract acceptance criteria
    const acceptanceCriteria = extractAcceptanceCriteria(task as Task)
    log(`Found ${acceptanceCriteria.length} acceptance criteria`)

    // Get GitHub client
    const { data: connection } = await supabase
      .from('github_connections')
      .select('access_token_encrypted')
      .eq('user_id', userId)
      .single()

    if (!connection) {
      throw new Error('GitHub connection required')
    }

    const github = await GitHubCodeEditor.fromEncryptedToken(
      connection.access_token_encrypted
    )

    // Create implementation branch
    await updateProgress('INITIALIZING', 'Creating implementation branch...')

    try {
      const branchExists = await github.branchExists(
        repo.owner,
        repo.name,
        session.implementation_branch
      )

      if (!branchExists) {
        await github.createBranch(
          repo.owner,
          repo.name,
          session.implementation_branch,
          session.source_branch
        )
        log(`Created branch: ${session.implementation_branch}`)
      } else {
        log(`Branch already exists: ${session.implementation_branch}`)
      }
    } catch (e) {
      log(`Branch creation warning: ${e}`)
    }

    // Initialize Claude client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })

    // ===========================================
    // Main Loop
    // ===========================================

    let currentIteration = 0
    let allPassed = false
    let isStuck = false
    let stuckReason = ''

    while (
      currentIteration < cfg.maxIterations &&
      !allPassed &&
      !isStuck
    ) {
      currentIteration++
      log(`Starting iteration ${currentIteration}`)

      // Check if session was cancelled
      const { data: currentSession } = await supabase
        .from('agent_execution_sessions')
        .select('status')
        .eq('id', sessionId)
        .single()

      if (currentSession?.status === 'CANCELLED') {
        log('Session cancelled, exiting loop')
        return
      }

      // Check for human feedback if waiting
      if (currentSession?.status === 'WAITING_FEEDBACK') {
        const { data: feedback } = await supabase
          .from('agent_feedback')
          .select('*')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (!feedback || feedback.feedback_type === 'abort') {
          log('No feedback or abort received, exiting')
          return
        }

        // Feedback received, update status and continue
        await updateStatus('RUNNING')
      }

      await updateProgress('ANALYZING_TASK', `Starting iteration ${currentIteration}...`, {
        criteriaTotal: acceptanceCriteria.length,
      })

      // Create iteration record
      const { data: iteration, error: iterError } = await supabase
        .from('agent_iterations')
        .insert({
          session_id: sessionId,
          iteration_number: currentIteration,
          criteria_total: acceptanceCriteria.length,
        })
        .select()
        .single()

      if (iterError || !iteration) {
        throw new Error('Failed to create iteration record')
      }

      // Load previous iterations for context
      const { data: previousIterations } = await supabase
        .from('agent_iterations')
        .select('*')
        .eq('session_id', sessionId)
        .lt('iteration_number', currentIteration)
        .order('iteration_number', { ascending: true })

      // Check for human feedback
      const { data: latestFeedback } = await supabase
        .from('agent_feedback')
        .select('content')
        .eq('session_id', sessionId)
        .eq('feedback_type', 'guidance')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      // Build context
      await updateProgress('PLANNING', 'Building implementation context...', {
        criteriaTotal: acceptanceCriteria.length,
      })

      // Get repo file tree
      const tree = await github.getTree(
        repo.owner,
        repo.name,
        session.implementation_branch
      )
      const filePaths = tree.tree
        .filter(t => t.type === 'blob')
        .map(t => t.path)

      // Get key files (relevant to the task)
      const keyFiles = await getKeyFilesForTask(
        github,
        repo.owner,
        repo.name,
        session.implementation_branch,
        task as Task,
        filePaths
      )

      const implContext: ImplementationContext = {
        task: task as Task,
        repo: repo as Repo,
        acceptanceCriteria,
        repoStructure: filePaths,
        keyFiles,
        previousIterations: (previousIterations || []) as AgentIteration[],
        humanFeedback: latestFeedback?.content,
      }

      // Build and send implementation prompt
      await updateProgress('IMPLEMENTING', 'Generating implementation...', {
        criteriaTotal: acceptanceCriteria.length,
      })

      const implPrompt = buildImplementationPrompt(implContext)
      log(`Sending prompt to Claude (${implPrompt.length} chars)`)

      // Call Claude
      const implResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        system: IMPLEMENTATION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: implPrompt }],
      })

      const implText = implResponse.content.find(c => c.type === 'text')?.text || ''
      log(`Received response (${implText.length} chars)`)

      // Parse implementation result
      let implResult: ImplementationResult
      try {
        implResult = parseImplementationResult(implText)
      } catch (e) {
        log(`Failed to parse implementation response: ${e}`)

        // Update iteration with error
        await supabase
          .from('agent_iterations')
          .update({
            prompt_sent: implPrompt.slice(0, 50000),
            response_received: implText.slice(0, 50000),
            blocked_reason: 'Failed to parse AI response',
            completed_at: new Date().toISOString(),
          })
          .eq('id', iteration.id)

        isStuck = true
        stuckReason = 'AI response was not in expected format'
        continue
      }

      // Check if AI needs human input
      if (implResult.needsHumanInput) {
        log(`AI needs human input: ${implResult.humanInputReason}`)

        await supabase
          .from('agent_iterations')
          .update({
            prompt_sent: implPrompt.slice(0, 50000),
            response_received: implText.slice(0, 50000),
            needs_human_input: true,
            blocked_reason: implResult.humanInputReason,
            completed_at: new Date().toISOString(),
          })
          .eq('id', iteration.id)

        await updateStatus('WAITING_FEEDBACK', {
          stuck_reason: implResult.humanInputReason,
        })

        await updateProgress(
          'AWAITING_FEEDBACK',
          implResult.humanInputReason || 'Awaiting human input',
          { criteriaTotal: acceptanceCriteria.length }
        )

        // Wait for feedback (poll)
        let waitTime = 0
        while (waitTime < cfg.feedbackTimeout) {
          await new Promise(r => setTimeout(r, 5000))
          waitTime += 5000

          const { data: sessionCheck } = await supabase
            .from('agent_execution_sessions')
            .select('status')
            .eq('id', sessionId)
            .single()

          if (sessionCheck?.status === 'RUNNING') {
            log('Feedback received, continuing')
            break
          }
          if (sessionCheck?.status === 'CANCELLED') {
            log('Session cancelled while waiting')
            return
          }
        }

        if (waitTime >= cfg.feedbackTimeout) {
          isStuck = true
          stuckReason = 'Timed out waiting for human feedback'
        }
        continue
      }

      // Apply file changes
      const fileChanges = implResult.fileChanges
      const changeSummaries: FileChangeSummary[] = []

      if (fileChanges.length > 0) {
        await updateProgress('IMPLEMENTING', 'Applying file changes...', {
          criteriaTotal: acceptanceCriteria.length,
          filesModified: fileChanges.length,
        })

        // Prepare commit files
        const commitFiles: CommitFile[] = []

        for (const change of fileChanges) {
          log(`Processing ${change.operation}: ${change.path}`)

          // Record file operation for rollback
          let beforeSha: string | undefined
          let beforeContent: string | undefined

          if (change.operation === 'UPDATE' || change.operation === 'DELETE') {
            try {
              const existingFile = await github.getFileContent(
                repo.owner,
                repo.name,
                change.path,
                session.implementation_branch
              )
              beforeSha = existingFile.sha
              beforeContent = github.decodeContent(
                existingFile.content,
                existingFile.encoding
              )
            } catch (e) {
              // File doesn't exist
              log(`File not found for ${change.operation}: ${change.path}`)
            }
          }

          await supabase.from('agent_file_operations').insert({
            session_id: sessionId,
            iteration_id: iteration.id,
            file_path: change.path,
            operation: change.operation,
            before_sha: beforeSha,
            before_content: beforeContent?.slice(0, 100000),
          })

          // Build commit file
          if (change.operation === 'DELETE') {
            commitFiles.push({
              path: change.path,
              mode: '100644',
              type: 'blob',
              sha: null, // Null SHA = delete
            })
          } else {
            commitFiles.push({
              path: change.path,
              mode: '100644',
              type: 'blob',
              content: change.content,
            })
          }

          changeSummaries.push({
            file: change.path,
            operation: change.operation as FileChangeSummary['operation'],
            summary: change.reason,
          })
        }

        // Create commit with all changes
        await updateProgress('COMMITTING', 'Creating commit...', {
          criteriaTotal: acceptanceCriteria.length,
          filesModified: fileChanges.length,
        })

        try {
          const commit = await github.createMultiFileCommit(
            repo.owner,
            repo.name,
            session.implementation_branch,
            implResult.commitMessage,
            commitFiles
          )

          log(`Created commit: ${commit.sha}`)

          // Update iteration with commit info
          await supabase
            .from('agent_iterations')
            .update({
              commit_sha: commit.sha,
              commit_message: implResult.commitMessage,
              changes_made: changeSummaries,
            })
            .eq('id', iteration.id)
        } catch (e) {
          log(`Commit failed: ${e}`)
          await supabase
            .from('agent_iterations')
            .update({
              blocked_reason: `Commit failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
              changes_made: changeSummaries,
            })
            .eq('id', iteration.id)

          // Try to continue - maybe we can fix in next iteration
        }
      }

      // Update iteration with verification results
      const verification = implResult.verification
      await supabase
        .from('agent_iterations')
        .update({
          prompt_sent: implPrompt.slice(0, 50000),
          response_received: implText.slice(0, 50000),
          verification_results: {
            passed: verification.allPassed,
            score: verification.confidence,
            items: verification.selfCheck,
            summary: verification.allPassed
              ? 'All criteria passed'
              : 'Some criteria not met',
          },
          criteria_passed: verification.selfCheck.filter(c => c.passed).length,
          completed_at: new Date().toISOString(),
        })
        .eq('id', iteration.id)

      // Update session progress
      await supabase
        .from('agent_execution_sessions')
        .update({
          current_iteration: currentIteration,
          total_files_changed: fileChanges.length,
        })
        .eq('id', sessionId)

      // Check if all passed
      allPassed = verification.allPassed && verification.confidence >= 0.8
      log(
        `Iteration ${currentIteration} complete: ${verification.selfCheck.filter(c => c.passed).length}/${verification.selfCheck.length} criteria passed, confidence: ${verification.confidence}`
      )

      if (!allPassed && currentIteration >= cfg.maxIterations) {
        isStuck = true
        stuckReason = `Max iterations (${cfg.maxIterations}) reached without passing all criteria`
      }

      // Pause between iterations
      if (!allPassed && !isStuck) {
        await new Promise(r => setTimeout(r, cfg.pauseBetweenIterations))
      }
    }

    // ===========================================
    // Final Status Update
    // ===========================================

    if (allPassed) {
      // Create PR
      await updateProgress('CREATING_PR', 'Creating pull request...')

      const prBody = buildPRDescription(
        task as { key: string; title: string; description?: string },
        acceptanceCriteria,
        currentIteration,
        session.total_files_changed || 0
      )

      try {
        const pr = await github.createPullRequest(repo.owner, repo.name, {
          title: `[AI] ${task.key}: ${task.title}`,
          body: prBody,
          head: session.implementation_branch,
          base: session.source_branch,
          draft: true, // Start as draft for review
        })

        log(`Created PR #${pr.number}: ${pr.html_url}`)

        await updateStatus('SUCCEEDED', {
          pr_number: pr.number,
          pr_url: pr.html_url,
          completed_at: new Date().toISOString(),
        })

        await updateProgress('FINALIZING', 'Implementation complete!', {
          criteriaTotal: acceptanceCriteria.length,
          criteriaPassed: acceptanceCriteria.length,
        })

        // Update task status to IN_REVIEW
        await supabase
          .from('tasks')
          .update({ status: 'IN_REVIEW' })
          .eq('id', taskId)

        // Log activity
        await supabase.from('task_activity').insert({
          task_id: taskId,
          project_id: projectId,
          actor_id: userId,
          kind: 'AGENT_IMPLEMENTATION_COMPLETED',
          after_value: {
            session_id: sessionId,
            pr_number: pr.number,
            pr_url: pr.html_url,
            iterations: currentIteration,
          },
        })
      } catch (e) {
        log(`PR creation failed: ${e}`)
        await updateStatus('SUCCEEDED', {
          error_message: `PR creation failed: ${e instanceof Error ? e.message : 'Unknown'}`,
          completed_at: new Date().toISOString(),
        })
      }
    } else if (isStuck) {
      log(`Stuck: ${stuckReason}`)

      await updateStatus('STUCK', {
        stuck_reason: stuckReason,
      })

      await updateProgress('AWAITING_FEEDBACK', stuckReason)

      // Log activity
      await supabase.from('task_activity').insert({
        task_id: taskId,
        project_id: projectId,
        actor_id: userId,
        kind: 'AGENT_IMPLEMENTATION_FAILED',
        after_value: {
          session_id: sessionId,
          reason: stuckReason,
          iterations: currentIteration,
        },
      })
    } else {
      await updateStatus('FAILED', {
        error_message: 'Implementation loop ended without success',
        completed_at: new Date().toISOString(),
      })
    }
  } catch (error) {
    console.error('[AgentRunner] Fatal error:', error)

    await updateStatus('FAILED', {
      error_message: error instanceof Error ? error.message : 'Unknown error',
      completed_at: new Date().toISOString(),
    })

    // Log activity
    await supabase.from('task_activity').insert({
      task_id: taskId,
      project_id: projectId,
      actor_id: userId,
      kind: 'AGENT_IMPLEMENTATION_FAILED',
      after_value: {
        session_id: sessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    })
  }
}

// ===========================================
// Helper Functions
// ===========================================

/**
 * Get key files relevant to the task
 */
async function getKeyFilesForTask(
  github: GitHubCodeEditor,
  owner: string,
  repo: string,
  branch: string,
  task: Task,
  allFiles: string[]
): Promise<Array<{ path: string; content: string }>> {
  const keyFiles: Array<{ path: string; content: string }> = []

  // Priority files to always include
  const priorityPatterns = [
    /^readme\.md$/i,
    /^package\.json$/,
    /^tsconfig\.json$/,
    /\.env\.example$/,
  ]

  // Find files matching task keywords
  const keywords = extractKeywords(task.title + ' ' + (task.description || ''))

  const relevantFiles = allFiles.filter(path => {
    // Check priority patterns
    const filename = path.split('/').pop() || ''
    for (const pattern of priorityPatterns) {
      if (pattern.test(filename)) {
        return true
      }
    }

    // Check keyword match
    const pathLower = path.toLowerCase()
    return keywords.some(kw => pathLower.includes(kw))
  })

  // Sort by relevance (priority patterns first, then alphabetically)
  const sortedFiles = relevantFiles.sort((a, b) => {
    const aFilename = a.split('/').pop() || ''
    const bFilename = b.split('/').pop() || ''

    const aIsPriority = priorityPatterns.some(p => p.test(aFilename))
    const bIsPriority = priorityPatterns.some(p => p.test(bFilename))

    if (aIsPriority && !bIsPriority) return -1
    if (!aIsPriority && bIsPriority) return 1
    return a.localeCompare(b)
  })

  // Limit to 15 files
  const filesToFetch = sortedFiles.slice(0, 15)

  for (const path of filesToFetch) {
    try {
      const content = await github.getFileContentDecoded(owner, repo, path, branch)
      if (content) {
        keyFiles.push({ path, content })
      }
    } catch (e) {
      // Skip files that can't be read
    }
  }

  return keyFiles
}
