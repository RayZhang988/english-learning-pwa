import { useEffect, useState, type CSSProperties } from 'react'
import {
  formatDurationEstimateBasis,
  formatEstimatedDuration,
} from './duration-format.ts'
import {
  DailyEffectiveDurationSummary,
  TaskDurationEstimate,
} from './duration-surfaces.tsx'
import { TrainingBudgetTarget } from './training-budget-surfaces.tsx'
import type {
  DailyEffectiveDurationSummaryViewModel,
  DurationTrainingModuleId,
  TaskDurationEstimateViewModel,
} from './duration-view-models.ts'
import type { TrainingBudgetTargetViewModel } from './training-budget-view-models.ts'
import { OfflineNotice } from './feedback-states.tsx'
import type { WrongAnswerLibraryEntryProps } from './wrong-answer-library-surfaces.tsx'
import { Icon, type IconName } from './icons.tsx'
import {
  AiConversationPlaceholder,
  TrainingAreaHub,
  TravelSceneCategoryGrid,
  TravelSceneList,
  TravelScenePlaceholder,
  type TrainingAreaScreen,
} from './training-area-surfaces.tsx'
import {
  getTravelScene,
  type TrainingAreaId,
} from './training-area-model.ts'

export type AppSection = 'today' | 'practice' | 'progress'
export type PracticeModuleId =
  | 'assessment'
  | 'vocabulary'
  | 'listening'
  | 'speaking'
export type TrainingPracticeModuleId = Exclude<
  PracticeModuleId,
  'assessment'
> & DurationTrainingModuleId
export type TrainingTaskStatus =
  | 'pending'
  | 'active'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'skipped'
export type StartableTrainingTaskStatus = Exclude<
  TrainingTaskStatus,
  'completed' | 'skipped'
>
export type TrainingTaskUnavailableReason =
  | 'not-in-active-plan'
  | 'task-finished'
  | 'invalid-task-data'

interface TrainingTaskAccessBase {
  /**
   * Stable UI identity. It never substitutes for LearningTask.taskId.
   */
  readonly moduleId: TrainingPracticeModuleId
  readonly statusLabel: string
}

type StartableTrainingTaskDurationViewModel =
  | {
      /**
       * New 900-second effective-training completion budget from 04.
       * A budget task must not also present a content-duration estimate.
       */
      readonly trainingBudget: TrainingBudgetTargetViewModel
      readonly durationEstimate?: never
    }
  | {
      /**
       * Compatibility presentation for a task with no trainingBudget.
       */
      readonly trainingBudget?: undefined
      readonly durationEstimate: TaskDurationEstimateViewModel
    }

export type TrainingTaskAccessViewModel =
  | (TrainingTaskAccessBase &
      StartableTrainingTaskDurationViewModel & {
        readonly availability: 'startable'
        /**
         * Exact LearningTask.taskId. The UI returns it unchanged.
         */
        readonly taskId: string
        readonly status: StartableTrainingTaskStatus
        readonly recommended: boolean
        readonly actionLabel: string
      })
  | (TrainingTaskAccessBase & {
      readonly availability: 'unavailable'
      /**
       * Completed tasks retain their real id. Plan gaps or malformed input may
       * intentionally have no trustworthy task id.
       */
      readonly taskId: string | null
      readonly status: TrainingTaskStatus | null
      readonly recommended: false
      readonly unavailableReason: TrainingTaskUnavailableReason
      readonly unavailableDescription: string
    })
  | (TrainingTaskAccessBase & {
      readonly availability: 'extra-training'
      readonly taskId: null
      readonly status: 'completed' | 'skipped'
      readonly recommended: false
      readonly actionLabel: string
      readonly extraTrainingDescription: string
      readonly openEnded: true
    })

