import { describe, expect, it } from 'vitest'
import type {
  AbilityDomain,
  LearningAttemptCompletedEvent,
  LearningTask,
  LearningTimingSegmentRecordedEvent,
  ProgressState,
  TaskDurationBaseline,
  TaskDurationSample,
} from './contracts.ts'
import {
  MAX_INTERACTION_IDLE_SECONDS,
} from './contracts.ts'
import {
  applyLearningAttempt,
  createLearningEngineState,
} from './engine.ts'
import { parseLearningEvent } from './events.ts'
import {
  applyPlanEvent,
  createPlanProgress,
  summarizePlanActivity,
} from './lifecycle.ts'
import { generateDailyPlan } from './scheduler.ts'
import {
  calculateContentBaselineSeconds,
  estimateTaskDuration,
  getDurationProfileKey,
  recordTaskDurationSample,
} from './timing.ts'
import {
  abilityProfile,
  attemptEvent,
  learningCandidate,
} from './test-fixtures.ts'

function durationBaseline(
  input: Partial<TaskDurationBaseline> = {},
): TaskDurationBaseline {
  return {
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
    ...input,
  }
}

function progressWithTrustedDurations(
  durations: readonly number[],
  input: {
    readonly domain?: AbilityDomain
    readonly mode?: 'learn' | 'review'
    readonly contentType?: string
  } = {},
): ProgressState {
  const domain = input.domain ?? 'vocabulary'
  const mode = input.mode ?? 'learn'
  const contentType = input.contentType ?? 'multiple-choice-set'
  const progress = createLearningEngineState(
    abilityProfile(),
    '2026-07-01T00:00:00.000Z',
  ).progress
  const profileKey = getDurationProfileKey(domain, mode, contentType)
  const durationSamples: readonly TaskDurationSample[] = durations.map(
    (effectiveSeconds, index) => ({
      sampleId: `${domain}-${mode}-duration-${index}`,
      taskId: `${domain}-${mode}-task-${index}`,
      learningUnitId: `${domain}-${mode}-unit-${index}`,
      domain,
      mode,
      contentType,
      profileKey,
      effectiveSeconds,
      source: 'timing-segments',
      reliable: true,
      completedAt: `2026-07-${String(index + 2).padStart(2, '0')}T00:00:00.000Z`,
    }),
  )
  return {
    ...progress,
    durationSamples,
  }
}

function progressWithLegacyAttempts(
  durations: readonly number[],
  input: {
    readonly domain?: AbilityDomain
    readonly mode?: 'learn' | 'review'
    readonly contentType?: string
  } = {},
): ProgressState {
  const domain = input.domain ?? 'vocabulary'
  const mode = input.mode ?? 'learn'
  const contentType = input.contentType ?? 'multiple-choice-set'
  let state = createLearningEngineState(
    abilityProfile(),
    '2026-07-01T00:00:00.000Z',
  )
  durations.forEach((durationSeconds, index) => {
    state = applyLearningAttempt(
      state,
      attemptEvent({
        id: `${domain}-${mode}-duration-${index}`,
        taskId: `${domain}-${mode}-task-${index}`,
        learningUnitId: `${domain}-${mode}-unit-${index}`,
        contentRef: `lesson://${domain}/${mode}/${index}`,
        domain,
        targetModuleId: domain,
        mode,
        durationSeconds,
        contentTags: [`content-type:${contentType}`],
        occurredAt: `2026-07-${String(index + 2).padStart(2, '0')}T00:00:00.000Z`,
        localDate: `2026-07-${String(index + 2).padStart(2, '0')}`,
      }),
    ).state
  })
  return state.progress
}

function estimate(
  progress: ProgressState,
  input: {
    readonly domain?: AbilityDomain
    readonly mode?: 'learn' | 'review'
    readonly contentType?: string
  } = {},
) {
  const domain = input.domain ?? 'vocabulary'
  const mode = input.mode ?? 'learn'
  const contentType = input.contentType ?? 'multiple-choice-set'
  return estimateTaskDuration({
    domain,
    mode,
    tags: [`content-type:${contentType}`],
    legacyEstimatedSeconds: 900,
    durationBaseline: durationBaseline({ contentType }),
    progress,
  })
}

