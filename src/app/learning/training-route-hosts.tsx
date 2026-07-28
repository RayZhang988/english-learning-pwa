import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  CurrentListeningContentSource,
  ListeningTrainingRoute,
} from '../../features/listening/index.ts'
import {
  CurrentSpeakingContentSource,
  SpeakingTrainingRoute,
} from '../../features/speaking/index.ts'
import {
  CurrentVocabularyContentSource,
  VocabularyTrainingRoute,
} from '../../features/vocabulary/index.ts'
import type {
  LearningTask,
  TrainingModuleId,
} from '../../learning-engine/index.ts'
import { platformFetch } from '../../platform/index.ts'
import { offlineAssetStore } from '../../pwa/index.ts'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  TaskDurationEstimate,
  TrainingBudgetProgress,
  TrainingCompletionDurationScreen,
} from '../../ui/index.ts'
import { productionEffectiveTimingSessions } from './effective-timing-production.ts'
import { useLearningApp } from './learning-app-context.ts'
import {
  toTrainingBudgetProgressViewModel,
  toTaskDurationEstimateViewModel,
  toTrainingCompletionDurationViewModel,
} from './view-model.ts'
import {
  createProductionTrainingSupplyProviders,
} from './training-supply-providers.ts'

const vocabularyContentSource = new CurrentVocabularyContentSource(
  offlineAssetStore,
  platformFetch,
)
const listeningContentSource = new CurrentListeningContentSource(
  offlineAssetStore,
  platformFetch,
)
const speakingContentSource = new CurrentSpeakingContentSource(
  offlineAssetStore,
  platformFetch,
)
const trainingSupplyProviders =
  createProductionTrainingSupplyProviders({
    vocabulary: vocabularyContentSource,
    listening: listeningContentSource,
    speaking: speakingContentSource,
  })

