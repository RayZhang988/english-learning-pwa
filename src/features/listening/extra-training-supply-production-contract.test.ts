import { describe, expect, it } from 'vitest'
import packageIndex from '../../../content/curriculum/package-index.v1.json'
import manifest from '../../../content/curriculum/survival-travel-american-4w.v1.json'
import extensionIndex from '../../../content/curriculum/listening-exercise-extension-index.v1.json'
import trainingSupplyIndex from '../../../content/curriculum/training-supply-index.v1/listening.json'
import exercises from '../../../content/lessons/survival-travel-american-4w/listening-exercises.v1.json'
import bilingualChoiceOptions from '../../../content/lessons/survival-travel-american-4w/listening-choice-bilingual-options.v1.json'
import week1 from '../../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import { createListeningCatalog } from './content.ts'
import { ListeningCatalogSupplyProvider } from './supply.ts'
import type { ListeningSupplyItem } from './types.ts'

function provider() {
  const catalog = createListeningCatalog({
    packageIndex, manifest, extensionIndex, trainingSupplyIndex,
    lessonsByPath: {
      [packageIndex.lessonFiles[0]]: week1, [packageIndex.lessonFiles[1]]: week2,
      [packageIndex.lessonFiles[2]]: week3, [packageIndex.lessonFiles[3]]: week4,
    },
    exerciseBundlesByPath: { [extensionIndex.exerciseBundleFiles[0]]: exercises },
    bilingualChoiceOptions,
  })
  return new ListeningCatalogSupplyProvider(catalog.trainingSupplyIndex, catalog)
}

const candidates = (trainingSupplyIndex.candidates as readonly {
  readonly itemId: string; readonly difficultyLevel: number; readonly allowedModes: readonly string[]
  readonly variantFamilyId: string; readonly playbackContentId: string | null
  readonly source: { readonly variantId: string }
}[]).filter((candidate) => candidate.itemId.includes('-listening-') && candidate.allowedModes.includes('learn') && candidate.difficultyLevel === 1)

function extra(priorityItemIds: Record<'recent-error' | 'due-review' | 'same-day-variant' | 'new-optional-content', readonly string[]>, patch: Partial<{ cursor: string | null; excludeItemIds: readonly string[] }> = {}) {
  return {
    schemaVersion: 1 as const, requestId: 'extra-listening-priority', sessionId: 'extra-listening',
    localDate: '2026-07-29', domain: 'listening' as const, targetModuleId: 'listening' as const,
    mode: 'learn' as const, targetDifficulty: 1, cursor: null, excludeItemIds: [],
    priority: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'] as const,
    priorityItemIds, reason: 'initial' as const, ...patch,
  }
}

