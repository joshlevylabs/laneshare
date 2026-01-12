import OpenAI from 'openai'

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
  readonly dimension: number
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI
  readonly dimension = 1536

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-ada-002',
      input: text,
    })
    return response.data[0].embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    // OpenAI allows up to 2048 texts per request, but we'll batch conservatively
    const batchSize = 100
    const results: number[][] = []

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)
      const response = await this.client.embeddings.create({
        model: 'text-embedding-ada-002',
        input: batch,
      })

      for (const item of response.data) {
        results.push(item.embedding)
      }
    }

    return results
  }
}

// Factory function to create embedding provider based on environment
export function createEmbeddingProvider(): EmbeddingProvider {
  const provider = process.env.EMBEDDINGS_PROVIDER || 'openai'

  switch (provider) {
    case 'openai':
      return new OpenAIEmbeddingProvider()
    default:
      throw new Error(`Unknown embedding provider: ${provider}`)
  }
}

// Singleton instance for reuse
let embeddingProvider: EmbeddingProvider | null = null

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!embeddingProvider) {
    embeddingProvider = createEmbeddingProvider()
  }
  return embeddingProvider
}