export function TrainingRouteHost({
  moduleId,
}: {
  readonly moduleId: TrainingModuleId
}) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { coordinator, state } = useLearningApp()
  const taskRef = useRef<{
    readonly taskId: string
    readonly task: LearningTask
  } | null>(null)
  const completedTaskIdRef = useRef<string | null>(null)
  const restoredCompletionTaskIdRef = useRef<string | null>(null)
  const returnPendingTaskIdRef = useRef<string | null>(null)
  const budgetPortRef = useRef<{
    readonly key: string
    readonly status: () => 'running' | 'finish-current-item'
  } | null>(null)
  const [completionDurationTaskId, setCompletionDurationTaskId] =
    useState<string | null>(null)
  const taskId = searchParams.get('taskId')

  if (state.status === 'loading') {
    return <LoadingState label="正在恢复今日学习任务" />
  }
  if (state.status === 'assessment-required') {
    return (
      <EmptyState
        title="需要先完成水平测试"
        description="没有能力档案，系统不会生成或伪造训练任务。"
      />
    )
  }
  if (state.status === 'empty') {
    return (
      <EmptyState
        title="今天没有可执行任务"
        description="当前课程没有满足条件的学习单元。"
      />
    )
  }
  if (state.status === 'error') {
    return (
      <ErrorState
        title="无法恢复学习任务"
        description={state.error.message}
        onRetry={() => {
          void coordinator.initialize()
        }}
      />
    )
  }
  if (!taskId) {
    return (
      <ErrorState
        title="缺少任务编号"
        description="请从今日计划重新打开训练任务。"
      />
    )
  }

  if (taskRef.current?.taskId !== taskId) {
    try {
      taskRef.current = {
        taskId,
        task: coordinator.resolveTask(taskId, moduleId),
      }
    } catch (error) {
      const completedExecution =
        state.runtime.activePlan.plan.localDate === state.localDate
          ? state.runtime.activePlan.tasks.find(
              (execution) =>
                execution.task.taskId === taskId &&
                execution.task.targetModuleId === moduleId &&
                execution.status === 'completed',
            )
          : undefined
      if (!completedExecution) {
        return (
          <ErrorState
            title="无法打开训练任务"
            description={
              error instanceof Error
                ? error.message
                : '任务与今日计划不匹配。'
            }
          />
        )
      }
      taskRef.current = {
        taskId,
        task: completedExecution.task,
      }
      restoredCompletionTaskIdRef.current = taskId
    }
  }

  if (!taskRef.current) {
    return (
      <ErrorState
        title="无法打开训练任务"
        description="任务与今日计划不匹配。"
      />
    )
  }

  const task = taskRef.current.task
  const currentExecution =
    state.runtime.activePlan.plan.planId === task.planId &&
    state.runtime.activePlan.plan.localDate === state.localDate
      ? state.runtime.activePlan.tasks.find(
          (execution) =>
            execution.task.taskId === task.taskId &&
            execution.task.targetModuleId === moduleId,
        )
      : undefined
  const budgetPortKey = `${task.planId}:${task.taskId}:${moduleId}:${state.localDate}`
  if (budgetPortRef.current?.key !== budgetPortKey) {
    budgetPortRef.current = {
      key: budgetPortKey,
      status: () =>
        coordinator.trainingBudgetStatus(task.taskId, moduleId),
    }
  }
  const onExit = () => {
    if (
      completedTaskIdRef.current === task.taskId ||
      currentExecution?.status === 'completed'
    ) {
      setCompletionDurationTaskId(task.taskId)
      return
    }
    navigate('/', { replace: true })
  }
  const onCompleted = () => {
    completedTaskIdRef.current = task.taskId
  }
  const onReturnToPlan = () => {
    if (returnPendingTaskIdRef.current === task.taskId) {
      return
    }
    returnPendingTaskIdRef.current = task.taskId
    navigate('/', { replace: true })
  }
  const commonProps = {
    task,
    localDate: state.localDate,
    eventSink: coordinator.eventSink,
    timingSessionFactory: productionEffectiveTimingSessions,
    onCompleted,
    onExit,
    supplyProvider:
      task.trainingBudget === undefined
        ? undefined
        : trainingSupplyProviders[moduleId],
    trainingBudgetStatus:
      task.trainingBudget === undefined
        ? undefined
        : budgetPortRef.current.status,
  }

  if (
    completionDurationTaskId === task.taskId ||
    (restoredCompletionTaskIdRef.current === task.taskId &&
      currentExecution?.status === 'completed')
  ) {
    return (
      <TrainingCompletionDurationScreen
        viewModel={toTrainingCompletionDurationViewModel(
          moduleId,
          currentExecution,
        )}
        onAction={onReturnToPlan}
      />
    )
  }

  const trainingBudget =
    toTrainingBudgetProgressViewModel(currentExecution)
  const durationSurface = trainingBudget ? (
    <TrainingBudgetProgress viewModel={trainingBudget} />
  ) : (
    <TaskDurationEstimate
      estimate={toTaskDurationEstimateViewModel(task)}
      appearance="strip"
    />
  )

  if (moduleId === 'vocabulary') {
    return (
      <>
        {durationSurface}
        <VocabularyTrainingRoute
          {...commonProps}
          contentSource={vocabularyContentSource}
        />
      </>
    )
  }
  if (moduleId === 'listening') {
    return (
      <>
        {durationSurface}
        <ListeningTrainingRoute
          {...commonProps}
          contentSource={listeningContentSource}
        />
      </>
    )
  }
  return (
    <>
      {durationSurface}
      <SpeakingTrainingRoute
        {...commonProps}
        contentSource={speakingContentSource}
      />
    </>
  )
}

export function VocabularyTrainingRouteHost() {
  return <TrainingRouteHost moduleId="vocabulary" />
}

export function ListeningTrainingRouteHost() {
  return <TrainingRouteHost moduleId="listening" />
}

export function SpeakingTrainingRouteHost() {
  return <TrainingRouteHost moduleId="speaking" />
}