interface DailyTaskPresentation {
  readonly title: string
  /**
   * Content quantity or scope only, for example "12 个词".
   * Time belongs to trainingBudget or durationEstimate and must not be
   * embedded here.
   */
  readonly contentSummary: string
  readonly icon: IconName
  readonly accent: 'indigo' | 'coral' | 'mint'
}

export type DailyTrainingTaskAccessViewModel = TrainingTaskAccessViewModel

export type DailyTaskViewModel =
  DailyTrainingTaskAccessViewModel & DailyTaskPresentation

export interface DailyPlanViewModel {
  readonly dateLabel: string
  readonly greeting: string
  readonly streakDays: number
  /**
   * Optional daily allocation target. This is not a per-task estimate.
   */
  readonly planTargetLabel: string
  readonly progressLabel: string
  readonly progressPercent: number
  readonly tasks: readonly DailyTaskViewModel[]
  readonly effectiveTimeSummary?: DailyEffectiveDurationSummaryViewModel
}

export interface ProgressViewModel {
  readonly studyDays: string
  readonly studyMinutes: string
  readonly completedSessions: string
  readonly weeklyBars: readonly {
    readonly label: string
    readonly value: number
    readonly isToday?: boolean
  }[]
}

/** Read-only R17 projection supplied by 01; UI does not derive eligibility. */
export interface GrowthProgressDomainViewModel {
  readonly domain: 'vocabulary' | 'listening' | 'speaking'
  readonly currentLevelLabel: string
  readonly progressPercent: number
  readonly recentSessionCount: number
  readonly scoredItemCount: number
  readonly recentAccuracyPercent: number | null
  readonly eligibility: 'eligible' | 'ineligible' | 'cooling-down' | 'highest-level' | 'test-in-progress'
  readonly remainingCooldownSessions: number
  readonly action: { readonly label: string; readonly disabled: boolean; readonly busy: boolean }
  readonly activeTest: { readonly itemIds: readonly string[]; readonly index: number; readonly score: { readonly correctCount: number; readonly answeredCount: number } } | null
}

export type PracticeModuleViewModel =
  | {
      /**
       * Stable UI identity only. Assessment is not a LearningTask.
       */
      readonly moduleId: 'assessment'
      readonly request:
        | {
            readonly state: 'enabled'
            readonly label: string
          }
        | {
            readonly state: 'disabled'
            readonly label: string
            readonly reason: string
          }
    }
  | TrainingTaskAccessViewModel

interface LearningAppPrototypeBaseProps {
  readonly plan: DailyPlanViewModel
  readonly progress: ProgressViewModel
  readonly growth?: readonly GrowthProgressDomainViewModel[]
  readonly onGrowthActionRequested?: (domain: GrowthProgressDomainViewModel['domain']) => void
  readonly offline?: boolean
  readonly onTaskRequested: (taskId: string) => void
  readonly onExtraTrainingRequested?: (
    moduleId: TrainingPracticeModuleId,
  ) => void
  readonly initialSection?: AppSection
  readonly initialTrainingAreaScreen?: TrainingAreaScreen
  readonly onSectionChanged?: (section: AppSection) => void
  readonly onTrainingAreaScreenChanged?: (
    screen: TrainingAreaScreen,
  ) => void
  /** A single optional tool rendered only in the practice hub. */
  readonly wrongAnswerLibrary?: WrongAnswerLibraryEntryProps
}

export type LearningAppPrototypeProps =
  LearningAppPrototypeBaseProps &
    (
      | {
          readonly practiceModules: readonly PracticeModuleViewModel[]
          readonly onAssessmentRequested: () => void
        }
      | {
          /**
           * Transitional compatibility state. All module cards render disabled
           * until the application layer supplies the explicit practice contract.
           */
          readonly practiceModules?: undefined
          readonly onAssessmentRequested?: undefined
        }
    )

const navigation: readonly {
  readonly id: AppSection
  readonly label: string
  readonly icon: IconName
}[] = [
  { id: 'today', label: '今天', icon: 'home' },
  { id: 'practice', label: '训练', icon: 'target' },
  { id: 'progress', label: '进度', icon: 'trend' },
]

