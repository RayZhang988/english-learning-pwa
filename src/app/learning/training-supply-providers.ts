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
} from '../../learning-engine/index.ts'

interface TrainingSupplyCatalog {
  readonly trainingSupplyIndex?: unknown
}

export interface ProductionTrainingSupplyProvider {
  next(
    request:
      | LearningTaskSupplyRequest
      | ExtraTrainingSupplyRequest,
  ): Promise<LearningTaskSupplyResult>
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
  const maximumItems = 1_000
  while (itemIds.length < maximumItems) {
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
    itemIds.push(result.item.itemId)
  }
  throw new TypeError('Supply provider exceeded the bounded round enumeration.')
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

  #provider(): Promise<Provider> {
    if (!this.#providerPromise) {
      this.#providerPromise = this.#source.load().then((catalog) => {
        if (catalog.trainingSupplyIndex === undefined) {
          throw new TypeError(
            'Released content package does not contain a training supply index.',
          )
        }
        return this.#createProvider(
          catalog.trainingSupplyIndex,
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
