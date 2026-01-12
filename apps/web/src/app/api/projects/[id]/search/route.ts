import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getEmbeddingProvider } from '@/lib/embeddings'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const searchSchema = z.object({
  query: z.string().min(1),
  type: z.enum(['semantic', 'keyword']).default('semantic'),
  limit: z.number().min(1).max(50).default(10),
})

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

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const body = await request.json()
  const result = searchSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { query, type, limit } = result.data

  try {
    if (type === 'semantic') {
      // Generate embedding for the query
      const embeddingProvider = getEmbeddingProvider()
      const queryEmbedding = await embeddingProvider.embed(query)

      // Search using vector similarity
      const { data: results, error } = await supabase.rpc('search_chunks', {
        p_project_id: params.id,
        p_query_embedding: queryEmbedding,
        p_match_count: limit,
        p_match_threshold: 0.5,
      })

      if (error) {
        console.error('Search error:', error)
        throw new Error('Search failed')
      }

      return NextResponse.json({
        results: results.map((r: any) => ({
          id: r.id,
          repo_id: r.repo_id,
          file_path: r.file_path,
          content: r.content,
          chunk_index: r.chunk_index,
          similarity: r.similarity,
          repo_owner: r.repo_owner,
          repo_name: r.repo_name,
        })),
      })
    } else {
      // Keyword search
      const { data: results, error } = await supabase.rpc('keyword_search_chunks', {
        p_project_id: params.id,
        p_query: query,
        p_match_count: limit,
      })

      if (error) {
        console.error('Search error:', error)
        throw new Error('Search failed')
      }

      return NextResponse.json({
        results: results.map((r: any) => ({
          id: r.id,
          repo_id: r.repo_id,
          file_path: r.file_path,
          content: r.content,
          chunk_index: r.chunk_index,
          repo_owner: r.repo_owner,
          repo_name: r.repo_name,
        })),
      })
    }
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    )
  }
}
