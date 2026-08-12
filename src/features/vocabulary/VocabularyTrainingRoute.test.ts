import { describe, expect, it } from 'vitest'
import { InMemoryPlatformEventSink, createStaticDataSource } from '../../core/testing/index.ts'
import { createTrainingSupplyRound } from '../../learning-engine/index.ts'
import type { NamespaceStore, StoredRecord } from '../../storage/index.ts'
import { createVocabularyCatalog } from './content.ts'
import { VocabularySessionRepository } from './repository.ts'
import {
  createVocabularyTrainingRouteRuntime,
  sameVocabularySupplyRound,
} from './VocabularyTrainingRoute.tsx'
import { loadActualVocabularyDocuments, vocabularyTaskFor } from './test-fixtures.ts'
import type { ReviewContentIndex, WrongAnswerEvidenceSink } from './wrong-answer-review.ts'
import type { VocabularySupplyProvider } from './supply.ts'

class MemoryStore implements NamespaceStore {
  private readonly records = new Map<string, StoredRecord<unknown>>()
  async get<T>(key: string): Promise<StoredRecord<T> | undefined> { return this.records.get(key) as StoredRecord<T> | undefined }
  async put<T>(key: string, value: T, schemaVersion = 1): Promise<void> { this.records.set(key, { namespace: 'feature.vocabulary', key, value, schemaVersion, updatedAt: '2026-07-28T00:00:00.000Z' }) }
  async delete(key: string): Promise<void> { this.records.delete(key) }
  async keys(): Promise<readonly string[]> { return [...this.records.keys()] }
  async clear(): Promise<void> { this.records.clear() }
}

describe('VocabularyTrainingRoute QA-011 ports', () => {
  it('keeps runtime identity for a cloned persisted supply round', () => {
    const round = createTrainingSupplyRound({
      seed: 'same-round',
      candidateItemIds: ['vocabulary-a', 'vocabulary-b'],
      shortTermExcludedItemIds: [],
    })

    expect(
      sameVocabularySupplyRound(round, { ...round, order: [...round.order] }),
    ).toBe(true)
    expect(sameVocabularySupplyRound(round, { ...round, seed: 'new-round' })).toBe(false)
  })

  it('forwards budget ports into a continuous stream and leaves old calls unchanged', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const source = createStaticDataSource(catalog)
    const common = { localDate: '2026-07-28', eventSink: new InMemoryPlatformEventSink(), contentSource: source, onExit: () => undefined }
    const budgetTask = vocabularyTaskFor(catalog.units[0], { trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } })
    const continuous = createVocabularyTrainingRouteRuntime({ ...common, task: budgetTask, repository: new VocabularySessionRepository(new MemoryStore()), trainingBudgetStatus: () => 'running' })
    expect((await continuous.initialize()).stream).not.toBeNull()

    const legacy = createVocabularyTrainingRouteRuntime({ ...common, task: vocabularyTaskFor(catalog.units[0]), repository: new VocabularySessionRepository(new MemoryStore()) })
    expect((await legacy.initialize()).stream).toBeNull()
  })
  it('forwards the exact optional R13-D review port and keeps omission compatible', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments()); const common = { localDate: '2026-08-03', eventSink: new InMemoryPlatformEventSink(), contentSource: createStaticDataSource(catalog), onExit: () => undefined, task: vocabularyTaskFor(catalog.units[0]) }
    const review = { index: { schemaVersion: 1, documentType: 'review-content-index', contentVersion: '1.0.0', aliases: {} } as ReviewContentIndex, sink: { publish: async () => undefined } as WrongAnswerEvidenceSink, source: 'daily-training' as const }
    const withPort = createVocabularyTrainingRouteRuntime({ ...common, wrongAnswerReview: review }) as unknown as { wrongAnswerReview: unknown }
    const withoutPort = createVocabularyTrainingRouteRuntime(common) as unknown as { wrongAnswerReview: unknown }
    expect(withPort.wrongAnswerReview).toBe(review); expect(withoutPort.wrongAnswerReview).toBeUndefined()
  })

  it('forwards a supplied randomized round so its first item and refresh stay in that order', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const candidates = (catalog.trainingSupplyIndex as {
      readonly candidates: readonly { readonly itemId: string; readonly domain: string }[]
    }).candidates.filter((candidate) => candidate.domain === 'vocabulary')
    const round = createTrainingSupplyRound({
      seed: 'vocabulary-route-round',
      candidateItemIds: candidates.map((candidate) => candidate.itemId),
      shortTermExcludedItemIds: [],
    })
    const supplyProvider: VocabularySupplyProvider = {
      async next(request) {
        const itemId = request.supplyRound?.order[request.supplyRound.cursor]
        const item = candidates.find((candidate) => candidate.itemId === itemId)
        if (!item) {
          throw new Error('Route must forward the supplied round before requesting an item.')
        }
        return {
          schemaVersion: 1,
          requestId: request.requestId,
          status: 'item',
          item: item as never,
          nextCursor: item.itemId,
        }
      },
    }
    const store = new MemoryStore()
    const props = {
      task: vocabularyTaskFor(catalog.units[0], {
        trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 },
      }),
      localDate: '2026-08-11',
      eventSink: new InMemoryPlatformEventSink(),
      contentSource: createStaticDataSource(catalog),
      repository: new VocabularySessionRepository(store),
      supplyProvider,
      supplyRound: round,
      trainingBudgetStatus: () => 'running' as const,
      onExit: () => undefined,
    }

    const first = await createVocabularyTrainingRouteRuntime(props).initialize()
    expect(first.stream?.activeItem.itemId).toBe(round.order[0])
    expect(first.stream?.supplyRound).toMatchObject({
      order: round.order,
      cursor: 1,
    })

    const refreshed = await createVocabularyTrainingRouteRuntime(props).initialize()
    expect(refreshed.stream?.activeItem.itemId).toBe(round.order[0])
    expect(refreshed.stream?.supplyRound).toEqual(first.stream?.supplyRound)
  })
})
