import type { ChoiceOption } from '../../src/features/assessment/types.ts'
import type {
  VocabularyAssessmentBankV2,
  VocabularyAssessmentFormatV2,
  VocabularyAssessmentItemV2,
  VocabularyFrequencyTierV2,
} from '../../src/features/assessment/vocabulary-types.ts'
import { placementBankV1 } from './placement-bank.v1.ts'

const optionIds = ['a', 'b', 'c', 'd'] as const

function options(values: readonly string[]): readonly ChoiceOption[] {
  return values.map((text, index) => ({
    id: optionIds[index] ?? String(index),
    text,
  }))
}

function frequencyTier(
  difficulty: number,
): VocabularyFrequencyTierV2 {
  if (difficulty <= 1) {
    return 'foundation'
  }
  if (difficulty <= 4) {
    return 'high-frequency'
  }
  if (difficulty <= 7) {
    return 'mid-frequency'
  }
  if (difficulty <= 10) {
    return 'low-frequency'
  }
  return 'advanced'
}

function calibration(difficulty: number) {
  return {
    scale: 'internal-lexical-difficulty-v2',
    status: 'expert-provisional',
    frequencyTier: frequencyTier(difficulty),
    difficultyStandardError:
      difficulty <= 2 ? 1.1 : difficulty >= 11 ? 1.5 : 1.25,
    wordCountCalibration: 'unavailable',
  } as const
}

function item(input: {
  readonly id: string
  readonly format: VocabularyAssessmentFormatV2
  readonly difficulty: number
  readonly prompt: string
  readonly text: string
  readonly choices: readonly string[]
  readonly answer: 0 | 1 | 2 | 3
}): VocabularyAssessmentItemV2 {
  return {
    id: input.id,
    schemaVersion: 2,
    domain: 'vocabulary',
    kind: 'choice',
    format: input.format,
    difficulty: input.difficulty,
    discrimination: 1,
    expectedSeconds:
      input.format === 'word-meaning' ? 55 : 65,
    prompt: input.prompt,
    tags: [
      'adaptive-vocabulary-v2',
      input.format,
      `level-${input.difficulty}`,
      frequencyTier(input.difficulty),
    ],
    stimulus: {
      text: input.text,
      audioText: null,
      maxPlays: 0,
    },
    options: options(input.choices),
    scoring: {
      correctOptionId: optionIds[input.answer],
    },
    calibration: calibration(input.difficulty),
  }
}

const retainedVocabularyItems = placementBankV1.items.flatMap(
  (legacyItem): readonly VocabularyAssessmentItemV2[] => {
    if (
      legacyItem.domain !== 'vocabulary' ||
      legacyItem.kind !== 'choice' ||
      (legacyItem.format !== 'word-meaning' &&
        legacyItem.format !== 'sentence-understanding') ||
      legacyItem.stimulus.text === null
    ) {
      return []
    }

    return [
      {
        ...legacyItem,
        schemaVersion: 2,
        domain: 'vocabulary',
        kind: 'choice',
        format: legacyItem.format,
        expectedSeconds:
          legacyItem.format === 'word-meaning' ? 55 : 65,
        tags: [
          'adaptive-vocabulary-v2',
          ...legacyItem.tags,
          frequencyTier(legacyItem.difficulty),
        ],
        stimulus: {
          text: legacyItem.stimulus.text,
          audioText: null,
          maxPlays: 0,
        },
        calibration: calibration(legacyItem.difficulty),
      },
    ]
  },
)

const boundaryItems = [
  item({
    id: 'vocab-v2-foundation-yes',
    format: 'word-meaning',
    difficulty: 0,
    prompt: 'Choose the closest meaning.',
    text: 'yes',
    choices: ['an affirmative answer', 'a question', 'a place', 'a number'],
    answer: 0,
  }),
  item({
    id: 'vocab-v2-foundation-water',
    format: 'word-meaning',
    difficulty: 0,
    prompt: 'Choose the closest meaning.',
    text: 'water',
    choices: ['a kind of road', 'a drink', 'a time of day', 'a family member'],
    answer: 1,
  }),
  item({
    id: 'vocab-v2-foundation-sit',
    format: 'sentence-understanding',
    difficulty: 0,
    prompt: 'What does the sentence ask you to do?',
    text: 'Sit here.',
    choices: ['Leave now.', 'Speak loudly.', 'Take a seat here.', 'Open it.'],
    answer: 2,
  }),
  item({
    id: 'vocab-v2-foundation-cold',
    format: 'sentence-understanding',
    difficulty: 0,
    prompt: 'Choose the closest meaning.',
    text: 'I am cold.',
    choices: [
      'I need more warmth.',
      'I am very busy.',
      'I want some food.',
      'I am arriving late.',
    ],
    answer: 0,
  }),
  item({
    id: 'vocab-v2-basic-help',
    format: 'word-meaning',
    difficulty: 1,
    prompt: 'Choose the closest meaning.',
    text: 'help',
    choices: [
      'to hide something',
      'to make something easier for someone',
      'to wait outside',
      'to buy something',
    ],
    answer: 1,
  }),
  item({
    id: 'vocab-v2-basic-before',
    format: 'sentence-understanding',
    difficulty: 1,
    prompt: 'Which thing happens first?',
    text: 'Wash your hands before dinner.',
    choices: [
      'Dinner and washing happen together.',
      'Dinner happens first.',
      'Washing happens first.',
      'There is no dinner.',
    ],
    answer: 2,
  }),
  item({
    id: 'vocab-v2-advanced-circumspect',
    format: 'word-meaning',
    difficulty: 11,
    prompt: 'Choose the closest meaning.',
    text: 'circumspect',
    choices: [
      'easily amused',
      'careful to consider possible risks',
      'unwilling to speak',
      'impossible to measure',
    ],
    answer: 1,
  }),
  item({
    id: 'vocab-v2-advanced-notwithstanding',
    format: 'sentence-understanding',
    difficulty: 12,
    prompt: 'Choose the closest interpretation.',
    text: 'Notwithstanding the apparent consensus, several objections remain unresolved.',
    choices: [
      'All objections disappeared after agreement.',
      'There was never any apparent agreement.',
      'Some objections remain despite seeming agreement.',
      'The objections created complete agreement.',
    ],
    answer: 2,
  }),
] as const

export const vocabularyPlacementBankV2 = {
  id: 'placement-vocabulary-en-us-v2',
  schemaVersion: 2,
  assessmentKind: 'adaptive-vocabulary',
  locale: 'en-US',
  items: [...retainedVocabularyItems, ...boundaryItems],
} as const satisfies VocabularyAssessmentBankV2
