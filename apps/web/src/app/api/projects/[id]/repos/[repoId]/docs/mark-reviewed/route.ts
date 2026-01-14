/**
 * POST /api/projects/[id]/repos/[repoId]/docs/mark-reviewed
 *
 * Mark a documentation bundle as reviewed.
 * Changes status from NEEDS_REVIEW to READY.
 * Also copies repo doc pages to the project documents table.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { RepoDocStatus, RepoDocCategory, DocumentCategory } from '@laneshare/shared'

const MarkReviewedSchema = z.object({
  bundleId: z.string().uuid(),
  clearAllReviewFlags: z.boolean().optional().default(false),
  copyToDocuments: z.boolean().optional().default(true), // Copy pages to project documents
})

// Map repo doc categories to document categories
const CATEGORY_MAP: Record<RepoDocCategory, DocumentCategory> = {
  ARCHITECTURE: 'architecture',
  API: 'api',
  FEATURE: 'feature_guide',
  RUNBOOK: 'runbook',
}

export async function POST(
  request: Request,
  { params }: { params: { id: string; repoId: string } }
) {
  const projectId = params.id
  const repoId = params.repoId
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  try {
    // Authenticate
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check project membership (maintainer or higher)
    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only maintainers can mark documentation as reviewed' },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { bundleId, clearAllReviewFlags, copyToDocuments } = MarkReviewedSchema.parse(body)

    // Verify bundle exists and belongs to repo, get repo info
    const [bundleResult, repoResult] = await Promise.all([
      supabase
        .from('repo_doc_bundles')
        .select('id, status')
        .eq('id', bundleId)
        .eq('repo_id', repoId)
        .eq('project_id', projectId)
        .single(),
      supabase
        .from('repos')
        .select('name, owner')
        .eq('id', repoId)
        .single(),
    ])

    if (bundleResult.error || !bundleResult.data) {
      return NextResponse.json({ error: 'Bundle not found' }, { status: 404 })
    }

    const repo = repoResult.data

    // Update bundle status to READY
    const { error: updateError } = await serviceClient
      .from('repo_doc_bundles')
      .update({
        status: 'READY' as RepoDocStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bundleId)

    if (updateError) {
      console.error('[MarkReviewed] Update error:', updateError)
      return NextResponse.json({ error: 'Failed to update bundle' }, { status: 500 })
    }

    // Optionally clear all needs_review flags on pages
    if (clearAllReviewFlags) {
      await serviceClient
        .from('repo_doc_pages')
        .update({
          needs_review: false,
          updated_at: new Date().toISOString(),
        })
        .eq('bundle_id', bundleId)
        .eq('needs_review', true)
    }

    // Update repo status
    await serviceClient
      .from('repos')
      .update({
        doc_status: 'READY',
      })
      .eq('id', repoId)
      .eq('doc_bundle_id', bundleId)

    // Copy repo doc pages to project documents table
    let createdCount = 0
    let updatedCount = 0
    if (copyToDocuments) {
      // Fetch all pages from the bundle
      const { data: pages, error: pagesError } = await serviceClient
        .from('repo_doc_pages')
        .select('*')
        .eq('bundle_id', bundleId)

      if (pagesError) {
        console.error('[MarkReviewed] Failed to fetch pages:', pagesError)
      } else if (pages && pages.length > 0) {
        const repoPrefix = repo?.name || 'repo'

        for (const page of pages) {
          // Generate unique slug with repo prefix
          const docSlug = `${repoPrefix}-${page.slug}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
          const docCategory = CATEGORY_MAP[page.category as RepoDocCategory] || 'other'

          // Check if document already exists (by slug)
          const { data: existingDoc } = await serviceClient
            .from('documents')
            .select('id')
            .eq('project_id', projectId)
            .eq('slug', docSlug)
            .single()

          if (existingDoc) {
            // Update existing document
            await serviceClient
              .from('documents')
              .update({
                title: page.title,
                markdown: page.markdown,
                description: `Auto-generated documentation from ${repo?.owner}/${repo?.name}`,
                updated_by: user.id,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingDoc.id)
            updatedCount++
          } else {
            // Create new document
            await serviceClient
              .from('documents')
              .insert({
                project_id: projectId,
                title: page.title,
                slug: docSlug,
                category: docCategory,
                description: `Auto-generated documentation from ${repo?.owner}/${repo?.name}`,
                tags: ['auto-generated', repoPrefix, page.category.toLowerCase()],
                markdown: page.markdown,
                created_by: user.id,
                updated_by: user.id,
              })
            createdCount++
          }
        }
        console.log(`[MarkReviewed] Documents: ${createdCount} created, ${updatedCount} updated`)
      }
    }

    return NextResponse.json({
      message: 'Documentation marked as reviewed',
      bundle_id: bundleId,
      status: 'READY',
      documents_created: createdCount,
      documents_updated: updatedCount,
    })
  } catch (error) {
    console.error('[MarkReviewed] Error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
