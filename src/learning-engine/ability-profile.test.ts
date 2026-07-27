import { describe, expect, it } from 'vitest'
import {
  normalizeLearningAbilityProfile,
  R1_FIRST_DAY_START_MAPPING_VERSION,
  SAFE_PENDING_CALIBRATION_LEVEL,
} from './ability-profile.ts'
import { createLearningEngineState } from './engine.ts'
import { generateDailyPlan } from './scheduler.ts'
import {
  abilityEstimate,
  abilityProfile,
  abilityProfileR1,
  abilityProfileV2,
  learningCandidate,
} from './test-fixtures.ts'

describe('learning ability profile compatibility', () => {
  it('preserves v1 starting levels and legacy calibration behavior', () => {
    const profile = abilityProfile({
      vocabulary: abilityEstimate('vocabulary', { level: 7 }),
      listening: abilityEstimate('listening', {
        status: 'unavailable',
      }),
    })
    const state = createLearningEngineState(
      profile,
      '2026-07-02T00:00:00.000Z',
    )

    expect(state.progress.domains.vocabulary.baselineLevel).toBe(7)
    expect(state.progress.domains.listening.baselineLevel).toBe(
      SAFE_PENDING_CALIBRATION_LEVEL,
    )
    expect(
      state.progress.domains.listening.pendingCalibrationPolicy,
    ).toBeUndefined()
    expect(state.progress.r1VocabularyStartPlacement).toBeUndefined()
  })

  it('accepts v2 without treating pending dimensions as measured', () => {
    const state = createLearningEngineState(
      abilityProfileV2(6.5),
      '2026-07-02T00:00:00.000Z',
    )

    expect(state.progress.domains.vocabulary.baselineLevel).toBe(6.5)
    expect(state.progress.domains.listening).toMatchObject({
      assessmentStatus: 'unavailable',
      baselineLevel: SAFE_PENDING_CALIBRATION_LEVEL,
      confidence: 0,
      pendingCalibrationPolicy: 'normal-training',
    })
    expect(state.progress.domains.speaking).toMatchObject({
      assessmentStatus: 'unavailable',
      baselineLevel: SAFE_PENDING_CALIBRATION_LEVEL,
      confidence: 0,
      pendingCalibrationPolicy: 'normal-training',
    })
  })

  it.each([
    {
      label: 'lower boundary',
      profile: abilityProfileR1({
        id: 'kindergarten',
        ordinal: 0,
        estimatedWords: 100,
        lower: 0,
        upper: 250,
      }),
      expected: 0,
    },
    {
      label: 'low',
      profile: abilityProfileR1({
        id: 'primary-4',
        ordinal: 4,
        estimatedWords: 650,
        lower: 500,
        upper: 800,
      }),
      expected: 1.5,
    },
    {
      label: 'middle',
      profile: abilityProfileR1(),
      expected: 4.5,
    },
    {
      label: 'high',
      profile: abilityProfileR1({
        id: 'cet-6-reference',
        ordinal: 14,
        estimatedWords: 3_000,
        lower: 2_700,
        upper: 3_150,
      }),
      expected: 10,
    },
    {
      label: 'upper boundary',
      profile: abilityProfileR1({
        id: 'cet-6-reference',
        ordinal: 14,
        estimatedWords: 3_200,
        lower: 3_200,
        upper: 3_200,
      }),
      expected: 10.5,
    },
  ])(
    'maps a schema 3 $label result to a conservative start',
    ({ profile, expected }) => {
      const progress = createLearningEngineState(
        profile,
        '2026-07-02T00:00:00.000Z',
      ).progress

      expect(progress.domains.vocabulary.baselineLevel).toBe(expected)
      expect(progress.domains.vocabulary.currentLevel).toBe(expected)
      expect(progress.r1VocabularyStartPlacement).toMatchObject({
        mappingVersion: R1_FIRST_DAY_START_MAPPING_VERSION,
        resultLevelId: profile.resultLevel.id,
        resultLevelOrdinal: profile.resultLevel.ordinal,
        resultLevelMinimumEstimatedWords:
          profile.resultLevel.minimumEstimatedWords,
        estimatedWords: profile.travelVocabulary.estimatedWords,
        reasonableInterval:
          profile.travelVocabulary.reasonableInterval,
        selectedStartLevel: expected,
      })
    },
  )

  it('lets the interval lower bound reduce the same point estimate', () => {
    const cautious = createLearningEngineState(
      abilityProfileR1({
        lower: 1_000,
        upper: 1_800,
      }),
      '2026-07-02T00:00:00.000Z',
    ).progress
    const narrower = createLearningEngineState(
      abilityProfileR1({
        lower: 1_500,
        upper: 1_800,
      }),
      '2026-07-02T00:00:00.000Z',
    ).progress

    expect(cautious.domains.vocabulary.baselineLevel).toBe(3.5)
    expect(narrower.domains.vocabulary.baselineLevel).toBe(5.5)
  })

  it('uses safe normal training for R1 pending dimensions without calibration tasks', () => {
    const progress = createLearningEngineState(
      abilityProfileR1(),
      '2026-07-02T00:00:00.000Z',
    ).progress
    const plan = generateDailyPlan({
      planId: 'plan-r1-pending',
      generatedAt: '2026-07-02T00:00:00.000Z',
      localDate: '2026-07-02',
      availableSeconds: 900,
      progress,
      reviewItems: {},
      candidates: [
        ...Array.from({ length: 5 }, (_, index) =>
          learningCandidate('listening', index + 1),
        ),
        ...Array.from({ length: 5 }, (_, index) =>
          learningCandidate('speaking', index + 1),
        ),
      ],
    })

    expect(progress.domains.listening).toMatchObject({
      assessmentStatus: 'unavailable',
      baselineLevel: SAFE_PENDING_CALIBRATION_LEVEL,
      pendingCalibrationPolicy: 'normal-training',
    })
    expect(progress.domains.speaking).toMatchObject({
      assessmentStatus: 'unavailable',
      baselineLevel: SAFE_PENDING_CALIBRATION_LEVEL,
      pendingCalibrationPolicy: 'normal-training',
    })
    expect(plan.tasks.length).toBeGreaterThan(0)
    expect(plan.tasks.every((task) => task.mode === 'learn')).toBe(true)
  })

  it.each([
    {
      label: 'future schema',
      profile: { schemaVersion: 4 },
      message: 'Unsupported AbilityProfile schemaVersion',
    },
    {
      label: 'wrong R1 kind',
      profile: {
        ...abilityProfileR1(),
        assessmentKind: 'adaptive-vocabulary',
      },
      message: 'AbilityProfileR1 contract is incompatible',
    },
    {
      label: 'unknown v2 calibration state',
      profile: {
        ...abilityProfileV2(),
        abilities: {
          ...abilityProfileV2().abilities,
          listening: {
            ...abilityProfileV2().abilities.listening,
            calibrationState: 'future-calibration',
          },
        },
      },
      message: 'abilities.listening.calibrationState is invalid',
    },
    {
      label: 'inconsistent result ordinal',
      profile: abilityProfileR1({ ordinal: 8 }),
      message: 'resultLevel is incompatible with R1 mapping',
    },
    {
      label: 'interval excludes point estimate',
      profile: abilityProfileR1({ lower: 1_700 }),
      message:
        'travelVocabulary reasonable interval must contain estimatedWords',
    },
    {
      label: 'forged measured listening result',
      profile: {
        ...abilityProfileR1(),
        abilities: {
          ...abilityProfileR1().abilities,
          listening: {
            ...abilityProfileR1().abilities.listening,
            status: 'estimated',
            calibrationState: 'estimated',
            internalLevel: 8,
            confidence: 0.9,
            boundary: 'within-range',
          },
        },
      },
      message: 'abilities.listening must remain pending calibration',
    },
  ])('rejects an invalid $label profile', ({ profile, message }) => {
    expect(() => normalizeLearningAbilityProfile(profile)).toThrow(
      message,
    )
  })
})