function timingEvent(
  task: LearningTask,
  input: {
    readonly id: string
    readonly startedAt: string
    readonly endedAt: string
    readonly elapsedSeconds: number
    readonly phase?: LearningTimingSegmentRecordedEvent['payload']['phase']
    readonly reason?: LearningTimingSegmentRecordedEvent['payload']['reason']
    readonly visibility?: LearningTimingSegmentRecordedEvent['payload']['visibility']
    readonly idleThresholdSeconds?: number
  },
): LearningTimingSegmentRecordedEvent {
  return {
    id: input.id,
    type: 'learning.timing.segment.recorded.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: input.endedAt,
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-02',
      mode: task.mode,
      phase: input.phase ?? 'answering',
      reason: input.reason ?? 'active-answering',
      visibility: input.visibility ?? 'foreground',
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      elapsedSeconds: input.elapsedSeconds,
      idleThresholdSeconds:
        (input.idleThresholdSeconds ??
          MAX_INTERACTION_IDLE_SECONDS) as 45,
    },
  }
}

function completionEvent(
  task: LearningTask,
  input: {
    readonly id?: string
    readonly unscorable?: boolean
  } = {},
): LearningAttemptCompletedEvent {
  const unscorable = input.unscorable ?? false
  return {
    id: input.id ?? `${task.taskId}:completed`,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: '2026-07-02T00:10:00.000Z',
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-02',
      mode: task.mode,
      difficultyLevel: task.difficultyLevel,
      estimatedSeconds: task.estimatedSeconds,
      result: unscorable ? 'unscorable' : 'scored',
      performanceScore: unscorable ? null : 0.8,
      evidenceQuality: unscorable ? 0 : 1,
      assistanceLevel: 0,
      durationSeconds: 400,
      taskCompleted: !unscorable,
      errorTags: [],
      contentTags: task.tags,
      failureCategory: unscorable ? 'network' : null,
    },
  }
}

function singleTask(
  domain: AbilityDomain = 'vocabulary',
): {
  readonly state: ReturnType<typeof createLearningEngineState>
  readonly task: LearningTask
  readonly progress: ReturnType<typeof createPlanProgress>
} {
  const state = createLearningEngineState(
    abilityProfile(),
    '2026-07-01T00:00:00.000Z',
  )
  const plan = generateDailyPlan({
    planId: `timing-plan-${domain}`,
    generatedAt: '2026-07-02T00:00:00.000Z',
    localDate: '2026-07-02',
    availableSeconds: 600,
    progress: state.progress,
    reviewItems: {},
    candidates: [
      learningCandidate(domain, 1, {
        durationBaseline: durationBaseline({
          contentType: `${domain}-practice`,
        }),
        tags: [`content-type:${domain}-practice`],
      }),
    ],
  })
  return {
    state,
    task: plan.tasks[0],
    progress: createPlanProgress(plan, plan.generatedAt),
  }
}

