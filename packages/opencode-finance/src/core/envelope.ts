export type Tier = "official" | "unofficial"

export type Source = {
  publisher: string
  title: string
  url: string
  tier: Tier
  // When this copy was fetched from the publisher; older than "now" when served from cache.
  retrieved_at: string
}

export type Envelope<T> = {
  data: T
  sources: Source[]
  warnings: string[]
}

export class SourceCollector {
  private readonly items = new Map<string, Source>()
  readonly warnings: string[] = []

  add(source: Source) {
    if (!this.items.has(source.url)) this.items.set(source.url, source)
    return source
  }

  warn(message: string) {
    if (!this.warnings.includes(message)) this.warnings.push(message)
  }

  envelope<T>(data: T): Envelope<T> {
    return { data, sources: [...this.items.values()], warnings: this.warnings }
  }
}
