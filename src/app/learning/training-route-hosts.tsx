import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ListeningTrainingRoute } from '../../features/listening/index.ts'
import { SpeakingTrainingRoute } from '../../features/speaking/index.ts'
import { VocabularyTrainingRoute } from '../../features/vocabulary/index.ts'
import type {
  LearningTask,
  TrainingModuleId,
} from '../../learning-engine/index.ts'
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
  listeningContentSource,
  speakingContentSource,
  trainingSupplyProviders,
  vocabularyContentSource,
} from './training-production-resources.ts'
import { productionWrongAnswerEvidencePorts } from '../wrong-answer-evidence-production.ts'

type ReadyWrongAnswerEvidencePorts = Pick<
  typeof productionWrongAnswerEvidencePorts,
  'vocabulary' | 'listeningIdentity' | 'publishListening' | 'speaking'
>

type StableWrongAnswerRoutePorts = {
  readonly vocabulary: ReadyWrongAnswerEvidencePorts['vocabulary'] & {
    readonly source: 'daily-training'
  }
  readonly listeningIdentity:
    ReadyWrongAnswerEvidencePorts['listeningIdentity']
  readonly publishListening:
    ReadyWrongAnswerEvidencePorts['publishListening']
  readonly speaking: ReadyWrongAnswerEvidencePorts['speaking']
}

const wrongAnswerRoutePortsByEvidence = new WeakMap<
  object,
  StableWrongAnswerRoutePorts
>()

function stableWrongAnswerRoutePorts(
  evidence: ReadyWrongAnswerEvidencePorts,
): StableWrongAnswerRoutePorts {
  const cached = wrongAnswerRoutePortsByEvidence.get(evidence)
  if (cached) {
    return cached
  }
  const created: StableWrongAnswerRoutePorts = {
    vocabulary: {
      ...evidence.vocabulary,
      source: 'daily-training',
    },
    listeningIdentity: (item) => evidence.listeningIdentity(item),
    publishListening: (wrongAnswerEvidence) =>
      evidence.publishListening(wrongAnswerEvidence),
    speaking: evidence.speaking,
  }
  wrongAnswerRoutePortsByEvidence.set(evidence, created)
  return created
}

export function TrainingRouteHost({
  moduleId,
  readyWrongAnswerEvidence,
}: {
  readonly moduleId: TrainingModuleId
  /** Tests and composition roots may inject an already validated index. */
  readonly readyWrongAnswerEvidence?: ReadyWrongAnswerEvidencePorts
}) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { coordinator, state } = useLearningApp()
  const taskRef = useRef<{
    readonly taskId: string
    readonly task: LearningTask
  } | null>(null)
  const completedTaskIdRef = useRef<string | null>(null)
  const returnPendingTaskIdRef = useRef<string | null>(null)
  const budgetPortRef = useRef<{
    readonly key: string
    readonly status: () => 'running' | 'finish-current-item'
  } | null>(null)
  const [completionDurationTaskId, setCompletionDurationTaskId] =
    useState<string | null>(null)
  const evidencePorts = readyWrongAnswerEvidence ?? productionWrongAnswerEvidencePorts
  const [reviewEvidenceState, setReviewEvidenceState] = useState<'loading' | 'ready' | 'error'>(readyWrongAnswerEvidence ? 'ready' : 'loading')
  useEffect(() => {
    if (readyWrongAnswerEvidence) return
    let current = true
    void productionWrongAnswerEvidencePorts.initialize().then(
      () => { if (current) setReviewEvidenceState('ready') },
      () => { if (current) setReviewEvidenceState('error') },
    )
    return () => { current = false }
  }, [readyWrongAnswerEvidence])
  const taskId = searchParams.get('taskId')

  if (reviewEvidenceState === 'loading') return <LoadingState label="正在准备统一错题库" />
  if (reviewEvidenceState === 'error') return <ErrorState title="无法准备错题库" description="训练不会在错题记录无法保存时继续，以免丢失正式错题。" onRetry={() => { setReviewEvidenceState('loading'); void productionWrongAnswerEvidencePorts.initialize().then(() => setReviewEvidenceState('ready'), () => setReviewEvidenceState('error')) }} />

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
    score: currentExecution?.score,
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
    completedExtraTrainingEntry:
      currentExecution?.status === 'completed'
        ? {
            onContinueTraining: async () => {
              const session = await coordinator.startExtraTraining(moduleId)
              navigate(
                coordinator.routeForExtraTrainingSession(session.sessionId),
              )
            },
          }
        : undefined,
  }

  if (completionDurationTaskId === task.taskId) {
    return (
      <TrainingCompletionDurationScreen
        viewModel={{
          ...toTrainingCompletionDurationViewModel(
            moduleId,
            currentExecution,
          ),
          extraTrainingEntry: {
            action: {
              label: '继续训练',
              disabled: false,
              loading: false,
            },
          },
        }}
        onAction={onReturnToPlan}
        onContinueTraining={async () => {
          const session = await coordinator.startExtraTraining(moduleId)
          navigate(coordinator.routeForExtraTrainingSession(session.sessionId))
        }}
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
  const wrongAnswerPorts = stableWrongAnswerRoutePorts(evidencePorts)

  if (moduleId === 'vocabulary') {
    return (
      <>
        {durationSurface}
        <VocabularyTrainingRoute
          {...commonProps}
          contentSource={vocabularyContentSource}
          wrongAnswerReview={wrongAnswerPorts.vocabulary}
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
          reviewIdentityForItem={wrongAnswerPorts.listeningIdentity}
          publishWrongAnswerEvidence={wrongAnswerPorts.publishListening}
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
        wrongAnswerEvidence={wrongAnswerPorts.speaking}
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
