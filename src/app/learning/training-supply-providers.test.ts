import { describe, expect, it } from 'vitest'
import type {
  ListeningCatalog,
} from '../../features/listening/index.ts'
import type {
  SpeakingCatalog,
} from '../../features/speaking/index.ts'
import type {
  VocabularyCatalog,
} from '../../features/vocabulary/index.ts'
import type {
  LearningTaskSupplyRequest,
} from '../../learning-engine/index.ts'
import {
  collectEligibleSupplyCandidates,
  collectEligibleSupplyItemIds,
  createProductionTrainingSupplyProviders,
} from './training-supply-providers.ts'

const request = (
  domain: 'vocabulary' | 'listening' | 'speaking',
): LearningTaskSupplyRequest => ({
  schemaVersion: 1,
  requestId: `task:${domain}:supply:1:initial`,
  planId: 'plan-1',
  taskId: `task:${domain}`,
  domain,
  targetModuleId: domain,
  mode: 'learn',
  targetDifficulty: 1,
  cursor: null,
  excludeItemIds: [],
  reason: 'initial',
})

const emptyIndex = {
  schemaVersion: 1,
  candidates: [],
}

function vocabularyCatalog(
  trainingSupplyIndex: unknown,
): VocabularyCatalog {
  return {
    schemaVersion: 1,
    packageVersion: '1.0.0',
    courseId: 'course',
    units: [],
    trainingSupplyIndex,
    getUnit: () => undefined,
    getItem: () => undefined,
  }
}

function listeningCatalog(
  trainingSupplyIndex: unknown,
): ListeningCatalog {
  return {
    schemaVersion: 1,
    packageVersion: '1.0.0',
    extensionVersion: '1.1.0',
    courseId: 'course',
    units: [],
    trainingSupplyIndex,
    getUnit: () => undefined,
  }
}

function speakingCatalog(
  trainingSupplyIndex: unknown,
): SpeakingCatalog {
  return {
    schemaVersion: 1,
    packageVersion: '1.0.0',
    courseId: 'survival-travel-american-4w',
    units: [],
    trainingSupplyIndex,
    getUnit: () => undefined,
  }
}