describe('extra listening supply production contract', () => {
  it('selects the exact published priority item, then descends through priority buckets', async () => {
    const [recent, due, sameDay, fresh] = candidates
    const priority = {
      'recent-error': [recent!.itemId], 'due-review': [due!.itemId],
      'same-day-variant': [sameDay!.itemId], 'new-optional-content': [fresh!.itemId],
    }
    const supply = provider()
    await expect(supply.next(extra(priority))).resolves.toMatchObject({ status: 'item', item: { itemId: recent!.itemId } })
    const cooledDue = await supply.next(extra(priority, { excludeItemIds: [recent!.itemId] }))
    expect(cooledDue).toMatchObject({ status: 'item' })
    if (cooledDue.status === 'item') {
      expect(cooledDue.item.itemId).not.toBe(due!.itemId)
    }
    const sameDayResult = await supply.next(extra(priority, {
      excludeItemIds: [recent!.itemId, due!.itemId],
    }))
    expect(sameDayResult).toMatchObject({ status: 'item' })
    if (sameDayResult.status === 'item') {
      // same-day expansion is not an exact review override: its family is
      // still in the recent cooldown, so normal fallback must take over.
      expect((sameDayResult.item as ListeningSupplyItem & { readonly variantFamilyId: string }).variantFamilyId)
        .not.toBe(sameDay!.variantFamilyId)
    }
  })

  it('rejects unknown published-priority identities instead of silently selecting ordinary content', async () => {
    await expect(provider().next(extra({ 'recent-error': ['missing-listening-candidate'], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] }))).resolves.toMatchObject({ status: 'content-exhausted', reason: 'provider-failure' })
  })

  it('uses deterministic cursor/exclude fallback when all priority buckets are empty', async () => {
    const supply = provider()
    const first = await supply.next(extra({ 'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] }))
    expect(first.status).toBe('item')
    if (first.status !== 'item') return
    const restored = await supply.next(extra({ 'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] }, { cursor: first.nextCursor, excludeItemIds: [first.item.itemId] }))
    expect(restored).toMatchObject({ status: 'item' })
    if (restored.status === 'item') expect(restored.item.itemId).not.toBe(first.item.itemId)
  })

  it('hard-cools ordinary extra-training families for 30 items and restores from durable IDs', async () => {
    const supply = provider()
    const priority = { 'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] }
    const completed: string[] = []
    const families: string[] = []
    let cursor: string | null = null
    for (let index = 0; index < 30; index += 1) {
      const request = extra(priority, {
        cursor, excludeItemIds: completed,
      })
      const result = await supply.next({
        ...request,
        requestId: `ordinary-extra-${index}`,
        reason: index === 0 ? 'initial' : 'continue-after-item',
      })
      expect(result.status).toBe('item')
      if (result.status !== 'item') return
      const item = result.item as ListeningSupplyItem & { readonly variantFamilyId: string }
      expect(families.slice(-4)).not.toContain(item.variantFamilyId)
      completed.push(item.itemId)
      families.push(item.variantFamilyId)
      cursor = result.nextCursor
    }
    const restored = await supply.next(extra(priority, {
      cursor, excludeItemIds: completed,
    }))
    expect(restored.status).toBe('item')
    if (restored.status === 'item') {
      expect(families.slice(-4)).not.toContain((restored.item as ListeningSupplyItem & { readonly variantFamilyId: string }).variantFamilyId)
    }
  })

  it('takes only one same-audio priority variant, then falls through to a different playback identity', async () => {
    const duplicateGroup = [...new Map(
      candidates
        .filter((candidate) => candidate.playbackContentId !== null)
        .map((candidate) => [candidate.playbackContentId!, candidates.filter((other) => other.playbackContentId === candidate.playbackContentId)]),
    ).values()].find((group) => group.length >= 3)
    expect(duplicateGroup).toBeDefined()
    if (!duplicateGroup) return
    const priority = {
      'recent-error': duplicateGroup.map((candidate) => candidate.itemId),
      'due-review': [], 'same-day-variant': [], 'new-optional-content': [],
    }
    const supply = provider()
    const first = await supply.next(extra(priority))
    expect(first.status).toBe('item')
    if (first.status !== 'item') return
    const firstItem = first.item as ListeningSupplyItem
    expect(priority['recent-error']).toContain(firstItem.itemId)
    const nextRequest = extra(priority, { cursor: first.nextCursor, excludeItemIds: [firstItem.itemId] })
    const next = await supply.next({ ...nextRequest, requestId: 'same-audio-priority-next', reason: 'continue-after-item' })
    const restored = await supply.next({ ...nextRequest, requestId: 'same-audio-priority-restored', reason: 'continue-after-item' })
    expect(next.status).toBe('item')
    expect(restored.status === 'item' ? restored.item.itemId : null)
      .toBe(next.status === 'item' ? next.item.itemId : null)
    if (next.status === 'item') {
      expect((next.item as ListeningSupplyItem).playbackContentId).not.toBe(firstItem.playbackContentId)
    }
  })

  it('interleaves same-family recent errors with ordinary content without dropping them from priority', async () => {
    const family = candidates.find((candidate) => candidate.variantFamilyId.includes('w1d1'))!.variantFamilyId
    const priorityCandidates = candidates
      .filter((candidate) => candidate.variantFamilyId === family)
    const priorityIds = priorityCandidates.map((candidate) => candidate.itemId)
    expect(priorityIds.length).toBeGreaterThanOrEqual(9)
    const priority = { 'recent-error': priorityIds, 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] }
    const supply = provider()
    const completed: string[] = []
    const supplied: Array<ListeningSupplyItem & { readonly variantFamilyId: string }> = []
    let cursor: string | null = null
    for (let index = 0; index < 30; index += 1) {
      const request = extra(priority, { cursor, excludeItemIds: completed })
      const result = await supply.next({ ...request, requestId: `priority-boundary-${index}`, reason: index ? 'continue-after-item' : 'initial' })
      expect(result.status).toBe('item')
      if (result.status !== 'item') return
      const item = result.item as ListeningSupplyItem & { readonly variantFamilyId: string }
      expect(supplied.slice(-4).map((entry) => entry.variantFamilyId)).not.toContain(item.variantFamilyId)
      expect(supplied.at(-1)?.source.variantId).not.toBe(item.source.variantId)
      expect(supplied.map((entry) => entry.playbackContentId)).not.toContain(item.playbackContentId)
      supplied.push(item); completed.push(item.itemId)
      cursor = result.nextCursor
    }
    const uniquePriorityPlayback = new Set(priorityCandidates.map((item) => item.playbackContentId))
    expect(supplied.filter((item) => priorityIds.includes(item.itemId)).length).toBe(uniquePriorityPlayback.size)
  })

  it('treats a same-day declaration as a completed seed, never its replayable variant', async () => {
    const declared = candidates.find((candidate) => candidate.variantFamilyId.includes('w1d1'))!
    const priority = { 'recent-error': [], 'due-review': [], 'same-day-variant': [declared.itemId], 'new-optional-content': [] }
    const supply = provider()
    const initial = extra(priority)
    const first = await supply.next(initial)
    const restoredFirst = await supply.next({ ...initial, requestId: 'same-day-seed-restored' })
    expect(restoredFirst.status === 'item' ? restoredFirst.item.itemId : null)
      .toBe(first.status === 'item' ? first.item.itemId : null)
    const completed: string[] = []
    const items: Array<ListeningSupplyItem & { readonly variantFamilyId: string }> = []
    let cursor: string | null = null
    for (let index = 0; index < 30; index += 1) {
      const request = extra(priority, { cursor, excludeItemIds: completed })
      const result = await supply.next({ ...request, requestId: `same-day-family-${index}`, reason: index ? 'continue-after-item' : 'initial' })
      expect(result.status).toBe('item')
      if (result.status !== 'item') return
      const item = result.item as ListeningSupplyItem & { readonly variantFamilyId: string }
      expect(item.itemId).not.toBe(declared.itemId)
      expect(item.playbackContentId).not.toBe(declared.playbackContentId)
      expect(items.slice(-4).map((entry) => entry.variantFamilyId)).not.toContain(item.variantFamilyId)
      expect(items.at(-1)?.source.variantId).not.toBe(item.source.variantId)
      expect(items.map((entry) => entry.playbackContentId)).not.toContain(item.playbackContentId)
      items.push(item); completed.push(item.itemId); cursor = result.nextCursor
    }
    // A distinct-audio family variant is permitted but never required by
    // shuffle; the seed itself must remain excluded through the whole stream.
  })

  it('keeps the daily LearningTaskSupplyRequest path stable without reverting to file order', async () => {
    const request = { schemaVersion: 1 as const, requestId: 'daily-listening', planId: 'plan', taskId: 'task', domain: 'listening' as const, targetModuleId: 'listening' as const, mode: 'learn' as const, targetDifficulty: 1, cursor: null, excludeItemIds: [], reason: 'initial' as const }
    const result = await provider().next(request)
    const retry = await provider().next({ ...request, requestId: 'daily-listening-retry' })
    expect(result).toMatchObject({ status: 'item' })
    expect(retry.status === 'item' && result.status === 'item'
      ? retry.item.itemId
      : null).toBe(result.status === 'item' ? result.item.itemId : null)
    expect(result.status === 'item' ? result.item.itemId : null)
      .not.toBe(candidates[0]!.itemId)
  })
})
