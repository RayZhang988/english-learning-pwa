import { describe, expect, it } from 'vitest'
import type {
  AttemptFailureCategory,
  LearningAttemptCompletedEvent,
  LearningTask,
} from './contracts.ts'
import {
  applyLearningAttempt,
  createLearningEngineState,
} from './engine.ts'
import { parseLearningEvent } from './events.ts'
import {
  applyPlanEvent,
  createPlanProgress,
  getResumeDecision,
  resolveAttemptPlanDisposition,
  summarizePlanActivity,
} from './lifecycle.ts'
import { generateDailyPlan } from './scheduler.ts'
import { abilityProfile, learningCandidate } from './test-fixtures.ts'

function unscorableEvent(
  task: LearningTask,
  input: {
    readonly eventId?: string
    readonly failureCategory?: AttemptFailureCategory
  } = {},
): LearningAttemptCompletedEvent {
  return {
    id: input.eventId ?? 'speaking-fallback-completed',
    type: 'learning.attempt.completed.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: '2026-07-07T00:05:00.000Z',
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-07',
      mode: task.mode,
      difficultyLevel: task.difficultyLevel,
      estimatedSeconds: task.estimatedSeconds,
      result: 'unscorable',
      performanceScore: null,
      evidenceQuality: 0,
      assistanceLevel: 0,
      durationSeconds: 120,
      taskCompleted: false,
      errorTags: [],
      contentTags: task.tags,
      failureCategory: input.failureCategory ?? 'network',
    },
  }
}

function threeTaskPlan() {
  const engineState = createLearningEngineState(
    abilityProfile(),
    '2026-07-01T00:00:00.000Z',
  )
  const plan = generateDailyPlan({
    planId: 'qa-002-plan',
    generatedAt: '2026-07-07T00:00:00.000Z',
    localDate: '2026-07-07',
    availableSeconds: 600,
    progress: engineState.progress,
    reviewItems: {},
    candidates: [
      learningCandidate('speaking', 1, {
        estimatedSeconds: 120,
      }),
      learningCandidate('listening', 1),
      learningCandidate('vocabulary', 1),
    ],
  })
  return { engineState, plan }
}

describe('unscorable speaking fallback completion', () => {
  it.each([
    'device',
    'permission',
    'network',
    'interrupted',
  ] as const)(
    'accepts the completed speaking %s fallback as a plan terminal',
    (failureCategory) => {
      const { plan } = threeTaskPlan()
      expect(
        resolveAttemptPlanDisposition(
          unscorableEvent(plan.tasks[0], { failureCategory }),
        ),
      ).toBe('unscorable-practice-completion')
    },
  )

  it('ends the plan task without creating mastery evidence or a skip', () => {
    const { engineState, plan } = threeTaskPlan()
    const speakingTask = plan.tasks[0]
    expect(speakingTask.domain).toBe('speaking')
    const event = parseLearningEvent(
      unscorableEvent(speakingTask),
    ) as LearningAttemptCompletedEvent

    expect(resolveAttemptPlanDisposition(event)).toBe(
      'unscorable-practice-completion',
    )
    const learningResult = applyLearningAttempt(engineState, event)
    expect(learningResult).toMatchObject({
      evidenceAccepted: false,
      reason: 'unscorable',
      reviewItem: null,
    })
    expect(learningResult.state).toBe(engineState)
    expect(learningResult.state.progress.attempts).toEqual([])
    expect(learningResult.state.reviewItems).toEqual({})

    const initialProgress = createPlanProgress(
      plan,
      plan.generatedAt,
    )
    const updated = applyPlanEvent(initialProgress, event)
    const speakingExecution = updated.tasks[0]
    expect(speakingExecution).toMatchObject({
      status: 'completed',
      completionKind: 'unscorable-practice',
      effectiveSeconds: 0,
      skipCount: 0,
    })
    expect(updated.status).toBe('in-progress')
    expect(updated.processedEventIds).toContain(event.id)
    expect(applyPlanEvent(updated, event)).toBe(updated)
    expect(summarizePlanActivity(updated)).toMatchObject({
      completedTaskCount: 1,
      effectiveSeconds: 0,
      planCompleted: false,
    })

    const sameDayResume = getResumeDecision(updated, '2026-07-07')
    expect(sameDayResume).toMatchObject({
      action: 'resume-plan',
      nextTaskId: updated.tasks[1].task.taskId,
    })
    expect(sameDayResume.nextTaskId).not.toBe(speakingTask.taskId)
    expect(
      getResumeDecision(updated, '2026-07-08').carryOverTasks.map(
        (task) => task.taskId,
      ),
    ).not.toContain(speakingTask.taskId)
  })

  it('keeps non-speaking unscorable failures resumable', () => {
    const { plan } = threeTaskPlan()
    const listeningTask = plan.tasks.find(
      (task) => task.domain === 'listening',
    )!
    const event = unscorableEvent(listeningTask, {
      eventId: 'listening-content-unavailable',
      failureCategory: 'content',
    })
    expect(resolveAttemptPlanDisposition(event)).toBe('retry-required')

    const updated = applyPlanEvent(
      createPlanProgress(plan, plan.generatedAt),
      event,
    )
    const execution = updated.tasks.find(
      (entry) => entry.task.taskId === listeningTask.taskId,
    )
    expect(execution).toMatchObject({
      status: 'paused',
      completionKind: null,
      skipCount: 0,
    })
    expect(getResumeDecision(updated, '2026-07-07')).toMatchObject({
      action: 'resume-plan',
      nextTaskId: listeningTask.taskId,
    })
  })

  it('keeps unsupported speaking content resumable', () => {
    const { plan } = threeTaskPlan()
    const speakingTask = plan.tasks[0]
    const event = unscorableEvent(speakingTask, {
      eventId: 'speaking-content-unavailable',
      failureCategory: 'content',
    })

    expect(resolveAttemptPlanDisposition(event)).toBe('retry-required')
    const updated = applyPlanEvent(
      createPlanProgress(plan, plan.generatedAt),
      event,
    )
    expect(updated.tasks[0]).toMatchObject({
      status: 'paused',
      completionKind: null,
    })
  })
})