describe('production training supply providers', () => {
  it('normalizes semantic candidates and only maps declared extra-training priorities', async () => {
    const extraRequest = {
      ...request('vocabulary'),
      sessionId: 'extra-1',
      localDate: '2026-08-14',
      priority: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'] as const,
      priorityItemIds: {
        'recent-error': ['one'],
        'due-review': ['missing'],
        'same-day-variant': [],
        'new-optional-content': ['two'],
      },
    }
    const provider = {
      async maximumCandidateCount() { return 2 },
      async eligibleCandidateIdentities(value: typeof extraRequest) {
        return {
          schemaVersion: 2 as const,
          requestId: value.requestId,
          status: 'eligible-candidates' as const,
          candidates: [
            { itemId: 'one', knowledgePointId: 'knowledge-one', semanticCategoryId: 'semantic-one' },
            { itemId: 'two', knowledgePointId: 'knowledge-two', semanticCategoryId: 'semantic-two' },
          ],
        }
      },
      async next() { throw new Error('semantic batch result must be used') },
    }

    await expect(collectEligibleSupplyCandidates(provider, extraRequest)).resolves.toEqual({
      candidates: [
        { itemId: 'one', knowledgePointId: 'knowledge-one', semanticCategoryId: 'semantic-one' },
        { itemId: 'two', knowledgePointId: 'knowledge-two', semanticCategoryId: 'semantic-two' },
      ],
      priorityItems: [
        { itemId: 'one', reason: 'recent-error' },
        { itemId: 'two', reason: 'new-optional-content' },
      ],
    })
  })

  it('preserves a module-resolved priority override instead of guessing its source identity', async () => {
    const provider = {
      async maximumCandidateCount() { return 1 },
      async eligibleCandidateIdentities(value: LearningTaskSupplyRequest) {
        return {
          schemaVersion: 1 as const,
          requestId: value.requestId,
          status: 'eligible-candidates' as const,
          candidates: [{ itemId: 'variant', knowledgePointId: 'knowledge-variant', semanticCategoryId: 'semantic-variant' }],
          priorityItems: [{ itemId: 'variant', reason: 'same-day-variant' }],
        }
      },
      async next() { throw new Error('semantic batch result must be used') },
    }

    await expect(collectEligibleSupplyCandidates(provider, request('listening'))).resolves.toEqual({
      candidates: [{ itemId: 'variant', knowledgePointId: 'knowledge-variant', semanticCategoryId: 'semantic-variant' }],
      priorityItems: [{ itemId: 'variant', reason: 'same-day-variant' }],
    })
  })

  it.each([
    { name: 'wrong request id', result: { schemaVersion: 2, requestId: 'wrong', status: 'eligible-candidates', candidates: [] } },
    { name: 'provider failure status', result: { schemaVersion: 1, requestId: request('vocabulary').requestId, status: 'content-exhausted', reason: 'provider-failure' } },
    { name: 'duplicate identity', result: { schemaVersion: 2, requestId: request('vocabulary').requestId, status: 'eligible-candidates', candidates: [{ itemId: 'one', knowledgePointId: 'k1', semanticCategoryId: 's1' }, { itemId: 'one', knowledgePointId: 'k2', semanticCategoryId: 's2' }] } },
    { name: 'invalid priority reason', result: { schemaVersion: 1, requestId: request('vocabulary').requestId, status: 'eligible-candidates', candidates: [{ itemId: 'one', knowledgePointId: 'k1', semanticCategoryId: 's1' }], priorityItems: [{ itemId: 'one', reason: 'invented' }] } },
    { name: 'priority outside candidates', result: { schemaVersion: 1, requestId: request('vocabulary').requestId, status: 'eligible-candidates', candidates: [{ itemId: 'one', knowledgePointId: 'k1', semanticCategoryId: 's1' }], priorityItems: [{ itemId: 'missing', reason: 'recent-error' }] } },
  ])('rejects semantic eligibility with $name', async ({ result }) => {
    const provider = {
      async maximumCandidateCount() { return 2 },
      async eligibleCandidateIdentities() { return result },
      async next() { throw new Error('must not fall back') },
    }
    await expect(collectEligibleSupplyCandidates(provider, request('vocabulary'))).rejects.toThrow(TypeError)
  })

  it('collects only the stable eligible identities exposed by a provider', async () => {
    const seen: string[][] = []
    const provider = { async next(value: LearningTaskSupplyRequest) {
      seen.push([...value.excludeItemIds])
      const itemId = ['one', 'two'].find((id) => !value.excludeItemIds.includes(id))
      return itemId === undefined
        ? { schemaVersion: 1 as const, requestId: value.requestId, status: 'content-exhausted' as const, reason: 'all-eligible-content-recently-used' as const }
        : { schemaVersion: 1 as const, requestId: value.requestId, status: 'item' as const, item: { itemId, learningUnitId: itemId, contentRef: itemId, difficultyLevel: 1, tags: [] }, nextCursor: itemId }
    } }
    await expect(collectEligibleSupplyItemIds(provider, request('vocabulary'))).resolves.toEqual(['one', 'two'])
    expect(seen).toEqual([[], ['one'], ['one', 'two']])
  })

  it('enumerates every eligible identity when the released index contains more than 1,000 candidates', async () => {
    const releasedItemIds = Array.from(
      { length: 1_205 },
      (_, index) => `released-vocabulary-${index + 1}`,
    )
    const provider = {
      async maximumCandidateCount() {
        return releasedItemIds.length
      },
      async eligibleItemIds(value: LearningTaskSupplyRequest) {
        return { schemaVersion: 1 as const, requestId: value.requestId, status: 'eligible-items' as const, itemIds: releasedItemIds }
      },
      async next() {
        throw new Error('The O(n²) next() fallback must not run when batch eligibility is available.')
      },
    }

    await expect(
      collectEligibleSupplyItemIds(provider, request('vocabulary')),
    ).resolves.toEqual(releasedItemIds)
  })

  it.each([
    { name: 'invalid status', maximum: 2, result: { schemaVersion: 1 as const, requestId: request('vocabulary').requestId, status: 'invalid-request' as const } },
    { name: 'an empty identity', maximum: 1, result: { schemaVersion: 1 as const, requestId: request('vocabulary').requestId, status: 'eligible-items' as const, itemIds: [''] } },
    { name: 'duplicate identities', maximum: 2, result: { schemaVersion: 1 as const, requestId: request('vocabulary').requestId, status: 'eligible-items' as const, itemIds: ['one', 'one'] } },
    { name: 'more identities than the released index', maximum: 1, result: { schemaVersion: 1 as const, requestId: request('vocabulary').requestId, status: 'eligible-items' as const, itemIds: ['one', 'two'] } },
  ])('rejects a batch eligibility result with $name', async ({ maximum, result }) => {
    const provider = {
      async maximumCandidateCount() { return maximum },
      async eligibleItemIds() { return result },
      async next() { throw new Error('Fallback must not run for an invalid batch result.') },
    }
    await expect(
      collectEligibleSupplyItemIds(provider, request('vocabulary')),
    ).rejects.toThrow(TypeError)
  })
  it('loads and parses each released package supply index lazily once', async () => {
    const loads = {
      vocabulary: 0,
      listening: 0,
      speaking: 0,
    }
    const providers = createProductionTrainingSupplyProviders({
      vocabulary: {
        async load() {
          loads.vocabulary += 1
          return vocabularyCatalog(emptyIndex)
        },
      },
      listening: {
        async load() {
          loads.listening += 1
          return listeningCatalog(emptyIndex)
        },
      },
      speaking: {
        async load() {
          loads.speaking += 1
          return speakingCatalog(emptyIndex)
        },
      },
    })

    for (const domain of [
      'vocabulary',
      'listening',
      'speaking',
    ] as const) {
      await expect(
        providers[domain].next(request(domain)),
      ).resolves.toMatchObject({
        requestId: request(domain).requestId,
        status: 'content-exhausted',
        reason: 'no-eligible-content',
      })
      await providers[domain].next(request(domain))
    }

    expect(loads).toEqual({
      vocabulary: 1,
      listening: 1,
      speaking: 1,
    })
  })

  it('does not cache a failed package load and preserves the request id on retry', async () => {
    let loads = 0
    const providers = createProductionTrainingSupplyProviders({
      vocabulary: {
        async load() {
          loads += 1
          return vocabularyCatalog(
            loads === 1 ? undefined : emptyIndex,
          )
        },
      },
      listening: {
        async load() {
          return listeningCatalog(emptyIndex)
        },
      },
      speaking: {
        async load() {
          return speakingCatalog(emptyIndex)
        },
      },
    })
    const supplyRequest = request('vocabulary')

    await expect(
      providers.vocabulary.next(supplyRequest),
    ).resolves.toEqual({
      schemaVersion: 1,
      requestId: supplyRequest.requestId,
      status: 'content-exhausted',
      reason: 'provider-failure',
    })
    await expect(
      providers.vocabulary.next(supplyRequest),
    ).resolves.toMatchObject({
      requestId: supplyRequest.requestId,
      status: 'content-exhausted',
      reason: 'no-eligible-content',
    })
    expect(loads).toBe(2)
  })
})
