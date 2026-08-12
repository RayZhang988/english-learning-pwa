import { describe, expect, it } from 'vitest'
import {
  classifyTimingSegment,
  createInitialProgressState,
  createPlanProgress,
  estimateTaskDuration,
  generateDailyPlan,
  getDurationProfileKey,
  type LearningTimingSegmentRecordedPayload,
  type ProgressState,
  type TaskDurationBaseline,
  type TaskDurationSample,
} from '../../src/learning-engine/index.ts'
import { projectLearningCandidates } from '../../src/app/learning/course-candidate-source.ts'
import {
  toDailyEffectiveDurationSummaryViewModel,
  toTaskDurationEstimateViewModel,
} from '../../src/app/learning/view-model.ts'
import { abilityProfileR1 } from '../../src/learning-engine/test-fixtures.ts'
import { releasedCourseDocuments } from './fixtures/production-course.ts'

const MODULES = [
  'vocabulary',
  'listening',
  'speaking',
] as const

function productionCandidates() {
  return projectLearningCandidates(
    releasedCourseDocuments,
    new Set(),
    new Set(MODULES),
  )
}

function productionFirstDayPlan() {
  const generatedAt = '2026-07-28T00:00:00.000Z'
  const progress = createInitialProgressState(
    abilityProfileR1(),
    generatedAt,
  )
  return generateDailyPlan({
    planId: 'qa-r3-production-first-day',
    generatedAt,
    localDate: '2026-07-28',
    availableSeconds: 2_700,
    progress,
    reviewItems: {},
    candidates: productionCandidates(),
  })
}

function durationBaseline(): TaskDurationBaseline {
  return {
    schemaVersion: 1,
    contentType: 'qa-guided-practice',
    fixedSeconds: 20,
    itemCount: 4,
    secondsPerItem: 25,
    activeAudioSeconds: 40,
    expectedAudioPlaythroughs: 1.5,
    interactionStepCount: 3,
    secondsPerInteractionStep: 10,
    minimumSeconds: 90,
    maximumSeconds: 360,
  }
}

function progressWithSamples(
  durations: readonly number[],
): ProgressState {
  const base = createInitialProgressState(
    abilityProfileR1(),
    '2026-07-28T00:00:00.000Z',
  )
  const profileKey = getDurationProfileKey(
    'vocabulary',
    'learn',
    'qa-guided-practice',
  )
  const samples: readonly TaskDurationSample[] = durations.map(
    (effectiveSeconds, index) => ({
      sampleId: `qa-r3-sample-${index + 1}`,
      taskId: `qa-r3-task-${index + 1}`,
      learningUnitId: `qa-r3-unit-${index + 1}`,
      domain: 'vocabulary',
      mode: 'learn',
      contentType: 'qa-guided-practice',
      profileKey,
      effectiveSeconds,
      source: 'timing-segments',
      reliable: true,
      completedAt: new Date(
        Date.parse('2026-07-28T00:00:00.000Z') +
          index * 60_000,
      ).toISOString(),
    }),
  )
  return {
    ...base,
    durationSamples: samples,
  }
}

function estimate(progress: ProgressState) {
  return estimateTaskDuration({
    domain: 'vocabulary',
    mode: 'learn',
    tags: ['qa-r3'],
    legacyEstimatedSeconds: 900,
    durationBaseline: durationBaseline(),
    progress,
  })
}

function timingPayload(
  phase: LearningTimingSegmentRecordedPayload['phase'],
  reason: LearningTimingSegmentRecordedPayload['reason'],
  visibility: LearningTimingSegmentRecordedPayload['visibility'],
  elapsedSeconds: number,
): LearningTimingSegmentRecordedPayload {
  return {
    planId: 'qa-r3-plan',
    taskId: 'qa-r3-task',
    learningUnitId: 'qa-r3-unit',
    contentRef: 'lesson://qa-r3/unit',
    domain: 'vocabulary',
    targetModuleId: 'vocabulary',
    localDate: '2026-07-28',
    mode: 'learn',
    phase,
    reason,
    visibility,
    startedAt: '2026-07-28T00:00:00.000Z',
    endedAt: new Date(
      Date.parse('2026-07-28T00:00:00.000Z') +
        elapsedSeconds * 1_000,
    ).toISOString(),
    elapsedSeconds,
    idleThresholdSeconds: 45,
  }
}

