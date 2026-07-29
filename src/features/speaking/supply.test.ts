import { describe, expect, it } from 'vitest'
import packageIndex from '../../../content/curriculum/package-index.v1.json'
import manifest from '../../../content/curriculum/survival-travel-american-4w.v1.json'
import trainingSupplyIndex from '../../../content/curriculum/training-supply-index.v1.json'
import week1 from '../../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import { createSpeakingCatalog } from './content.ts'
import { SpeakingCatalogSupplyProvider, resolveSpeakingSupplyPrompt } from './supply.ts'
import type { SpeakingContentDocuments, SpeakingSupplyItem } from './types.ts'

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

describe('released speaking supply resolver', () => {
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
