import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { GitHubClient } from '@/lib/github'
import { getEmbeddingProvider } from '@/lib/embeddings'
import { runDocGeneration } from '@/lib/doc-generator'
import { chunkContent, estimateTokens, shouldIndexFile, detectLanguage } from '@laneshare/shared'
import { NextResponse } from 'next/server'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get the repo
  const { data: repo, error: repoError } = await supabase
    .from('repos')
    .select('*, projects!inner(id)')
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

  // Get GitHub connection
  const { data: connection } = await supabase
    .from('github_connections')
    .select('access_token_encrypted')
    .eq('user_id', user.id)
    .single()

  if (!connection) {
    return NextResponse.json(
      { error: 'GitHub not connected. Please connect your GitHub account first.' },
      { status: 400 }
    )
  }

  // Update repo status to syncing with initial progress
  await serviceClient
    .from('repos')
    .update({
      status: 'SYNCING',
      sync_error: null,
      sync_progress: 0,
      sync_total: 0,
      sync_stage: 'discovering',
    })
    .eq('id', params.id)

  // Start sync in background
  syncRepository(params.id, repo, connection.access_token_encrypted, serviceClient)
    .catch((error) => {
      console.error('Sync error:', error)
      serviceClient
        .from('repos')
        .update({
          status: 'ERROR',
          sync_error: error instanceof Error ? error.message : 'Unknown error',
        })
        .eq('id', params.id)
    })

  return NextResponse.json({ message: 'Sync started' })
}

async function syncRepository(
  repoId: string,
  repo: { owner: string; name: string; default_branch: string; project_id: string },
  encryptedToken: string,
  supabase: ReturnType<typeof createServiceRoleClient>
) {
  const github = await GitHubClient.fromEncryptedToken(encryptedToken)
  const embeddingProvider = getEmbeddingProvider()

  // Get the file tree
  const { tree } = await github.getTree(repo.owner, repo.name, repo.default_branch, true)

  // Filter to indexable files
  const indexableFiles = tree.filter(
    (item) =>
      item.type === 'blob' &&
      item.size &&
      shouldIndexFile(item.path, item.size)
  )

  // Update progress with total file count
  await supabase
    .from('repos')
    .update({
      sync_total: indexableFiles.length,
      sync_stage: 'indexing',
    })
    .eq('id', repoId)

  // Delete existing chunks for this repo
  await supabase.from('chunks').delete().eq('repo_id', repoId)
  await supabase.from('repo_files').delete().eq('repo_id', repoId)

  // Process files in batches
  const batchSize = 10
  const allChunks: Array<{
    repo_id: string
    file_path: string
    chunk_index: number
    content: string
    token_count: number
    metadata: Record<string, unknown>
  }> = []

  let filesProcessed = 0
  for (let i = 0; i < indexableFiles.length; i += batchSize) {
    const batch = indexableFiles.slice(i, i + batchSize)

    await Promise.all(
      batch.map(async (file) => {
        try {
          // Get file content
          const blob = await github.getBlob(repo.owner, repo.name, file.sha)
          const content = github.decodeContent(blob.content, blob.encoding)

          // Store file record
          await supabase.from('repo_files').upsert(
            {
              repo_id: repoId,
              path: file.path,
              sha: file.sha,
              size: file.size || 0,
              language: detectLanguage(file.path),
              last_indexed_at: new Date().toISOString(),
            },
            { onConflict: 'repo_id,path' }
          )

          // Chunk the content
          const chunks = chunkContent(content, file.path)

          for (let idx = 0; idx < chunks.length; idx++) {
            allChunks.push({
              repo_id: repoId,
              file_path: file.path,
              chunk_index: idx,
              content: chunks[idx],
              token_count: estimateTokens(chunks[idx]),
              metadata: {
                language: detectLanguage(file.path),
                totalChunks: chunks.length,
              },
            })
          }
        } catch (error) {
          console.error(`Error processing file ${file.path}:`, error)
        }
      })
    )

    // Update progress after each batch
    filesProcessed += batch.length
    await supabase
      .from('repos')
      .update({ sync_progress: filesProcessed })
      .eq('id', repoId)
  }

  // Update stage to embedding
  await supabase
    .from('repos')
    .update({ sync_stage: 'embedding' })
    .eq('id', repoId)

  // Generate embeddings in batches
  const embeddingBatchSize = 50
  for (let i = 0; i < allChunks.length; i += embeddingBatchSize) {
    const batch = allChunks.slice(i, i + embeddingBatchSize)
    const contents = batch.map((c) => c.content)

    try {
      const embeddings = await embeddingProvider.embedBatch(contents)

      // Insert chunks with embeddings
      const chunksWithEmbeddings = batch.map((chunk, idx) => ({
        ...chunk,
        embedding: embeddings[idx],
      }))

      await supabase.from('chunks').insert(chunksWithEmbeddings)
    } catch (error) {
      console.error('Error generating embeddings:', error)
      // Insert chunks without embeddings as fallback
      await supabase.from('chunks').insert(batch)
    }
  }

  // Update stage to generating docs
  await supabase
    .from('repos')
    .update({ sync_stage: 'generating_docs' })
    .eq('id', repoId)

  // Trigger documentation generation and wait for completion before marking as synced
  try {
    const docResult = await runDocGeneration(repo.project_id, repoId, supabase)
    if (docResult.errors.length > 0) {
      console.log(`[DocGen] Completed with ${docResult.errors.length} errors:`, docResult.errors)
    } else {
      console.log(`[DocGen] Successfully generated documentation for repo ${repoId}`)
    }
  } catch (error) {
    console.error('[DocGen] Documentation generation failed:', error)
  }

  // Update repo status to synced and clear progress fields
  await supabase
    .from('repos')
    .update({
      status: 'SYNCED',
      last_synced_at: new Date().toISOString(),
      sync_error: null,
      sync_progress: null,
      sync_total: null,
      sync_stage: null,
    })
    .eq('id', repoId)
}
