import { describe, expect, it } from 'vitest'
import {
  matchSpeakingText,
  type ExtraSpeakingTrainingSnapshot,
} from '../../features/speaking/index.ts'
import {
  createSpeakingUnit,
  speakingPrompt,
} from '../../features/speaking/test-fixtures.ts'
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
  toExtraSpeakingScreenViewModel,
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
  it('passes the authored target translation through recognized and unscorable speaking feedback', () => {
    const base: ExtraSpeakingTrainingSnapshot = {
      schemaVersion: 1,
      session: session({
        domain: 'speaking',
        targetModuleId: 'speaking',
      }),
      unit: createSpeakingUnit(),
      prompt: speakingPrompt,
      activeItem: null,
      activeRequestId: null,
      suppliedNextCursor: null,
      phase: 'feedback',
      recordingAvailable: true,
      answer: {
        recorded: true,
        transcript: "I'm from Shanghai.",
        match: matchSpeakingText(
          "I'm from Shanghai.",
          speakingPrompt.acceptedAnswers,
        ),
        failureCategory: null,
        fallbackReason: null,
      },
      pendingEvents: [],
      pendingWrongAnswerEvidence: [],
      updatedAt: '2026-08-10T00:00:00.000Z',
    }

    expect(toExtraSpeakingScreenViewModel(base).contentMatch).toMatchObject({
      state: 'recognized',
      targetTranslationZh: '我来自上海。',
    })
    expect(
      toExtraSpeakingScreenViewModel({
        ...base,
        answer: {
          ...base.answer!,
          transcript: null,
          match: null,
          failureCategory: 'device',
          fallbackReason: 'recognition-no-speech',
        },
      }).contentMatch,
    ).toMatchObject({
      state: 'unscorable',
      targetTranslationZh: '我来自上海。',
    })
  })

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
      effectiveSeconds: 260,
      completedItemCount: 4,
    })
    const failed = session({
      sessionId: 'failed-speaking',
      domain: 'speaking',
      targetModuleId: 'speaking',
      status: 'failed',
      endReason: 'provider-failure',
      effectiveSeconds: 200,
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
        effectiveSeconds: 260,
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
      effectiveSeconds: 900,
      completedItemCount: 12,
    })
    expect(
      toExtraTrainingPickerViewModel(
        engineWith(completed),
        '2026-07-29',
      ).modules[0],
    ).toMatchObject({
      status: 'completed',
      startAction: { label: '开始新一轮' },
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

  it('uses accumulated effective time for active open-ended practice and preserves legacy completion truth', () => {
    const finishing = session({
      status: 'running',
      effectiveSeconds: 900,
      completedItemCount: 8,
      score: {
        schemaVersion: 1,
        correctCount: 5,
        incorrectCount: 2,
        unscorableCount: 1,
      },
    })
    expect(
      toExtraTrainingActiveViewModel(
        finishing,
        'vocabulary',
      ),
    ).toMatchObject({
      sessionId: 'extra-session',
      progress: {
        status: 'running',
        effectiveSeconds: 900,
        completedItemCount: 8,
        accuracyPercentage: 71,
      },
    })

    expect(
      toExtraTrainingActiveViewModel(
        session({ score: undefined }),
        'vocabulary',
      ).progress.accuracyPercentage,
    ).toBeNull()

    const {
      completionMode: _completionMode,
      effectiveSeconds: _effectiveSeconds,
      ...legacyFinishing
    } = finishing
    const completed = {
      ...legacyFinishing,
      targetEffectiveSeconds: 900 as const,
      remainingEffectiveSeconds: 0,
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
