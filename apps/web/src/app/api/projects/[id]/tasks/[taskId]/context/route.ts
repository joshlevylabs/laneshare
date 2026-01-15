import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type {
  TaskServiceLink,
  TaskAssetLink,
  TaskRepoLink,
  TaskDocLink,
  TaskFeatureLink,
  TaskTicketLink,
  TaskRepoDocLink,
  TaskLinkedContext,
  TicketLinkType,
} from '@laneshare/shared'

const addLinkSchema = z.object({
  type: z.enum(['service', 'asset', 'repo', 'doc', 'feature', 'ticket', 'repo_doc']),
  id: z.string().uuid(),
  // Optional: for ticket links, specify the relationship type
  linkType: z.enum(['related', 'blocks', 'blocked_by', 'duplicates', 'duplicated_by']).optional(),
})

const removeLinkSchema = z.object({
  type: z.enum(['service', 'asset', 'repo', 'doc', 'feature', 'ticket', 'repo_doc']),
  linkId: z.string().uuid(),
})

// GET - Fetch all linked context for a task
export async function GET(
  request: Request,
  { params }: { params: { id: string; taskId: string } }
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

  // Fetch all linked context in parallel
  const [servicesResult, assetsResult, reposResult, docsResult, featuresResult, ticketsResult, repoDocsResult] = await Promise.all([
    supabase
      .from('task_service_links')
      .select(`
        id,
        task_id,
        project_id,
        connection_id,
        created_by,
        created_at,
        connection:project_service_connections(id, service, display_name)
      `)
      .eq('task_id', params.taskId)
      .order('created_at', { ascending: false }),

    supabase
      .from('task_asset_links')
      .select(`
        id,
        task_id,
        project_id,
        asset_id,
        created_by,
        created_at,
        asset:service_assets(id, name, asset_type, asset_key, service, data_json)
      `)
      .eq('task_id', params.taskId)
      .order('created_at', { ascending: false }),

    supabase
      .from('task_repo_links')
      .select(`
        id,
        task_id,
        project_id,
        repo_id,
        created_by,
        created_at,
        repo:repos(id, owner, name, default_branch)
      `)
      .eq('task_id', params.taskId)
      .order('created_at', { ascending: false }),

    // Try new documents table first, with fallback to doc_pages for legacy links
    supabase
      .from('task_doc_links')
      .select(`
        id,
        task_id,
        project_id,
        doc_id,
        created_by,
        created_at
      `)
      .eq('task_id', params.taskId)
      .order('created_at', { ascending: false }),

    supabase
      .from('task_feature_links')
      .select(`
        id,
        task_id,
        project_id,
        feature_id,
        created_by,
        created_at,
        feature:architecture_features(id, feature_slug, feature_name, description)
      `)
      .eq('task_id', params.taskId)
      .order('created_at', { ascending: false }),

    supabase
      .from('task_ticket_links')
      .select(`
        id,
        task_id,
        project_id,
        linked_task_id,
        link_type,
        created_by,
        created_at,
        linked_task:tasks!linked_task_id(id, key, title, status, type)
      `)
      .eq('task_id', params.taskId)
      .order('created_at', { ascending: false }),

    supabase
      .from('task_repo_doc_links')
      .select(`
        id,
        task_id,
        project_id,
        repo_doc_page_id,
        created_by,
        created_at,
        repo_doc_page:repo_doc_pages(id, slug, title, category, repo_id, needs_review, repo:repos(owner, name))
      `)
      .eq('task_id', params.taskId)
      .order('created_at', { ascending: false }),
  ])

  // Fetch document details for doc links (from new documents table, fallback to doc_pages)
  const docLinks = docsResult.data || []
  const docIds = docLinks.map((l) => l.doc_id).filter(Boolean)

  let docsWithDetails: TaskDocLink[] = []
  if (docIds.length > 0) {
    // First try the new documents table
    const { data: docs } = await supabase
      .from('documents')
      .select('id, slug, title, category')
      .in('id', docIds)

    const docsMap = new Map((docs || []).map((d) => [d.id, d]))

    // For any missing, try doc_pages (legacy)
    const missingDocIds = docIds.filter((id) => !docsMap.has(id))
    if (missingDocIds.length > 0) {
      const { data: legacyDocs } = await supabase
        .from('doc_pages')
        .select('id, slug, title, category')
        .in('id', missingDocIds)

      for (const d of legacyDocs || []) {
        docsMap.set(d.id, d as any) // Legacy doc_pages has different category enum
      }
    }

    docsWithDetails = docLinks.map((link) => ({
      ...link,
      doc: docsMap.get(link.doc_id) || null,
    })) as unknown as TaskDocLink[]
  }

  // Transform Supabase results to match our types (use 'as unknown as' for nested relations)
  const linkedContext: TaskLinkedContext = {
    services: (servicesResult.data || []) as unknown as TaskServiceLink[],
    assets: (assetsResult.data || []) as unknown as TaskAssetLink[],
    repos: (reposResult.data || []) as unknown as TaskRepoLink[],
    docs: docsWithDetails,
    features: (featuresResult.data || []) as unknown as TaskFeatureLink[],
    tickets: (ticketsResult.data || []) as unknown as TaskTicketLink[],
    repoDocs: (repoDocsResult.data || []) as unknown as TaskRepoDocLink[],
  }

  return NextResponse.json(linkedContext)
}

