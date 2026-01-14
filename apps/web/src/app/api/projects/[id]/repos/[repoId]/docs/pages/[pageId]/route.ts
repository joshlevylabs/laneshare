/**
 * GET/PATCH /api/projects/[id]/repos/[repoId]/docs/pages/[pageId]
 *
 * Get or update a single documentation page.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'

const UpdatePageSchema = z.object({
  markdown: z.string().min(1).optional(),
  title: z.string().min(1).max(200).optional(),
  needs_review: z.boolean().optional(),
})

export async function GET(
  request: Request,
  { params }: { params: { id: string; repoId: string; pageId: string } }
) {
  const projectId = params.id
  const repoId = params.repoId
  const pageId = params.pageId
  const supabase = createServerSupabaseClient()

  try {
    // Authenticate
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check project membership
    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get the page with bundle info
    const { data: page, error } = await supabase
      .from('repo_doc_pages')
      .select(`
        *,
        bundle:repo_doc_bundles!bundle_id(
          id,
          version,
          status,
          generated_at,
          source_fingerprint
        ),
        editor:profiles!user_edited_by(id, email, full_name, avatar_url)
      `)
      .eq('id', pageId)
      .eq('repo_id', repoId)
      .eq('project_id', projectId)
      .single()

    if (error || !page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    // Get adjacent pages for navigation
    const { data: adjacentPages } = await supabase
      .from('repo_doc_pages')
      .select('id, slug, title, category')
      .eq('bundle_id', page.bundle_id)
      .order('category')
      .order('slug')

    // Find prev/next pages
    let prevPage = null
    let nextPage = null

    if (adjacentPages) {
      const currentIndex = adjacentPages.findIndex(p => p.id === pageId)
      if (currentIndex > 0) {
        prevPage = adjacentPages[currentIndex - 1]
      }
      if (currentIndex < adjacentPages.length - 1) {
        nextPage = adjacentPages[currentIndex + 1]
      }
    }

    return NextResponse.json({
      page,
      navigation: {
        prev: prevPage,
        next: nextPage,
      },
    })
  } catch (error) {
    console.error('[DocPage] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; repoId: string; pageId: string } }
) {
  const projectId = params.id
  const repoId = params.repoId
  const pageId = params.pageId
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  try {
    // Authenticate
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check project membership
    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Parse request body
    const body = await request.json()
    const updates = UpdatePageSchema.parse(body)

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    // Verify page exists
    const { data: existingPage } = await supabase
      .from('repo_doc_pages')
      .select('id')
      .eq('id', pageId)
      .eq('repo_id', repoId)
      .eq('project_id', projectId)
      .single()

    if (!existingPage) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      ...updates,
      updated_at: new Date().toISOString(),
    }

    // If markdown is being updated, mark as user edited
    if (updates.markdown) {
      updateData.user_edited = true
      updateData.user_edited_at = new Date().toISOString()
      updateData.user_edited_by = user.id
    }

    // Update the page
    const { data: page, error } = await serviceClient
      .from('repo_doc_pages')
      .update(updateData)
      .eq('id', pageId)
      .select()
      .single()

    if (error) {
      console.error('[DocPage] Update error:', error)
      return NextResponse.json({ error: 'Failed to update page' }, { status: 500 })
    }

    return NextResponse.json({ page })
  } catch (error) {
    console.error('[DocPage] Error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
