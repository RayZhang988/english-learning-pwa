import { describe, expect, it } from 'vitest'
import {
  SHORT_TERM_EXCLUSION_WINDOW,
  assertTrainingSupplyRound,
  type TrainingSupplyCandidateIdentity,
  createTrainingSupplyRound,
  nextTrainingSupplyItem,
  recordTrainingSupplyItem,
} from './training-randomization.ts'

const candidate = (
  itemId: string,
  knowledgePointId: string,
  semanticCategoryId: string,
): TrainingSupplyCandidateIdentity => ({ itemId, knowledgePointId, semanticCategoryId })

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

describe('R15 semantic diversity contract', () => {
  it('persists a deterministic semantic order and its auditable relaxation decisions', () => {
    const candidates = [
      candidate('greeting-choice', 'greeting', 'social'),
      candidate('greeting-listen', 'greeting', 'social'),
      candidate('hotel', 'hotel', 'lodging'),
      candidate('taxi', 'taxi', 'transport'),
      candidate('bus', 'bus', 'transport'),
    ]
    const input = {
      seed: 'r15-deterministic',
      candidates,
      shortTermExcludedItemIds: [],
      shortTermHistory: [],
    } as const

    const first = createTrainingSupplyRound(input)
    const second = createTrainingSupplyRound(input)

    expect(first).toEqual(second)
    expect(first.schemaVersion).toBe(2)
    expect(first.relaxationTier).toBe(0)
    expect(first.orderAudit).toHaveLength(candidates.length)
    for (let index = 1; index < first.orderAudit!.length; index += 1) {
      expect(first.orderAudit![index]!.knowledgePointId).not.toBe(
        first.orderAudit![index - 1]!.knowledgePointId,
      )
    }
  })

  it('meets the first-30 diversity gate across 200 deterministic seeds', () => {
    const candidates = Array.from({ length: 120 }, (_, index) =>
      candidate(`item-${index}`, `knowledge-${index % 60}`, `semantic-${index % 12}`),
    )

    for (let seed = 0; seed < 200; seed += 1) {
      const round = createTrainingSupplyRound({
        seed: `quality-${seed}`,
        candidates,
        shortTermExcludedItemIds: [],
        shortTermHistory: [],
      })
      const firstThirty = round.orderAudit!.slice(0, 30)
      for (let index = 1; index < firstThirty.length; index += 1) {
        expect(firstThirty[index]!.knowledgePointId).not.toBe(
          firstThirty[index - 1]!.knowledgePointId,
        )
      }
      for (let index = 2; index < firstThirty.length; index += 1) {
        const run = firstThirty.slice(index - 2, index + 1)
        expect(new Set(run.map((entry) => entry.semanticCategoryId)).size).toBeGreaterThan(1)
      }
    }
  })

  it('relaxes semantic cooldown before knowledge adjacency and never reports false exhaustion', () => {
    const round = createTrainingSupplyRound({
      seed: 'small-pool',
      candidates: [
        candidate('a', 'a', 'only-category'),
        candidate('b', 'b', 'only-category'),
        candidate('c', 'c', 'only-category'),
      ],
      shortTermExcludedItemIds: [],
      shortTermHistory: [],
    })

    expect(round.order).toHaveLength(3)
    expect(round.orderAudit!.map((entry) => entry.relaxationTier)).toEqual([0, 0, 1])
    expect(round.relaxationTier).toBe(1)
  })

  it('lets explicit priority bypass cooldown and preserves the exact reason', () => {
    const recent = candidate('recent-error', 'greeting', 'social')
    const round = createTrainingSupplyRound({
      seed: 'priority',
      candidates: [recent, candidate('fresh', 'hotel', 'lodging')],
      shortTermExcludedItemIds: ['recent-error'],
      shortTermHistory: [recent],
      priorityItems: [{ itemId: 'recent-error', reason: 'recent-error' }],
    })

    expect(round.order[0]).toBe('recent-error')
    expect(round.orderAudit![0]).toMatchObject({
      priorityReason: 'recent-error',
      relaxationTier: 0,
    })
    expect(nextTrainingSupplyItem(round)).toEqual({
      status: 'item',
      itemId: 'recent-error',
      priorityReason: 'recent-error',
      relaxationTier: 0,
    })
  })

  it('keeps semantic history and the next item stable across JSON recovery', () => {
    const started = createTrainingSupplyRound({
      seed: 'semantic-resume',
      candidates: [
        candidate('a', 'a', 'alpha'),
        candidate('b', 'b', 'beta'),
        candidate('c', 'c', 'gamma'),
      ],
      shortTermExcludedItemIds: [],
      shortTermHistory: [],
    })
    const first = nextTrainingSupplyItem(started)
    if (first.status !== 'item') throw new Error('expected item')
    const advanced = recordTrainingSupplyItem(started, first.itemId)
    const restored = JSON.parse(JSON.stringify(advanced)) as typeof advanced

    expect(restored.shortTermHistory).toHaveLength(1)
    expect(nextTrainingSupplyItem(restored)).toEqual(nextTrainingSupplyItem(advanced))
  })

  it('continues accepting a valid schema-1 round without data loss', () => {
    const legacy = {
      schemaVersion: 1 as const,
      seed: 'legacy',
      order: ['a', 'b'],
      cursor: 1,
      shortTermExcludedItemIds: ['a'],
    }

    expect(nextTrainingSupplyItem(legacy)).toEqual({ status: 'item', itemId: 'b' })
    expect(recordTrainingSupplyItem(legacy, 'b')).toEqual({
      ...legacy,
      cursor: 2,
      shortTermExcludedItemIds: ['a', 'b'],
    })
  })

  it('strictly rejects damaged persisted semantic audit state', () => {
    const valid = createTrainingSupplyRound({
      seed: 'strict-recovery',
      candidates: [candidate('a', 'knowledge-a', 'semantic-a')],
      shortTermExcludedItemIds: [],
      shortTermHistory: [],
    })

    expect(() => assertTrainingSupplyRound({
      ...valid,
      orderAudit: [{ ...valid.orderAudit[0]!, itemId: 'different' }],
    })).toThrow('orderAudit')
    expect(() => assertTrainingSupplyRound({ ...valid, relaxationTier: 2 })).toThrow(
      'relaxationTier',
    )
  })

  it('persists only the three released semantic identity fields from rich candidates', () => {
    const round = createTrainingSupplyRound({
      seed: 'minimal-snapshot',
      candidates: [{
        ...candidate('a', 'knowledge-a', 'semantic-a'),
        source: { large: 'provider-owned-content' },
      }],
      shortTermExcludedItemIds: [],
      shortTermHistory: [],
    })

    expect(Object.keys(round.orderAudit[0]!).sort()).toEqual([
      'itemId',
      'knowledgePointId',
      'priorityReason',
      'relaxationTier',
      'semanticCategoryId',
    ])
  })

  it.each([
    [candidate('', 'knowledge', 'semantic'), 'itemId'],
    [candidate('item', '', 'semantic'), 'knowledgePointId'],
    [candidate('item', 'knowledge', ''), 'semanticCategoryId'],
  ])('rejects invalid released candidate metadata %#', (invalid, field) => {
    expect(() => createTrainingSupplyRound({
      seed: 'invalid',
      candidates: [invalid],
      shortTermExcludedItemIds: [],
      shortTermHistory: [],
    })).toThrow(field)
  })

  it('orders 4,500 semantic candidates within the linear-scale performance boundary', () => {
    const candidates = Array.from({ length: 4_500 }, (_, index) =>
      candidate(`item-${index}`, `knowledge-${index % 1_500}`, `semantic-${index % 180}`),
    )
    const startedAt = performance.now()
    const round = createTrainingSupplyRound({
      seed: 'large-vocabulary-pool',
      candidates,
      shortTermExcludedItemIds: [],
      shortTermHistory: [],
    })

    expect(round.order).toHaveLength(4_500)
    expect(performance.now() - startedAt).toBeLessThan(250)
  })

  it('does not degrade quadratically when a large eligible pool has one semantic category', () => {
    const candidates = Array.from({ length: 4_500 }, (_, index) =>
      candidate(`single-${index}`, `knowledge-${index}`, 'single-semantic'),
    )
    const startedAt = performance.now()
    const round = createTrainingSupplyRound({
      seed: 'large-single-semantic-pool',
      candidates,
      shortTermExcludedItemIds: [],
      shortTermHistory: [],
    })

    expect(round.order).toHaveLength(4_500)
    expect(round.relaxationTier).toBe(1)
    expect(performance.now() - startedAt).toBeLessThan(250)
  })
})
