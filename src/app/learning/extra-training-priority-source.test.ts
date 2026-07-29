import { describe, expect, it } from 'vitest'
import {
  createExtraTrainingSession,
  type LearningEngineState,
} from '../../learning-engine/index.ts'
import {
  ProductionExtraTrainingPrioritySource,
} from './extra-training-priority-source.ts'
import {
  completedExtraTrainingPlan,
  completedExtraTrainingRuntime,
  extraTrainingEngineState,
} from './extra-training-test-fixtures.ts'

const candidates = [
  {
    itemId: 'vocab-error-a',
    supplyOrder: 1,
    domain: 'vocabulary',
    targetModuleId: 'vocabulary',
    learningUnitId: 'unit-error',
    contentRef: 'lesson://course/error',
    allowedModes: ['learn'],
  },
  {
    itemId: 'vocab-error-b',
    supplyOrder: 2,
    domain: 'vocabulary',
    targetModuleId: 'vocabulary',
    learningUnitId: 'unit-error',
    contentRef: 'lesson://course/error',
    allowedModes: ['learn'],
  },
  {
    itemId: 'vocab-due',
    supplyOrder: 3,
    domain: 'vocabulary',
    targetModuleId: 'vocabulary',
    learningUnitId: 'unit-due',
    contentRef: 'lesson://course/due',
    allowedModes: ['learn'],
  },
  {
    itemId: 'vocab-used',
    supplyOrder: 4,
    domain: 'vocabulary',
    targetModuleId: 'vocabulary',
    learningUnitId: 'unit-used',
    contentRef: 'lesson://course/used',
    allowedModes: ['learn'],
  },
] as const

describe('ProductionExtraTrainingPrioritySource', () => {
  it('maps only real released item ids into all four ordered priority buckets', async () => {
    const source = new ProductionExtraTrainingPrioritySource({
      async load() {
        return {
          trainingSupplyIndex: {
            schemaVersion: 1,
            documentType:
              'continuous-training-supply-index',
            candidates,
          },
        }
      },
    })
    const base = extraTrainingEngineState()
    const withHistory: LearningEngineState = {
      ...base,
      progress: {
        ...base.progress,
        attempts: [
          {
            eventId: 'attempt-error',
            planId: 'daily:2026-07-29',
            taskId: 'daily:2026-07-29:vocabulary',
            learningUnitId: 'unit-error',
            domain: 'vocabulary',
            mode: 'learn',
            difficultyLevel: 1,
            performanceScore: 0,
            effectivePerformance: 0,
            evidenceQuality: 1,
            durationSeconds: 0,
            errorTags: ['meaning-recall'],
            occurredAt: '2026-07-29T08:00:00.000Z',
            localDate: '2026-07-29',
          },
        ],
      },
      reviewItems: {
        'unit-due': {
          schemaVersion: 1,
          learningUnitId: 'unit-due',
          contentRef: 'lesson://course/due',
          domain: 'vocabulary',
          difficultyLevel: 1,
          estimatedSeconds: 120,
          memoryDifficulty: 5,
          mastery: 0.5,
          stabilityDays: 1,
          successfulReviews: 0,
          lapseCount: 1,
          attemptCount: 1,
          lastAttemptAt: '2026-07-28T08:00:00.000Z',
          lastSuccessfulAt: null,
          nextReviewAt: '2026-07-29T08:30:00.000Z',
          retryAt: null,
          status: 'learning',
          tags: [],
        },
      },
    }
    const daily = completedExtraTrainingRuntime()
    const runtime = {
      ...daily,
      activePlan: {
        ...daily.activePlan,
        tasks: daily.activePlan.tasks.map((execution) =>
          execution.task.targetModuleId === 'vocabulary'
            ? {
                ...execution,
                training: {
                  ...execution.training!,
                  completedItemIds: ['vocab-used'],
                },
              }
            : execution,
        ),
      },
    }
    const priorities = await source.load({
      moduleId: 'vocabulary',
      localDate: '2026-07-29',
      asOf: '2026-07-29T09:00:00.000Z',
      runtime,
      engineState: withHistory,
    })

    expect(priorities).toEqual({
      'recent-error': ['vocab-error-a', 'vocab-error-b'],
      'due-review': ['vocab-due'],
      'same-day-variant': ['vocab-used'],
      'new-optional-content': [],
    })
    expect(
      Object.values(priorities).flat(),
    ).toEqual(
      expect.arrayContaining(
        candidates.map((candidate) => candidate.itemId),
      ),
    )
  })

  it('adds same-day item ids from earlier extra sessions without inventing unknown ids', async () => {
    const source = new ProductionExtraTrainingPrioritySource({
      async load() {
        return {
          trainingSupplyIndex: {
            schemaVersion: 1,
            documentType:
              'continuous-training-supply-index',
            candidates,
          },
        }
      },
    })
    const base = extraTrainingEngineState()
    const extraTraining = createExtraTrainingSession(
      undefined,
      completedExtraTrainingPlan(),
      {
        sessionId: 'prior',
        localDate: '2026-07-29',
        domain: 'vocabulary',
        targetModuleId: 'vocabulary',
        targetDifficulty: 1,
        priorityItemIds: {
          'recent-error': [],
          'due-review': [],
          'same-day-variant': [],
          'new-optional-content': [],
        },
        startedAt: '2026-07-29T08:00:00.000Z',
      },
    )
    const session = extraTraining.sessions.prior
    const engineState = {
      ...base,
      extraTraining: {
        ...extraTraining,
        sessions: {
          prior: {
            ...session,
            excludeItemIds: ['vocab-used', 'unknown-item'],
          },
        },
      },
    }

    const priorities = await source.load({
      moduleId: 'vocabulary',
      localDate: '2026-07-29',
      asOf: '2026-07-29T09:00:00.000Z',
      runtime: completedExtraTrainingRuntime(),
      engineState,
    })

    expect(priorities['same-day-variant']).toEqual([
      'vocab-used',
    ])
  })
})