const practiceModulePresentation = {
  assessment: {
    title: '水平测试',
    description: '了解当前英语水平',
    icon: 'target',
    accent: 'indigo',
  },
  vocabulary: {
    title: '词汇',
    description: '复习与巩固词汇',
    icon: 'book',
    accent: 'mint',
  },
  listening: {
    title: '听力',
    description: '精听与理解训练',
    icon: 'headphones',
    accent: 'indigo',
  },
  speaking: {
    title: '口语',
    description: '跟读与表达训练',
    icon: 'mic',
    accent: 'coral',
  },
} satisfies Record<
  PracticeModuleId,
  {
    readonly title: string
    readonly description: string
    readonly icon: IconName
    readonly accent: DailyTaskViewModel['accent']
  }
>

const disconnectedPracticeModules: readonly PracticeModuleViewModel[] = [
  {
    moduleId: 'assessment',
    request: {
      state: 'disabled',
      label: '暂不可用',
      reason: '水平测试入口尚未接入。',
    },
  },
  {
    moduleId: 'vocabulary',
    taskId: null,
    status: null,
    statusLabel: '暂不可用',
    availability: 'unavailable',
    recommended: false,
    unavailableReason: 'invalid-task-data',
    unavailableDescription: '词汇训练入口尚未接入。',
  },
  {
    moduleId: 'listening',
    taskId: null,
    status: null,
    statusLabel: '暂不可用',
    availability: 'unavailable',
    recommended: false,
    unavailableReason: 'invalid-task-data',
    unavailableDescription: '听力训练入口尚未接入。',
  },
  {
    moduleId: 'speaking',
    taskId: null,
    status: null,
    statusLabel: '暂不可用',
    availability: 'unavailable',
    recommended: false,
    unavailableReason: 'invalid-task-data',
    unavailableDescription: '口语训练入口尚未接入。',
  },
]

