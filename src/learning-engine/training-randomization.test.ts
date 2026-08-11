import { describe, expect, it } from 'vitest'
import {
  SHORT_TERM_EXCLUSION_WINDOW,
  createTrainingSupplyRound,
  nextTrainingSupplyItem,
  recordTrainingSupplyItem,
} from './training-randomization.ts'

describe('R11-A training randomization contract', () => {
  it('creates a deterministic Fisher-Yates order from an injectable seed', () => {
    const first = createTrainingSupplyRound({
      seed: 'round-alpha',
      candidateItemIds: ['a', 'b', 'c', 'd', 'e'],
      shortTermExcludedItemIds: [],
    })
    const sameSeed = createTrainingSupplyRound({
      seed: 'round-alpha',
      candidateItemIds: ['a', 'b', 'c', 'd', 'e'],
      shortTermExcludedItemIds: [],
    })

    expect(first).toEqual(sameSeed)
    expect(first.order).toHaveLength(5)
    expect(new Set(first.order)).toEqual(new Set(['a', 'b', 'c', 'd', 'e']))
  })

  it('persists its order and cursor without reshuffling after JSON recovery', () => {
    const started = createTrainingSupplyRound({
      seed: 'resume-seed',
      candidateItemIds: ['one', 'two', 'three'],
      shortTermExcludedItemIds: [],
    })
    const first = nextTrainingSupplyItem(started)
    expect(first.status).toBe('item')
    if (first.status !== 'item') {
      throw new Error('Expected an item in the non-empty randomized round.')
    }
    const advanced = recordTrainingSupplyItem(started, first.itemId)
    const restored = JSON.parse(JSON.stringify(advanced)) as typeof advanced

    expect(nextTrainingSupplyItem(restored)).toEqual(
      nextTrainingSupplyItem(advanced),
    )
  })

  it('avoids bounded recent content for ordinary new learning but lets explicit review priority override it', () => {
    const excluded = Array.from(
      { length: SHORT_TERM_EXCLUSION_WINDOW + 3 },
      (_, index) => `old-${index}`,
    )
    const ordinary = createTrainingSupplyRound({
      seed: 'ordinary',
      candidateItemIds: ['old-14', 'fresh'],
      shortTermExcludedItemIds: excluded,
    })
    const review = createTrainingSupplyRound({
      seed: 'review',
      candidateItemIds: ['old-14', 'fresh'],
      shortTermExcludedItemIds: excluded,
      priorityItemIds: ['old-14'],
    })

    expect(ordinary.order).toEqual(['fresh'])
    expect(review.order[0]).toBe('old-14')
  })

  it('reports exhaustion when every ordinary candidate is in the short-term window', () => {
    const round = createTrainingSupplyRound({
      seed: 'exhausted',
      candidateItemIds: ['a', 'b'],
      shortTermExcludedItemIds: ['a', 'b'],
    })

    expect(nextTrainingSupplyItem(round)).toEqual({
      status: 'content-exhausted',
      reason: 'all-eligible-content-recently-used',
    })
  })
})
