import type { ReadonlyDataSource } from '../../core/index.ts'
import {
  ListeningCatalogSupplyProvider,
  type ListeningCatalog,
  type ListeningSupplyProvider,
} from '../../features/listening/index.ts'
import {
  SpeakingCatalogSupplyProvider,
  type SpeakingCatalog,
  type SpeakingSupplyProvider,
} from '../../features/speaking/index.ts'
import {
  VocabularyCatalogSupplyProvider,
  type VocabularyCatalog,
  type VocabularySupplyProvider,
} from '../../features/vocabulary/index.ts'
import type {
  LearningTaskSupplyRequest,
  LearningTaskSupplyResult,
} from '../../learning-engine/index.ts'

interface TrainingSupplyCatalog {
  readonly trainingSupplyIndex?: unknown
}

interface TrainingSupplyProvider {
  next(
    request: LearningTaskSupplyRequest,
  ): Promise<LearningTaskSupplyResult>
}

/**
 * Loads and validates the released supply index through the same offline-first
 * package source as the owning feature. A failed load is deliberately not
 * cached, so an explicit retry can recover after the network or local asset
 * becomes available again.
 */
class LazyCatalogSupplyProvider<
  Catalog extends TrainingSupplyCatalog,
  Provider extends TrainingSupplyProvider,
> implements TrainingSupplyProvider {
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
    request: LearningTaskSupplyRequest,
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
  readonly vocabulary: VocabularySupplyProvider
  readonly listening: ListeningSupplyProvider
  readonly speaking: SpeakingSupplyProvider
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
