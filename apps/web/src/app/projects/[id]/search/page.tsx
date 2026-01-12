'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import { Search, Loader2, FileCode, Copy, Check } from 'lucide-react'

interface SearchResult {
  id: string
  repo_id: string
  file_path: string
  content: string
  chunk_index: number
  similarity?: number
  repo_owner: string
  repo_name: string
}

export default function SearchPage({ params }: { params: { id: string } }) {
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [searchType, setSearchType] = useState<'semantic' | 'keyword'>('semantic')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setIsSearching(true)
    setResults([])

    try {
      const response = await fetch(`/api/projects/${params.id}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, type: searchType }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Search failed')
      }

      const data = await response.json()
      setResults(data.results)

      if (data.results.length === 0) {
        toast({
          title: 'No results found',
          description: 'Try different search terms or sync more repositories.',
        })
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Search failed',
        description: error instanceof Error ? error.message : 'An error occurred',
      })
    } finally {
      setIsSearching(false)
    }
  }

  const copyToClipboard = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
    toast({
      title: 'Copied to clipboard',
      description: 'Code snippet copied successfully.',
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Search Code</h1>
        <p className="text-muted-foreground">
          Search across all indexed repositories using semantic or keyword search
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
          <CardDescription>
            Semantic search finds conceptually related code. Keyword search finds exact matches.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="space-y-4">
            <Tabs
              value={searchType}
              onValueChange={(v) => setSearchType(v as 'semantic' | 'keyword')}
            >
              <TabsList>
                <TabsTrigger value="semantic">Semantic Search</TabsTrigger>
                <TabsTrigger value="keyword">Keyword Search</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={
                    searchType === 'semantic'
                      ? 'Describe what you\'re looking for...'
                      : 'Enter keywords to search...'
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button type="submit" disabled={isSearching || !query.trim()}>
                {isSearching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Search
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            {results.length} result{results.length !== 1 ? 's' : ''} found
          </h2>

          {results.map((result) => (
            <Card key={result.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <FileCode className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <CardTitle className="text-sm font-medium">
                        {result.repo_owner}/{result.repo_name}
                      </CardTitle>
                      <CardDescription>{result.file_path}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {result.similarity && (
                      <Badge variant="secondary">
                        {Math.round(result.similarity * 100)}% match
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(result.content, result.id)}
                    >
                      {copiedId === result.id ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="bg-muted p-4 rounded-md overflow-x-auto text-sm">
                  <code>{result.content}</code>
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isSearching && results.length === 0 && query && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Search className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No results</h3>
            <p className="text-muted-foreground text-center max-w-sm">
              No matching code found. Try different search terms or make sure your repositories are synced.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
