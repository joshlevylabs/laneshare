import OpenAI from 'openai'
import {
  buildArchitectureDocPrompt,
  buildFeaturesDocPrompt,
  buildMultiRepoDocPrompt,
  ARCHITECTURE_PRIORITY_PATTERNS,
  FEATURES_PRIORITY_PATTERNS,
  type FileTreeItem,
  type ChunkSummary,
  type ArchitecturePromptContext,
  type FeaturesPromptContext,
  type MultiRepoPromptContext,
} from '@laneshare/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

interface DocGenerationResult {
  architectureDoc?: string
  featuresDoc?: string
  multiRepoDoc?: string
  errors: string[]
}

/**
 * Main entry point for documentation generation.
 * Call this after a repo sync completes successfully.
 */
export async function runDocGeneration(
  projectId: string,
  repoId: string,
  supabase: SupabaseClient
): Promise<DocGenerationResult> {
  const result: DocGenerationResult = { errors: [] }

  console.log(`[DocGen] Starting documentation generation for project ${projectId}, repo ${repoId}`)

  try {
    // Get repo info
    const { data: repo } = await supabase
      .from('repos')
      .select('*')
      .eq('id', repoId)
      .single()

    if (!repo) {
      throw new Error('Repository not found')
    }

    // Get all synced repos for this project
    const { data: allRepos } = await supabase
      .from('repos')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'SYNCED')

    // Get project name
    const { data: project } = await supabase
      .from('projects')
      .select('name')
      .eq('id', projectId)
      .single()

    // Gather context for the synced repo
    const fileTree = await getFileTreeSummary(supabase, repoId)
    const architectureChunks = await getRepresentativeChunks(supabase, repoId, 'architecture')
    const featuresChunks = await getRepresentativeChunks(supabase, repoId, 'features')

    // Generate architecture documentation
    try {
      const architectureContext: ArchitecturePromptContext = {
        repoOwner: repo.owner,
        repoName: repo.name,
        fileTree,
        keyChunks: architectureChunks,
      }
      result.architectureDoc = await generateWithOpenAI(buildArchitectureDocPrompt(architectureContext))

      // Update the architecture doc page
      await upsertDocPage(supabase, projectId, 'architecture/overview', 'Architecture Overview', 'architecture', result.architectureDoc)
      console.log(`[DocGen] Architecture doc generated for ${repo.owner}/${repo.name}`)
    } catch (error) {
      const errorMsg = `Architecture doc generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      console.error(`[DocGen] ${errorMsg}`)
      result.errors.push(errorMsg)
    }

    // Generate features documentation
    try {
      const readmeContent = await getReadmeContent(supabase, repoId)
      const routeFiles = await getRouteFiles(supabase, repoId)

      const featuresContext: FeaturesPromptContext = {
        repoOwner: repo.owner,
        repoName: repo.name,
        readmeContent,
        routeFiles,
        keyChunks: featuresChunks,
      }
      result.featuresDoc = await generateWithOpenAI(buildFeaturesDocPrompt(featuresContext))

      // Update the features doc page
      await upsertDocPage(supabase, projectId, 'features/index', 'Features', 'features', result.featuresDoc)
      console.log(`[DocGen] Features doc generated for ${repo.owner}/${repo.name}`)
    } catch (error) {
      const errorMsg = `Features doc generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      console.error(`[DocGen] ${errorMsg}`)
      result.errors.push(errorMsg)
    }

    // Generate multi-repo documentation if there are multiple synced repos
    if (allRepos && allRepos.length > 1) {
      try {
        const multiRepoContext = await buildMultiRepoContext(supabase, projectId, allRepos, project?.name || 'Project')
        result.multiRepoDoc = await generateWithOpenAI(buildMultiRepoDocPrompt(multiRepoContext))

        // Update the status/current doc page with multi-repo info
        await upsertDocPage(supabase, projectId, 'status/current', 'Multi-Repository Architecture', 'status', result.multiRepoDoc)
        console.log(`[DocGen] Multi-repo doc generated for project ${projectId}`)
      } catch (error) {
        const errorMsg = `Multi-repo doc generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        console.error(`[DocGen] ${errorMsg}`)
        result.errors.push(errorMsg)
      }
    }

    console.log(`[DocGen] Documentation generation completed for project ${projectId}`)
    return result
  } catch (error) {
    const errorMsg = `Doc generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    console.error(`[DocGen] ${errorMsg}`)
    result.errors.push(errorMsg)
    return result
  }
}

/**
 * Get file tree summary from repo_files table
 */
async function getFileTreeSummary(
  supabase: SupabaseClient,
  repoId: string
): Promise<FileTreeItem[]> {
  const { data: files } = await supabase
    .from('repo_files')
    .select('path, size, language')
    .eq('repo_id', repoId)
    .order('path')
    .limit(500)

  return (files || []).map((f) => ({
    path: f.path,
    size: f.size,
    language: f.language,
  }))
}

/**
 * Get representative chunks for a specific documentation type
 */
async function getRepresentativeChunks(
  supabase: SupabaseClient,
  repoId: string,
  category: 'architecture' | 'features'
): Promise<ChunkSummary[]> {
  const priorityPatterns =
    category === 'architecture' ? ARCHITECTURE_PRIORITY_PATTERNS : FEATURES_PRIORITY_PATTERNS

  // Get repo name for the chunks
  const { data: repo } = await supabase
    .from('repos')
    .select('owner, name')
    .eq('id', repoId)
    .single()

  const repoName = repo ? `${repo.owner}/${repo.name}` : 'unknown'

  // Get all chunks for this repo
  const { data: chunks } = await supabase
    .from('chunks')
    .select('file_path, content, chunk_index')
    .eq('repo_id', repoId)
    .order('chunk_index')

  if (!chunks || chunks.length === 0) {
    return []
  }

  // Score chunks by how well they match priority patterns
  const scoredChunks = chunks.map((chunk) => {
    let score = 0
    for (const pattern of priorityPatterns) {
      if (chunk.file_path.toLowerCase().includes(pattern.toLowerCase())) {
        score += 10
      }
    }
    // Prefer first chunks of files (usually have imports/overview)
    if (chunk.chunk_index === 0) {
      score += 5
    }
    return { ...chunk, score }
  })

  // Sort by score and take top chunks
  scoredChunks.sort((a, b) => b.score - a.score)

  // Deduplicate by file path (take first chunk per file)
  const seenPaths = new Set<string>()
  const uniqueChunks: ChunkSummary[] = []

  for (const chunk of scoredChunks) {
    if (!seenPaths.has(chunk.file_path) && uniqueChunks.length < 20) {
      seenPaths.add(chunk.file_path)
      uniqueChunks.push({
        filePath: chunk.file_path,
        content: chunk.content,
        repoName,
      })
    }
  }

  return uniqueChunks
}

/**
 * Get README content if available
 */
async function getReadmeContent(
  supabase: SupabaseClient,
  repoId: string
): Promise<string | undefined> {
  const { data: chunks } = await supabase
    .from('chunks')
    .select('content')
    .eq('repo_id', repoId)
    .ilike('file_path', '%readme%')
    .order('chunk_index')
    .limit(5)

  if (chunks && chunks.length > 0) {
    return chunks.map((c) => c.content).join('\n\n')
  }
  return undefined
}

/**
 * Get route/API file paths
 */
async function getRouteFiles(
  supabase: SupabaseClient,
  repoId: string
): Promise<string[]> {
  const { data: files } = await supabase
    .from('repo_files')
    .select('path')
    .eq('repo_id', repoId)
    .or('path.ilike.%route%,path.ilike.%api%,path.ilike.%page%,path.ilike.%controller%,path.ilike.%handler%')
    .limit(50)

  return (files || []).map((f) => f.path)
}

/**
 * Build context for multi-repo documentation
 */
async function buildMultiRepoContext(
  supabase: SupabaseClient,
  projectId: string,
  repos: Array<{ id: string; owner: string; name: string }>,
  projectName: string
): Promise<MultiRepoPromptContext> {
  const repoInfos: MultiRepoPromptContext['repos'] = []
  const crossRepoChunks: ChunkSummary[] = []
  const sharedPatterns: string[] = []

  for (const repo of repos) {
    // Get tech stack info from file tree
    const { data: files } = await supabase
      .from('repo_files')
      .select('language')
      .eq('repo_id', repo.id)

    const languageSet: Record<string, boolean> = {}
    for (const f of files || []) {
      if (f.language) languageSet[f.language] = true
    }
    const languages = Object.keys(languageSet)

    // Get a brief description from README or first chunk
    const readmeContent = await getReadmeContent(supabase, repo.id)
    const description = readmeContent
      ? readmeContent.slice(0, 200) + '...'
      : `${repo.owner}/${repo.name} repository`

    repoInfos.push({
      owner: repo.owner,
      name: repo.name,
      techStack: languages as string[],
      description,
    })

    // Look for cross-repo imports or API calls
    const { data: chunks } = await supabase
      .from('chunks')
      .select('file_path, content')
      .eq('repo_id', repo.id)
      .or('content.ilike.%fetch%,content.ilike.%import%,content.ilike.%from%,content.ilike.%api%')
      .limit(20)

    for (const chunk of chunks || []) {
      // Check for patterns that suggest cross-repo communication
      if (
        chunk.content.includes('fetch(') ||
        chunk.content.includes('axios') ||
        chunk.content.includes('@laneshare/') ||
        chunk.content.includes('from "..') ||
        chunk.content.includes('/api/')
      ) {
        crossRepoChunks.push({
          filePath: chunk.file_path,
          content: chunk.content.slice(0, 500),
          repoName: `${repo.owner}/${repo.name}`,
        })
      }
    }
  }

  // Detect shared patterns
  const allLanguages = repoInfos.flatMap((r) => r.techStack)
  const languageCounts = allLanguages.reduce(
    (acc, lang) => {
      acc[lang] = (acc[lang] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  for (const [lang, count] of Object.entries(languageCounts)) {
    if (count > 1) {
      sharedPatterns.push(`Shared language: ${lang} (used in ${count} repos)`)
    }
  }

  if (crossRepoChunks.some((c) => c.content.includes('/api/'))) {
    sharedPatterns.push('REST API communication detected')
  }

  if (crossRepoChunks.some((c) => c.content.includes('@laneshare/'))) {
    sharedPatterns.push('Monorepo with shared packages')
  }

  return {
    projectName,
    repos: repoInfos,
    sharedPatterns,
    crossRepoChunks: crossRepoChunks.slice(0, 10),
  }
}

/**
 * Call OpenAI to generate documentation
 */
async function generateWithOpenAI(prompt: string): Promise<string> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })

  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [
      {
        role: 'system',
        content: 'You are a technical documentation expert. Generate clear, comprehensive, and well-structured Markdown documentation.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.5,
    max_tokens: 3000,
  })

  return response.choices[0].message.content || '# Documentation\n\nNo content generated.'
}

/**
 * Upsert a doc page in the database
 */
async function upsertDocPage(
  supabase: SupabaseClient,
  projectId: string,
  slug: string,
  title: string,
  category: 'architecture' | 'features' | 'decisions' | 'status',
  markdown: string
): Promise<void> {
  const { error } = await supabase.from('doc_pages').upsert(
    {
      project_id: projectId,
      slug,
      title,
      category,
      markdown,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id,slug' }
  )

  if (error) {
    throw new Error(`Failed to upsert doc page: ${error.message}`)
  }
}
