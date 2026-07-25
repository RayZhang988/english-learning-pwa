import { useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  ListeningTrainingRoute,
} from '../../features/listening/index.ts'
import {
  SpeakingTrainingRoute,
} from '../../features/speaking/index.ts'
import {
  VocabularyTrainingRoute,
} from '../../features/vocabulary/index.ts'
import type {
  LearningTask,
  TrainingModuleId,
} from '../../learning-engine/index.ts'
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../ui/index.ts'
import { useLearningApp } from './learning-app-context.ts'

function TrainingRouteHost({
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
  }

  const task = taskRef.current.task
  const onExit = () => {
    navigate('/', { replace: true })
  }
  const commonProps = {
    task,
    localDate: state.localDate,
    eventSink: coordinator.eventSink,
    onExit,
  }

  if (moduleId === 'vocabulary') {
    return <VocabularyTrainingRoute {...commonProps} />
  }
  if (moduleId === 'listening') {
    return <ListeningTrainingRoute {...commonProps} />
  }
  return <SpeakingTrainingRoute {...commonProps} />
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
