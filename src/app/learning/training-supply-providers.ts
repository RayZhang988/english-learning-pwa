import type { ReadonlyDataSource } from '../../core/index.ts'
import {
  ListeningCatalogSupplyProvider,
  type ListeningCatalog,
} from '../../features/listening/index.ts'
import {
  SpeakingCatalogSupplyProvider,
  type SpeakingCatalog,
} from '../../features/speaking/index.ts'
import {
  VocabularyCatalogSupplyProvider,
  type VocabularyCatalog,
} from '../../features/vocabulary/index.ts'
import type {
  ExtraTrainingSupplyRequest,
  LearningTaskSupplyRequest,
  LearningTaskSupplyResult,
  TrainingSupplyCandidateIdentity,
  TrainingSupplyPriorityItem,
} from '../../learning-engine/index.ts'

interface TrainingSupplyCatalog {
  readonly trainingSupplyIndex?: unknown
}

export interface ProductionTrainingSupplyProvider {
  maximumCandidateCount?(): Promise<number>
  eligibleCandidateIdentities?(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): Promise<unknown>
  eligibleItemIds?(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): Promise<{
    readonly schemaVersion: 1
    readonly requestId: string
    readonly status: 'eligible-items' | 'invalid-request'
    readonly itemIds?: readonly string[]
  } | null>
  next(
    request:
      | LearningTaskSupplyRequest
      | ExtraTrainingSupplyRequest,
  ): Promise<LearningTaskSupplyResult>
}

export interface EligibleSupplyCandidates {
  readonly candidates: readonly TrainingSupplyCandidateIdentity[]
  readonly priorityItems: readonly TrainingSupplyPriorityItem[]
}

