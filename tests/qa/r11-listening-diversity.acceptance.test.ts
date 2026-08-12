import { describe, expect, it } from 'vitest'
import packageIndex from '../../content/curriculum/package-index.v1.json'
import manifest from '../../content/curriculum/survival-travel-american-4w.v1.json'
import extensionIndex from '../../content/curriculum/listening-exercise-extension-index.v1.json'
import trainingSupplyIndex from '../../content/curriculum/training-supply-index.v1/listening.json'
import exercises from '../../content/lessons/survival-travel-american-4w/listening-exercises.v1.json'
import bilingualChoiceOptions from '../../content/lessons/survival-travel-american-4w/listening-choice-bilingual-options.v1.json'
import week1 from '../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import { createListeningCatalog } from '../../src/features/listening/content.ts'
import { ListeningCatalogSupplyProvider } from '../../src/features/listening/supply.ts'
import type { ListeningSupplyItem } from '../../src/features/listening/types.ts'

const catalog = createListeningCatalog({
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

const provider = new ListeningCatalogSupplyProvider(
  catalog.trainingSupplyIndex,
  catalog,
)

type Supplied = ListeningSupplyItem & {
  readonly variantFamilyId: string
}

async function dailySequence(planId: string, count = 30) {
  const items: Supplied[] = []
  let cursor: string | null = null
  for (let index = 0; index < count; index += 1) {
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
      excludeItemIds: items.map((item) => item.itemId),
      reason: index === 0
        ? 'initial' as const
        : 'continue-after-item' as const,
    }
    const result = await provider.next(request)
    const restored = await provider.next({
      ...request,
      requestId: `${request.requestId}:restored`,
    })
    expect(restored.status === 'item' ? restored.item.itemId : null)
      .toBe(result.status === 'item' ? result.item.itemId : null)
    expect(result.status).toBe('item')
    if (result.status !== 'item') break
    items.push(result.item as Supplied)
    cursor = result.nextCursor
  }
  return items
}

describe('R11 released listening diversity acceptance', () => {
  it('publishes the expanded 253-item listening pool with 84 short-sentence choices', () => {
    const listeningCandidates = trainingSupplyIndex.candidates.filter(
      (candidate) => candidate.domain === 'listening',
    )
    const questions = catalog.units.flatMap((unit) => unit.questions)

    expect(listeningCandidates).toHaveLength(253)
    expect(new Set(listeningCandidates.map((item) => item.itemId))).toHaveLength(253)
    expect(
      questions.filter((question) => question.type === 'short-sentence-choice'),
    ).toHaveLength(84)
  })

  it('keeps refresh recovery stable while separating dialogue families and question types', async () => {
    const items = await dailySequence('r11-acceptance')

    expect(items).toHaveLength(30)
    expect(new Set(items.map((item) => item.itemId))).toHaveLength(30)
    for (const [index, item] of items.entries()) {
      expect(
        items
          .slice(Math.max(0, index - 4), index)
          .map((recent) => recent.variantFamilyId),
      ).not.toContain(item.variantFamilyId)
      if (index > 0) {
        expect(item.source.variantId)
          .not.toBe(items[index - 1]!.source.variantId)
      }
    }
  })

  it('gives different daily sessions materially different stable orders', async () => {
    const first = await dailySequence('r11-order-a', 20)
    const second = await dailySequence('r11-order-b', 20)

    expect(
      first.filter((item, index) => item.itemId !== second[index]?.itemId),
    ).toHaveLength(20)
  })
})
