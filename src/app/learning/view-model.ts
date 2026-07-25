import {
  buildProgressSnapshot,
  DEFAULT_DAILY_TARGET_SECONDS,
  type LearningEngineState,
  type PlanProgress,
  type TaskExecutionState,
  type TrainingModuleId,
} from '../../learning-engine/index.ts'
import type {
  DailyPlanViewModel,
  DailyTaskViewModel,
  ProgressViewModel,
} from '../../ui/index.ts'

const modulePresentation: Readonly<
  Record<
    TrainingModuleId,
    Pick<DailyTaskViewModel, 'title' | 'icon' | 'accent'>
  >
> = {
  vocabulary: {
    title: '词汇训练',
    icon: 'book',
    accent: 'mint',
  },
  listening: {
    title: '听力训练',
    icon: 'headphones',
    accent: 'indigo',
  },
  speaking: {
    title: '口语训练',
    icon: 'mic',
    accent: 'coral',
  },
}

const modeLabels = {
  learn: '新内容',
  calibration: '能力校准',
  review: '复习',
  retry: '重试',
} as const

function taskViewModel(
  execution: TaskExecutionState,
  resumeTaskId: string | null,
): DailyTaskViewModel {
  const presentation =
    modulePresentation[execution.task.targetModuleId]
  const terminal =
    execution.status === 'completed' || execution.status === 'skipped'
  const isCurrent = execution.task.taskId === resumeTaskId
  const request = terminal
    ? {
        state: 'disabled' as const,
        label:
          execution.status === 'completed' ? '已完成' : '已跳过',
        reason:
          execution.status === 'completed'
            ? '这项任务已经完成。'
            : '这项任务已从今日计划中跳过。',
      }
    : isCurrent
      ? {
          state: 'enabled' as const,
          label:
            execution.status === 'paused' ? '继续' : '下一项',
        }
      : {
          state: 'disabled' as const,
          label: '稍后',
          reason: '完成当前任务后可开始。',
        }

  return {
    id: execution.task.taskId,
    ...presentation,
    meta: `${Math.round(execution.task.estimatedSeconds / 60)} 分钟 · ${
      modeLabels[execution.task.mode]
    }`,
    status: terminal
      ? 'complete'
      : isCurrent
        ? 'current'
        : 'upcoming',
    request,
  }
}

function dateLabel(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number)
  return new Intl.DateTimeFormat('zh-CN', {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(year, month - 1, day, 12))
}

export function toDailyPlanViewModel(
  progress: PlanProgress,
  engineState: LearningEngineState,
  resumeTaskId: string | null,
  asOf: string,
): DailyPlanViewModel {
  const tasks = progress.tasks.map((task) =>
    taskViewModel(task, resumeTaskId),
  )
  const completedCount = progress.tasks.filter(
    (task) => task.status === 'completed',
  ).length
  const finishedCount = progress.tasks.filter(
    (task) =>
      task.status === 'completed' || task.status === 'skipped',
  ).length
  const totalCount = progress.tasks.length
  const current = tasks.find(
    (task) =>
      task.id === resumeTaskId && task.request.state === 'enabled',
  )
  const progressSnapshot = buildProgressSnapshot(
    engineState.progress,
    asOf,
    progress.plan.localDate,
  )

  return {
    dateLabel: dateLabel(progress.plan.localDate),
    greeting: '今天的英语学习',
    streakDays: progressSnapshot.streak.currentDays,
    summary: `${Math.round(progress.plan.plannedSeconds / 60)} 分钟 · ${totalCount} 项训练`,
    progressLabel: `已完成 ${completedCount} 项`,
    progressPercent:
      totalCount === 0
        ? 0
        : Math.round((finishedCount / totalCount) * 100),
    tasks,
    primaryAction: current
      ? {
          state: 'enabled',
          label:
            progress.status === 'not-started'
              ? '开始今日计划'
              : '继续今日计划',
          taskId: current.id,
        }
      : {
          state: 'disabled',
          label:
            progress.status === 'completed'
              ? '今日计划已完成'
              : '当前没有可执行任务',
          reason:
            progress.status === 'completed'
              ? '今天的学习任务已经全部完成。'
              : '计划中的任务暂时不可用。',
        },
  }
}

function recentActivity(
  engineState: LearningEngineState,
): ProgressViewModel['weeklyBars'] {
  return engineState.progress.dailyActivity.slice(-7).map((activity) => ({
    label: activity.localDate.slice(5).replace('-', '/'),
    value: Math.min(
      100,
      Math.round(
        (activity.effectiveSeconds / DEFAULT_DAILY_TARGET_SECONDS) *
          100,
      ),
    ),
  }))
}

export function toProgressViewModel(
  engineState: LearningEngineState,
): ProgressViewModel {
  const activities = engineState.progress.dailyActivity
  return {
    studyDays: String(
      activities.filter((activity) => activity.completedTaskCount > 0)
        .length,
    ),
    studyMinutes: String(
      Math.round(
        activities.reduce(
          (total, activity) => total + activity.effectiveSeconds,
          0,
        ) / 60,
      ),
    ),
    completedSessions: String(
      activities.reduce(
        (total, activity) => total + activity.completedTaskCount,
        0,
      ),
    ),
    weeklyBars: recentActivity(engineState),
  }
}