const FORMAL_PRIORITY_REASONS = new Set([
  'recent-error',
  'due-review',
  'same-day-variant',
  'new-optional-content',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function declaredPriorityItems(
  request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  candidateIds: ReadonlySet<string>,
): readonly TrainingSupplyPriorityItem[] {
  if (!('priority' in request)) return []
  const seen = new Set<string>()
  const result: TrainingSupplyPriorityItem[] = []
  for (const reason of request.priority) {
    if (!FORMAL_PRIORITY_REASONS.has(reason)) {
      throw new TypeError('Extra-training request contains an invalid priority reason.')
    }
    for (const itemId of request.priorityItemIds[reason]) {
      if (candidateIds.has(itemId) && !seen.has(itemId)) {
        seen.add(itemId)
        result.push({ itemId, reason })
      }
    }
  }
  return result
}

/**
 * Normalizes each owning module's released batch shape without inspecting
 * course content. A malformed or failed semantic batch is never downgraded to
 * the legacy item-id enumerator because that would silently disable R15.
 */
export async function collectEligibleSupplyCandidates(
  provider: ProductionTrainingSupplyProvider,
  request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
): Promise<EligibleSupplyCandidates> {
  if (typeof provider.eligibleCandidateIdentities !== 'function') {
    throw new TypeError('Supply provider does not expose semantic candidate identities.')
  }
  const maximumItems = provider.maximumCandidateCount
    ? await provider.maximumCandidateCount()
    : 1_000
  if (!Number.isSafeInteger(maximumItems) || maximumItems < 0) {
    throw new TypeError('Supply provider returned an invalid candidate enumeration bound.')
  }
  const raw = await provider.eligibleCandidateIdentities(request)
  let candidatesValue: unknown
  let prioritiesValue: unknown = undefined
  if (isRecord(raw)) {
    if ((raw.schemaVersion !== 1 && raw.schemaVersion !== 2) ||
      raw.requestId !== request.requestId || raw.status !== 'eligible-candidates') {
      throw new TypeError('Supply provider returned an invalid semantic eligibility result.')
    }
    candidatesValue = raw.candidates
    prioritiesValue = raw.priorityItems
  } else {
    throw new TypeError('Supply provider returned an invalid semantic eligibility result.')
  }
  if (!Array.isArray(candidatesValue) || candidatesValue.length > maximumItems) {
    throw new TypeError('Supply provider exceeded the released semantic candidate index.')
  }
  const candidateIds = new Set<string>()
  const candidates = candidatesValue.map((value) => {
    if (!isRecord(value) ||
      typeof value.itemId !== 'string' || value.itemId.trim().length === 0 ||
      typeof value.knowledgePointId !== 'string' || value.knowledgePointId.trim().length === 0 ||
      typeof value.semanticCategoryId !== 'string' || value.semanticCategoryId.trim().length === 0 ||
      candidateIds.has(value.itemId)) {
      throw new TypeError('Supply provider returned an invalid semantic candidate identity.')
    }
    candidateIds.add(value.itemId)
    return {
      itemId: value.itemId,
      knowledgePointId: value.knowledgePointId,
      semanticCategoryId: value.semanticCategoryId,
    }
  })
  const priorityItems = prioritiesValue === undefined
    ? declaredPriorityItems(request, candidateIds)
    : (() => {
        if (!Array.isArray(prioritiesValue)) {
          throw new TypeError('Supply provider returned invalid semantic priority items.')
        }
        const seen = new Set<string>()
        return prioritiesValue.map((value) => {
          if (!isRecord(value) || typeof value.itemId !== 'string' ||
            typeof value.reason !== 'string' || !FORMAL_PRIORITY_REASONS.has(value.reason) ||
            !candidateIds.has(value.itemId) || seen.has(value.itemId)) {
            throw new TypeError('Supply provider returned an invalid semantic priority item.')
          }
          seen.add(value.itemId)
          return { itemId: value.itemId, reason: value.reason }
        })
      })()
  return { candidates, priorityItems }
}

/**
 * Builds a round from the owning module's own eligibility semantics. 01 sees
 * only stable item identities: it never parses lesson answers or duplicates
 * module-specific difficulty rules.
 */
export async function collectEligibleSupplyItemIds(
  provider: ProductionTrainingSupplyProvider,
  request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
): Promise<readonly string[]> {
  const itemIds: string[] = []
  const maximumItems = provider.maximumCandidateCount
    ? await provider.maximumCandidateCount()
    : 1_000
  if (!Number.isSafeInteger(maximumItems) || maximumItems < 0) {
    throw new TypeError(
      'Supply provider returned an invalid candidate enumeration bound.',
    )
  }
  if (provider.eligibleItemIds) {
    const result = await provider.eligibleItemIds(request)
    if (result !== null && (
      result.schemaVersion !== 1 ||
      result.requestId !== request.requestId ||
      result.status !== 'eligible-items' ||
      !Array.isArray(result.itemIds)
    )) {
      throw new TypeError('Supply provider returned an invalid eligible item result.')
    }
    if (result !== null) {
      const eligibleItemIds = result.itemIds as readonly unknown[]
      if (eligibleItemIds.length > maximumItems) {
        throw new TypeError('Supply provider exceeded the released candidate index.')
      }
      const identities = new Set<string>()
      for (const itemId of eligibleItemIds) {
        if (typeof itemId !== 'string' || itemId.length === 0) {
          throw new TypeError('Supply provider returned an invalid eligible item identity.')
        }
        if (identities.has(itemId)) {
          throw new TypeError('Supply provider repeated an eligible item identity.')
        }
        identities.add(itemId)
      }
      return [...identities]
    }
  }
  while (itemIds.length <= maximumItems) {
    const result = await provider.next({
      ...request,
      requestId: `${request.requestId}:round:${itemIds.length + 1}`,
      cursor: null,
      excludeItemIds: itemIds,
    })
    if (result.status === 'content-exhausted') {
      return itemIds
    }
    if (itemIds.includes(result.item.itemId)) {
      throw new TypeError('Supply provider repeated a supposedly excluded item.')
    }
    if (itemIds.length === maximumItems) {
      throw new TypeError('Supply provider exceeded the released candidate index.')
    }
    itemIds.push(result.item.itemId)
  }
  throw new TypeError('Supply provider exceeded the released candidate index.')
}

/**
 * Loads and validates the released supply index through the same offline-first
 * package source as the owning feature. A failed load is deliberately not
 * cached, so an explicit retry can recover after the network or local asset
 * becomes available again.
 */
class LazyCatalogSupplyProvider<
  Catalog extends TrainingSupplyCatalog,
  Provider extends ProductionTrainingSupplyProvider,
> implements ProductionTrainingSupplyProvider {
  readonly #source: ReadonlyDataSource<Catalog>
  readonly #createProvider: (
    index: unknown,
    catalog: Catalog,
  ) => Provider
  #providerPromise: Promise<Provider> | null = null
  #maximumCandidateCount: number | null = null

  constructor(
    source: ReadonlyDataSource<Catalog>,
    createProvider: (
      index: unknown,
      catalog: Catalog,
    ) => Provider,
  ) {
    this.#source = source
    this.#createProvider = createProvider
  }

  async next(
    request:
      | LearningTaskSupplyRequest
      | ExtraTrainingSupplyRequest,
  ): Promise<LearningTaskSupplyResult> {
    try {
      const provider = await this.#provider()
      return await provider.next(request)
    } catch {
      this.#providerPromise = null
      return {
        schemaVersion: 1,
        requestId: request.requestId,
        status: 'content-exhausted',
        reason: 'provider-failure',
      }
    }
  }

  async maximumCandidateCount(): Promise<number> {
    await this.#provider()
    if (this.#maximumCandidateCount === null) {
      throw new TypeError(
        'Released content package candidate count is unavailable.',
      )
    }
    return this.#maximumCandidateCount
  }

  async eligibleItemIds(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): Promise<{
    readonly schemaVersion: 1
    readonly requestId: string
    readonly status: 'eligible-items' | 'invalid-request'
    readonly itemIds?: readonly string[]
  } | null> {
    const provider = await this.#provider()
    if (!('eligibleItemIds' in provider) || typeof provider.eligibleItemIds !== 'function') {
      return null
    }
    return provider.eligibleItemIds(request)
  }

  async eligibleCandidateIdentities(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): Promise<unknown> {
    const provider = await this.#provider()
    if (!('eligibleCandidateIdentities' in provider) ||
      typeof provider.eligibleCandidateIdentities !== 'function') {
      throw new TypeError('Released supply provider has no semantic candidate interface.')
    }
    return provider.eligibleCandidateIdentities(request)
  }

  #provider(): Promise<Provider> {
    if (!this.#providerPromise) {
      this.#providerPromise = this.#source.load().then((catalog) => {
        if (catalog.trainingSupplyIndex === undefined) {
          throw new TypeError(
            'Released content package does not contain a training supply index.',
          )
        }
        const index = catalog.trainingSupplyIndex
        if (
          typeof index !== 'object' ||
          index === null ||
          !('candidates' in index) ||
          !Array.isArray(index.candidates)
        ) {
          throw new TypeError(
            'Released content package has an invalid training supply index.',
          )
        }
        this.#maximumCandidateCount = index.candidates.length
        return this.#createProvider(
          index,
          catalog,
        )
      })
    }
    return this.#providerPromise
  }
}

export interface ProductionTrainingSupplyProviders {
  readonly vocabulary: ProductionTrainingSupplyProvider
  readonly listening: ProductionTrainingSupplyProvider
  readonly speaking: ProductionTrainingSupplyProvider
}

export function createProductionTrainingSupplyProviders(sources: {
  readonly vocabulary: ReadonlyDataSource<VocabularyCatalog>
  readonly listening: ReadonlyDataSource<ListeningCatalog>
  readonly speaking: ReadonlyDataSource<SpeakingCatalog>
}): ProductionTrainingSupplyProviders {
  return {
    vocabulary: new LazyCatalogSupplyProvider(
      sources.vocabulary,
      (index, catalog) =>
        new VocabularyCatalogSupplyProvider(index, catalog),
    ),
    listening: new LazyCatalogSupplyProvider(
      sources.listening,
      (index, catalog) =>
        new ListeningCatalogSupplyProvider(index, catalog),
    ),
    speaking: new LazyCatalogSupplyProvider(
      sources.speaking,
      (index, catalog) =>
        new SpeakingCatalogSupplyProvider(index, catalog),
    ),
  }
}
