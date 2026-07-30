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
