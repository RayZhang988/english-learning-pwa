import { describe, expect, it } from 'vitest'
import type { PlanProgress } from './contracts.ts'
import { EXTRA_TRAINING_EFFECTIVE_SECONDS } from './contracts.ts'
import {
  applyExtraTrainingEvent,
  buildExtraTrainingSupplyRequest,
  createExtraTrainingSession,
  createExtraTrainingState,
  expireExtraTrainingSessions,
} from './extra-training.ts'
import { applyExtraTrainingAttempt, createLearningEngineState } from './engine.ts'
import { parseExtraTrainingEvent, parseLearningEvent } from './events.ts'
import { createPlanProgress } from './lifecycle.ts'
import { createInitialProgressState } from './progress.ts'
import { generateDailyPlan } from './scheduler.ts'
import { abilityProfile, learningCandidate } from './test-fixtures.ts'

function completedDailyPlan(): PlanProgress {
  const plan = generateDailyPlan({
    planId: 'daily-complete',
    generatedAt: '2026-07-29T00:00:00.000Z',
    localDate: '2026-07-29',
    progress: createInitialProgressState(abilityProfile(), '2026-07-29T00:00:00.000Z'),
    reviewItems: {},
    candidates: [
      learningCandidate('vocabulary', 1),
      learningCandidate('listening', 1),
      learningCandidate('speaking', 1),
    ],
  })
  const progress = createPlanProgress(plan, plan.generatedAt)
  return {
    ...progress,
    status: 'completed',
    tasks: progress.tasks.map((task) => ({ ...task, status: 'completed' as const })),
  }
}

function create(domain: 'vocabulary' | 'listening' | 'speaking' = 'vocabulary') {
  return createExtraTrainingSession(
    createExtraTrainingState(),
    completedDailyPlan(),
    {
      sessionId: `${domain}-extra-1`,
      localDate: '2026-07-29',
      domain,
      targetModuleId: domain,
      targetDifficulty: 3,
      startedAt: '2026-07-29T01:00:00.000Z',
    },
  )
}

function event(
  type: string,
  sessionId = 'vocabulary-extra-1',
  payload: Record<string, unknown> = {},
) {
  return parseExtraTrainingEvent({
    id: `${type}:${sessionId}:${payload.id ?? 'one'}`,
    type,
    sourceModuleId: 'vocabulary',
    schemaVersion: 1,
    occurredAt: '2026-07-29T01:01:00.000Z',
    payload: {
      sessionId,
      localDate: '2026-07-29',
      domain: 'vocabulary',
      targetModuleId: 'vocabulary',
      mode: 'learn',
      ...payload,
    },
  })
}

