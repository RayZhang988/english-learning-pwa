import type { ReadonlyDataSource } from '../core/index.ts'
import { platformFetch } from '../platform/index.ts'
export interface ProductionReviewContentAlias { readonly reviewContentId: string; readonly originalQuestionType: string; readonly domain: 'vocabulary' | 'listening' | 'speaking'; readonly source: Readonly<Record<string, string>> }
export interface ProductionReviewContentIndex { readonly schemaVersion: 1; readonly documentType: 'review-content-index'; readonly contentVersion: '1.0.0'; readonly aliases: Readonly<Record<string, ProductionReviewContentAlias>> }

export const REVIEW_CONTENT_INDEX_PATH = 'content/curriculum/review-content-index.v1.json'
export const reviewContentIndexUrl = new URL('../../content/curriculum/review-content-index.v1.json', import.meta.url).href
const REVIEW_SHARD_URLS: Readonly<Record<string, string>> = Object.fromEntries([
  ...Array.from({ length: 16 }, (_, bucket) => {
    const suffix = String(bucket).padStart(2, '0')
    const path = `content/curriculum/review-content-index.v1/vocabulary-${suffix}.json`
    return [path, new URL(`../../content/curriculum/review-content-index.v1/vocabulary-${suffix}.json`, import.meta.url).href]
  }),
  ...Array.from({ length: 4 }, (_, bucket) => {
    const suffix = String(bucket).padStart(2, '0')
    const path = `content/curriculum/review-content-index.v1/scene-vocabulary-${suffix}.json`
    return [path, new URL(`../../content/curriculum/review-content-index.v1/scene-vocabulary-${suffix}.json`, import.meta.url).href]
  }),
  ['content/curriculum/review-content-index.v1/listening.json', new URL('../../content/curriculum/review-content-index.v1/listening.json', import.meta.url).href],
  ['content/curriculum/review-content-index.v1/speaking.json', new URL('../../content/curriculum/review-content-index.v1/speaking.json', import.meta.url).href],
])

