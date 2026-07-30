import {
  buildProgressSnapshot,
  DEFAULT_DAILY_TARGET_SECONDS,
  type LearningEngineState,
  type LearningTask,
  type PlanProgress,
  type PlanTaskAccess,
  type PlanTaskAvailability,
  type TaskExecutionState,
  type TrainingModuleId,
  type TrainingUnitScore,
} from '../../learning-engine/index.ts'
import type {
  ActualEffectiveDurationViewModel,
  DailyTrainingTaskAccessViewModel,
  DailyEffectiveDurationSummaryViewModel,
  DailyPlanViewModel,
  DailyTaskViewModel,
  PracticeModuleViewModel,
  ProgressViewModel,
  TaskDurationEstimateViewModel,
  TrainingBudgetProgressViewModel,
  TrainingCompletionDurationViewModel,
  TrainingUnitScoreViewModel,
} from '../../ui/index.ts'

export function toTrainingUnitScoreViewModel(
  score: TrainingUnitScore | undefined,
): TrainingUnitScoreViewModel {
  if (!score) {
    return {
      state: 'unavailable',
      reason: 'legacy-score-missing',
    }
  }
  const totalCount = score.correctCount + score.incorrectCount
  return {
    state: 'available',
    correctCount: score.correctCount,
    totalCount,
    percentage:
      totalCount === 0
        ? null
        : Math.round((score.correctCount / totalCount) * 100),
    unscorableCount: score.unscorableCount,
  }
}

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

const practiceModuleIds = [
  'vocabulary',
  'listening',
  'speaking',
] as const satisfies readonly TrainingModuleId[]

const practiceModuleLabels: Readonly<Record<TrainingModuleId, string>> = {
  vocabulary: '词汇训练',
  listening: '听力训练',
  speaking: '口语训练',
}

export function toTaskDurationEstimateViewModel(
  task: LearningTask,
): TaskDurationEstimateViewModel {
  return {
    estimateSeconds:
      task.durationEstimate?.estimateSeconds ?? task.estimatedSeconds,
    basis: task.durationEstimate?.basis ?? 'content-baseline',
    sampleCount: task.durationEstimate?.sampleCount ?? 0,
    confidence: task.durationEstimate?.confidence ?? 'low',
  }
}

export function toActualEffectiveDurationViewModel(
  execution: TaskExecutionState | undefined,
): ActualEffectiveDurationViewModel {
  if (execution?.effectiveTimeSource === 'legacy-event-duration') {
    return {
      state: 'unavailable',
      reason: 'legacy-event-duration',
    }
  }
  if (
    execution?.effectiveTimeSource !== 'timing-segments' ||
    !Number.isFinite(execution.effectiveSeconds) ||
    execution.effectiveSeconds < 0 ||
    !Number.isInteger(execution.timingSegmentCount) ||
    (execution.timingSegmentCount ?? 0) < 1
  ) {
    return {
      state: 'unavailable',
      reason: 'missing-timing-segments',
    }
  }
  return {
    state: 'reliable',
    effectiveSeconds: execution.effectiveSeconds,
    source: 'timing-segments',
  }
}

function exhaustedDescription(
  reason: Extract<
    TrainingBudgetProgressViewModel,
    { readonly status: 'content-exhausted' }
  >['contentExhausted']['reason'],
): string {
  if (reason === 'no-eligible-content') {
    return '当前难度没有可继续使用的训练内容，进度已保留。'
  }
  if (reason === 'all-eligible-content-recently-used') {
    return '当前合格题目都已在本次训练中使用，进度与去重记录已保留。'
  }
  return '训练题库暂时无法读取，进度与去重记录已保留。'
}

export function toTrainingBudgetProgressViewModel(
  execution: TaskExecutionState | undefined,
): TrainingBudgetProgressViewModel | undefined {
  const training = execution?.training
  if (!execution?.task.trainingBudget || !training) {
    return undefined
  }
  const base = {
    targetEffectiveSeconds: training.targetEffectiveSeconds,
    remainingEffectiveSeconds: training.remainingEffectiveSeconds,
    completedItemCount: training.completedItemIds.length,
  }
  if (
    training.status === 'running' ||
    training.status === 'finish-current-item' ||
    training.status === 'completed'
  ) {
    return {
      ...base,
      status: training.status,
    }
  }
  if (!training.contentExhausted) {
    throw new TypeError(
      'Content-exhausted training progress requires recovery details.',
    )
  }
  return {
    ...base,
    status: 'content-exhausted',
    contentExhausted: {
      reason: training.contentExhausted.reason,
      description: exhaustedDescription(
        training.contentExhausted.reason,
      ),
    },
    retryAction: {
      label: '重新获取题目',
    },
  }
}

