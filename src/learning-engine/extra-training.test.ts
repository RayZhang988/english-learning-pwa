import { describe, expect, it } from 'vitest'
import type { PlanProgress } from './contracts.ts'
import {
  applyExtraTrainingEvent,
  buildExtraTrainingSupplyRequest,
  createExtraTrainingSession,
  createExtraTrainingState,
  expireExtraTrainingSessions,
  getExtraTrainingEligibility,
  migrateExtraTrainingSessionsToOpenEnded,
} from './extra-training.ts'
import { applyExtraTrainingAttempt, createLearningEngineState } from './engine.ts'
import { parseExtraTrainingEvent, parseLearningEvent } from './events.ts'
import { createPlanProgress } from './lifecycle.ts'
import { createInitialProgressState } from './progress.ts'
import { generateDailyPlan } from './scheduler.ts'
import { abilityProfile, learningCandidate } from './test-fixtures.ts'
import { createTrainingSupplyRound } from './training-randomization.ts'

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

function withCompletedModules(
  completed: readonly ('vocabulary' | 'listening' | 'speaking')[],
): PlanProgress {
  const progress = completedDailyPlan()
  return {
    ...progress,
    status: completed.length === 3 ? 'completed' : 'in-progress',
    tasks: progress.tasks.map((task) => ({
      ...task,
      status: completed.includes(task.task.targetModuleId)
        ? ('completed' as const)
        : ('pending' as const),
    })),
  }
}

