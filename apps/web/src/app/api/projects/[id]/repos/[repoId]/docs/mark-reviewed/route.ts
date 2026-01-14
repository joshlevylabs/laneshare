/**
 * POST /api/projects/[id]/repos/[repoId]/docs/mark-reviewed
 *
 * Mark a documentation bundle as reviewed.
 * Changes status from NEEDS_REVIEW to READY.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { RepoDocStatus } from '@laneshare/shared'

const MarkReviewedSchema = z.object({
  bundleId: z.string().uuid(),
  clearAllReviewFlags: z.boolean().optional().default(false),
})

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
    const { bundleId, clearAllReviewFlags } = MarkReviewedSchema.parse(body)

    // Verify bundle exists and belongs to repo
    const { data: bundle, error: bundleError } = await supabase
      .from('repo_doc_bundles')
      .select('id, status')
      .eq('id', bundleId)
      .eq('repo_id', repoId)
      .eq('project_id', projectId)
      .single()

    if (bundleError || !bundle) {
      return NextResponse.json({ error: 'Bundle not found' }, { status: 404 })
    }

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

    return NextResponse.json({
      message: 'Documentation marked as reviewed',
      bundle_id: bundleId,
      status: 'READY',
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