describe('R3 truthful training duration acceptance', () => {
  it('projects released course facts into non-uniform structured duration baselines', () => {
    const candidates = productionCandidates()
    const firstByModule = MODULES.map((moduleId) => {
      const candidate = candidates.find(
        (entry) => entry.domain === moduleId,
      )
      expect(candidate).toBeDefined()
      return candidate
    })

    expect(
      firstByModule.every(
        (candidate) => candidate?.durationBaseline !== undefined,
      ),
    ).toBe(true)

    const plan = productionFirstDayPlan()
    expect(plan.tasks).toHaveLength(3)
    expect(plan.targetSeconds).toBe(2_700)
    expect(plan.plannedSeconds).toBe(
      plan.tasks.reduce(
        (total, task) => total + task.estimatedSeconds,
        0,
      ),
    )
    expect(plan.plannedSeconds).toBe(1033)
    expect(
      Object.fromEntries(
        plan.tasks.map((task) => [
          task.targetModuleId,
          task.durationEstimate?.estimateSeconds,
        ]),
      ),
    ).toEqual({
      vocabulary: 600,
      listening: 252,
      speaking: 181,
    })
    expect(
      plan.tasks.every(
        (task) =>
          task.durationEstimate?.baselineSource ===
            'structured-content' &&
          task.estimatedSeconds ===
            task.durationEstimate.estimateSeconds,
      ),
    ).toBe(true)
    expect(
      new Set(
        plan.tasks.map(
          (task) => task.durationEstimate?.estimateSeconds,
        ),
      ).size,
    ).toBeGreaterThan(1)
    expect(
      plan.tasks.every(
        (task) => task.durationEstimate?.estimateSeconds !== 900,
      ),
    ).toBe(true)
  })

  it('keeps 1–2 trusted samples on content baseline and switches on the third', () => {
    expect(estimate(progressWithSamples([150]))).toMatchObject({
      basis: 'content-baseline',
      sampleCount: 1,
      estimateSeconds: 210,
    })
    expect(estimate(progressWithSamples([150, 180]))).toMatchObject({
      basis: 'content-baseline',
      sampleCount: 2,
      estimateSeconds: 210,
    })
    const personalized = estimate(
      progressWithSamples([150, 180, 240]),
    )
    expect(personalized).toMatchObject({
      basis: 'personal-history',
      sampleCount: 3,
      estimateSeconds: 180,
    })
    expect(
      Math.abs(personalized.estimateSeconds - 180) / 180,
    ).toBeLessThanOrEqual(0.25)
  })

  it('uses only the latest nine trusted samples and a robust median', () => {
    const personalized = estimate(
      progressWithSamples([
        20, 1_000, 150, 160, 170, 180, 190, 200, 210, 220, 230,
      ]),
    )
    expect(personalized).toMatchObject({
      basis: 'personal-history',
      estimateSeconds: 190,
      sampleCount: 9,
    })
  })

  it('includes active phases and excludes background, pause and waits', () => {
    expect(
      classifyTimingSegment(
        timingPayload(
          'answering',
          'active-answering',
          'foreground',
          30,
        ),
      ),
    ).toEqual({
      included: true,
      effectiveSeconds: 30,
      excludedSeconds: 0,
    })
    for (const [phase, reason] of [
      ['paused', 'user-paused'],
      ['loading', 'content-loading'],
      ['loading', 'media-loading'],
      ['permission-wait', 'permission-wait'],
      ['network-wait', 'network-wait'],
    ] as const) {
      expect(
        classifyTimingSegment(
          timingPayload(phase, reason, 'foreground', 30),
        ),
      ).toEqual({
        included: false,
        effectiveSeconds: 0,
        excludedSeconds: 30,
      })
    }
    expect(
      classifyTimingSegment(
        timingPayload(
          'answering',
          'app-backgrounded',
          'background',
          30,
        ),
      ),
    ).toEqual({
      included: false,
      effectiveSeconds: 0,
      excludedSeconds: 30,
    })
  })

  it('does not use daily target seconds as a task duration label', () => {
    const plan = productionFirstDayPlan()
    for (const task of plan.tasks) {
      const viewModel = toTaskDurationEstimateViewModel(task)
      expect(viewModel.estimateSeconds).toBe(
        task.durationEstimate?.estimateSeconds ??
          task.estimatedSeconds,
      )
      expect(viewModel.estimateSeconds).not.toBe(plan.targetSeconds)
    }
  })

  it('keeps missing and legacy module durations unavailable in a partial daily total', () => {
    const plan = productionFirstDayPlan()
    const progress = createPlanProgress(
      plan,
      '2026-07-28T00:00:00.000Z',
    )
    const timed = {
      ...progress,
      tasks: progress.tasks.map((execution) =>
        execution.task.targetModuleId === 'vocabulary'
          ? {
              ...execution,
              effectiveSeconds: 120,
              spentSeconds: 150,
              excludedSeconds: 30,
              timingSegmentCount: 2,
              effectiveTimeSource: 'timing-segments' as const,
            }
          : execution.task.targetModuleId === 'listening'
            ? {
                ...execution,
                effectiveSeconds: 600,
                spentSeconds: 600,
                effectiveTimeSource:
                  'legacy-event-duration' as const,
              }
            : execution,
      ),
    }

    expect(
      toDailyEffectiveDurationSummaryViewModel(timed),
    ).toMatchObject({
      items: [
        {
          moduleId: 'vocabulary',
          duration: {
            state: 'reliable',
            effectiveSeconds: 120,
            source: 'timing-segments',
          },
        },
        {
          moduleId: 'listening',
          duration: {
            state: 'unavailable',
            reason: 'legacy-event-duration',
          },
        },
        {
          moduleId: 'speaking',
          duration: {
            state: 'unavailable',
            reason: 'missing-timing-segments',
          },
        },
      ],
      total: {
        coverage: 'partial',
        effectiveSeconds: 120,
        source: 'timing-segments',
      },
    })
  })
})
