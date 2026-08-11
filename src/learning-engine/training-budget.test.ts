import { describe, expect, it } from 'vitest'
import type {
  LearningTask,
  LearningTimingSegmentRecordedEvent,
} from './contracts.ts'
import { REQUIRED_TASK_EFFECTIVE_SECONDS } from './contracts.ts'
import { parseLearningEvent } from './events.ts'
import { applyPlanEvent, createPlanProgress } from './lifecycle.ts'
import { createInitialProgressState } from './progress.ts'
import { generateDailyPlan } from './scheduler.ts'
import { getPlanTaskAccess } from './task-access.ts'
import { buildLearningTaskSupplyRequest } from './training-budget.ts'
import { createTrainingSupplyRound } from './training-randomization.ts'
import { abilityProfile, learningCandidate } from './test-fixtures.ts'

function taskAndProgress() {
  const progress = createInitialProgressState(
    abilityProfile(),
    '2026-07-28T00:00:00.000Z',
  )
  const plan = generateDailyPlan({
    planId: 'budget-plan',
    generatedAt: '2026-07-28T00:00:00.000Z',
    localDate: '2026-07-28',
    progress,
    reviewItems: {},
    candidates: [
      learningCandidate('vocabulary', 1),
      learningCandidate('listening', 1),
      learningCandidate('speaking', 1),
    ],
  })
  return { task: plan.tasks[0], progress: createPlanProgress(plan, plan.generatedAt) }
}

function timing(
  task: LearningTask,
  id: string,
  startedAt: string,
  endedAt: string,
  elapsedSeconds: number,
): LearningTimingSegmentRecordedEvent {
  return {
    id,
    type: 'learning.timing.segment.recorded.v1',
    sourceModuleId: task.targetModuleId,
    schemaVersion: 1,
    occurredAt: endedAt,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-28',
      mode: task.mode,
      phase: 'audio-listening',
      reason: 'active-audio-listening',
      visibility: 'foreground',
      startedAt,
      endedAt,
      elapsedSeconds,
      idleThresholdSeconds: 45,
    },
  }
}

function itemEvent(task: LearningTask, requestId: string) {
  return parseLearningEvent({
    id: `${requestId}:item`,
    type: 'learning.training.item.completed.v1',
    sourceModuleId: task.targetModuleId,
    schemaVersion: 1,
    occurredAt: '2026-07-28T00:15:02.000Z',
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-28',
      mode: task.mode,
      requestId,
      nextSupplyCursor: 'cursor-2',
      outcome: 'unscorable-practice',
      item: {
        itemId: 'stream-item-1',
        learningUnitId: task.learningUnitId,
        contentRef: task.contentRef,
        difficultyLevel: task.difficultyLevel,
        tags: task.tags,
      },
    },
  })
}

function recoveryEvent(
  task: LearningTask,
  input: {
    readonly id?: string
    readonly localDate?: string
    readonly exhaustionRequestId?: string
  } = {},
) {
  return parseLearningEvent({
    id: input.id ?? 'content-recovered',
    type: 'learning.training.content.recovered.v1',
    sourceModuleId: task.targetModuleId,
    schemaVersion: 1,
    occurredAt: '2026-07-28T00:02:00.000Z',
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: input.localDate ?? '2026-07-28',
      mode: task.mode,
      exhaustionRequestId:
        input.exhaustionRequestId ?? `${task.taskId}:supply:1:initial`,
    },
  })
}

