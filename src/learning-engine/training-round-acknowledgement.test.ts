import { describe, expect, it } from 'vitest'
import {
  createTrainingSupplyRound,
  nextTrainingSupplyItem,
  recordTrainingSupplyItem,
} from './training-randomization.ts'
import { assertSupplyRoundAdvances } from './training-round-acknowledgement.ts'

const candidates = [
  { itemId: 'a', knowledgePointId: 'knowledge-a', semanticCategoryId: 'semantic-a' },
  { itemId: 'b', knowledgePointId: 'knowledge-b', semanticCategoryId: 'semantic-b' },
]

describe('R15 semantic round acknowledgement', () => {
  it('accepts exactly one atomically recorded semantic item', () => {
    const previous = createTrainingSupplyRound({
      seed: 'ack', candidates, shortTermExcludedItemIds: [], shortTermHistory: [],
    })
    const next = nextTrainingSupplyItem(previous)
    if (next.status !== 'item') throw new Error('expected item')
    const received = recordTrainingSupplyItem(previous, next.itemId)

    expect(() => assertSupplyRoundAdvances(previous, received)).not.toThrow()
  })

  it('rejects changed semantic audit metadata even when seed, order and cursor match', () => {
    const previous = createTrainingSupplyRound({
      seed: 'audit-tamper', candidates, shortTermExcludedItemIds: [], shortTermHistory: [],
    })
    const next = nextTrainingSupplyItem(previous)
    if (next.status !== 'item') throw new Error('expected item')
    const received = recordTrainingSupplyItem(previous, next.itemId)
    const tampered = {
      ...received,
      orderAudit: received.orderAudit.map((entry, index) => index === 0
        ? { ...entry, semanticCategoryId: 'changed-semantic' }
        : entry),
    }

    expect(() => assertSupplyRoundAdvances(previous, tampered)).toThrow(
      'established training round',
    )
  })

  it('rejects a cursor advance that does not append the acknowledged semantic history', () => {
    const previous = createTrainingSupplyRound({
      seed: 'history-tamper', candidates, shortTermExcludedItemIds: [], shortTermHistory: [],
    })
    const next = nextTrainingSupplyItem(previous)
    if (next.status !== 'item') throw new Error('expected item')
    const received = recordTrainingSupplyItem(previous, next.itemId)

    expect(() => assertSupplyRoundAdvances(previous, {
      ...received,
      shortTermHistory: [],
    })).toThrow('semantic history')
  })
})
