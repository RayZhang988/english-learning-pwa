import { describe, expect, it } from 'vitest'
import packageIndex from '../../../content/curriculum/package-index.v1.json'
import manifest from '../../../content/curriculum/survival-travel-american-4w.v1.json'
import trainingSupplyIndex from '../../../content/curriculum/training-supply-index.v1/speaking.json'
import week1 from '../../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import { createSpeakingCatalog } from './content.ts'
import { SpeakingCatalogSupplyProvider, resolveSpeakingSupplyPrompt } from './supply.ts'
import {
  createTrainingSupplyRound,
  recordTrainingSupplyItem,
} from '../../learning-engine/index.ts'
import type { SpeakingContentDocuments, SpeakingSupplyItem } from './types.ts'
import type {
  ExtraTrainingSupplyRequest,
  LearningTaskSupplyRequest,
} from '../../learning-engine/index.ts'

function catalog() {
  const lessonPaths = packageIndex.lessonFiles
  const documents: SpeakingContentDocuments = {
    packageIndex,
    manifest,
    trainingSupplyIndex,
    lessonsByPath: {
      [lessonPaths[0]]: week1,
      [lessonPaths[1]]: week2,
      [lessonPaths[2]]: week3,
      [lessonPaths[3]]: week4,
    },
  }
  return createSpeakingCatalog(documents)
}

function request(cursor: string | null = null, excludeItemIds: readonly string[] = []) {
  return {
    schemaVersion: 1 as const,
    requestId: `supply-test:${cursor ?? 'initial'}`,
    planId: 'plan-speaking', taskId: 'task-speaking',
    domain: 'speaking' as const, targetModuleId: 'speaking' as const,
    mode: 'learn' as const, targetDifficulty: 1,
    cursor, excludeItemIds, reason: cursor === null ? 'initial' as const : 'continue-after-item' as const,
  }
}

function extraRequest(
  priorityItemIds: Record<'recent-error' | 'due-review' | 'same-day-variant' | 'new-optional-content', readonly string[]>,
  patch: Partial<{ cursor: string | null; excludeItemIds: readonly string[] }> = {},
) {
  return {
    schemaVersion: 1 as const, requestId: 'extra-speaking-priority', sessionId: 'extra-speaking', localDate: '2026-07-29',
    domain: 'speaking' as const, targetModuleId: 'speaking' as const, mode: 'learn' as const, targetDifficulty: 1,
    cursor: null, excludeItemIds: [], priority: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'] as const,
    priorityItemIds, reason: 'initial' as const, ...patch,
  }
}

async function eligibleIdentities(
  provider: SpeakingCatalogSupplyProvider,
  value: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest = request(),
) {
  const result = await provider.eligibleCandidateIdentities(value)
  expect(result).toMatchObject({
    schemaVersion: 1,
    requestId: value.requestId,
    status: 'eligible-candidates',
  })
  if (result.status !== 'eligible-candidates') throw new Error('Expected eligible speaking identities.')
  return result
}