export function toTrainingCompletionDurationViewModel(
  moduleId: TrainingModuleId,
  execution: TaskExecutionState | undefined,
): TrainingCompletionDurationViewModel {
  const trainingBudget =
    toTrainingBudgetProgressViewModel(execution)
  return {
    moduleId,
    title: `${practiceModuleLabels[moduleId]}已完成`,
    description: '成绩与练习反馈已保存，下面只显示可信的实际有效练习时间。',
    score: toTrainingUnitScoreViewModel(execution?.score),
    actualDuration: toActualEffectiveDurationViewModel(execution),
    trainingBudget:
      trainingBudget?.status === 'completed'
        ? trainingBudget
        : undefined,
    actionLabel: '返回今日计划',
  }
}

export function toDailyEffectiveDurationSummaryViewModel(
  progress: PlanProgress,
): DailyEffectiveDurationSummaryViewModel {
  const items = practiceModuleIds.map((moduleId) => {
    const executions = progress.tasks.filter(
      (execution) => execution.task.targetModuleId === moduleId,
    )
    return {
      moduleId,
      label: practiceModuleLabels[moduleId],
      duration: toActualEffectiveDurationViewModel(
        executions.length === 1 ? executions[0] : undefined,
      ),
    }
  })
  const reliableItems = items.filter(
    (
      item,
    ): item is typeof item & {
      readonly duration: Extract<
        ActualEffectiveDurationViewModel,
        { readonly state: 'reliable' }
      >
    } => item.duration.state === 'reliable',
  )

  return {
    items,
    total:
      reliableItems.length === 0
        ? { coverage: 'unavailable' }
        : {
            coverage:
              reliableItems.length === practiceModuleIds.length
                ? 'complete'
                : 'partial',
            effectiveSeconds: reliableItems.reduce(
              (total, item) =>
                total + item.duration.effectiveSeconds,
              0,
            ),
            source: 'timing-segments',
          },
  }
}

function unavailableDescription(
  moduleId: TrainingModuleId,
  access: PlanTaskAvailability,
): string {
  const label = practiceModuleLabels[moduleId]
  if (
    access.unavailableReason === 'task-finished' &&
    access.taskStatus === 'completed'
  ) {
    return `今天的${label}任务已经完成。`
  }
  if (
    access.unavailableReason === 'task-finished' &&
    access.taskStatus === 'skipped'
  ) {
    return `今天的${label}任务已从计划中跳过。`
  }
  if (access.unavailableReason === 'not-in-active-plan') {
    return `当前计划没有${label}任务。`
  }
  return `${label}任务数据不完整或与当前计划不一致，无法安全启动。`
}

function trainingTaskAccessViewModel(
  moduleId: TrainingModuleId,
  access: PlanTaskAvailability,
  task?: LearningTask,
): DailyTrainingTaskAccessViewModel {
  if (
    access.availability === 'startable' &&
    access.taskStatus !== null &&
    access.taskStatus !== 'completed' &&
    access.taskStatus !== 'skipped' &&
    task?.taskId === access.taskId &&
    task.targetModuleId === moduleId
  ) {
    const statusPresentation = {
      pending: {
        statusLabel: '未开始',
        actionLabel: '开始训练',
      },
      active: {
        statusLabel: '进行中',
        actionLabel: '继续训练',
      },
      paused: {
        statusLabel: '已暂停',
        actionLabel: '继续训练',
      },
      blocked: {
        statusLabel: '待继续',
        actionLabel: '继续训练',
      },
    }[access.taskStatus]
    const timing =
      task.trainingBudget === undefined
        ? {
            durationEstimate:
              toTaskDurationEstimateViewModel(task),
          }
        : {
            trainingBudget: {
              targetEffectiveSeconds:
                task.trainingBudget.targetEffectiveSeconds,
            },
          }
    return {
      moduleId,
      availability: 'startable',
      taskId: access.taskId,
      status: access.taskStatus,
      recommended: access.recommended,
      ...timing,
      ...statusPresentation,
    }
  }

  const normalizedAccess =
    access.availability === 'startable'
      ? invalidAccess(access.taskId, moduleId)
      : access
  return {
    moduleId,
    availability: 'unavailable',
    taskId:
      normalizedAccess.unavailableReason === 'not-in-active-plan'
        ? null
        : normalizedAccess.taskId,
    status: normalizedAccess.taskStatus,
    recommended: false,
    statusLabel:
      normalizedAccess.taskStatus === 'completed'
        ? '已完成'
        : normalizedAccess.taskStatus === 'skipped'
          ? '已跳过'
          : normalizedAccess.unavailableReason === 'not-in-active-plan'
            ? '今日无任务'
            : '任务异常',
    unavailableReason:
      normalizedAccess.unavailableReason ?? 'invalid-task-data',
    unavailableDescription: unavailableDescription(
      moduleId,
      normalizedAccess,
    ),
  }
}

function invalidAccess(
  taskId: string,
  moduleId: TrainingModuleId | null,
): PlanTaskAvailability {
  return {
    taskId,
    targetModuleId: moduleId,
    taskStatus: null,
    availability: 'unavailable',
    unavailableReason: 'invalid-task-data',
    recommended: false,
  }
}

