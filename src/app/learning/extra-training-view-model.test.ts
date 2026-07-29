import { describe, expect, it } from 'vitest'
import {
  createExtraTrainingSession,
  type ExtraTrainingSession,
} from '../../learning-engine/index.ts'
import {
  completedExtraTrainingPlan,
  extraTrainingEngineState,
} from './extra-training-test-fixtures.ts'
import {
  isDailyPlanCompleted3Of3,
  toExtraTrainingActiveViewModel,
  toExtraTrainingCompletionViewModel,
  toExtraTrainingPickerViewModel,
} from './extra-training-view-model.ts'

function session(
  overrides: Partial<ExtraTrainingSession> = {},
): ExtraTrainingSession {
  const state = createExtraTrainingSession(
    undefined,
    completedExtraTrainingPlan(),
    {
      sessionId: 'extra-session',
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
      startedAt: '2026-07-29T09:00:00.000Z',
    },
  )
  return {
    ...state.sessions['extra-session'],
    ...overrides,
  }
}

function engineWith(...sessions: ExtraTrainingSession[]) {
  const engine = extraTrainingEngineState()
  return {
    ...engine,
    extraTraining: {
      schemaVersion: 1 as const,
      sessions: Object.fromEntries(
        sessions.map((entry) => [entry.sessionId, entry]),
      ),
      processedEventIds: [],
    },
  }
}

describe('R6 app view models', () => {
  it('requires the real same-day three-task completion gate', () => {
    const completed = completedExtraTrainingPlan()
    expect(
      isDailyPlanCompleted3Of3(completed, '2026-07-29'),
    ).toBe(true)
    expect(
      isDailyPlanCompleted3Of3(completed, '2026-07-30'),
    ).toBe(false)
    expect(
      isDailyPlanCompleted3Of3(
        {
          ...completed,
          status: 'in-progress',
        },
        '2026-07-29',
      ),
    ).toBe(false)
  })

  it('maps available, paused, completed, exhausted, failed and expired from durable sessions', () => {
    const paused = session({
      sessionId: 'paused-listening',
      domain: 'listening',
      targetModuleId: 'listening',
      status: 'paused',
      endReason: 'user-exited',
      remainingEffectiveSeconds: 640,
      completedItemCount: 4,
    })
    const failed = session({
      sessionId: 'failed-speaking',
      domain: 'speaking',
      targetModuleId: 'speaking',
      status: 'failed',
      endReason: 'provider-failure',
      remainingEffectiveSeconds: 700,
      completedItemCount: 2,
    })
    const viewModel = toExtraTrainingPickerViewModel(
      engineWith(paused, failed),
      '2026-07-29',
    )

    expect(viewModel.modules).toMatchObject([
      {
        moduleId: 'vocabulary',
        status: 'available',
      },
      {
        moduleId: 'listening',
        status: 'paused',
        sessionId: 'paused-listening',
        remainingEffectiveSeconds: 640,
        completedItemCount: 4,
      },
      {
        moduleId: 'speaking',
        status: 'failed',
        sessionId: 'failed-speaking',
        failureReason: 'provider-failure',
      },
    ])

    const completed = session({
      status: 'completed',
      endReason: 'budget-reached',
      remainingEffectiveSeconds: 0,
      completedItemCount: 12,
    })
    expect(
      toExtraTrainingPickerViewModel(
        engineWith(completed),
        '2026-07-29',
      ).modules[0],
    ).toMatchObject({
      status: 'completed',
      startAction: { label: '再练 15 分钟' },
    })

    const exhausted = session({
      status: 'failed',
      endReason: 'content-exhausted',
    })
    expect(
      toExtraTrainingPickerViewModel(
        engineWith(exhausted),
        '2026-07-29',
      ).modules[0],
    ).toMatchObject({
      status: 'content-exhausted',
      retryAction: { label: '重新获取题目' },
    })

    const expired = session({
      localDate: '2026-07-28',
      status: 'expired',
      endReason: 'cross-day-expired',
    })
    expect(
      toExtraTrainingPickerViewModel(
        engineWith(expired),
        '2026-07-29',
      ).modules[0],
    ).toMatchObject({
      status: 'expired',
      startAction: { label: '开始今天的新一轮' },
    })
  })

  it('uses only the independent timing budget for active and completion duration truth', () => {
    const finishing = session({
      status: 'finish-current-item',
      remainingEffectiveSeconds: 0,
      completedItemCount: 8,
    })
    expect(
      toExtraTrainingActiveViewModel(
        finishing,
        'vocabulary',
      ),
    ).toMatchObject({
      sessionId: 'extra-session',
      budget: {
        status: 'finish-current-item',
        remainingEffectiveSeconds: 0,
        completedItemCount: 8,
      },
    })

    const completed = {
      ...finishing,
      status: 'completed' as const,
      endReason: 'budget-reached' as const,
      endedAt: '2026-07-29T09:20:00.000Z',
    }
    expect(
      toExtraTrainingCompletionViewModel(completed),
    ).toMatchObject({
      sessionId: 'extra-session',
      completedItemCount: 8,
      actualDuration: {
        state: 'reliable',
        source: 'timing-segments',
        effectiveSeconds: 900,
      },
      chooseAgainAction: { label: '再练 15 分钟' },
      returnAction: { label: '返回今日完成' },
    })
  })

  it('rejects a module/session identity mismatch instead of routing by a label or array position', () => {
    expect(() =>
      toExtraTrainingActiveViewModel(
        session(),
        'listening',
      ),
    ).toThrow('does not match')
  })
})
