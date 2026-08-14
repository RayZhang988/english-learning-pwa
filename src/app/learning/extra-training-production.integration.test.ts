import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  CurrentListeningContentSource,
  resolveListeningSupplyQuestion,
  type ListeningSupplyItem,
} from '../../features/listening/index.ts'
import {
  CurrentSpeakingContentSource,
  resolveSpeakingSupplyPrompt,
  type SpeakingSupplyItem,
} from '../../features/speaking/index.ts'
import {
  CurrentVocabularyContentSource,
  type VocabularySupplyItem,
} from '../../features/vocabulary/index.ts'
import type {
  ExtraTrainingSupplyRequest,
  TrainingModuleId,
} from '../../learning-engine/index.ts'
import type {
  OfflineAssetStore,
  OfflinePackageRecord,
} from '../../pwa/index.ts'
import {
  collectEligibleSupplyCandidates,
  createProductionTrainingSupplyProviders,
} from './training-supply-providers.ts'

const noCache: OfflineAssetStore = {
  async install(): Promise<OfflinePackageRecord> {
    throw new TypeError('install is not used by this production-read test')
  },
  async getPackage() {
    return undefined
  },
  async getAsset() {
    return undefined
  },
  async remove() {},
}

const fileFetcher = (async (input: URL | RequestInfo) => {
  const value =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input
  const url = new URL(value)
  if (url.protocol !== 'file:') {
    return new Response(null, { status: 404 })
  }
  return new Response(await readFile(url, 'utf8'), { status: 200 })
}) as typeof fetch

function request(
  moduleId: TrainingModuleId,
): ExtraTrainingSupplyRequest {
  return {
    schemaVersion: 1,
    requestId: `extra:${moduleId}:released:1`,
    sessionId: `extra:${moduleId}:released`,
    localDate: '2026-07-29',
    domain: moduleId,
    targetModuleId: moduleId,
    mode: 'learn',
    targetDifficulty: 1,
    cursor: null,
    excludeItemIds: [],
    priority: [
      'recent-error',
      'due-review',
      'same-day-variant',
      'new-optional-content',
    ],
    priorityItemIds: {
      'recent-error': [],
      'due-review': [],
      'same-day-variant': [],
      'new-optional-content': [],
    },
    reason: 'initial',
  }
}

describe('R6 released production supply integration', () => {
  it('resolves a real released item for each optional production route', async () => {
    const vocabulary =
      new CurrentVocabularyContentSource(noCache, fileFetcher)
    const listening =
      new CurrentListeningContentSource(noCache, fileFetcher)
    const speaking =
      new CurrentSpeakingContentSource(noCache, fileFetcher)
    const providers = createProductionTrainingSupplyProviders({
      vocabulary,
      listening,
      speaking,
    })

    const [
      vocabularyResult,
      listeningResult,
      speakingResult,
    ] = await Promise.all([
      providers.vocabulary.next(request('vocabulary')),
      providers.listening.next(request('listening')),
      providers.speaking.next(request('speaking')),
    ])

    expect(vocabularyResult.status).toBe('item')
    expect(listeningResult.status).toBe('item')
    expect(speakingResult.status).toBe('item')
    if (
      vocabularyResult.status !== 'item' ||
      listeningResult.status !== 'item' ||
      speakingResult.status !== 'item'
    ) {
      throw new TypeError(
        'Released optional-training supply unexpectedly exhausted.',
      )
    }

    const vocabularyCatalog = await vocabulary.load()
    const vocabularyItem =
      vocabularyResult.item as VocabularySupplyItem
    expect(
      vocabularyCatalog.getItem(vocabularyItem.source.sourceId),
    ).toBeDefined()
    expect(
      vocabularyItem.source.distractorItemIds.every(
        (itemId) => vocabularyCatalog.getItem(itemId) !== undefined,
      ),
    ).toBe(true)

    const listeningCatalog = await listening.load()
    expect(
      resolveListeningSupplyQuestion(
        listeningCatalog,
        listeningResult.item as ListeningSupplyItem,
      ).question,
    ).toBeDefined()

    const speakingCatalog = await speaking.load()
    expect(
      resolveSpeakingSupplyPrompt(
        speakingCatalog,
        speakingResult.item as SpeakingSupplyItem,
      ).prompt,
    ).toBeDefined()
  })

  it('publishes bounded semantic candidate batches for all three production domains', async () => {
    const providers = createProductionTrainingSupplyProviders({
      vocabulary: new CurrentVocabularyContentSource(noCache, fileFetcher),
      listening: new CurrentListeningContentSource(noCache, fileFetcher),
      speaking: new CurrentSpeakingContentSource(noCache, fileFetcher),
    })

    for (const moduleId of ['vocabulary', 'listening', 'speaking'] as const) {
      const baseRequest = request(moduleId)
      const result = await collectEligibleSupplyCandidates(
        providers[moduleId],
        baseRequest,
      )
      expect(result.candidates.length).toBeGreaterThan(0)
      expect(new Set(result.candidates.map((item) => item.itemId)).size)
        .toBe(result.candidates.length)
      expect(result.candidates.every((item) =>
        item.knowledgePointId.length > 0 && item.semanticCategoryId.length > 0,
      )).toBe(true)

      const priorityItemId = result.candidates[0]!.itemId
      const prioritized = await collectEligibleSupplyCandidates(
        providers[moduleId],
        {
          ...baseRequest,
          requestId: `${baseRequest.requestId}:priority`,
          priorityItemIds: {
            ...baseRequest.priorityItemIds,
            'recent-error': [priorityItemId],
          },
        },
      )
      expect(prioritized.priorityItems).toContainEqual({
        itemId: priorityItemId,
        reason: 'recent-error',
      })
    }
  })
})