describe('R3 task duration estimate', () => {
  it('calculates a structured content baseline instead of copying the daily allocation', () => {
    expect(calculateContentBaselineSeconds(durationBaseline())).toBe(210)
    const result = estimate(progressWithTrustedDurations([]))

    expect(result).toMatchObject({
      estimateSeconds: 210,
      sampleCount: 0,
      basis: 'content-baseline',
      confidence: 'medium',
      baselineSource: 'structured-content',
      reasonableRangeSeconds: { lower: 120, upper: 600 },
    })
  })

  it.each([
    { durations: [100], count: 1 },
    { durations: [100, 120], count: 2 },
  ])(
    'does not claim personalization from $count history samples',
    ({ durations, count }) => {
      expect(
        estimate(progressWithTrustedDurations(durations)),
      ).toMatchObject({
        estimateSeconds: 210,
        sampleCount: count,
        basis: 'content-baseline',
      })
    },
  )

  it.each([3, 9, 12])(
    'does not personalize from %i legacy scored attempts',
    (attemptCount) => {
      const legacy = progressWithLegacyAttempts(
        Array.from(
          { length: attemptCount },
          (_, index) => 100 + index * 5,
        ),
      )

      expect(estimate(legacy)).toMatchObject({
        estimateSeconds: 210,
        sampleCount: 0,
        basis: 'content-baseline',
      })
    },
  )

  it('requires the third trusted timing sample even when legacy attempts exist', () => {
    const legacy = progressWithLegacyAttempts(
      Array.from({ length: 9 }, (_, index) => 80 + index * 5),
    )
    const twoTrusted = progressWithTrustedDurations([100, 120])
      .durationSamples as readonly TaskDurationSample[]
    const mixedTwo: ProgressState = {
      ...legacy,
      durationSamples: twoTrusted,
    }
    expect(estimate(mixedTwo)).toMatchObject({
      estimateSeconds: 210,
      sampleCount: 2,
      basis: 'content-baseline',
    })

    const threeTrusted = progressWithTrustedDurations([100, 120, 140])
      .durationSamples as readonly TaskDurationSample[]
    const mixedThree: ProgressState = {
      ...legacy,
      durationSamples: threeTrusted,
    }
    expect(estimate(mixedThree)).toMatchObject({
      estimateSeconds: 120,
      sampleCount: 3,
      basis: 'personal-history',
    })
  })

  it('does not double count a scored attempt and trusted timing sample with the same id', () => {
    const legacy = progressWithLegacyAttempts([400, 500, 600])
    const trusted = progressWithTrustedDurations([100, 120, 140])
      .durationSamples as readonly TaskDurationSample[]
    const mixed: ProgressState = {
      ...legacy,
      durationSamples: trusted,
    }

    expect(estimate(mixed)).toMatchObject({
      estimateSeconds: 120,
      sampleCount: 3,
      basis: 'personal-history',
    })
  })

  it('uses the exact odd and even recent medians from three samples onward', () => {
    const odd = estimate(
      progressWithTrustedDurations([100, 120, 140]),
    )
    const even = estimate(
      progressWithTrustedDurations([100, 120, 140, 160]),
    )

    expect(odd).toMatchObject({
      estimateSeconds: 120,
      sampleCount: 3,
      basis: 'personal-history',
      confidence: 'medium',
    })
    expect(even).toMatchObject({
      estimateSeconds: 130,
      sampleCount: 4,
      basis: 'personal-history',
    })
    expect(
      Math.abs(odd.estimateSeconds - 120) / 120,
    ).toBeLessThanOrEqual(0.25)
  })

  it('removes an extreme outlier without letting it distort the median', () => {
    const result = estimate(
      progressWithTrustedDurations([100, 110, 120, 7_000]),
    )
    expect(result).toMatchObject({
      estimateSeconds: 110,
      sampleCount: 3,
      basis: 'personal-history',
    })
  })

  it('isolates samples by domain, mode, and content type', () => {
    const vocabulary = progressWithTrustedDurations([90, 100, 110])
    expect(estimate(vocabulary).basis).toBe('personal-history')
    expect(estimate(vocabulary, { domain: 'listening' }).basis).toBe(
      'content-baseline',
    )

    const reviews = progressWithTrustedDurations([90, 100, 110], {
      mode: 'review',
    })
    expect(estimate(reviews, { mode: 'review' }).basis).toBe(
      'personal-history',
    )
    expect(estimate(reviews, { mode: 'learn' }).basis).toBe(
      'content-baseline',
    )
    expect(
      estimate(vocabulary, { contentType: 'dialogue' }).basis,
    ).toBe('content-baseline')
  })

  it.each([
    'vocabulary',
    'listening',
    'speaking',
  ] as const)(
    'calibrates %s independently from the other two domains',
    (domain) => {
      const progress = progressWithTrustedDurations([90, 100, 110], {
        domain,
      })
      expect(estimate(progress, { domain })).toMatchObject({
        estimateSeconds: 100,
        sampleCount: 3,
        basis: 'personal-history',
      })
      for (const other of [
        'vocabulary',
        'listening',
        'speaking',
      ] as const) {
        if (other !== domain) {
          expect(estimate(progress, { domain: other }).basis).toBe(
            'content-baseline',
          )
        }
      }
    },
  )

  it('rejects invalid baseline values and ignores invalid historical durations', () => {
    expect(() =>
      calculateContentBaselineSeconds(
        durationBaseline({ itemCount: Number.NaN }),
      ),
    ).toThrow('itemCount must be a finite non-negative number')
    expect(() =>
      calculateContentBaselineSeconds(
        durationBaseline({ minimumSeconds: 0 }),
      ),
    ).toThrow('minimumSeconds must be a finite positive number')

    const profileKey = getDurationProfileKey(
      'vocabulary',
      'learn',
      'multiple-choice-set',
    )
    const initial = progressWithTrustedDurations([])
    const corrupted: ProgressState = {
      ...initial,
      durationSamples: [
        {
          sampleId: 'zero',
          taskId: 'task-zero',
          learningUnitId: 'unit-zero',
          domain: 'vocabulary',
          mode: 'learn',
          contentType: 'multiple-choice-set',
          profileKey,
          effectiveSeconds: 0,
          source: 'timing-segments',
          reliable: true,
          completedAt: '2026-07-02T00:00:00.000Z',
        },
        {
          sampleId: 'negative',
          taskId: 'task-negative',
          learningUnitId: 'unit-negative',
          domain: 'vocabulary',
          mode: 'learn',
          contentType: 'multiple-choice-set',
          profileKey,
          effectiveSeconds: -1,
          source: 'timing-segments',
          reliable: true,
          completedAt: '2026-07-03T00:00:00.000Z',
        },
        {
          sampleId: 'nan',
          taskId: 'task-nan',
          learningUnitId: 'unit-nan',
          domain: 'vocabulary',
          mode: 'learn',
          contentType: 'multiple-choice-set',
          profileKey,
          effectiveSeconds: Number.NaN,
          source: 'timing-segments',
          reliable: true,
          completedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    }
    expect(estimate(corrupted).sampleCount).toBe(0)
  })
})

describe('R3 effective timing segments', () => {
  it('serializes, validates, deduplicates, and restores included/excluded segments', () => {
    const { state, task, progress } = singleTask()
    const active = timingEvent(task, {
      id: 'active-answering-1',
      startedAt: '2026-07-02T00:00:00.000Z',
      endedAt: '2026-07-02T00:00:30.000Z',
      elapsedSeconds: 30,
    })
    const background = timingEvent(task, {
      id: 'background-1',
      startedAt: '2026-07-02T00:00:30.000Z',
      endedAt: '2026-07-02T00:02:10.000Z',
      elapsedSeconds: 100,
      phase: 'idle',
      reason: 'app-backgrounded',
      visibility: 'background',
    })

    expect(parseLearningEvent(active)).toEqual(active)
    const afterActive = applyPlanEvent(progress, active)
    expect(applyPlanEvent(afterActive, active)).toBe(afterActive)
    const restored = structuredClone(afterActive)
    const afterBackground = applyPlanEvent(restored, background)
    expect(afterBackground.tasks[0]).toMatchObject({
      status: 'active',
      spentSeconds: 130,
      effectiveSeconds: 30,
      timingSegmentCount: 2,
      excludedSeconds: 100,
      effectiveTimeSource: 'timing-segments',
    })

    const event = completionEvent(task)
    const completed = applyPlanEvent(afterBackground, event)
    expect(completed.tasks[0]).toMatchObject({
      status: 'completed',
      spentSeconds: 130,
      effectiveSeconds: 30,
      timingSegmentCount: 2,
    })
    expect(summarizePlanActivity(completed).effectiveSeconds).toBe(30)
    const withAttempt = applyLearningAttempt(state, event).state
    const sampled = recordTaskDurationSample(
      withAttempt.progress,
      completed,
      event,
    )
    expect(sampled).toMatchObject({
      durationSamples: [
        expect.objectContaining({
          sampleId: event.id,
          effectiveSeconds: 30,
          source: 'timing-segments',
        }),
      ],
    })
    expect(sampled.attempts).toHaveLength(1)
    expect(
      estimate(sampled, {
        contentType: 'vocabulary-practice',
      }),
    ).toMatchObject({
      sampleCount: 1,
      basis: 'content-baseline',
    })
  })

  it('excludes foreground media loading and keeps legacy active plans readable', () => {
    const { task, progress } = singleTask('listening')
    const loading = timingEvent(task, {
      id: 'media-loading-1',
      startedAt: '2026-07-02T00:00:00.000Z',
      endedAt: '2026-07-02T00:00:20.000Z',
      elapsedSeconds: 20,
      phase: 'loading',
      reason: 'media-loading',
    })
    const withLoading = applyPlanEvent(progress, loading)
    expect(withLoading.tasks[0]).toMatchObject({
      spentSeconds: 20,
      effectiveSeconds: 0,
      excludedSeconds: 20,
    })

    const legacyProgress = {
      ...progress,
      tasks: progress.tasks.map((execution) => {
        const {
          timingSegmentCount: _timingSegmentCount,
          excludedSeconds: _excludedSeconds,
          effectiveTimeSource: _effectiveTimeSource,
          ...legacyExecution
        } = execution
        return legacyExecution
      }),
    }
    const completed = applyPlanEvent(
      structuredClone(legacyProgress),
      completionEvent(task, { id: 'legacy-scored-completion' }),
    )
    expect(completed.tasks[0]).toMatchObject({
      status: 'completed',
      spentSeconds: 400,
      effectiveSeconds: 400,
      effectiveTimeSource: 'legacy-event-duration',
    })
  })

  it('keeps complete unscorable speaking practice time without creating mastery evidence', () => {
    const { state, task, progress } = singleTask('speaking')
    const recording = timingEvent(task, {
      id: 'speaking-recording',
      startedAt: '2026-07-02T00:00:00.000Z',
      endedAt: '2026-07-02T00:00:40.000Z',
      elapsedSeconds: 40,
      phase: 'recording',
      reason: 'active-recording',
    })
    const playback = timingEvent(task, {
      id: 'speaking-playback',
      startedAt: '2026-07-02T00:00:40.000Z',
      endedAt: '2026-07-02T00:01:10.000Z',
      elapsedSeconds: 30,
      phase: 'playback',
      reason: 'active-playback',
    })
    const event = completionEvent(task, {
      id: 'speaking-unscorable-completed',
      unscorable: true,
    })
    const withRecording = applyPlanEvent(progress, recording)
    const withPlayback = applyPlanEvent(withRecording, playback)
    const completed = applyPlanEvent(withPlayback, event)
    const learning = applyLearningAttempt(state, event)
    const sampled = recordTaskDurationSample(
      learning.state.progress,
      completed,
      event,
    )

    expect(completed.tasks[0]).toMatchObject({
      status: 'completed',
      completionKind: 'unscorable-practice',
      effectiveSeconds: 70,
      effectiveTimeSource: 'timing-segments',
    })
    expect(learning.evidenceAccepted).toBe(false)
    expect(learning.state.progress.attempts).toEqual([])
    expect(sampled.durationSamples).toEqual([
      expect.objectContaining({
        sampleId: event.id,
        effectiveSeconds: 70,
        source: 'timing-segments',
        reliable: true,
      }),
    ])
    expect(
      recordTaskDurationSample(sampled, completed, event),
    ).toBe(sampled)
    const twoScoredTimingSamples = progressWithTrustedDurations(
      [60, 65],
      {
        domain: 'speaking',
        contentType: 'speaking-practice',
      },
    ).durationSamples as readonly TaskDurationSample[]
    const mixedTrusted: ProgressState = {
      ...sampled,
      durationSamples: [
        ...twoScoredTimingSamples,
        ...(sampled.durationSamples ?? []),
      ],
    }
    expect(
      estimate(mixedTrusted, {
        domain: 'speaking',
        contentType: 'speaking-practice',
      }),
    ).toMatchObject({
      estimateSeconds: 65,
      sampleCount: 3,
      basis: 'personal-history',
    })
  })

  it('rejects zero, negative, NaN, mismatched, and over-idle segments', () => {
    const { task } = singleTask()
    const base = timingEvent(task, {
      id: 'invalid-timing',
      startedAt: '2026-07-02T00:00:00.000Z',
      endedAt: '2026-07-02T00:00:30.000Z',
      elapsedSeconds: 30,
    })
    for (const elapsedSeconds of [0, -1, Number.NaN]) {
      expect(() =>
        parseLearningEvent({
          ...base,
          payload: { ...base.payload, elapsedSeconds },
        }),
      ).toThrow()
    }
    expect(() =>
      parseLearningEvent({
        ...base,
        payload: {
          ...base.payload,
          idleThresholdSeconds: 60,
        },
      }),
    ).toThrow('idleThresholdSeconds must be 45')
    expect(() =>
      parseLearningEvent({
        ...base,
        payload: {
          ...base.payload,
          endedAt: '2026-07-02T00:00:46.000Z',
          elapsedSeconds: 46,
        },
      }),
    ).toThrow('active answering segment exceeds its maximum duration')
  })
})
