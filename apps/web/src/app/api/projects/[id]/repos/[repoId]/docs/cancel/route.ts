/**
 * POST /api/projects/[id]/repos/[repoId]/docs/cancel
 *
 * Cancels an ongoing documentation generation process.
 * Sets the bundle status to ERROR with a "cancelled" message.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { RepoDocStatus } from '@laneshare/shared'

export async function POST(
  request: Request,
  { params }: { params: { id: string; repoId: string } }
) {
  const { id: projectId, repoId } = params
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
        { error: 'Only maintainers can cancel documentation generation' },
        { status: 403 }
      )
    }

    // Get repo info to find current bundle
    const { data: repo, error: repoError } = await supabase
      .from('repos')
      .select('doc_bundle_id, doc_status')
      .eq('id', repoId)
      .eq('project_id', projectId)
      .single()

    if (repoError || !repo) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
    }

    // Check if there's actually a generation in progress
    if (repo.doc_status !== 'GENERATING') {
      return NextResponse.json({
        message: 'No documentation generation in progress',
        status: repo.doc_status,
      })
    }

    // Update bundle status to cancelled
    if (repo.doc_bundle_id) {
      await serviceClient
        .from('repo_doc_bundles')
        .update({
          status: 'ERROR' as RepoDocStatus,
          error: 'Generation cancelled by user',
          progress_json: null,
        })
        .eq('id', repo.doc_bundle_id)
    }

    // Update repo status
    await serviceClient
      .from('repos')
      .update({
        doc_status: null, // Reset to no docs
        doc_bundle_id: null,
      })
      .eq('id', repoId)

    console.log(`[DocCancel] Cancelled doc generation for repo ${repoId}`)

    return NextResponse.json({
      message: 'Documentation generation cancelled',
      success: true,
    })
  } catch (error) {
    console.error('[DocCancel] Error:', error)
    return NextResponse.json(
      { error: 'Failed to cancel documentation generation' },
      { status: 500 }
    )
  }
}
