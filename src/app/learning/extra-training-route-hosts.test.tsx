import { renderToStaticMarkup } from 'react-dom/server'
import {
  MemoryRouter,
  Route,
  Routes,
} from 'react-router'
import { describe, expect, it } from 'vitest'
import {
  createExtraTrainingSession,
  getPlanTaskAccess,
  type ExtraTrainingSession,
} from '../../learning-engine/index.ts'
import {
  ExtraTrainingPickerRouteHost,
  ExtraTrainingRouteHost,
} from './extra-training-route-hosts.tsx'
import {
  completedExtraTrainingPlan,
  completedExtraTrainingRuntime,
  extraTrainingEngineState,
} from './extra-training-test-fixtures.ts'
import {
  LearningAppContext,
  type LearningAppContextValue,
} from './learning-app-context.ts'
import type {
  LearningAppCoordinator,
  LearningAppState,
} from './learning-app-coordinator.ts'

function extraSession(
  moduleId: 'vocabulary' | 'listening' | 'speaking',
  status: ExtraTrainingSession['status'],
  overrides: Partial<ExtraTrainingSession> = {},
): ExtraTrainingSession {
  const sessionId = `extra:${moduleId}`
  const state = createExtraTrainingSession(
    undefined,
    completedExtraTrainingPlan(),
    {
      sessionId,
      localDate: '2026-07-29',
      domain: moduleId,
      targetModuleId: moduleId,
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
    ...state.sessions[sessionId],
    status,
    ...overrides,
  }
}

function appContext(
  sessions: readonly ExtraTrainingSession[],
): LearningAppContextValue {
  const runtime = completedExtraTrainingRuntime()
  const baseEngine = extraTrainingEngineState()
  const engineState = {
    ...baseEngine,
    extraTraining: {
      schemaVersion: 1 as const,
      sessions: Object.fromEntries(
        sessions.map((session) => [
          session.sessionId,
          session,
        ]),
      ),
      processedEventIds: [],
    },
  }
  const state: LearningAppState = {
    status: 'ready',
    localDate: '2026-07-29',
    runtime,
    engineState,
    assessmentProfileSchemaVersion: 3,
    taskAccess: getPlanTaskAccess(runtime.activePlan),
  }
  const coordinator = {
    state,
    resolveExtraTrainingSession(
      sessionId: string,
      expectedModuleId?: string,
    ) {
      const session = sessions.find(
        (candidate) => candidate.sessionId === sessionId,
      )
      if (
        !session ||
        (expectedModuleId &&
          session.targetModuleId !== expectedModuleId)
      ) {
        throw new TypeError('Extra session mismatch.')
      }
      return session
    },
    routeForExtraTrainingSession(sessionId: string) {
      const session = sessions.find(
        (candidate) => candidate.sessionId === sessionId,
      )
      if (!session) {
        throw new TypeError('Missing session.')
      }
      return `/extra-training/${session.targetModuleId}?sessionId=${sessionId}`
    },
    async startExtraTraining() {
      return sessions[0]
    },
  } as unknown as LearningAppCoordinator
  return { coordinator, state }
}

describe('R6 app routes', () => {
  it('renders one picker card per module from durable session identities', () => {
    const listening = extraSession('listening', 'paused', {
      endReason: 'user-exited',
      remainingEffectiveSeconds: 640,
      completedItemCount: 4,
    })
    const speaking = extraSession('speaking', 'failed', {
      endReason: 'provider-failure',
    })
    const markup = renderToStaticMarkup(
      <LearningAppContext.Provider
        value={appContext([listening, speaking])}
      >
        <MemoryRouter initialEntries={['/extra-training']}>
          <ExtraTrainingPickerRouteHost />
        </MemoryRouter>
      </LearningAppContext.Provider>,
    )

    expect(markup).toContain('data-module-id="vocabulary"')
    expect(markup).toContain('data-extra-training-status="available"')
    expect(markup).toContain('data-module-id="listening"')
    expect(markup).toContain('data-extra-training-status="paused"')
    expect(markup).toContain('继续上次训练')
    expect(markup).toContain('data-module-id="speaking"')
    expect(markup).toContain('data-extra-training-status="failed"')
    expect(markup).toContain('重试当前训练')
  })

  it('restores a completed independent session into the real completion page', () => {
    const completed = extraSession('vocabulary', 'completed', {
      remainingEffectiveSeconds: 0,
      completedItemCount: 11,
      endReason: 'budget-reached',
      endedAt: '2026-07-29T09:20:00.000Z',
    })
    const markup = renderToStaticMarkup(
      <LearningAppContext.Provider
        value={appContext([completed])}
      >
        <MemoryRouter
          initialEntries={[
            '/extra-training/vocabulary?sessionId=extra%3Avocabulary',
          ]}
        >
          <Routes>
            <Route
              path="/extra-training/:moduleId"
              element={<ExtraTrainingRouteHost />}
            />
          </Routes>
        </MemoryRouter>
      </LearningAppContext.Provider>,
    )

    expect(markup).toContain(
      'data-extra-training-session-id="extra:vocabulary"',
    )
    expect(markup).toContain('词汇额外训练已完成')
    expect(markup).toContain('本轮累计完成 11 题')
    expect(markup).toContain('data-duration-state="reliable"')
    expect(markup).toContain('再练 15 分钟')
    expect(markup).toContain('返回今日完成')
  })

  it('rejects a mismatched module route instead of guessing from the URL', () => {
    const vocabulary = extraSession('vocabulary', 'paused', {
      endReason: 'user-exited',
    })
    const markup = renderToStaticMarkup(
      <LearningAppContext.Provider
        value={appContext([vocabulary])}
      >
        <MemoryRouter
          initialEntries={[
            '/extra-training/listening?sessionId=extra%3Avocabulary',
          ]}
        >
          <Routes>
            <Route
              path="/extra-training/:moduleId"
              element={<ExtraTrainingRouteHost />}
            />
          </Routes>
        </MemoryRouter>
      </LearningAppContext.Provider>,
    )

    expect(markup).toContain('无法恢复额外训练会话')
    expect(markup).toContain('Extra session mismatch')
  })
})