export function LearningAppPrototype({
  plan,
  progress,
  growth,
  onGrowthActionRequested,
  offline = false,
  onTaskRequested,
  onExtraTrainingRequested,
  practiceModules,
  onAssessmentRequested,
  initialSection = 'today',
  initialTrainingAreaScreen = { kind: 'hub' },
  onSectionChanged,
  onTrainingAreaScreenChanged,
  wrongAnswerLibrary,
}: LearningAppPrototypeProps) {
  const [section, setSection] = useState<AppSection>(initialSection)
  const [trainingAreaScreen, setTrainingAreaScreen] =
    useState<TrainingAreaScreen>(initialTrainingAreaScreen)

  useEffect(() => {
    setSection(initialSection)
  }, [initialSection])

  useEffect(() => {
    setTrainingAreaScreen(initialTrainingAreaScreen)
  }, [initialTrainingAreaScreen])

  const showTrainingAreaScreen = (screen: TrainingAreaScreen) => {
    setTrainingAreaScreen(screen)
    onTrainingAreaScreenChanged?.(screen)
  }

  const openTrainingArea = (areaId: TrainingAreaId) => {
    showTrainingAreaScreen(
      areaId === 'daily'
        ? { kind: 'daily' }
        : areaId === 'scenes'
          ? { kind: 'scenes' }
          : { kind: 'ai' },
    )
  }

  return (
    <div className="learning-app">
      <div className="learning-app__page">
        {offline ? <OfflineNotice /> : null}
        {section === 'today' ? (
          <TodayPage
            plan={plan}
            onTaskRequested={onTaskRequested}
            onExtraTrainingRequested={onExtraTrainingRequested}
          />
        ) : null}
        {section === 'practice' ? (
          trainingAreaScreen.kind === 'hub' ? (
            <TrainingAreaHub
              onSelect={openTrainingArea}
              wrongAnswerLibrary={wrongAnswerLibrary}
            />
          ) : trainingAreaScreen.kind === 'daily' ? (
            <PracticeModuleGrid
              modules={practiceModules ?? disconnectedPracticeModules}
              onBack={() =>
                showTrainingAreaScreen({ kind: 'hub' })
              }
              onAssessmentRequested={
                onAssessmentRequested ?? (() => undefined)
              }
              onTaskRequested={onTaskRequested}
              onExtraTrainingRequested={onExtraTrainingRequested}
            />
          ) : trainingAreaScreen.kind === 'scenes' ? (
            <TravelSceneCategoryGrid
              onBack={() =>
                showTrainingAreaScreen({ kind: 'hub' })
              }
              onCategoryRequested={(categoryId) =>
                showTrainingAreaScreen({ kind: 'category', categoryId })
              }
            />
          ) : trainingAreaScreen.kind === 'category' ? (
            <TravelSceneList
              categoryId={trainingAreaScreen.categoryId}
              onBack={() =>
                showTrainingAreaScreen({ kind: 'scenes' })
              }
              onSceneRequested={(sceneId) =>
                showTrainingAreaScreen({ kind: 'scene', sceneId })
              }
            />
          ) : trainingAreaScreen.kind === 'scene' ? (
            <TravelScenePlaceholder
              sceneId={trainingAreaScreen.sceneId}
              onBack={() => {
                const category = getTravelScene(
                  trainingAreaScreen.sceneId,
                )?.category.id
                showTrainingAreaScreen(
                  category
                    ? { kind: 'category', categoryId: category }
                    : { kind: 'scenes' },
                )
              }}
            />
          ) : (
            <AiConversationPlaceholder
              onBack={() =>
                showTrainingAreaScreen({ kind: 'hub' })
              }
            />
          )
        ) : null}
        {section === 'progress' ? <ProgressPage progress={progress} growth={growth} onGrowthActionRequested={onGrowthActionRequested} /> : null}
      </div>

      <nav className="bottom-nav" aria-label="主要导航">
        {navigation.map((item) => (
          <button
            className="bottom-nav__item"
            type="button"
            key={item.id}
            aria-current={section === item.id ? 'page' : undefined}
            onClick={() => {
              setSection(item.id)
              onSectionChanged?.(item.id)
              if (item.id === 'practice') {
                showTrainingAreaScreen({ kind: 'hub' })
              }
            }}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function TodayPage({
  plan,
  onTaskRequested,
  onExtraTrainingRequested,
}: {
  readonly plan: DailyPlanViewModel
  readonly onTaskRequested: (taskId: string) => void
  readonly onExtraTrainingRequested?: (
    moduleId: TrainingPracticeModuleId,
  ) => void
}) {
  return (
    <>
      <header className="app-header">
        <div>
          <span className="eyebrow">{plan.dateLabel}</span>
          <h1>{plan.greeting}</h1>
        </div>
        <span
          className="streak-chip"
          aria-label={`连续学习 ${plan.streakDays} 天`}
        >
          <Icon name="spark" />
          <b>{plan.streakDays}</b>
        </span>
      </header>

      <section
        className="daily-brief"
        style={{ '--plan-progress': `${plan.progressPercent}%` } as CSSProperties}
      >
        <div className="daily-brief__topline">
          <span>今日计划</span>
          <strong>{plan.progressLabel}</strong>
        </div>
        <h2>保持一点节奏，<br />比一次学很多更重要。</h2>
        <div className="daily-brief__footer">
          <span>{plan.planTargetLabel}</span>
          <span aria-hidden="true">{plan.progressPercent}%</span>
        </div>
        <div
          className="daily-brief__progress"
          role="progressbar"
          aria-label="今日计划进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={plan.progressPercent}
        >
          <span />
        </div>
      </section>

      <section className="plan-section" aria-labelledby="plan-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CHOOSE YOUR START</span>
            <h2 id="plan-heading">任选一项开始</h2>
          </div>
          <span className="section-heading__count">{plan.tasks.length} 项</span>
        </div>
        <p className="plan-section__hint">
          “建议先做”只是推荐，其他可用任务同样可以直接开始。
        </p>
        <TodayTaskList
          tasks={plan.tasks}
          onTaskRequested={onTaskRequested}
          onExtraTrainingRequested={onExtraTrainingRequested}
        />
      </section>
      {plan.effectiveTimeSummary ? (
        <DailyEffectiveDurationSummary
          viewModel={plan.effectiveTimeSummary}
        />
      ) : null}
    </>
  )
}

function recommendedAriaDescription(recommended: boolean): string {
  return recommended
    ? '。建议先做；其他未完成任务同样可选'
    : ''
}

function durationEstimateAriaDescription(
  estimate: TaskDurationEstimateViewModel,
): string {
  return `。预计有效练习${formatEstimatedDuration(estimate.estimateSeconds)}，${formatDurationEstimateBasis(estimate.basis)}`
}

function trainingTaskDurationAriaDescription(
  task: Extract<
    TrainingTaskAccessViewModel,
    { readonly availability: 'startable' }
  >,
): string {
  return task.trainingBudget
    ? `。训练目标${formatTrainingBudgetTargetAriaLabel(task.trainingBudget.targetEffectiveSeconds)}`
    : durationEstimateAriaDescription(task.durationEstimate)
}

function formatTrainingBudgetTargetAriaLabel(seconds: number): string {
  if (Number.isFinite(seconds) && seconds >= 0 && seconds % 60 === 0) {
    return `${seconds / 60} 分钟有效训练，只累计前台有效练习`
  }

  return '有效训练目标，以运行时提供的有效时间为准'
}

export function TodayTaskList({
  tasks,
  onTaskRequested,
  onExtraTrainingRequested,
}: {
  readonly tasks: readonly DailyTaskViewModel[]
  readonly onTaskRequested: (taskId: string) => void
  readonly onExtraTrainingRequested?: (
    moduleId: TrainingPracticeModuleId,
  ) => void
}) {
  return (
    <ul className="task-choice-list">
      {tasks.map((task) => {
        const isStartable = task.availability === 'startable'
        const isExtraTraining = task.availability === 'extra-training'
        const stateClass =
          task.availability === 'unavailable' &&
          task.unavailableReason === 'invalid-task-data'
            ? 'error'
            : task.availability
        const detail =
          task.availability === 'unavailable'
            ? task.unavailableDescription
            : isExtraTraining
              ? task.extraTrainingDescription
            : task.contentSummary
        const actionLabel =
          task.availability === 'startable'
            ? task.actionLabel
            : isExtraTraining
              ? task.actionLabel
            : task.statusLabel
        const ariaLabel =
          task.availability === 'startable'
            ? `${task.actionLabel}：${task.title}${trainingTaskDurationAriaDescription(task)}${recommendedAriaDescription(task.recommended)}`
            : isExtraTraining
              ? `${task.actionLabel}：${task.title}。${task.extraTrainingDescription}。今日 15 分钟已完成；不限时继续训练，主动退出时保存。`
            : `${task.statusLabel}：${task.title}。${task.unavailableDescription}`

        return (
          <li className="task-choice-list__item" key={task.moduleId}>
            <button
              className={[
                'task-row',
                `task-row--${stateClass}`,
                task.status === 'completed' || task.status === 'skipped'
                  ? 'task-row--finished'
                  : '',
                task.recommended ? 'task-row--recommended' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              type="button"
              disabled={!isStartable && (!isExtraTraining || !onExtraTrainingRequested)}
              data-module-id={task.moduleId}
              data-task-id={task.taskId ?? undefined}
              data-availability={task.availability}
              data-recommended={task.recommended ? 'true' : 'false'}
              aria-label={ariaLabel}
              onClick={
                task.availability === 'startable'
                  ? () => onTaskRequested(task.taskId)
                  : isExtraTraining && onExtraTrainingRequested
                    ? () => onExtraTrainingRequested(task.moduleId)
                    : undefined
              }
            >
              <span className={`task-icon task-icon--${task.accent}`}>
                <Icon name={task.icon} />
              </span>
              <span className="task-row__copy">
                <span className="task-row__title-line">
                  <strong>{task.title}</strong>
                  {task.recommended ? (
                    <span className="recommendation-badge">
                      建议先做
                    </span>
                  ) : null}
                </span>
                <small>{detail}</small>
                {task.availability === 'startable' ? (
                  task.trainingBudget ? (
                    <TrainingBudgetTarget
                      viewModel={task.trainingBudget}
                    />
                  ) : (
                    <TaskDurationEstimate
                      estimate={task.durationEstimate}
                    />
                  )
                ) : isExtraTraining ? (
                  <small className="task-row__extra-training-note">
                    今日 15 分钟已完成 · 不限时继续训练
                  </small>
                ) : null}
              </span>
              <span
                className={`task-row__status task-row__status--${stateClass}`}
              >
                {actionLabel}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function PracticeModuleGrid({
  modules,
  onBack,
  onAssessmentRequested,
  onTaskRequested,
  onExtraTrainingRequested,
}: {
  readonly modules: readonly PracticeModuleViewModel[]
  readonly onBack?: () => void
  readonly onAssessmentRequested: () => void
  readonly onTaskRequested: (taskId: string) => void
  readonly onExtraTrainingRequested?: (
    moduleId: TrainingPracticeModuleId,
  ) => void
}) {
  return (
    <>
      {onBack ? (
        <header className="detail-header training-framework-header">
          <button type="button" aria-label="返回训练方式" onClick={onBack}>
            <Icon name="arrow-left" />
          </button>
          <div>
            <span className="eyebrow">DAILY PRACTICE</span>
            <h1>日常训练</h1>
          </div>
        </header>
      ) : (
        <PageHeader eyebrow="PRACTICE" title="选择训练" />
      )}
      <p className="page-intro">
        水平测试和每日词汇、听力、口语都在这里；今日任务仍可自由选择。
      </p>
      <section className="module-grid" aria-label="训练模块">
        {modules.map((module) => {
          const presentation =
            practiceModulePresentation[module.moduleId]
          const isAssessment = module.moduleId === 'assessment'
          const isDisabled = isAssessment
            ? module.request.state === 'disabled'
            : module.availability === 'unavailable' ||
              (module.availability === 'extra-training' &&
                !onExtraTrainingRequested)
          const taskId = isAssessment ? undefined : module.taskId ?? undefined
          const isRecommended = !isAssessment && module.recommended
          const description = isAssessment
            ? module.request.state === 'disabled'
              ? module.request.reason
              : presentation.description
            : module.availability === 'unavailable'
              ? module.unavailableDescription
              : module.availability === 'extra-training'
                ? module.extraTrainingDescription
              : presentation.description
          const actionLabel = isAssessment
            ? module.request.label
            : module.availability === 'startable'
              ? module.actionLabel
              : module.availability === 'extra-training'
                ? module.actionLabel
              : module.statusLabel
          let ariaLabel: string
          if (module.moduleId === 'assessment') {
            ariaLabel =
              module.request.state === 'disabled'
                ? `${presentation.title}：${description}`
                : `${actionLabel}：${presentation.title}`
          } else if (module.availability === 'unavailable') {
            ariaLabel = `${presentation.title}：${description}`
          } else if (module.availability === 'extra-training') {
            ariaLabel =
              `${module.actionLabel}：${presentation.title}。${description}。不限时，主动退出时保存`
          } else {
            ariaLabel =
              `${actionLabel}：${presentation.title}` +
              trainingTaskDurationAriaDescription(module) +
              recommendedAriaDescription(isRecommended)
          }
          let onClick: (() => void) | undefined
          if (isAssessment) {
            if (module.request.state === 'enabled') {
              onClick = onAssessmentRequested
            }
          } else if (module.availability === 'startable') {
            const requestedTaskId = module.taskId
            onClick = () => onTaskRequested(requestedTaskId)
          } else if (
            module.availability === 'extra-training' &&
            onExtraTrainingRequested
          ) {
            const requestedModuleId = module.moduleId
            onClick = () =>
              onExtraTrainingRequested(requestedModuleId)
          }

          return (
            <button
              className={[
                'module-card',
                isRecommended ? 'module-card--recommended' : '',
                !isAssessment &&
                module.availability === 'unavailable' &&
                module.unavailableReason === 'invalid-task-data'
                  ? 'module-card--error'
                  : '',
                !isAssessment &&
                (module.status === 'completed' ||
                  module.status === 'skipped')
                  ? 'module-card--finished'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              type="button"
              key={module.moduleId}
              disabled={isDisabled}
              data-module-id={module.moduleId}
              data-task-id={taskId}
              data-availability={
                isAssessment
                  ? module.request.state
                  : module.availability
              }
              data-recommended={isRecommended ? 'true' : 'false'}
              aria-label={ariaLabel}
              onClick={onClick}
            >
              {isRecommended ? (
                <span className="recommendation-badge">
                  建议先做
                </span>
              ) : null}
              <span
                className={`task-icon task-icon--${presentation.accent}`}
              >
                <Icon name={presentation.icon} />
              </span>
              <h2>{presentation.title}</h2>
              <p>{description}</p>
              {!isAssessment &&
              (module.availability === 'startable' ||
                module.availability === 'extra-training') ? (
                module.availability === 'extra-training' ? (
                  <span className="training-budget-target training-budget-target--compact">
                    <span>
                      <small>额外训练</small>
                      <strong>不限时</strong>
                    </span>
                    <em>主动退出</em>
                  </span>
                ) : module.trainingBudget ? (
                  <TrainingBudgetTarget
                    viewModel={module.trainingBudget}
                  />
                ) : (
                  <TaskDurationEstimate
                    estimate={module.durationEstimate}
                  />
                )
              ) : null}
              <span className="module-card__action">
                {actionLabel}
                {!isDisabled ? <Icon name="arrow-right" /> : null}
              </span>
            </button>
          )
        })}
      </section>
    </>
  )
}

function ProgressPage({ progress, growth, onGrowthActionRequested }: { readonly progress: ProgressViewModel; readonly growth?: readonly GrowthProgressDomainViewModel[]; readonly onGrowthActionRequested?: (domain: GrowthProgressDomainViewModel['domain']) => void }) {
  const [selectedDomain, setSelectedDomain] = useState<GrowthProgressDomainViewModel['domain'] | null>(null)
  const selected = growth?.find((entry) => entry.domain === selectedDomain)
  const labels = { vocabulary: '词汇', listening: '听力', speaking: '口语' } as const
  const status = (entry: GrowthProgressDomainViewModel) => {
    if (entry.eligibility === 'eligible') return '已满足升级条件'
    if (entry.eligibility === 'test-in-progress') return '升级测试进行中'
    if (entry.eligibility === 'cooling-down') return `测试未通过，还需 ${entry.remainingCooldownSessions} 次正式训练`
    if (entry.eligibility === 'highest-level') return '已达最高等级'
    if (entry.progressPercent === 100) return '成长进度已满，继续补齐会话或正确率'
    if (entry.scoredItemCount < 50) return '继续积累可评分题目'
    return '继续积累最近正式训练成绩'
  }
  return (
    <>
      <PageHeader eyebrow="PROGRESS" title="学习进度" />
      <p className="page-intro">只看长期变化，不追逐一天的高低。</p>

      <section className="metric-grid" aria-label="本周学习概览">
        <article>
          <strong>{progress.studyDays}</strong>
          <span>学习天数</span>
        </article>
        <article>
          <strong>{progress.studyMinutes}</strong>
          <span>学习分钟</span>
        </article>
        <article>
          <strong>{progress.completedSessions}</strong>
          <span>完成训练</span>
        </article>
      </section>

      {growth ? <section className="weekly-card" aria-label="专项成长进度">
        <div className="section-heading"><div><span className="eyebrow">R17 GROWTH</span><h2>专项成长</h2></div></div>
        <p className="page-intro">三个专项独立升级；只有日常和额外训练的正式成绩会计入。</p>
        <div className="training-card-grid">
          {growth.map((entry) => <article className="task-card" key={entry.domain}>
            <span className="eyebrow">{labels[entry.domain]}</span><h3>{entry.currentLevelLabel}</h3>
            <div role="progressbar" aria-label={`${labels[entry.domain]}成长进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={entry.progressPercent} className="daily-brief__progress"><i style={{ width: `${entry.progressPercent}%` }} /></div>
            <p>成长进度 {entry.progressPercent}% · 最近 {entry.recentSessionCount}/5 次</p>
            <p>可评分 {entry.scoredItemCount} 题 · 正确率 {entry.recentAccuracyPercent === null ? '暂无' : `${entry.recentAccuracyPercent}%`}</p>
            <p>{status(entry)}</p>
            {(entry.eligibility === 'eligible' || entry.eligibility === 'test-in-progress') ? <button type="button" className="primary-button" disabled={entry.action.disabled} aria-busy={entry.action.busy} onClick={() => onGrowthActionRequested?.(entry.domain)}>{entry.action.label}</button> : null}
            <button type="button" className="secondary-button" onClick={() => setSelectedDomain(entry.domain)}>查看详情</button>
          </article>)}
        </div>
      </section> : null}

      {selected ? <section className="weekly-card" aria-label={`${labels[selected.domain]}成长详情`}>
        <div className="section-heading"><div><span className="eyebrow">{labels[selected.domain]} GROWTH</span><h2>{selected.currentLevelLabel}</h2></div><button type="button" className="text-button" onClick={() => setSelectedDomain(null)}>关闭</button></div>
        <p>升级条件：最近 5 次正式训练、累计至少 50 道可评分题、正确率至少 80%，且成长进度达到 100%。</p>
        {selected.activeTest ? <p>升级测试：第 {selected.activeTest.index + 1}/10 题，当前答对 {selected.activeTest.score.correctCount} 题。退出后会保存进度。</p> : null}
        <button type="button" className="primary-button" disabled={selected.action.disabled} aria-busy={selected.action.busy} onClick={() => onGrowthActionRequested?.(selected.domain)}>{selected.action.label}</button>
      </section> : null}

      <section className="weekly-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">THIS WEEK</span>
            <h2>每日投入</h2>
          </div>
          <span className="weekly-card__unit">分钟</span>
        </div>
        <div className="weekly-bars" aria-label="本周每日学习时长">
          {progress.weeklyBars.map((day) => (
            <div
              className={day.isToday ? 'weekly-bar weekly-bar--today' : 'weekly-bar'}
              key={day.label}
            >
              <span className="weekly-bar__track">
                <i style={{ height: `${day.value}%` }} />
              </span>
              <small>{day.label}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="progress-note">
        <span className="progress-note__mark">Aa</span>
        <div>
          <span className="eyebrow">ABILITY TREND</span>
          <h2>能力趋势待接入</h2>
          <p>详细能力变化将在学习模块提供数据后展示。</p>
        </div>
      </section>
    </>
  )
}

function PageHeader({
  eyebrow,
  title,
}: {
  readonly eyebrow: string
  readonly title: string
}) {
  return (
    <header className="page-header">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
    </header>
  )
}