function shardDigest(value: unknown): string {
  let hash = 0x811c9dc5
  for (const character of `review-content-v2-shard|${JSON.stringify(value)}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function assertReviewContentIndex(value: unknown): asserts value is ProductionReviewContentIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Review-content index is invalid.')
  const document = value as Partial<ProductionReviewContentIndex>
  if (document.schemaVersion !== 1 || document.documentType !== 'review-content-index' || document.contentVersion !== '1.0.0' || !document.aliases || typeof document.aliases !== 'object' || Array.isArray(document.aliases) || Object.keys(document.aliases).length < 1476) throw new TypeError('Review-content index is invalid.')
  let daily = 0
  let scene = 0
  for (const [aliasKey, raw] of Object.entries(document.aliases)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Review-content alias is invalid.')
    const candidate = raw as Partial<ProductionReviewContentAlias>
    if (typeof candidate.reviewContentId !== 'string' || candidate.reviewContentId.length === 0 || typeof candidate.originalQuestionType !== 'string' || candidate.originalQuestionType.length === 0 || !['vocabulary', 'listening', 'speaking'].includes(candidate.domain ?? '') || !candidate.source || typeof candidate.source !== 'object' || Array.isArray(candidate.source)) throw new TypeError('Review-content alias is invalid.')
    const typeMatchesDomain = candidate.domain === 'vocabulary'
      ? (candidate.originalQuestionType.startsWith('vocabulary-') || candidate.originalQuestionType.startsWith('scene-vocabulary-'))
      : candidate.originalQuestionType.startsWith(`${candidate.domain}-`)
    if (!candidate.reviewContentId.startsWith('review-content-v1-') || !typeMatchesDomain) throw new TypeError('Review-content alias identity is invalid.')
    const source = candidate.source as Readonly<Record<string, unknown>>
    if (source.kind === 'daily-supply' && typeof source.itemId === 'string' && aliasKey === `daily:${source.itemId}`) daily += 1
    else if (source.kind === 'scene-vocabulary-bank' && typeof source.bankId === 'string' && typeof source.contentVersion === 'string' && typeof source.questionId === 'string' && aliasKey === `scene:${source.bankId}@${source.contentVersion}:${source.questionId}` && candidate.domain === 'vocabulary') scene += 1
    else throw new TypeError('Review-content alias source is invalid.')
  }
  if (daily < 864 || scene !== 612) throw new TypeError('Review-content index coverage is invalid.')
}

export class ReviewContentSource implements ReadonlyDataSource<ProductionReviewContentIndex> {
  readonly #fetcher: typeof fetch
  constructor(fetcher: typeof fetch = platformFetch) { this.#fetcher = fetcher }
  async load(signal?: AbortSignal): Promise<ProductionReviewContentIndex> {
    const response = await this.#fetcher(reviewContentIndexUrl, { signal })
    if (!response.ok) throw new TypeError(`Review-content index returned ${response.status}.`)
    const value: unknown = await response.json()
    if (value && typeof value === 'object' && !Array.isArray(value) && (value as { schemaVersion?: unknown }).schemaVersion === 2) {
      const manifest = value as { documentType?: unknown; contentVersion?: unknown; totals?: { allAliases?: unknown }; shards?: unknown }
      if (manifest.documentType !== 'review-content-index-manifest' || manifest.contentVersion !== '1.1.0' || !Array.isArray(manifest.shards) || typeof manifest.totals?.allAliases !== 'number') throw new TypeError('Review-content manifest is invalid.')
      const parts = await Promise.all(manifest.shards.map(async (descriptor) => {
        if (!descriptor || typeof descriptor !== 'object') throw new TypeError('Review-content manifest shard is invalid.')
        const item = descriptor as { path?: unknown; shard?: unknown; aliasCount?: unknown; digest?: unknown }
        if (typeof item.path !== 'string' || typeof item.shard !== 'string' || typeof item.aliasCount !== 'number' || typeof item.digest !== 'string') throw new TypeError('Review-content manifest shard is invalid.')
        const url = REVIEW_SHARD_URLS[item.path]
        if (!url) throw new TypeError(`Review-content shard is not bundled: ${item.path}.`)
        const shardResponse = await this.#fetcher(url, { signal })
        if (!shardResponse.ok) throw new TypeError(`Review-content shard returned ${shardResponse.status}.`)
        const shard: unknown = await shardResponse.json()
        if (!shard || typeof shard !== 'object' || Array.isArray(shard)) throw new TypeError('Review-content shard is invalid.')
        const document = shard as { schemaVersion?: unknown; documentType?: unknown; contentVersion?: unknown; shard?: unknown; aliasCount?: unknown; aliases?: unknown }
        if (document.schemaVersion !== 1 || document.documentType !== 'review-content-index-shard' || document.contentVersion !== '1.1.0' || document.shard !== item.shard || document.aliasCount !== item.aliasCount || !document.aliases || typeof document.aliases !== 'object' || Array.isArray(document.aliases) || Object.keys(document.aliases).length !== item.aliasCount || shardDigest(shard) !== item.digest) throw new TypeError(`Review-content shard ${item.path} is invalid or incomplete.`)
        return document.aliases as Record<string, ProductionReviewContentAlias>
      }))
      const aliases: Record<string, ProductionReviewContentAlias> = {}
      for (const part of parts) for (const [key, alias] of Object.entries(part)) { if (aliases[key]) throw new TypeError(`Review-content alias is duplicated: ${key}.`); aliases[key] = alias }
      if (Object.keys(aliases).length !== manifest.totals.allAliases) throw new TypeError('Review-content manifest is incomplete.')
      const merged: ProductionReviewContentIndex = { schemaVersion: 1, documentType: 'review-content-index', contentVersion: '1.0.0', aliases }
      assertReviewContentIndex(merged)
      return merged
    }
    assertReviewContentIndex(value); return value
  }
}

export const reviewContentSource = new ReviewContentSource()
