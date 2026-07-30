import { describe, expect, it } from 'vitest'
import type { PlatformEvent } from '../core/index.ts'
import { parseExtraTrainingEvent, parseLearningEvent } from './events.ts'
import {
  applyExtraTrainingEvent,
  createExtraTrainingSession,
  createExtraTrainingState,
} from './extra-training.ts'
import { applyPlanEvent, createPlanProgress } from './lifecycle.ts'
import { createInitialProgressState } from './progress.ts'
import { generateDailyPlan } from './scheduler.ts'
import { abilityProfile, learningCandidate } from './test-fixtures.ts'
import {
  emptyTrainingUnitScore,
  mergeTrainingUnitScore,
  trainingScorePercentage,
} from './training-score.ts'

function plan() {
  return generateDailyPlan({
    planId: 'r7-plan',
    generatedAt: '2026-07-30T00:00:00.000Z',
    localDate: '2026-07-30',
    progress: createInitialProgressState(
      abilityProfile(),
      '2026-07-30T00:00:00.000Z',
    ),
    reviewItems: {},
    candidates: [
      learningCandidate('vocabulary', 1),
      learningCandidate('listening', 1),
      learningCandidate('speaking', 1),
    ],
  })
}

describe('R7 exact training-unit score contract', () => {
  it('derives percentage from scored items and never treats unscorable items as wrong', () => {
    const score = mergeTrainingUnitScore(emptyTrainingUnitScore(), {
      schemaVersion: 1,
      correctCount: 2,
      incorrectCount: 1,
      unscorableCount: 4,
    })!
    expect(trainingScorePercentage(score)).toBeCloseTo(66.666, 2)
    expect(trainingScorePercentage({
      schemaVersion: 1,
      correctCount: 0,
      incorrectCount: 0,
      unscorableCount: 3,
    })).toBeNull()
  })

  it('parses valid exact counts and rejects contradictory scored/unscorable evidence', () => {
    const task = plan().tasks[0]
    const base = {
      id: 'r7-attempt',
      type: 'learning.attempt.completed.v1',
      sourceModuleId: task.targetModuleId,
      schemaVersion: 1,
      occurredAt: '2026-07-30T00:01:00.000Z',
      payload: {
        planId: task.planId,
        taskId: task.taskId,
        learningUnitId: task.learningUnitId,
        contentRef: task.contentRef,
        domain: task.domain,
        targetModuleId: task.targetModuleId,
        localDate: '2026-07-30',
        mode: task.mode,
        difficultyLevel: task.difficultyLevel,
        estimatedSeconds: task.estimatedSeconds,
        result: 'scored',
        performanceScore: 0.5,
        evidenceQuality: 1,
        assistanceLevel: 0,
        durationSeconds: 1,
        taskCompleted: false,
        errorTags: [],
        contentTags: [],
        failureCategory: null,
        scoreDelta: {
          schemaVersion: 1,
          correctCount: 1,
          incorrectCount: 1,
          unscorableCount: 0,
        },
      },
    } as const
    expect(parseLearningEvent(base as unknown as PlatformEvent)).toMatchObject({
      payload: { scoreDelta: { correctCount: 1, incorrectCount: 1 } },
    })
    expect(() => parseLearningEvent({
      ...base,
      id: 'contradictory-score',
      payload: {
        ...base.payload,
        result: 'unscorable',
        performanceScore: null,
        failureCategory: 'device',
        scoreDelta: {
          schemaVersion: 1,
          correctCount: 1,
          incorrectCount: 0,
          unscorableCount: 1,
        },
      },
    } as unknown as PlatformEvent)).toThrow('only unscorable items')
  })

  it('adds daily score exactly once and keeps pre-R7 events compatible', () => {
    const dailyPlan = plan()
    const task = dailyPlan.tasks[0]
    const progress = createPlanProgress(dailyPlan, dailyPlan.generatedAt)
    const event = parseLearningEvent({
      id: 'r7-daily-score',
      type: 'learning.attempt.completed.v1',
      sourceModuleId: task.targetModuleId,
      schemaVersion: 1,
      occurredAt: '2026-07-30T00:01:00.000Z',
      payload: {
        planId: task.planId,
        taskId: task.taskId,
        learningUnitId: task.learningUnitId,
        contentRef: task.contentRef,
        domain: task.domain,
        targetModuleId: task.targetModuleId,
        localDate: dailyPlan.localDate,
        mode: task.mode,
        difficultyLevel: task.difficultyLevel,
        estimatedSeconds: task.estimatedSeconds,
        result: 'scored',
        performanceScore: 1,
        evidenceQuality: 1,
        assistanceLevel: 0,
        durationSeconds: 1,
        taskCompleted: false,
        errorTags: [],
        contentTags: [],
        failureCategory: null,
        scoreDelta: {
          schemaVersion: 1,
          correctCount: 1,
          incorrectCount: 0,
          unscorableCount: 0,
        },
      },
    })
    const once = applyPlanEvent(progress, event)
    expect(once.tasks[0].score).toEqual({
      schemaVersion: 1,
      correctCount: 1,
      incorrectCount: 0,
      unscorableCount: 0,
    })
    expect(applyPlanEvent(once, event)).toBe(once)
  })

  it('persists extra-training counts independently from the completed daily plan', () => {
    const dailyPlan = plan()
    const initial = createPlanProgress(dailyPlan, dailyPlan.generatedAt)
    const completed = {
      ...initial,
      status: 'completed' as const,
      tasks: initial.tasks.map((entry) => ({
        ...entry,
        status: 'completed' as const,
      })),
    }
    let state = createExtraTrainingSession(
      createExtraTrainingState(),
      completed,
      {
        sessionId: 'r7-extra',
        localDate: dailyPlan.localDate,
        domain: 'vocabulary',
        targetModuleId: 'vocabulary',
        targetDifficulty: 2,
        priorityItemIds: {
          'recent-error': [],
          'due-review': [],
          'same-day-variant': [],
          'new-optional-content': [],
        },
        startedAt: '2026-07-30T01:00:00.000Z',
      },
    )
    const event = parseExtraTrainingEvent({
      id: 'r7-extra-score',
      type: 'learning.extra-training.attempt.completed.v1',
      sourceModuleId: 'vocabulary',
      schemaVersion: 1,
      occurredAt: '2026-07-30T01:01:00.000Z',
      payload: {
        sessionId: 'r7-extra',
        localDate: dailyPlan.localDate,
        domain: 'vocabulary',
        targetModuleId: 'vocabulary',
        mode: 'learn',
        learningUnitId: 'r7-unit',
        contentRef: 'lesson://r7',
        difficultyLevel: 2,
        estimatedSeconds: 30,
        result: 'scored',
        performanceScore: 0,
        evidenceQuality: 1,
        assistanceLevel: 0,
        durationSeconds: 1,
        errorTags: [],
        contentTags: [],
        failureCategory: null,
        scoreDelta: {
          schemaVersion: 1,
          correctCount: 0,
          incorrectCount: 1,
          unscorableCount: 0,
        },
      },
    })
    state = applyExtraTrainingEvent(state, event)
    expect(state.sessions['r7-extra'].score).toMatchObject({
      correctCount: 0,
      incorrectCount: 1,
      unscorableCount: 0,
    })
    expect(applyExtraTrainingEvent(state, event)).toBe(state)
    expect(completed.status).toBe('completed')
  })
})