describe('R6 independent extra-training sessions', () => {
  it('fixes the former gap: only a completed 3/3 daily plan can create a JSON-portable 900-second session', () => {
    const state = create('listening')
    const session = state.sessions['listening-extra-1']
    expect(session).toMatchObject({
      schemaVersion: 1,
      localDate: '2026-07-29',
      domain: 'listening',
      targetEffectiveSeconds: EXTRA_TRAINING_EFFECTIVE_SECONDS,
      remainingEffectiveSeconds: 900,
      status: 'running',
      completedItemCount: 0,
    })
    expect(() => createExtraTrainingSession(createExtraTrainingState(), {
      ...completedDailyPlan(), status: 'in-progress',
    }, {
      sessionId: 'blocked', localDate: '2026-07-29', domain: 'vocabulary', targetModuleId: 'vocabulary', targetDifficulty: 2, startedAt: '2026-07-29T01:00:00.000Z',
    })).toThrow('completed daily plan')
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  it.each(['vocabulary', 'listening', 'speaking'] as const)(
    'creates a separate resumable 900-second block for %s',
    (domain) => {
      const state = create(domain)
      const session = state.sessions[`${domain}-extra-1`]
      expect(session).toMatchObject({ domain, targetModuleId: domain, status: 'running', remainingEffectiveSeconds: 900 })
    },
  )

  it('exposes the content-owner priority and restores cursor, exclusions and count after exit', () => {
    let state = create()
    const initialRequest = buildExtraTrainingSupplyRequest(state.sessions['vocabulary-extra-1'])
    expect(initialRequest).not.toBeNull()
    expect(initialRequest?.priority).toEqual([
      'recent-error', 'due-review', 'same-day-variant', 'new-optional-content',
    ])
    state = applyExtraTrainingEvent(state, event('learning.extra-training.item.completed.v1', undefined, {
      requestId: 'request-1', nextSupplyCursor: 'cursor-2', item: { itemId: 'item-1', learningUnitId: 'unit-1', contentRef: 'lesson://unit-1', difficultyLevel: 3, tags: [] },
    }))
    state = applyExtraTrainingEvent(state, event('learning.extra-training.exited.v1'))
    const restored = JSON.parse(JSON.stringify(state))
    expect(restored.sessions['vocabulary-extra-1']).toMatchObject({
      status: 'paused', endReason: 'user-exited', nextSupplyCursor: 'cursor-2', excludeItemIds: ['item-1'], completedItemCount: 1,
    })
    const resumed = applyExtraTrainingEvent(restored, event('learning.extra-training.started.v1'))
    expect(buildExtraTrainingSupplyRequest(resumed.sessions['vocabulary-extra-1'])?.reason).toBe('resume')
  })

  it('counts only valid foreground time, reaches finish-current-item, and completes only after that item', () => {
    let state = create()
    state = applyExtraTrainingEvent(state, event('learning.extra-training.timing.segment.recorded.v1', undefined, {
      phase: 'recording', reason: 'active-recording', visibility: 'foreground', startedAt: '2026-07-29T01:00:00.000Z', endedAt: '2026-07-29T01:15:00.000Z', elapsedSeconds: 900, idleThresholdSeconds: 45,
    }))
    expect(state.sessions['vocabulary-extra-1'].status).toBe('finish-current-item')
    state = applyExtraTrainingEvent(state, event('learning.extra-training.item.completed.v1', undefined, {
      id: 'last', requestId: 'request-last', nextSupplyCursor: null, item: { itemId: 'item-last', learningUnitId: 'unit-last', contentRef: 'lesson://unit-last', difficultyLevel: 3, tags: [] },
    }))
    state = applyExtraTrainingEvent(state, event('learning.extra-training.budget.completed.v1', undefined, { id: 'done', completedItemCount: 1 }))
    expect(state.sessions['vocabulary-extra-1']).toMatchObject({ status: 'completed', endReason: 'budget-reached', remainingEffectiveSeconds: 0 })
  })

  it('is idempotent, rejects wrong session identity, and never becomes a daily-plan event', () => {
    const state = create()
    const started = event('learning.extra-training.started.v1')
    const once = applyExtraTrainingEvent(state, started)
    expect(applyExtraTrainingEvent(once, started)).toBe(once)
    expect(() => applyExtraTrainingEvent(state, event('learning.extra-training.started.v1', 'wrong-session'))).toThrow('does not exist')
    const wrongDate = parseExtraTrainingEvent({
      ...started,
      id: 'wrong-extra-date',
      payload: { ...started.payload, localDate: '2026-07-30' },
    })
    expect(() => applyExtraTrainingEvent(state, wrongDate)).toThrow('identity does not match')
    expect(() => parseLearningEvent(started)).toThrow('Unsupported learning event type')
  })

  it('records scored optional evidence without creating a plan event or changing the completed 3/3 plan', () => {
    const attempted = parseExtraTrainingEvent({
      id: 'optional-scored', type: 'learning.extra-training.attempt.completed.v1', sourceModuleId: 'vocabulary', schemaVersion: 1,
      occurredAt: '2026-07-29T01:02:00.000Z',
      payload: {
        sessionId: 'vocabulary-extra-1', localDate: '2026-07-29', domain: 'vocabulary', targetModuleId: 'vocabulary', mode: 'learn',
        learningUnitId: 'optional-unit', contentRef: 'lesson://optional', difficultyLevel: 3, estimatedSeconds: 30,
        result: 'scored', performanceScore: 0.8, evidenceQuality: 0.8, assistanceLevel: 0, durationSeconds: 0,
        errorTags: [], contentTags: [], failureCategory: null,
      },
    })
    if (attempted.type !== 'learning.extra-training.attempt.completed.v1') {
      throw new TypeError('Expected an extra-training attempt event')
    }
    const result = applyExtraTrainingAttempt(createLearningEngineState(abilityProfile(), '2026-07-29T00:00:00.000Z'), attempted)
    expect(result).toMatchObject({ evidenceAccepted: true, reason: 'scored' })
    expect(result.state.progress.attempts[0]).toMatchObject({
      planId: 'extra-training:2026-07-29', taskId: 'vocabulary-extra-1',
    })
    expect(completedDailyPlan().status).toBe('completed')
  })

  it('keeps all three daily tasks completed while failed and cross-day optional sessions are retained separately', () => {
    const plan = completedDailyPlan()
    let state = create()
    state = applyExtraTrainingEvent(state, event('learning.extra-training.failed.v1', undefined, { reason: 'provider-failure' }))
    state = expireExtraTrainingSessions(state, '2026-07-30', '2026-07-30T00:00:00.000Z')
    expect(state.sessions['vocabulary-extra-1']).toMatchObject({ status: 'expired', endReason: 'cross-day-expired' })
    expect(plan.status).toBe('completed')
    expect(plan.tasks.map((task) => task.status)).toEqual(['completed', 'completed', 'completed'])
  })
})
