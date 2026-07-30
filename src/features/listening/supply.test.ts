import { describe, expect, it } from 'vitest'
import packageIndex from '../../../content/curriculum/package-index.v1.json'
import manifest from '../../../content/curriculum/survival-travel-american-4w.v1.json'
import extensionIndex from '../../../content/curriculum/listening-exercise-extension-index.v1.json'
import trainingSupplyIndex from '../../../content/curriculum/training-supply-index.v1.json'
import exercises from '../../../content/lessons/survival-travel-american-4w/listening-exercises.v1.json'
import bilingualChoiceOptions from '../../../content/lessons/survival-travel-american-4w/listening-choice-bilingual-options.v1.json'
import week1 from '../../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import { createListeningCatalog } from './content.ts'
import { resolveListeningSupplyQuestion, ListeningCatalogSupplyProvider } from './supply.ts'
import type { ListeningSupplyItem } from './types.ts'

function catalog() {
  return createListeningCatalog({
    packageIndex,
    manifest,
    extensionIndex,
    trainingSupplyIndex,
    lessonsByPath: {
      [packageIndex.lessonFiles[0]]: week1,
      [packageIndex.lessonFiles[1]]: week2,
      [packageIndex.lessonFiles[2]]: week3,
      [packageIndex.lessonFiles[3]]: week4,
    },
    exerciseBundlesByPath: {
      [extensionIndex.exerciseBundleFiles[0]]: exercises,
    },
    bilingualChoiceOptions,
  })
}

describe('listening training supply', () => {
  it('selects stable non-repeating approved listening items from all three source types', async () => {
    const current = catalog()
    const provider = new ListeningCatalogSupplyProvider(current.trainingSupplyIndex, current)
    const first = await provider.next({ schemaVersion: 1, requestId: 'request-1', planId: 'plan', taskId: 'task', domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1, cursor: null, excludeItemIds: [], reason: 'initial' })
    expect(first).toMatchObject({ status: 'item' })
    if (first.status !== 'item') return
    const second = await provider.next({ schemaVersion: 1, requestId: 'request-2', planId: 'plan', taskId: 'task', domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1, cursor: first.nextCursor, excludeItemIds: [first.item.itemId], reason: 'continue-after-item' })
    expect(second).toMatchObject({ status: 'item' })
    if (second.status !== 'item') return
    expect(second.item.itemId).not.toBe(first.item.itemId)
    const supplied = first.item as import('./types.ts').ListeningSupplyItem
    const resolved = resolveListeningSupplyQuestion(current, supplied)
    expect(resolved.question.id).toBe(supplied.source.sourceId)
    expect(current.trainingSupplyIndex).toBeDefined()
  })

  it('reports exhaustion instead of clearing exclusions and looping', async () => {
    const current = catalog()
    const provider = new ListeningCatalogSupplyProvider(current.trainingSupplyIndex, current)
    const all = (trainingSupplyIndex.candidates as { readonly itemId: string }[])
      .filter((item) => item.itemId.includes('-listening-'))
      .map((item) => item.itemId)
    const result = await provider.next({ schemaVersion: 1, requestId: 'request', planId: 'plan', taskId: 'task', domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1, cursor: null, excludeItemIds: all, reason: 'continue-after-item' })
    expect(result).toMatchObject({ status: 'content-exhausted', reason: 'all-eligible-content-recently-used' })
  })

  it.each([0, 0.5, 1, 2.5, 4, 5.5])(
    'shuffles target %s without repeating an item, dialogue family, or adjacent question type',
    async (targetDifficulty) => {
      const current = catalog()
      const provider = new ListeningCatalogSupplyProvider(
        current.trainingSupplyIndex,
        current,
      )
      const supplied: Array<{
        itemId: string
        variantFamilyId: string
        variantId: string
      }> = []
      let cursor: string | null = null
      for (let index = 0; index < 24; index += 1) {
        const result = await provider.next({
          schemaVersion: 1,
          requestId: `diversity-${targetDifficulty}-${index}`,
          planId: `plan-${targetDifficulty}`,
          taskId: `task-${targetDifficulty}`,
          domain: 'listening',
          targetModuleId: 'listening',
          mode: 'learn',
          targetDifficulty,
          cursor,
          excludeItemIds: supplied.map((item) => item.itemId),
          reason: index === 0 ? 'initial' : 'continue-after-item',
        })
        expect(result.status).toBe('item')
        if (result.status !== 'item') return
        const item = result.item as ListeningSupplyItem & {
          readonly variantFamilyId: string
        }
        supplied.push({
          itemId: item.itemId,
          variantFamilyId: item.variantFamilyId,
          variantId: item.source.variantId,
        })
        cursor = result.nextCursor
      }

      expect(new Set(supplied.map((item) => item.itemId))).toHaveLength(24)
      for (const [index, item] of supplied.entries()) {
        const recent = supplied.slice(Math.max(0, index - 4), index)
        expect(recent.map((entry) => entry.variantFamilyId))
          .not.toContain(item.variantFamilyId)
        if (index > 0) {
          expect(item.variantId).not.toBe(supplied[index - 1].variantId)
        }
      }
    },
  )

  it('keeps a restored next item stable while different plans receive different shuffled orders', async () => {
    const current = catalog()
    const provider = new ListeningCatalogSupplyProvider(
      current.trainingSupplyIndex,
      current,
    )
    async function sequence(planId: string) {
      const ids: string[] = []
      let cursor: string | null = null
      for (let index = 0; index < 20; index += 1) {
        const request = {
          schemaVersion: 1 as const,
          requestId: `${planId}:${index}`,
          planId,
          taskId: `${planId}:listening`,
          domain: 'listening' as const,
          targetModuleId: 'listening' as const,
          mode: 'learn' as const,
          targetDifficulty: 1,
          cursor,
          excludeItemIds: ids,
          reason: index === 0
            ? 'initial' as const
            : 'continue-after-item' as const,
        }
        const first = await provider.next(request)
        const restored = await provider.next({
          ...request,
          requestId: `${request.requestId}:retry`,
        })
        expect(restored.status).toBe(first.status)
        expect(
          restored.status === 'item' ? restored.item.itemId : null,
        ).toBe(first.status === 'item' ? first.item.itemId : null)
        expect(first.status).toBe('item')
        if (first.status !== 'item') return ids
        ids.push(first.item.itemId)
        cursor = first.nextCursor
      }
      return ids
    }

    const first = await sequence('shuffle-a')
    const second = await sequence('shuffle-b')
    expect(
      first.filter((itemId, index) => itemId !== second[index]).length,
    ).toBeGreaterThanOrEqual(14)
  })
})