function missingModuleAccess(
  moduleId: TrainingModuleId,
): PlanTaskAvailability {
  return {
    taskId: `missing:${moduleId}`,
    targetModuleId: moduleId,
    taskStatus: null,
    availability: 'unavailable',
    unavailableReason: 'not-in-active-plan',
    recommended: false,
  }
}

function specialtyPracticeModule(
  moduleId: TrainingModuleId,
  progress: PlanProgress,
  taskAccess: PlanTaskAccess,
): PracticeModuleViewModel {
  const taskIds = [
    ...new Set([
      ...progress.plan.tasks
        .filter((task) => task.targetModuleId === moduleId)
        .map((task) => task.taskId),
      ...progress.tasks
        .filter(
          (execution) =>
            execution.task.targetModuleId === moduleId,
        )
        .map((execution) => execution.task.taskId),
    ]),
  ]
  if (taskIds.length === 0) {
    return trainingTaskAccessViewModel(
      moduleId,
      missingModuleAccess(moduleId),
    )
  }
  if (taskIds.length !== 1) {
    return trainingTaskAccessViewModel(
      moduleId,
      invalidAccess(taskIds[0], moduleId),
    )
  }
  const access =
    taskAccess.tasks.find((task) => task.taskId === taskIds[0]) ??
    invalidAccess(taskIds[0], moduleId)
  const task = progress.plan.tasks.find(
    (candidate) => candidate.taskId === taskIds[0],
  )
  return trainingTaskAccessViewModel(moduleId, access, task)
}

export function toPracticeModulesViewModel(
  progress: PlanProgress,
  taskAccess: PlanTaskAccess,
  assessmentProfileSchemaVersion: 1 | 2 | 3 = 3,
  extraTrainingAvailable = false,
): readonly PracticeModuleViewModel[] {
  return [
    {
      moduleId: 'assessment',
      request: {
        state: 'enabled',
        label:
          assessmentProfileSchemaVersion === 3
            ? '查看测试结果'
            : '开始 R1 词汇测试',
      },
    },
    ...practiceModuleIds.map((moduleId) => {
      const module = specialtyPracticeModule(
        moduleId,
        progress,
        taskAccess,
      )
      if (
        extraTrainingAvailable &&
        module.moduleId !== 'assessment' &&
        module.availability === 'unavailable' &&
        module.unavailableReason === 'task-finished' &&
        (module.status === 'completed' ||
          module.status === 'skipped')
      ) {
        return {
          moduleId,
          availability: 'extra-training' as const,
          taskId: null,
          status: module.status,
          recommended: false as const,
          actionLabel: '继续训练',
          extraTrainingDescription:
            '今日任务已完成，可以开始一轮不影响今日 3/3 状态的额外训练。',
          trainingBudget: {
            targetEffectiveSeconds: 900,
          },
          statusLabel: module.statusLabel,
        }
      }
      return module
    }),
  ]
}

function taskViewModel(
  progress: PlanProgress,
  taskAccess: PlanTaskAccess,
  taskId: string,
): DailyTaskViewModel {
  const execution = progress.tasks.find(
    (candidate) => candidate.task.taskId === taskId,
  )
  const scheduled = progress.plan.tasks.find(
    (candidate) => candidate.taskId === taskId,
  )
  const task = execution?.task ?? scheduled
  const moduleId = task?.targetModuleId ?? null
  const access =
    taskAccess.tasks.find((candidate) => candidate.taskId === taskId) ??
    invalidAccess(taskId, moduleId)
  if (!task || moduleId === null) {
    throw new TypeError(
      'Daily task view model requires a scheduled task identity.',
    )
  }
  const presentation = modulePresentation[moduleId]
  const taskState = trainingTaskAccessViewModel(
    moduleId,
    access,
    task,
  )

  return {
    ...presentation,
    ...taskState,
    contentSummary: modeLabels[task.mode],
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
  taskAccess: PlanTaskAccess,
  asOf: string,
): DailyPlanViewModel {
  const tasks = progress.plan.tasks.map((task) =>
    taskViewModel(progress, taskAccess, task.taskId),
  )
  const completedCount = progress.tasks.filter(
    (task) => task.status === 'completed',
  ).length
  const finishedCount = progress.tasks.filter(
    (task) =>
      task.status === 'completed' || task.status === 'skipped',
  ).length
  const totalCount = progress.tasks.length
  const progressSnapshot = buildProgressSnapshot(
    engineState.progress,
    asOf,
    progress.plan.localDate,
  )

  return {
    dateLabel: dateLabel(progress.plan.localDate),
    greeting: '今天的英语学习',
    streakDays: progressSnapshot.streak.currentDays,
    planTargetLabel: `今日目标约 ${Math.round(
      progress.plan.targetSeconds / 60,
    )} 分钟 · ${totalCount} 项训练`,
    progressLabel: `已完成 ${completedCount} 项`,
    progressPercent:
      totalCount === 0
        ? 0
        : Math.round((finishedCount / totalCount) * 100),
    tasks,
    effectiveTimeSummary:
      toDailyEffectiveDurationSummaryViewModel(progress),
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
