import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
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
  TrainingCompletionDurationScreen,
  type AppSection,
} from '../ui/index.ts'
import {
  ASSESSMENT_ROUTE,
  ASSESSMENT_RESULTS_ROUTE,
} from './assessment/TravelVocabularyR1RouteHost.tsx'
import { useLearningApp } from './learning/learning-app-context.ts'
import {
  EXTRA_TRAINING_ROUTE,
} from './learning/extra-training-route-hosts.tsx'
import {
  isDailyPlanCompleted3Of3,
  toExtraTrainingPickerViewModel,
} from './learning/extra-training-view-model.ts'
import {
  toDailyPlanViewModel,
  toPracticeModulesViewModel,
  toProgressViewModel,
  toTrainingCompletionDurationViewModel,
} from './learning/view-model.ts'
import {
  pathForTrainingAreaScreen,
  trainingAreaScreenFromPath,
} from './training-area-routing.ts'

export function PlatformShell() {
  return (
    <div className="platform-shell">
      <Outlet />
    </div>
  )
}

export function PlatformReadyPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { coordinator, state } = useLearningApp()
  const [network, setNetwork] = useState<NetworkStatus>(() =>
    browserNetworkStatus.current(),
  )
  const [requestError, setRequestError] = useState<Error>()
  const [showCompletedPlan, setShowCompletedPlan] =
    useState(false)
  const extraTrainingRequestPending = useRef(false)

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

  if (
    !showCompletedPlan &&
    isDailyPlanCompleted3Of3(
      state.runtime.activePlan,
      state.localDate,
    )
  ) {
    const completedExecution = [...state.runtime.activePlan.tasks]
      .sort(
        (left, right) =>
          right.task.sequence - left.task.sequence,
      )[0]
    if (completedExecution) {
      return (
        <TrainingCompletionDurationScreen
          viewModel={{
            ...toTrainingCompletionDurationViewModel(
              completedExecution.task.targetModuleId,
              completedExecution,
            ),
            title: '今日计划 3/3 已完成',
            description:
              '三个必做训练都已保存；可以查看今日计划，或开始一轮不影响完成状态的额外练习。',
            extraTrainingEntry: {
              action: {
                label: '继续训练',
                disabled: false,
                loading: false,
              },
            },
            actionLabel: '查看今日计划',
          }}
          onAction={() => setShowCompletedPlan(true)}
          onContinueTraining={() =>
            navigate(EXTRA_TRAINING_ROUTE)
          }
        />
      )
    }
  }

  const now = new Date().toISOString()
  const initialSection: AppSection = location.pathname.startsWith(
    '/practice',
  )
    ? 'practice'
    : 'today'
  const initialTrainingAreaScreen = trainingAreaScreenFromPath(
    location.pathname,
  )
  return (
    <LearningAppPrototype
      initialSection={initialSection}
      initialTrainingAreaScreen={initialTrainingAreaScreen}
      plan={toDailyPlanViewModel(
        state.runtime.activePlan,
        state.engineState,
        state.taskAccess,
        now,
      )}
      progress={toProgressViewModel(state.engineState)}
      practiceModules={toPracticeModulesViewModel(
        state.runtime.activePlan,
        state.taskAccess,
        state.assessmentProfileSchemaVersion,
        isDailyPlanCompleted3Of3(
          state.runtime.activePlan,
          state.localDate,
        ),
      )}
      offline={network === 'offline'}
      onSectionChanged={(section) => {
        if (section === 'today') {
          navigate('/')
        } else if (section === 'practice') {
          navigate('/practice')
        }
      }}
      onTrainingAreaScreenChanged={(screen) => {
        navigate(pathForTrainingAreaScreen(screen))
      }}
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
      onExtraTrainingRequested={(moduleId) => {
        if (extraTrainingRequestPending.current) {
          return
        }
        extraTrainingRequestPending.current = true
        void (async () => {
          try {
            const module = toExtraTrainingPickerViewModel(
              state.engineState,
              state.localDate,
            ).modules.find(
              (candidate) => candidate.moduleId === moduleId,
            )
            if (!module) {
              throw new TypeError('找不到对应的额外训练模块。')
            }
            if (
              module.status === 'available' ||
              module.status === 'completed' ||
              module.status === 'expired'
            ) {
              const session =
                await coordinator.startExtraTraining(moduleId)
              navigate(
                coordinator.routeForExtraTrainingSession(
                  session.sessionId,
                ),
              )
              return
            }
            const route =
              coordinator.routeForExtraTrainingSession(
                module.sessionId,
              )
            navigate(
              module.status === 'content-exhausted' ||
                module.status === 'failed'
                ? `${route}&retry=1`
                : route,
            )
          } catch (error) {
            setRequestError(
              error instanceof Error
                ? error
                : new Error('无法打开额外训练。'),
            )
          } finally {
            extraTrainingRequestPending.current = false
          }
        })()
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
