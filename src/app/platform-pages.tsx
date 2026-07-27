import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import {
  browserNetworkStatus,
  type NetworkStatus,
} from '../platform/index.ts'
import {
  EmptyState,
  ErrorState,
  LearningAppPrototype,
  LoadingState,
  PlatformPrototype,
} from '../ui/index.ts'
import {
  ASSESSMENT_ROUTE,
  ASSESSMENT_RESULTS_ROUTE,
} from './assessment/TravelVocabularyR1RouteHost.tsx'
import { useLearningApp } from './learning/learning-app-context.ts'
import {
  toDailyPlanViewModel,
  toPracticeModulesViewModel,
  toProgressViewModel,
} from './learning/view-model.ts'

export function PlatformShell() {
  return (
    <div className="platform-shell">
      <Outlet />
    </div>
  )
}

export function PlatformReadyPage() {
  const navigate = useNavigate()
  const { coordinator, state } = useLearningApp()
  const [network, setNetwork] = useState<NetworkStatus>(() =>
    browserNetworkStatus.current(),
  )
  const [requestError, setRequestError] = useState<Error>()

  useEffect(
    () => browserNetworkStatus.subscribe(setNetwork),
    [],
  )

  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has('ui-fixture')
  ) {
    return <PlatformPrototype />
  }
  if (requestError) {
    return (
      <main className="full-page-feedback">
        <ErrorState
          title="无法打开训练任务"
          description={requestError.message}
          onRetry={() => setRequestError(undefined)}
        />
      </main>
    )
  }
  if (state.status === 'loading') {
    return (
      <main className="full-page-feedback">
        <LoadingState label="正在恢复今日学习计划" />
      </main>
    )
  }
  if (state.status === 'assessment-required') {
    return (
      <main className="full-page-feedback">
        <EmptyState
          title="需要先完成水平测试"
          description="当前设备还没有能力档案，因此不会生成虚假的每日计划。"
          action={(
            <button
              className="primary-button"
              type="button"
              onClick={() => navigate(ASSESSMENT_ROUTE)}
            >
              开始水平测试
            </button>
          )}
        />
      </main>
    )
  }
  if (state.status === 'empty') {
    return (
      <main className="full-page-feedback">
        <EmptyState
          title="今天没有可执行任务"
          description="课程内容存在，但目前没有满足前置条件的学习单元。"
        />
      </main>
    )
  }
  if (state.status === 'error') {
    return (
      <main className="full-page-feedback">
        <ErrorState
          title="无法恢复今日计划"
          description={state.error.message}
          onRetry={() => {
            void coordinator.initialize()
          }}
        />
      </main>
    )
  }

  const now = new Date().toISOString()
  return (
    <LearningAppPrototype
      plan={toDailyPlanViewModel(
        state.runtime.activePlan,
        state.engineState,
        state.resumeTaskId,
        now,
      )}
      progress={toProgressViewModel(state.engineState)}
      practiceModules={toPracticeModulesViewModel(
        state.runtime.activePlan,
        state.resumeTaskId,
        state.assessmentProfileSchemaVersion,
      )}
      offline={network === 'offline'}
      onAssessmentRequested={() => {
        navigate(
          state.assessmentProfileSchemaVersion === 3
            ? ASSESSMENT_RESULTS_ROUTE
            : ASSESSMENT_ROUTE,
        )
      }}
      onTaskRequested={(taskId) => {
        try {
          navigate(coordinator.routeForTask(taskId))
        } catch (error) {
          setRequestError(
            error instanceof Error
              ? error
              : new Error('任务与当前计划不匹配。'),
          )
        }
      }}
    />
  )
}

export function NotFoundPage() {
  return (
    <main className="full-page-feedback">
      <section className="feedback-card">
        <h1>页面不存在</h1>
        <p>这个地址没有对应的页面。</p>
        <a className="primary-button" href="#/">
          返回首页
        </a>
      </section>
    </main>
  )
}