function create(
  domain: 'vocabulary' | 'listening' | 'speaking' = 'vocabulary',
  priorityItemIds = {
    'recent-error': ['published-error-1', 'published-error-1'],
    'due-review': ['published-due-1'],
    'same-day-variant': ['published-variant-1'],
    'new-optional-content': [],
  },
) {
  return createExtraTrainingSession(
    createExtraTrainingState(),
    completedDailyPlan(),
    {
      sessionId: `${domain}-extra-1`,
      localDate: '2026-07-29',
      domain,
      targetModuleId: domain,
      targetDifficulty: 3,
      priorityItemIds,
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

describe('R6.2 module-scoped independent extra-training sessions', () => {
  it('creates JSON-portable open-ended practice after its own daily task, not 3/3', () => {
    const state = create('listening')
    const session = state.sessions['listening-extra-1']
    expect(session).toMatchObject({
      schemaVersion: 1,
      localDate: '2026-07-29',
      domain: 'listening',
      completionMode: 'open-ended',
      effectiveSeconds: 0,
      status: 'running',
      completedItemCount: 0,
    })
    expect(() => createExtraTrainingSession(createExtraTrainingState(), withCompletedModules(['listening']), {
      sessionId: 'blocked', localDate: '2026-07-29', domain: 'vocabulary', targetModuleId: 'vocabulary', targetDifficulty: 2, startedAt: '2026-07-29T01:00:00.000Z',
      priorityItemIds: { 'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] },
    })).toThrow('completed vocabulary daily task')
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  it.each([
    ['vocabulary', ['vocabulary']],
    ['listening', ['listening']],
    ['speaking', ['speaking']],
    ['speaking', ['vocabulary', 'speaking']],
    ['listening', ['vocabulary', 'listening', 'speaking']],
  ] as const)(
    'admits %s exactly when that module is completed (%s)',
    (moduleId, completed) => {
      const progress = withCompletedModules(completed)
      expect(getExtraTrainingEligibility(progress, moduleId, '2026-07-29')).toMatchObject({
        eligible: true,
        reason: 'daily-task-completed',
        moduleId,
      })
      const state = createExtraTrainingSession(createExtraTrainingState(), progress, {
        sessionId: `${moduleId}-partial-session`, localDate: '2026-07-29', domain: moduleId, targetModuleId: moduleId, targetDifficulty: 2, startedAt: '2026-07-29T01:00:00.000Z',
        priorityItemIds: { 'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] },
      })
      expect(state.sessions[`${moduleId}-partial-session`]).toMatchObject({
        targetModuleId: moduleId, status: 'running',
      })
    },
  )

  it('publishes stable module-level errors for incomplete, wrong-date, missing and corrupt daily tasks', () => {
    const partial = withCompletedModules(['vocabulary'])
    expect(getExtraTrainingEligibility(partial, 'listening', '2026-07-29')).toMatchObject({
      eligible: false, reason: 'daily-task-incomplete', taskId: expect.any(String),
    })
    expect(getExtraTrainingEligibility(partial, 'vocabulary', '2026-07-30')).toMatchObject({
      eligible: false, reason: 'daily-plan-date-mismatch', taskId: null,
    })
    const missing = { ...partial, tasks: partial.tasks.filter((task) => task.task.targetModuleId !== 'speaking') }
    expect(getExtraTrainingEligibility(missing, 'speaking', '2026-07-29')).toMatchObject({
      eligible: false, reason: 'daily-task-missing-or-invalid', taskId: null,
    })
    const corrupt = {
      ...partial,
      tasks: partial.tasks.map((task) => task.task.targetModuleId === 'vocabulary'
        ? { ...task, task: { ...task.task, taskId: '' } }
        : task),
    }
    expect(getExtraTrainingEligibility(corrupt, 'vocabulary', '2026-07-29')).toMatchObject({
      eligible: false, reason: 'daily-task-missing-or-invalid', taskId: null,
    })
  })

  it('keeps a same-module session stable through repeated starts and other-module completion', () => {
    const initial = createExtraTrainingSession(createExtraTrainingState(), withCompletedModules(['vocabulary']), {
      sessionId: 'vocabulary-stable', localDate: '2026-07-29', domain: 'vocabulary', targetModuleId: 'vocabulary', targetDifficulty: 2, startedAt: '2026-07-29T01:00:00.000Z',
      priorityItemIds: { 'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] },
    })
    const restarted = createExtraTrainingSession(initial, withCompletedModules(['vocabulary', 'listening']), {
      sessionId: 'vocabulary-stable', localDate: '2026-07-29', domain: 'vocabulary', targetModuleId: 'vocabulary', targetDifficulty: 2, startedAt: '2026-07-29T01:01:00.000Z',
      priorityItemIds: { 'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] },
    })
    expect(restarted).toBe(initial)
  })

  it.each(['vocabulary', 'listening', 'speaking'] as const)(
    'creates a separate resumable open-ended session for %s',
    (domain) => {
      const state = create(domain)
      const session = state.sessions[`${domain}-extra-1`]
      expect(session).toMatchObject({ domain, targetModuleId: domain, status: 'running', completionMode: 'open-ended', effectiveSeconds: 0 })
    },
  )

  it('exposes the content-owner priority and restores cursor, exclusions and count after exit', () => {
    let state = create()
    const initialRequest = buildExtraTrainingSupplyRequest(state.sessions['vocabulary-extra-1'])
    expect(initialRequest).not.toBeNull()
    expect(initialRequest?.priority).toEqual([
      'recent-error', 'due-review', 'same-day-variant', 'new-optional-content',
    ])
    expect(initialRequest?.priorityItemIds).toEqual({
      'recent-error': ['published-error-1'],
      'due-review': ['published-due-1'],
      'same-day-variant': ['published-variant-1'],
      'new-optional-content': [],
    })
    state = applyExtraTrainingEvent(state, event('learning.extra-training.item.completed.v1', undefined, {
      requestId: 'request-1', nextSupplyCursor: 'cursor-2', item: { itemId: 'item-1', learningUnitId: 'unit-1', contentRef: 'lesson://unit-1', difficultyLevel: 3, tags: [] },
    }))
    state = applyExtraTrainingEvent(state, event('learning.extra-training.exited.v1'))
    const restored = JSON.parse(JSON.stringify(state))
    expect(restored.sessions['vocabulary-extra-1']).toMatchObject({
      status: 'paused', endReason: 'user-exited', nextSupplyCursor: 'cursor-2', excludeItemIds: ['item-1'], completedItemCount: 1,
      priorityItemIds: initialRequest?.priorityItemIds,
    })
    const resumed = applyExtraTrainingEvent(restored, event('learning.extra-training.started.v1'))
    expect(buildExtraTrainingSupplyRequest(resumed.sessions['vocabulary-extra-1'])?.reason).toBe('resume')
  })

  it('passes a persisted randomized round unchanged to an extra-training supplier', () => {
    const initial = create()
    const supplyRound = createTrainingSupplyRound({
      seed: 'extra-seed',
      candidateItemIds: ['optional-a', 'optional-b'],
      shortTermExcludedItemIds: ['yesterday-item'],
    })
    const session = {
      ...initial.sessions['vocabulary-extra-1'],
      supplyRound,
    }

    expect(buildExtraTrainingSupplyRequest(session)?.supplyRound).toEqual(
      supplyRound,
    )
    expect(
      buildExtraTrainingSupplyRequest(
        JSON.parse(JSON.stringify(session)),
      )?.supplyRound,
    ).toEqual(supplyRound)
  })

  it('rejects invalid priority item identities and reads old sessions as four empty groups', () => {
    expect(() => create('vocabulary', {
      'recent-error': [''],
      'due-review': [],
      'same-day-variant': [],
      'new-optional-content': [],
    })).toThrow('priorityItemIds')
    const current = create()
    const { priorityItemIds: _missing, ...legacySession } = current.sessions['vocabulary-extra-1']
    expect(buildExtraTrainingSupplyRequest(legacySession)).toMatchObject({
      priorityItemIds: {
        'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [],
      },
    })
  })

  it('counts valid foreground time without automatically ending open-ended practice', () => {
    let state = create()
    state = applyExtraTrainingEvent(state, event('learning.extra-training.timing.segment.recorded.v1', undefined, {
      phase: 'recording', reason: 'active-recording', visibility: 'foreground', startedAt: '2026-07-29T01:00:00.000Z', endedAt: '2026-07-29T01:15:00.000Z', elapsedSeconds: 900, idleThresholdSeconds: 45,
    }))
    expect(state.sessions['vocabulary-extra-1']).toMatchObject({
      status: 'running',
      effectiveSeconds: 900,
    })
    state = applyExtraTrainingEvent(state, event('learning.extra-training.item.completed.v1', undefined, {
      id: 'last', requestId: 'request-last', nextSupplyCursor: null, item: { itemId: 'item-last', learningUnitId: 'unit-last', contentRef: 'lesson://unit-last', difficultyLevel: 3, tags: [] },
    }))
    expect(state.sessions['vocabulary-extra-1']).toMatchObject({
      status: 'running',
      completedItemCount: 1,
      effectiveSeconds: 900,
    })
    expect(() =>
      applyExtraTrainingEvent(
        state,
        event('learning.extra-training.budget.completed.v1', undefined, {
          id: 'done',
          completedItemCount: 1,
        }),
      ),
    ).toThrow('cannot complete from a time budget')
  })

  it('migrates an unfinished legacy 900-second session without losing progress', () => {
    const current = create()
    const open = current.sessions['vocabulary-extra-1']
    const legacy = {
      ...open,
      completionMode: undefined,
      effectiveSeconds: undefined,
      targetEffectiveSeconds: 900 as const,
      remainingEffectiveSeconds: 275,
      status: 'finish-current-item' as const,
      nextSupplyCursor: 'cursor-12',
      excludeItemIds: ['item-11'],
      completedItemCount: 11,
    }
    const migrated = migrateExtraTrainingSessionsToOpenEnded(
      {
        ...current,
        sessions: { [legacy.sessionId]: legacy },
      },
      '2026-07-29T02:00:00.000Z',
    ).sessions[legacy.sessionId]

    expect(migrated).toMatchObject({
      completionMode: 'open-ended',
      effectiveSeconds: 625,
      status: 'running',
      nextSupplyCursor: 'cursor-12',
      excludeItemIds: ['item-11'],
      completedItemCount: 11,
      endedAt: null,
      endReason: null,
    })
    expect(migrated).not.toHaveProperty('targetEffectiveSeconds')
    expect(migrated).not.toHaveProperty('remainingEffectiveSeconds')
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