// POST - Add a context link
export async function POST(
  request: Request,
  { params }: { params: { id: string; taskId: string } }
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
  const result = addLinkSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { type, id } = result.data
  let data, error

  switch (type) {
    case 'service':
      ({ data, error } = await supabase
        .from('task_service_links')
        .insert({
          task_id: params.taskId,
          project_id: params.id,
          connection_id: id,
          created_by: user.id,
        })
        .select(`
          id,
          task_id,
          project_id,
          connection_id,
          created_by,
          created_at,
          connection:project_service_connections(id, service, display_name)
        `)
        .single())
      break

    case 'asset':
      ({ data, error } = await supabase
        .from('task_asset_links')
        .insert({
          task_id: params.taskId,
          project_id: params.id,
          asset_id: id,
          created_by: user.id,
        })
        .select(`
          id,
          task_id,
          project_id,
          asset_id,
          created_by,
          created_at,
          asset:service_assets(id, name, asset_type, asset_key, service, data_json)
        `)
        .single())
      break

    case 'repo':
      ({ data, error } = await supabase
        .from('task_repo_links')
        .insert({
          task_id: params.taskId,
          project_id: params.id,
          repo_id: id,
          created_by: user.id,
        })
        .select(`
          id,
          task_id,
          project_id,
          repo_id,
          created_by,
          created_at,
          repo:repos(id, owner, name, default_branch)
        `)
        .single())
      break

    case 'doc':
      // Insert the link
      ({ data, error } = await supabase
        .from('task_doc_links')
        .insert({
          task_id: params.taskId,
          project_id: params.id,
          doc_id: id,
          created_by: user.id,
        })
        .select(`
          id,
          task_id,
          project_id,
          doc_id,
          created_by,
          created_at
        `)
        .single())

      // Fetch doc details from documents table (or doc_pages for legacy)
      if (data && !error) {
        let docInfo = null
        const { data: newDoc } = await supabase
          .from('documents')
          .select('id, slug, title, category')
          .eq('id', id)
          .single()

        if (newDoc) {
          docInfo = newDoc
        } else {
          const { data: legacyDoc } = await supabase
            .from('doc_pages')
            .select('id, slug, title, category')
            .eq('id', id)
            .single()
          docInfo = legacyDoc
        }
        data = { ...data, doc: docInfo }
      }
      break

    case 'feature':
      ({ data, error } = await supabase
        .from('task_feature_links')
        .insert({
          task_id: params.taskId,
          project_id: params.id,
          feature_id: id,
          created_by: user.id,
        })
        .select(`
          id,
          task_id,
          project_id,
          feature_id,
          created_by,
          created_at,
          feature:architecture_features(id, feature_slug, feature_name, description)
        `)
        .single())
      break

    case 'ticket':
      ({ data, error } = await supabase
        .from('task_ticket_links')
        .insert({
          task_id: params.taskId,
          project_id: params.id,
          linked_task_id: id,
          link_type: result.data.linkType || 'related',
          created_by: user.id,
        })
        .select(`
          id,
          task_id,
          project_id,
          linked_task_id,
          link_type,
          created_by,
          created_at,
          linked_task:tasks!linked_task_id(id, key, title, status, type)
        `)
        .single())
      break

    case 'repo_doc':
      ({ data, error } = await supabase
        .from('task_repo_doc_links')
        .insert({
          task_id: params.taskId,
          project_id: params.id,
          repo_doc_page_id: id,
          created_by: user.id,
        })
        .select(`
          id,
          task_id,
          project_id,
          repo_doc_page_id,
          created_by,
          created_at,
          repo_doc_page:repo_doc_pages(id, slug, title, category, repo_id, needs_review, repo:repos(owner, name))
        `)
        .single())
      break
  }

  if (error) {
    // Handle unique constraint violation (already linked)
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'This item is already linked to the task' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Log activity
  await supabase.from('task_activity').insert({
    task_id: params.taskId,
    project_id: params.id,
    actor_id: user.id,
    kind: 'CONTEXT_LINKED',
    field_name: type,
    after_value: id,
  })

  return NextResponse.json({ type, link: data }, { status: 201 })
}

// DELETE - Remove a context link
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; taskId: string } }
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
  const result = removeLinkSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { type, linkId } = result.data
  let error

  switch (type) {
    case 'service':
      ({ error } = await supabase
        .from('task_service_links')
        .delete()
        .eq('id', linkId)
        .eq('task_id', params.taskId))
      break

    case 'asset':
      ({ error } = await supabase
        .from('task_asset_links')
        .delete()
        .eq('id', linkId)
        .eq('task_id', params.taskId))
      break

    case 'repo':
      ({ error } = await supabase
        .from('task_repo_links')
        .delete()
        .eq('id', linkId)
        .eq('task_id', params.taskId))
      break

    case 'doc':
      ({ error } = await supabase
        .from('task_doc_links')
        .delete()
        .eq('id', linkId)
        .eq('task_id', params.taskId))
      break

    case 'feature':
      ({ error } = await supabase
        .from('task_feature_links')
        .delete()
        .eq('id', linkId)
        .eq('task_id', params.taskId))
      break

    case 'ticket':
      ({ error } = await supabase
        .from('task_ticket_links')
        .delete()
        .eq('id', linkId)
        .eq('task_id', params.taskId))
      break

    case 'repo_doc':
      ({ error } = await supabase
        .from('task_repo_doc_links')
        .delete()
        .eq('id', linkId)
        .eq('task_id', params.taskId))
      break
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Log activity
  await supabase.from('task_activity').insert({
    task_id: params.taskId,
    project_id: params.id,
    actor_id: user.id,
    kind: 'CONTEXT_UNLINKED',
    field_name: type,
    before_value: linkId,
  })

  return NextResponse.json({ success: true })
}
