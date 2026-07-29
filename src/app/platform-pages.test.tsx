import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPlanTaskAccess } from '../learning-engine/index.ts'
import {
  completedExtraTrainingRuntime,
  extraTrainingEngineState,
} from './learning/extra-training-test-fixtures.ts'
import {
  LearningAppContext,
  type LearningAppContextValue,
} from './learning/learning-app-context.ts'
import type {
  LearningAppCoordinator,
  LearningAppState,
} from './learning/learning-app-coordinator.ts'
import { PlatformReadyPage } from './platform-pages.tsx'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PlatformReadyPage R6 entry', () => {
  it('keeps a real continue-training entry on the restored 3/3 home route', () => {
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('window', {
      location: { search: '' },
    })
    const runtime = completedExtraTrainingRuntime()
    const state: LearningAppState = {
      status: 'ready',
      localDate: '2026-07-29',
      runtime,
      engineState: extraTrainingEngineState(),
      assessmentProfileSchemaVersion: 3,
      taskAccess: getPlanTaskAccess(runtime.activePlan),
    }
    const value: LearningAppContextValue = {
      state,
      coordinator: {
        state,
      } as unknown as LearningAppCoordinator,
    }

    const markup = renderToStaticMarkup(
      <LearningAppContext.Provider value={value}>
        <MemoryRouter>
          <PlatformReadyPage />
        </MemoryRouter>
      </LearningAppContext.Provider>,
    )

    expect(markup).toContain('今日计划 3/3 已完成')
    expect(markup).toContain('继续训练')
    expect(markup).toContain('查看今日计划')
    expect(markup).not.toContain('技术底座已运行')
    expect(markup).not.toContain('占位')
  })
})
