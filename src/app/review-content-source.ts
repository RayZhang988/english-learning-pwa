import type { ReadonlyDataSource } from '../core/index.ts'
import { platformFetch } from '../platform/index.ts'
export interface ProductionReviewContentAlias { readonly reviewContentId: string; readonly originalQuestionType: string; readonly domain: 'vocabulary' | 'listening' | 'speaking'; readonly source: Readonly<Record<string, string>> }
export interface ProductionReviewContentIndex { readonly schemaVersion: 1; readonly documentType: 'review-content-index'; readonly contentVersion: '1.0.0'; readonly aliases: Readonly<Record<string, ProductionReviewContentAlias>> }

export const REVIEW_CONTENT_INDEX_PATH = 'content/curriculum/review-content-index.v1.json'
export const reviewContentIndexUrl = new URL('../../content/curriculum/review-content-index.v1.json', import.meta.url).href

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
    const value: unknown = await response.json(); assertReviewContentIndex(value); return value
  }
}

export const reviewContentSource = new ReviewContentSource()
