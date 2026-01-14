'use client'

import { useParams } from 'next/navigation'
import { WorkspaceView } from '@/components/workspace'

export default function WorkspacePage() {
  const params = useParams()
  const projectId = params.id as string

  return <WorkspaceView projectId={projectId} />
}
