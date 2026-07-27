import { describe, expect, it } from 'vitest'
import { placementBankV1 } from '../../../content/assessment/placement-bank.v1.ts'
import { vocabularyPlacementBankV2 } from '../../../content/assessment/placement-bank.v2.ts'
import {
  toPublicVocabularyAssessmentItemV2,
  validateVocabularyAssessmentBankV2,
} from './vocabulary-bank.ts'

describe('v2 vocabulary placement bank', () => {
  it('keeps v1 frozen while providing calibrated vocabulary-only coverage', () => {
    expect(placementBankV1.id).toBe('placement-en-us-v1')
    expect(placementBankV1.items).toHaveLength(60)
    expect(validateVocabularyAssessmentBankV2(vocabularyPlacementBankV2))
      .toBe(vocabularyPlacementBankV2)
    expect(vocabularyPlacementBankV2.items).toHaveLength(32)
    expect(
      vocabularyPlacementBankV2.items.every(
        (item) =>
          item.schemaVersion === 2 &&
          item.domain === 'vocabulary' &&
          item.kind === 'choice',
      ),
    ).toBe(true)
    expect(
      new Set(
        vocabularyPlacementBankV2.items.map(
          (item) => item.difficulty,
        ),
      ),
    ).toEqual(new Set(Array.from({ length: 13 }, (_, index) => index)))
  })

  it('publishes relative calibration without inventing a word-count mapping', () => {
    for (const item of vocabularyPlacementBankV2.items) {
      expect(item.calibration.status).toBe('expert-provisional')
      expect(item.calibration.wordCountCalibration).toBe('unavailable')
      expect(item.calibration.difficultyStandardError).toBeGreaterThan(0)
    }
  })

  it('removes answer keys before presentation', () => {
    const privateItem = vocabularyPlacementBankV2.items[0]
    if (!privateItem) {
      throw new Error('Expected a v2 vocabulary item')
    }
    const publicItem = toPublicVocabularyAssessmentItemV2(privateItem)

    expect(publicItem).not.toHaveProperty('scoring')
    expect(publicItem.calibration.wordCountCalibration).toBe('unavailable')
    expect(privateItem).toHaveProperty('scoring')
  })
})
