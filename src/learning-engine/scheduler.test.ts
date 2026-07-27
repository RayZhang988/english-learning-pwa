import { describe, expect, it } from 'vitest'
import type {
  AbilityDomain,
  ReviewItemState,
} from './contracts.ts'
import { createInitialProgressState } from './progress.ts'
import { generateDailyPlan } from './scheduler.ts'
import {
  abilityEstimate,
  abilityProfile,
  learningCandidate,
} from './test-fixtures.ts'

const domains: readonly AbilityDomain[] = [
  'vocabulary',
  'listening',
  'speaking',
]

function candidatesPerDomain(count: number) {
  return domains.flatMap((domain) =>
    Array.from({ length: count }, (_, index) =>
      learningCandidate(domain, index + 1),
    ),
  )
}

describe('daily scheduler', () => {
  it('uses a safe calibration difficulty when an initial ability is unavailable', () => {
    const profile = abilityProfile({
      listening: abilityEstimate('listening', {
        status: 'unavailable',
      }),
    })
    const progress = createInitialProgressState(
      profile,
      '2026-07-01T00:00:00.000Z',
    )
    const plan = generateDailyPlan({
      planId: 'plan-new-user',
      generatedAt: '2026-07-02T00:00:00.000Z',
      localDate: '2026-07-02',
      availableSeconds: 900,
      progress,
      reviewItems: {},
      candidates: candidatesPerDomain(8),
    })

    expect(plan.allocations.listening.targetDifficulty).toBe(2)
    expect(
      plan.tasks
        .filter((task) => task.domain === 'listening')
        .every((task) => task.mode === 'calibration'),
    ).toBe(true)
  })

  it('assigns more time to a materially weaker domain without starving the others', () => {
    const progress = createInitialProgressState(
      abilityProfile(),
      '2026-07-01T00:00:00.000Z',
    )
    const skewed = {
      ...progress,
      domains: {
        vocabulary: {
          ...progress.domains.vocabulary,
          currentLevel: 9,
          recentPerformance: 0.9,
          retentionScore: 0.9,
          masteryScore: 0.9,
          confidence: 0.9,
        },
        listening: {
          ...progress.domains.listening,
          currentLevel: 1,
          recentPerformance: 0.4,
          retentionScore: 0.35,
          masteryScore: 0.35,
          confidence: 0.4,
        },
        speaking: {
          ...progress.domains.speaking,
          currentLevel: 8,
          recentPerformance: 0.85,
          retentionScore: 0.85,
          masteryScore: 0.85,
          confidence: 0.9,
        },
      },
    }
    const plan = generateDailyPlan({
      planId: 'plan-skewed',
      generatedAt: '2026-07-02T00:00:00.000Z',
      localDate: '2026-07-02',
      progress: skewed,
      reviewItems: {},
      candidates: candidatesPerDomain(20),
    })

    expect(plan.allocations.listening.weaknessWeight).toBeGreaterThan(
      plan.allocations.vocabulary.weaknessWeight,
    )
    expect(plan.allocations.listening.plannedSeconds).toBeGreaterThan(
      plan.allocations.vocabulary.plannedSeconds,
    )
    expect(plan.allocations.vocabulary.plannedSeconds).toBeGreaterThan(0)
    expect(plan.allocations.speaking.plannedSeconds).toBeGreaterThan(0)
  })

  it('puts overdue work first after missed days', () => {
    const progress = createInitialProgressState(
      abilityProfile(),
      '2026-07-01T00:00:00.000Z',
    )
    const overdue: ReviewItemState = {
      schemaVersion: 1,
      learningUnitId: 'overdue-1',
      contentRef: 'lesson://vocabulary/overdue',
      domain: 'vocabulary',
      difficultyLevel: 4,
      estimatedSeconds: 180,
      memoryDifficulty: 0.5,
      mastery: 0.6,
      stabilityDays: 2,
      successfulReviews: 2,
      lapseCount: 0,
      attemptCount: 2,
      lastAttemptAt: '2026-07-01T00:00:00.000Z',
      lastSuccessfulAt: '2026-07-01T00:00:00.000Z',
      nextReviewAt: '2026-07-03T00:00:00.000Z',
      retryAt: null,
      status: 'reviewing',
      tags: [],
    }
    const plan = generateDailyPlan({
      planId: 'plan-returning',
      generatedAt: '2026-07-15T00:00:00.000Z',
      localDate: '2026-07-15',
      availableSeconds: 900,
      progress,
      reviewItems: { 'overdue-1': overdue },
      candidates: candidatesPerDomain(8),
    })

    expect(plan.tasks[0].learningUnitId).toBe('overdue-1')
    expect(plan.tasks[0].mode).toBe('review')
    expect(plan.tasks[0].required).toBe(true)
  })

  it('honors a short day instead of pretending to schedule 45 minutes', () => {
    const progress = createInitialProgressState(
      abilityProfile(),
      '2026-07-01T00:00:00.000Z',
    )
    const plan = generateDailyPlan({
      planId: 'plan-short',
      generatedAt: '2026-07-02T00:00:00.000Z',
      localDate: '2026-07-02',
      availableSeconds: 600,
      progress,
      reviewItems: {},
      candidates: candidatesPerDomain(10),
    })

    expect(plan.targetSeconds).toBe(600)
    expect(plan.plannedSeconds).toBeLessThanOrEqual(690)
    expect(plan.warnings).toContain('short-day-budget')
    expect(new Set(plan.tasks.map((task) => task.learningUnitId)).size).toBe(
      plan.tasks.length,
    )
  })

  it('returns an empty partial result when no eligible content exists', () => {
    const progress = createInitialProgressState(
      abilityProfile(),
      '2026-07-01T00:00:00.000Z',
    )
    const plan = generateDailyPlan({
      planId: 'plan-empty',
      generatedAt: '2026-07-02T00:00:00.000Z',
      localDate: '2026-07-02',
      progress,
      reviewItems: {},
      candidates: [],
    })

    expect(plan.status).toBe('empty')
    expect(plan.tasks).toEqual([])
    expect(plan.unfilledSeconds).toBe(2700)
    expect(plan.warnings).toContain('insufficient-eligible-content')
  })

  it('uses content and personal estimates without rewriting tasks to fill the daily target', () => {
    const initial = createInitialProgressState(
      abilityProfile(),
      '2026-07-01T00:00:00.000Z',
    )
    const progress = {
      ...initial,
      durationSamples: [100, 120, 140].map(
        (effectiveSeconds, index) => ({
          sampleId: `duration-history-${index}`,
          taskId: `history-task-${index}`,
          learningUnitId: `history-unit-${index}`,
          domain: 'vocabulary' as const,
          mode: 'learn' as const,
          contentType: 'multiple-choice-set',
          profileKey:
            'vocabulary|learn|multiple-choice-set',
          effectiveSeconds,
          source: 'timing-segments' as const,
          reliable: true,
          completedAt: `2026-07-0${index + 2}T00:00:00.000Z`,
        }),
      ),
    }

    const plan = generateDailyPlan({
      planId: 'plan-r3-duration',
      generatedAt: '2026-07-06T00:00:00.000Z',
      localDate: '2026-07-06',
      availableSeconds: 600,
      progress,
      reviewItems: {},
      candidates: [
        learningCandidate('vocabulary', 99, {
          estimatedSeconds: 900,
          tags: ['content-type:multiple-choice-set'],
          durationBaseline: {
            schemaVersion: 1,
            contentType: 'multiple-choice-set',
            fixedSeconds: 30,
            itemCount: 5,
            secondsPerItem: 20,
            activeAudioSeconds: 60,
            expectedAudioPlaythroughs: 1,
            interactionStepCount: 5,
            secondsPerInteractionStep: 4,
            minimumSeconds: 120,
            maximumSeconds: 600,
          },
        }),
      ],
    })

    expect(plan.targetSeconds).toBe(600)
    expect(plan.tasks[0]).toMatchObject({
      estimatedSeconds: 120,
      durationEstimate: {
        estimateSeconds: 120,
        sampleCount: 3,
        basis: 'personal-history',
      },
    })
    expect(plan.plannedSeconds).toBe(120)
    expect(plan.unfilledSeconds).toBe(480)
  })
})
