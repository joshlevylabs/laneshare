import { redirect } from 'next/navigation'

interface PageProps {
  params: { id: string; repoId: string }
}

export default async function RepoDocsPage({ params }: PageProps) {
  // Redirect to the unified documents page with repo filter
  redirect(`/projects/${params.id}/documents?repo=${params.repoId}`)
}
