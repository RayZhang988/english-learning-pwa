import { describe, expect, it } from 'vitest'
import { placementBankV1 } from '../../../content/assessment/placement-bank.v1.ts'
import {
  toPublicAssessmentItem,
  validateAssessmentBank,
} from './bank.ts'

describe('assessment bank', () => {
  it('validates the production placement bank and its coverage', () => {
    expect(validateAssessmentBank(placementBankV1)).toBe(placementBankV1)
    expect(placementBankV1.items).toHaveLength(60)
    expect(
      new Set(placementBankV1.items.map((item) => item.id)).size,
    ).toBe(60)
  })

  it('removes answer keys before crossing the presentation boundary', () => {
    const privateItem = placementBankV1.items[0]
    if (!privateItem) {
      throw new Error('Expected a production bank item')
    }

    const publicItem = toPublicAssessmentItem(privateItem)
    expect(publicItem).not.toHaveProperty('scoring')
    expect(privateItem).toHaveProperty('scoring')
  })

  it('rejects duplicate ids', () => {
    const first = placementBankV1.items[0]
    if (!first) {
      throw new Error('Expected a production bank item')
    }

    expect(() =>
      validateAssessmentBank({
        ...placementBankV1,
        items: [...placementBankV1.items, first],
      }),
    ).toThrow('Duplicate assessment item id')
  })
})