describe('released speaking supply resolver', () => {
  it('publishes request-bound eligible semantic identities for application-owned schema-2 rounds', async () => {
    const provider = new SpeakingCatalogSupplyProvider(trainingSupplyIndex, catalog())
    const result = await eligibleIdentities(provider)
    const identities = result.candidates
    expect(identities.length).toBe(360)
    expect(identities[0]).toEqual({
      itemId: expect.any(String),
      knowledgePointId: expect.stringMatching(/^knowledge-v1-speaking-/u),
      semanticCategoryId: expect.stringMatching(/^semantic-v1/u),
    })
    expect(Object.keys(identities[0]!)).toEqual([
      'itemId', 'knowledgePointId', 'semanticCategoryId',
    ])
  })

  it('rejects missing or malformed semantic metadata instead of inventing it', () => {
    const broken = structuredClone(trainingSupplyIndex) as typeof trainingSupplyIndex
    delete (broken.candidates[0] as unknown as Record<string, unknown>).knowledgePointId
    expect(() => new SpeakingCatalogSupplyProvider(broken, catalog())).toThrow(/invalid candidate/i)
    const blank = structuredClone(trainingSupplyIndex) as typeof trainingSupplyIndex
    ;(blank.candidates[0] as unknown as Record<string, unknown>).semanticCategoryId = ' '
    expect(() => new SpeakingCatalogSupplyProvider(blank, catalog())).toThrow(/invalid candidate/i)
  })

  it('returns request-bound failure states for invalid or exhausted enumeration requests', async () => {
    const provider = new SpeakingCatalogSupplyProvider(trainingSupplyIndex, catalog())
    await expect(provider.eligibleCandidateIdentities({ ...request(), requestId: 'wrong-domain', domain: 'listening' })).resolves.toEqual({
      schemaVersion: 1, requestId: 'wrong-domain', status: 'content-exhausted', reason: 'provider-failure',
    })
    const all = await eligibleIdentities(provider)
    await expect(provider.eligibleCandidateIdentities({
      ...request(), requestId: 'all-excluded', excludeItemIds: all.candidates.map((item) => item.itemId),
    })).resolves.toEqual({
      schemaVersion: 1, requestId: 'all-excluded', status: 'content-exhausted', reason: 'all-eligible-content-recently-used',
    })
  })

  it('returns formal priority reasons without asking 01 to interpret speaking semantics', async () => {
    const provider = new SpeakingCatalogSupplyProvider(trainingSupplyIndex, catalog())
    const value = extraRequest({
      'recent-error': ['supply-v1-speaking-w1d1-q3'],
      'due-review': ['supply-v1-speaking-w1d1-s1'],
      'same-day-variant': [], 'new-optional-content': [],
    })
    const result = await eligibleIdentities(provider, value)
    expect(result.priorityItems).toEqual([
      { itemId: 'supply-v1-speaking-w1d1-q3', reason: 'recent-error' },
      { itemId: 'supply-v1-speaking-w1d1-s1', reason: 'due-review' },
    ])
    await expect(provider.eligibleCandidateIdentities(extraRequest({
      'recent-error': ['unknown-speaking-candidate'],
      'due-review': [], 'same-day-variant': [], 'new-optional-content': [],
    }))).resolves.toMatchObject({ status: 'content-exhausted', reason: 'provider-failure' })
  })

  it('lets a formal R6 priority override short-term exclusion without releasing ordinary excluded items', async () => {
    const provider = new SpeakingCatalogSupplyProvider(trainingSupplyIndex, catalog())
    const priorityId = 'supply-v1-speaking-w1d1-q3'
    const ordinaryId = 'supply-v1-speaking-w1d1-s2'
    const value = {
      ...extraRequest({
        'recent-error': [priorityId],
        'due-review': [], 'same-day-variant': [], 'new-optional-content': [],
      }),
      requestId: 'priority-overrides-cooldown',
      excludeItemIds: [priorityId, ordinaryId],
    }
    const result = await eligibleIdentities(provider, value)
    expect(result.candidates.map((item) => item.itemId)).toContain(priorityId)
    expect(result.candidates.map((item) => item.itemId)).not.toContain(ordinaryId)
    expect(result.priorityItems).toContainEqual({ itemId: priorityId, reason: 'recent-error' })
    const round = createTrainingSupplyRound({
      seed: 'speaking-priority-overrides-cooldown',
      candidates: result.candidates,
      shortTermExcludedItemIds: value.excludeItemIds,
      priorityItems: result.priorityItems,
    })
    await expect(provider.next({ ...value, supplyRound: round })).resolves.toMatchObject({
      status: 'item', item: { itemId: priorityId },
    })
    const forgedReason = {
      ...round,
      orderAudit: round.orderAudit.map((entry, index) => index === 0
        ? { ...entry, priorityReason: 'due-review' }
        : entry),
    }
    await expect(provider.next({ ...value, supplyRound: forgedReason })).resolves.toMatchObject({
      status: 'content-exhausted', reason: 'provider-failure',
    })
  })

  it('rejects a schema-2 round whose semantic identity does not match released content', async () => {
    const provider = new SpeakingCatalogSupplyProvider(trainingSupplyIndex, catalog())
    const eligible = await eligibleIdentities(provider)
    const round = createTrainingSupplyRound({
      seed: 'speaking-r15-tampered',
      candidates: eligible.candidates,
      shortTermExcludedItemIds: [],
    })
    const tampered = {
      ...round,
      orderAudit: round.orderAudit.map((entry, index) => index === 0
        ? { ...entry, semanticCategoryId: 'semantic-v1:tampered' }
        : entry),
    }
    await expect(provider.next({ ...request(), supplyRound: tampered })).resolves.toMatchObject({
      status: 'content-exhausted', reason: 'provider-failure',
    })
  })

  it('consumes a schema-2 round with no adjacent knowledge point and at most two same semantics in the first 30', async () => {
    const provider = new SpeakingCatalogSupplyProvider(trainingSupplyIndex, catalog())
    const { candidates } = await eligibleIdentities(provider)
    const round = createTrainingSupplyRound({
      seed: 'speaking-r15-first-30', candidates, shortTermExcludedItemIds: [],
    })
    const firstThirty = round.orderAudit.slice(0, 30)
    for (let index = 1; index < firstThirty.length; index += 1) {
      expect(firstThirty[index]!.knowledgePointId).not.toBe(firstThirty[index - 1]!.knowledgePointId)
    }
    for (let index = 2; index < firstThirty.length; index += 1) {
      const run = firstThirty.slice(index - 2, index + 1)
      expect(new Set(run.map((entry) => entry.semanticCategoryId)).size).toBeGreaterThan(1)
    }
    await expect(provider.next({ ...request(), supplyRound: round })).resolves.toMatchObject({
      status: 'item', item: { itemId: round.order[0] },
    })
  })

  it('restores schema-2 order offline and advances only from its acknowledged snapshot', async () => {
    const firstProvider = new SpeakingCatalogSupplyProvider(trainingSupplyIndex, catalog())
    const eligible = await eligibleIdentities(firstProvider)
    const round = createTrainingSupplyRound({
      seed: 'speaking-r15-resume',
      candidates: eligible.candidates,
      shortTermExcludedItemIds: [],
    })
    const first = await firstProvider.next({ ...request(), supplyRound: round })
    if (first.status !== 'item') throw new Error('Expected first schema-2 item.')
    const acknowledged = recordTrainingSupplyItem(round, first.item.itemId)
    const restoredProvider = new SpeakingCatalogSupplyProvider(trainingSupplyIndex, catalog())
    await expect(restoredProvider.next({
      ...request(first.item.itemId, [first.item.itemId]), supplyRound: acknowledged,
    })).resolves.toMatchObject({ status: 'item', item: { itemId: round.order[1] } })
    expect(acknowledged.shortTermHistory.at(-1)).toEqual({
      itemId: round.orderAudit[0]!.itemId,
      knowledgePointId: round.orderAudit[0]!.knowledgePointId,
      semanticCategoryId: round.orderAudit[0]!.semanticCategoryId,
    })
  })

  it('keeps schema-2 priority audit authoritative for extra training', async () => {
    const provider = new SpeakingCatalogSupplyProvider(trainingSupplyIndex, catalog())
    const base = extraRequest({
      'recent-error': ['supply-v1-speaking-w1d1-q3'],
      'due-review': ['supply-v1-speaking-w1d1-s1'],
      'same-day-variant': [], 'new-optional-content': [],
    })
    const eligible = await eligibleIdentities(provider, base)
    const round = createTrainingSupplyRound({
      seed: 'speaking-r15-priority', candidates: eligible.candidates, shortTermExcludedItemIds: [],
      priorityItems: eligible.priorityItems,
    })
    expect(round.orderAudit.slice(0, 2).map(({ itemId, priorityReason }) => ({ itemId, priorityReason }))).toEqual([
      { itemId: 'supply-v1-speaking-w1d1-q3', priorityReason: 'recent-error' },
      { itemId: 'supply-v1-speaking-w1d1-s1', priorityReason: 'due-review' },
    ])
    await expect(provider.next({ ...base, supplyRound: round })).resolves.toMatchObject({
      status: 'item', item: { itemId: 'supply-v1-speaking-w1d1-q3' },
    })
  })

  it('validates the 900-item release and enumerates its eligible identities in one bounded bulk pass', async () => {
    const startedAt = performance.now()
    const provider = new SpeakingCatalogSupplyProvider(trainingSupplyIndex, catalog())
    const result = await provider.eligibleCandidateIdentities({ ...request(), targetDifficulty: 5.5 })
    const elapsed = performance.now() - startedAt
    expect(trainingSupplyIndex.candidates).toHaveLength(900)
    expect(result.status).toBe('eligible-candidates')
    if (result.status !== 'eligible-candidates') throw new Error('Expected bulk identities.')
    expect(result.candidates.length).toBeGreaterThanOrEqual(300)
    expect(elapsed).toBeLessThan(100)
  })

  it('uses the persisted randomized round instead of source order', async () => {
    const released = catalog()
    const provider = new SpeakingCatalogSupplyProvider(trainingSupplyIndex, released)
    const candidates = trainingSupplyIndex.candidates.filter((item) => item.domain === 'speaking' && item.difficultyLevel === 1)
    const round = ['speaking-a', 'speaking-b', 'speaking-c'].map((seed) => createTrainingSupplyRound({ seed, candidateItemIds: candidates.map((item) => item.itemId), shortTermExcludedItemIds: [] })).find((candidate) => candidate.order[0] !== candidates[0]?.itemId)!
    await expect(provider.next({ ...request(), supplyRound: round })).resolves.toMatchObject({ status: 'item', item: { itemId: round.order[0] } })
  })
  it('parses the real 808 index and resolves both activity and scene fixed-response candidates', async () => {
    const released = catalog()
    const provider = new SpeakingCatalogSupplyProvider(trainingSupplyIndex, released)
    const first = await provider.next(request())
    expect(first).toMatchObject({ status: 'item', item: { source: { sourceType: 'speaking-prompt', sourceId: 'w1d1-s1' } } })
    if (first.status !== 'item') throw new Error('Expected the first released speaking candidate.')
    const activity = resolveSpeakingSupplyPrompt(released, first.item as SpeakingSupplyItem)
    expect(activity.prompt.partnerLine).toBe("Hi, I'm Maya.")

    const sceneItem = trainingSupplyIndex.candidates.find(
      (candidate) => candidate.itemId === 'supply-v1-speaking-w1d1-q3',
    )
    if (!sceneItem) throw new Error('Expected the released speaking scene candidate.')
    const scene = resolveSpeakingSupplyPrompt(released, sceneItem as SpeakingSupplyItem)
    expect(scene.prompt).toMatchObject({
      id: 'w1d1-q3',
      cueZh: '对方说“Nice to meet you.” 请回应。',
      partnerLine: '对方说“Nice to meet you.” 请回应。',
      modelAnswer: 'Nice to meet you, too.',
      acceptedAnswers: ['Nice to meet you, too.', 'You, too.', "It's nice to meet you, too."],
      requiredConcepts: ['polite-response'],
    })
  })

  it('rejects unknown or source-type/variant-mismatched released references', () => {
    const released = catalog()
    const sceneItem = trainingSupplyIndex.candidates.find(
      (candidate) => candidate.itemId === 'supply-v1-speaking-w1d1-q3',
    )
    if (!sceneItem) throw new Error('Expected the released speaking scene candidate.')
    expect(() => resolveSpeakingSupplyPrompt(released, {
      ...sceneItem,
      source: { ...sceneItem.source, sourceId: 'missing-scene' },
    } as SpeakingSupplyItem)).toThrow(/does not resolve/i)
    expect(() => resolveSpeakingSupplyPrompt(released, {
      ...sceneItem,
      source: { ...sceneItem.source, variantId: 'activity-prompt' },
    } as SpeakingSupplyItem)).toThrow(/does not resolve/i)
  })

  it('uses the exact extra-training priority order for released prompt and scene-quiz candidates', async () => {
    const provider = new SpeakingCatalogSupplyProvider(trainingSupplyIndex, catalog())
    const promptId = 'supply-v1-speaking-w1d1-s1'
    const sceneId = 'supply-v1-speaking-w1d1-q3'
    const sceneFirst = await provider.next(extraRequest({
      'recent-error': [sceneId], 'due-review': [promptId], 'same-day-variant': [], 'new-optional-content': [],
    }))
    expect(sceneFirst).toMatchObject({ status: 'item', item: { itemId: sceneId, source: { sourceType: 'speaking-scene-quiz' } } })
    const promptFirst = await provider.next(extraRequest({
      'recent-error': [], 'due-review': [promptId], 'same-day-variant': [sceneId], 'new-optional-content': [],
    }))
    expect(promptFirst).toMatchObject({ status: 'item', item: { itemId: promptId, source: { sourceType: 'speaking-prompt' } } })
    const levels = [
      ['recent-error', sceneId], ['due-review', promptId],
      ['same-day-variant', 'supply-v1-speaking-w1d1-s2'], ['new-optional-content', 'supply-v1-speaking-w1d1-s3'],
    ] as const
    for (const [priority, itemId] of levels) {
      const selected = await provider.next(extraRequest({
        'recent-error': priority === 'recent-error' ? [itemId] : [],
        'due-review': priority === 'due-review' ? [itemId] : [],
        'same-day-variant': priority === 'same-day-variant' ? [itemId] : [],
        'new-optional-content': priority === 'new-optional-content' ? [itemId] : [],
      }))
      expect(selected).toMatchObject({ status: 'item', item: { itemId } })
    }
  })

  it('falls through exhausted priority levels deterministically and rejects unknown priority ids', async () => {
    const provider = new SpeakingCatalogSupplyProvider(trainingSupplyIndex, catalog())
    const first = await provider.next(extraRequest({
      'recent-error': ['supply-v1-speaking-w1d1-s1'], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [],
    }))
    if (first.status !== 'item') throw new Error('Expected released priority item.')
    const fallback = await provider.next(extraRequest({
      'recent-error': [first.item.itemId], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [],
    }, { cursor: first.nextCursor, excludeItemIds: [first.item.itemId] }))
    expect(fallback).toMatchObject({ status: 'item' })
    if (fallback.status !== 'item') throw new Error('Expected deterministic fallback item.')
    expect(fallback.item.itemId).not.toBe(first.item.itemId)
    expect(fallback.nextCursor).toBe(fallback.item.itemId)
    await expect(provider.next(extraRequest({
      'recent-error': ['unknown-speaking-candidate'], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [],
    }))).resolves.toMatchObject({ status: 'content-exhausted', reason: 'provider-failure' })
  })
})
