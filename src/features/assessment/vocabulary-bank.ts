import {
  INTERNAL_LEVEL_MAX,
  INTERNAL_LEVEL_MIN,
} from './levels.ts'
import type {
  PublicVocabularyAssessmentItemV2,
  VocabularyAssessmentBankV2,
  VocabularyAssessmentFormatV2,
  VocabularyAssessmentItemV2,
} from './vocabulary-types.ts'

function assertRange(
  value: number,
  minimum: number,
  maximum: number,
  field: string,
): void {
  if (
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(
      `${field} must be between ${minimum} and ${maximum}`,
    )
  }
}

function validateItem(item: VocabularyAssessmentItemV2): void {
  if (!/^[a-z][a-z0-9-]+$/.test(item.id)) {
    throw new TypeError(`Invalid vocabulary assessment item id: ${item.id}`)
  }
  if (
    item.schemaVersion !== 2 ||
    item.domain !== 'vocabulary' ||
    item.kind !== 'choice'
  ) {
    throw new TypeError(`Item ${item.id} is not a v2 vocabulary choice item`)
  }
  if (
    item.format !== 'word-meaning' &&
    item.format !== 'sentence-understanding'
  ) {
    throw new TypeError(`Item ${item.id} has an unsupported format`)
  }
  assertRange(
    item.difficulty,
    INTERNAL_LEVEL_MIN,
    INTERNAL_LEVEL_MAX,
    `${item.id}.difficulty`,
  )
  assertRange(
    item.discrimination,
    0.5,
    2,
    `${item.id}.discrimination`,
  )
  assertRange(
    item.expectedSeconds,
    30,
    90,
    `${item.id}.expectedSeconds`,
  )
  if (
    item.prompt.trim().length === 0 ||
    item.stimulus.text.trim().length === 0 ||
    item.tags.length === 0
  ) {
    throw new TypeError(`Item ${item.id} has incomplete presentation data`)
  }
  if (
    item.stimulus.audioText !== null ||
    item.stimulus.maxPlays !== 0
  ) {
    throw new TypeError(`Item ${item.id} must not require audio`)
  }
  if (item.options.length !== 4) {
    throw new TypeError(`Item ${item.id} must have four options`)
  }
  const optionIds = new Set(item.options.map((option) => option.id))
  if (
    optionIds.size !== 4 ||
    !optionIds.has(item.scoring.correctOptionId)
  ) {
    throw new TypeError(`Item ${item.id} has invalid answer options`)
  }
  if (
    item.calibration.scale !== 'internal-lexical-difficulty-v2' ||
    item.calibration.status !== 'expert-provisional' ||
    item.calibration.wordCountCalibration !== 'unavailable'
  ) {
    throw new TypeError(`Item ${item.id} has unsupported calibration metadata`)
  }
  assertRange(
    item.calibration.difficultyStandardError,
    0.5,
    3,
    `${item.id}.calibration.difficultyStandardError`,
  )
}

function countFormat(
  bank: VocabularyAssessmentBankV2,
  format: VocabularyAssessmentFormatV2,
): number {
  return bank.items.filter((item) => item.format === format).length
}

function validateAnswerDistribution(
  items: readonly VocabularyAssessmentItemV2[],
): void {
  const counts = [0, 0, 0, 0]
  for (const item of items) {
    const position = item.options.findIndex(
      (option) => option.id === item.scoring.correctOptionId,
    )
    counts[position] = (counts[position] ?? 0) + 1
  }
  for (const [position, count] of counts.entries()) {
    const share = count / items.length
    if (share < 0.15 || share > 0.35) {
      throw new TypeError(
        `Vocabulary bank answer position ${position + 1} is imbalanced`,
      )
    }
  }
}

export function validateVocabularyAssessmentBankV2(
  bank: VocabularyAssessmentBankV2,
): VocabularyAssessmentBankV2 {
  if (
    bank.id !== 'placement-vocabulary-en-us-v2' ||
    bank.schemaVersion !== 2 ||
    bank.assessmentKind !== 'adaptive-vocabulary' ||
    bank.locale !== 'en-US'
  ) {
    throw new TypeError('Unsupported v2 vocabulary assessment bank')
  }
  if (bank.items.length < 30) {
    throw new TypeError('Vocabulary assessment bank needs at least 30 items')
  }

  const ids = new Set<string>()
  for (const item of bank.items) {
    validateItem(item)
    if (ids.has(item.id)) {
      throw new TypeError(`Duplicate vocabulary item id: ${item.id}`)
    }
    ids.add(item.id)
  }
  for (let level = INTERNAL_LEVEL_MIN; level <= INTERNAL_LEVEL_MAX; level += 1) {
    if (!bank.items.some((item) => item.difficulty === level)) {
      throw new TypeError(`Vocabulary bank lacks level ${level} coverage`)
    }
  }
  if (
    countFormat(bank, 'word-meaning') < 12 ||
    countFormat(bank, 'sentence-understanding') < 12
  ) {
    throw new TypeError('Vocabulary bank lacks format coverage')
  }
  const lowBoundaryCount = bank.items.filter(
    (item) => item.difficulty <= 1,
  ).length
  const highBoundaryCount = bank.items.filter(
    (item) => item.difficulty >= 11,
  ).length
  if (lowBoundaryCount < 8 || highBoundaryCount < 6) {
    throw new TypeError('Vocabulary bank lacks boundary evidence')
  }

  validateAnswerDistribution(bank.items)
  return bank
}

export function toPublicVocabularyAssessmentItemV2(
  item: VocabularyAssessmentItemV2,
): PublicVocabularyAssessmentItemV2 {
  const publicItem = { ...item } as unknown as Record<string, unknown>
  Reflect.deleteProperty(publicItem, 'scoring')
  return publicItem as unknown as PublicVocabularyAssessmentItemV2
}