describe('required effective-training budget', () => {
  it('passes a persisted randomized round unchanged to every downstream daily supplier', () => {
    const { progress } = taskAndProgress()
    const supplyRound = createTrainingSupplyRound({
      seed: 'daily-seed',
      candidateItemIds: ['candidate-a', 'candidate-b'],
      shortTermExcludedItemIds: ['previous-item'],
    })
    const withRound = {
      ...progress,
      tasks: progress.tasks.map((execution, index) =>
        index === 0
          ? {
              ...execution,
              training: { ...execution.training!, supplyRound },
            }
          : execution,
      ),
    }

    const request = buildLearningTaskSupplyRequest(withRound.tasks[0]!)
    expect(request?.supplyRound).toEqual(supplyRound)
    expect(
      buildLearningTaskSupplyRequest(
        JSON.parse(JSON.stringify(withRound)).tasks[0],
      )?.supplyRound,
    ).toEqual(supplyRound)
  })

  it('creates one independent 900-second stream per domain without using estimates as budgets', () => {
    const { progress } = taskAndProgress()
    expect(progress.plan.targetSeconds).toBe(2_700)
    expect(progress.plan.plannedSeconds).toBe(540)
    expect(progress.plan.tasks).toHaveLength(3)
    expect(progress.plan.tasks.map((task) => task.trainingBudget?.targetEffectiveSeconds)).toEqual([
      REQUIRED_TASK_EFFECTIVE_SECONDS,
      REQUIRED_TASK_EFFECTIVE_SECONDS,
      REQUIRED_TASK_EFFECTIVE_SECONDS,
    ])
    expect(progress.plan.tasks.map((task) => task.estimatedSeconds)).not.toEqual([
      900,
      900,
      900,
    ])
  })

  it('restores a deterministic next-item request and ignores duplicate item events', () => {
    const { task, progress } = taskAndProgress()
    const request = buildLearningTaskSupplyRequest(progress.tasks[0])
    expect(request).toMatchObject({
      requestId: `${task.taskId}:supply:1:initial`,
      reason: 'initial',
      cursor: null,
    })
    const updated = applyPlanEvent(progress, itemEvent(task, request!.requestId))
    expect(buildLearningTaskSupplyRequest(updated.tasks[0])).toMatchObject({
      requestId: `${task.taskId}:supply:2:cursor-2`,
      cursor: 'cursor-2',
      excludeItemIds: ['stream-item-1'],
    })
    const restored = JSON.parse(JSON.stringify(updated)) as typeof updated
    expect(buildLearningTaskSupplyRequest(restored.tasks[0])).toEqual(
      buildLearningTaskSupplyRequest(updated.tasks[0]),
    )
    expect(applyPlanEvent(updated, itemEvent(task, request!.requestId))).toBe(updated)
  })

  it('uses only included foreground timing, then requires the current item before completion', () => {
    const { task, progress } = taskAndProgress()
    const beforeDeadline = applyPlanEvent(
      progress,
      timing(task, 'timing-1', '2026-07-28T00:00:00.000Z', '2026-07-28T00:14:59.000Z', 899),
    )
    expect(beforeDeadline.tasks[0].training).toMatchObject({
      remainingEffectiveSeconds: 1,
      status: 'running',
    })
    const deadline = applyPlanEvent(
      beforeDeadline,
      timing(task, 'timing-2', '2026-07-28T00:14:59.000Z', '2026-07-28T00:15:01.000Z', 2),
    )
    expect(deadline.tasks[0].training).toMatchObject({
      remainingEffectiveSeconds: 0,
      status: 'finish-current-item',
    })
    expect(deadline.tasks[0].status).toBe('active')
    const withItem = applyPlanEvent(
      deadline,
      itemEvent(task, `${task.taskId}:supply:1:initial`),
    )
    const completed = applyPlanEvent(
      withItem,
      parseLearningEvent({
        id: 'budget-completed',
        type: 'learning.training.budget.completed.v1',
        sourceModuleId: task.targetModuleId,
        schemaVersion: 1,
        occurredAt: '2026-07-28T00:15:02.000Z',
        payload: {
          planId: task.planId,
          taskId: task.taskId,
          learningUnitId: task.learningUnitId,
          contentRef: task.contentRef,
          domain: task.domain,
          targetModuleId: task.targetModuleId,
          localDate: '2026-07-28',
          mode: task.mode,
          lastCompletedItemId: 'stream-item-1',
          completedItemCount: 1,
        },
      }),
    )
    expect(completed.tasks[0]).toMatchObject({ status: 'completed', training: { status: 'completed' } })
  })

  it('does not let a scored item attempt complete a required stream before its budget', () => {
    const { task, progress } = taskAndProgress()
    const updated = applyPlanEvent(
      progress,
      parseLearningEvent({
        id: 'early-scored-attempt',
        type: 'learning.attempt.completed.v1',
        sourceModuleId: task.targetModuleId,
        schemaVersion: 1,
        occurredAt: '2026-07-28T00:00:01.000Z',
        payload: {
          planId: task.planId,
          taskId: task.taskId,
          learningUnitId: task.learningUnitId,
          contentRef: task.contentRef,
          domain: task.domain,
          targetModuleId: task.targetModuleId,
          localDate: '2026-07-28',
          mode: task.mode,
          difficultyLevel: task.difficultyLevel,
          estimatedSeconds: task.estimatedSeconds,
          result: 'scored',
          performanceScore: 1,
          evidenceQuality: 1,
          assistanceLevel: 0,
          durationSeconds: 900,
          taskCompleted: true,
          errorTags: [],
          contentTags: task.tags,
          failureCategory: null,
        },
      }),
    )
    expect(updated.tasks[0]).toMatchObject({
      status: 'active',
      effectiveSeconds: 0,
      training: { remainingEffectiveSeconds: 900, status: 'running' },
    })
  })

  it('persists content exhaustion as an error, never as a completed daily task', () => {
    const { task, progress } = taskAndProgress()
    const blocked = applyPlanEvent(
      progress,
      parseLearningEvent({
        id: 'content-exhausted',
        type: 'learning.training.content.exhausted.v1',
        sourceModuleId: task.targetModuleId,
        schemaVersion: 1,
        occurredAt: '2026-07-28T00:01:00.000Z',
        payload: {
          planId: task.planId,
          taskId: task.taskId,
          learningUnitId: task.learningUnitId,
          contentRef: task.contentRef,
          domain: task.domain,
          targetModuleId: task.targetModuleId,
          localDate: '2026-07-28',
          mode: task.mode,
          requestId: `${task.taskId}:supply:1:initial`,
          cursor: null,
          reason: 'no-eligible-content',
        },
      }),
    )
    expect(blocked.tasks[0].training?.status).toBe('content-exhausted')
    expect(blocked.tasks[0].status).toBe('blocked')
    expect(getPlanTaskAccess(blocked).tasks[0]).toMatchObject({
      availability: 'startable',
      taskStatus: 'blocked',
    })
    expect(blocked.status).toBe('in-progress')
  })

  it('recovers the exact exhausted request without changing timing, cursor, or exclusions', () => {
    const { task, progress } = taskAndProgress()
    const firstItem = applyPlanEvent(
      progress,
      itemEvent(task, `${task.taskId}:supply:1:initial`),
    )
    const exhausted = applyPlanEvent(
      firstItem,
      parseLearningEvent({
        id: 'content-exhausted-after-item',
        type: 'learning.training.content.exhausted.v1',
        sourceModuleId: task.targetModuleId,
        schemaVersion: 1,
        occurredAt: '2026-07-28T00:01:00.000Z',
        payload: {
          planId: task.planId,
          taskId: task.taskId,
          learningUnitId: task.learningUnitId,
          contentRef: task.contentRef,
          domain: task.domain,
          targetModuleId: task.targetModuleId,
          localDate: '2026-07-28',
          mode: task.mode,
          requestId: `${task.taskId}:supply:2:cursor-2`,
          cursor: 'cursor-2',
          reason: 'all-eligible-content-recently-used',
        },
      }),
    )
    const recoveredEvent = recoveryEvent(task, {
      exhaustionRequestId: `${task.taskId}:supply:2:cursor-2`,
    })
    const recovered = applyPlanEvent(exhausted, recoveredEvent)
    expect(recovered.tasks[0]).toMatchObject({
      status: 'active',
      effectiveSeconds: 0,
      training: {
        status: 'running',
        remainingEffectiveSeconds: 900,
        completedItemIds: ['stream-item-1'],
        nextSupplyCursor: 'cursor-2',
        contentExhausted: null,
      },
    })
    expect(buildLearningTaskSupplyRequest(recovered.tasks[0])).toMatchObject({
      requestId: `${task.taskId}:supply:2:cursor-2`,
      excludeItemIds: ['stream-item-1'],
    })
    expect(applyPlanEvent(recovered, recoveredEvent)).toBe(recovered)
  })

  it('rejects recovery before exhaustion, for a different exhaustion request, or a different date', () => {
    const { task, progress } = taskAndProgress()
    expect(() => applyPlanEvent(progress, recoveryEvent(task))).toThrow(
      'content-exhausted',
    )
    const exhausted = applyPlanEvent(
      progress,
      parseLearningEvent({
        id: 'content-exhausted-for-rejection',
        type: 'learning.training.content.exhausted.v1',
        sourceModuleId: task.targetModuleId,
        schemaVersion: 1,
        occurredAt: '2026-07-28T00:01:00.000Z',
        payload: {
          planId: task.planId,
          taskId: task.taskId,
          learningUnitId: task.learningUnitId,
          contentRef: task.contentRef,
          domain: task.domain,
          targetModuleId: task.targetModuleId,
          localDate: '2026-07-28',
          mode: task.mode,
          requestId: `${task.taskId}:supply:1:initial`,
          cursor: null,
          reason: 'no-eligible-content',
        },
      }),
    )
    expect(() =>
      applyPlanEvent(
        exhausted,
        recoveryEvent(task, { exhaustionRequestId: 'another-request' }),
      ),
    ).toThrow('does not match')
    expect(() =>
      applyPlanEvent(
        exhausted,
        recoveryEvent(task, { id: 'wrong-date', localDate: '2026-07-29' }),
      ),
    ).toThrow('localDate')
    const wrongTask = recoveryEvent(task, { id: 'wrong-task' })
    expect(() =>
      applyPlanEvent(
        exhausted,
        {
          ...wrongTask,
          payload: { ...wrongTask.payload, taskId: 'not-in-this-plan' },
        } as typeof wrongTask,
      ),
    ).toThrow('not part of this plan')
  })

  it('returns to finish-current-item when recovery happens after the effective deadline', () => {
    const { task, progress } = taskAndProgress()
    const atDeadline = applyPlanEvent(
      progress,
      timing(task, 'deadline-before-exhaustion', '2026-07-28T00:00:00.000Z', '2026-07-28T00:15:00.000Z', 900),
    )
    const exhausted = applyPlanEvent(
      atDeadline,
      parseLearningEvent({
        id: 'deadline-content-exhausted',
        type: 'learning.training.content.exhausted.v1',
        sourceModuleId: task.targetModuleId,
        schemaVersion: 1,
        occurredAt: '2026-07-28T00:15:00.000Z',
        payload: {
          planId: task.planId,
          taskId: task.taskId,
          learningUnitId: task.learningUnitId,
          contentRef: task.contentRef,
          domain: task.domain,
          targetModuleId: task.targetModuleId,
          localDate: '2026-07-28',
          mode: task.mode,
          requestId: `${task.taskId}:supply:1:initial`,
          cursor: null,
          reason: 'provider-failure',
        },
      }),
    )
    const recovered = applyPlanEvent(exhausted, recoveryEvent(task))
    expect(recovered.tasks[0]).toMatchObject({
      status: 'active',
      training: { remainingEffectiveSeconds: 0, status: 'finish-current-item' },
    })
  })
})
