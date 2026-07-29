import { describe, expect, it } from 'vitest'
import packageIndex from '../../../content/curriculum/package-index.v1.json'
import manifest from '../../../content/curriculum/survival-travel-american-4w.v1.json'
import extensionIndex from '../../../content/curriculum/listening-exercise-extension-index.v1.json'
import trainingSupplyIndex from '../../../content/curriculum/training-supply-index.v1.json'
import exercises from '../../../content/lessons/survival-travel-american-4w/listening-exercises.v1.json'
import week1 from '../../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import { createListeningCatalog } from './content.ts'
import { ListeningCatalogSupplyProvider } from './supply.ts'

function provider() {
  const catalog = createListeningCatalog({
    packageIndex, manifest, extensionIndex, trainingSupplyIndex,
    lessonsByPath: {
      [packageIndex.lessonFiles[0]]: week1, [packageIndex.lessonFiles[1]]: week2,
      [packageIndex.lessonFiles[2]]: week3, [packageIndex.lessonFiles[3]]: week4,
    },
    exerciseBundlesByPath: { [extensionIndex.exerciseBundleFiles[0]]: exercises },
  })
  return new ListeningCatalogSupplyProvider(catalog.trainingSupplyIndex, catalog)
}

const candidates = (trainingSupplyIndex.candidates as readonly {
  readonly itemId: string; readonly difficultyLevel: number; readonly allowedModes: readonly string[]
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
    await expect(supply.next(extra(priority, { excludeItemIds: [recent!.itemId] }))).resolves.toMatchObject({ status: 'item', item: { itemId: due!.itemId } })
    await expect(supply.next(extra(priority, { excludeItemIds: [recent!.itemId, due!.itemId] }))).resolves.toMatchObject({ status: 'item', item: { itemId: sameDay!.itemId } })
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

  it('keeps the daily LearningTaskSupplyRequest path unchanged', async () => {
    const result = await provider().next({ schemaVersion: 1, requestId: 'daily-listening', planId: 'plan', taskId: 'task', domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1, cursor: null, excludeItemIds: [], reason: 'initial' })
    expect(result).toMatchObject({ status: 'item', item: { itemId: candidates[0]!.itemId } })
  })
})
