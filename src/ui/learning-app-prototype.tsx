import { useState, type CSSProperties } from 'react'
import { OfflineNotice } from './feedback-states.tsx'
import { Icon, type IconName } from './icons.tsx'

type AppSection = 'today' | 'practice' | 'progress'
export type PracticeModuleId =
  | 'assessment'
  | 'vocabulary'
  | 'listening'
  | 'speaking'
export type TrainingPracticeModuleId = Exclude<
  PracticeModuleId,
  'assessment'
>
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

export type TrainingTaskAccessViewModel =
  | (TrainingTaskAccessBase & {
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

interface DailyTaskPresentation {
  readonly title: string
  readonly meta: string
  readonly icon: IconName
  readonly accent: 'indigo' | 'coral' | 'mint'
}

export type DailyTaskViewModel =
  TrainingTaskAccessViewModel & DailyTaskPresentation

export interface DailyPlanViewModel {
  readonly dateLabel: string
  readonly greeting: string
  readonly streakDays: number
  readonly summary: string
  readonly progressLabel: string
  readonly progressPercent: number
  readonly tasks: readonly DailyTaskViewModel[]
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
  readonly offline?: boolean
  readonly onTaskRequested: (taskId: string) => void
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
  offline = false,
  onTaskRequested,
  practiceModules,
  onAssessmentRequested,
}: LearningAppPrototypeProps) {
  const [section, setSection] = useState<AppSection>('today')

  return (
    <div className="learning-app">
      <div className="learning-app__page">
        {offline ? <OfflineNotice /> : null}
        {section === 'today' ? (
          <TodayPage
            plan={plan}
            onTaskRequested={onTaskRequested}
          />
        ) : null}
        {section === 'practice' ? (
          <PracticeModuleGrid
            modules={practiceModules ?? disconnectedPracticeModules}
            onAssessmentRequested={
              onAssessmentRequested ?? (() => undefined)
            }
            onTaskRequested={onTaskRequested}
          />
        ) : null}
        {section === 'progress' ? <ProgressPage progress={progress} /> : null}
      </div>

      <nav className="bottom-nav" aria-label="主要导航">
        {navigation.map((item) => (
          <button
            className="bottom-nav__item"
            type="button"
            key={item.id}
            aria-current={section === item.id ? 'page' : undefined}
            onClick={() => setSection(item.id)}
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
}: {
  readonly plan: DailyPlanViewModel
  readonly onTaskRequested: (taskId: string) => void
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
          <span>{plan.summary}</span>
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
        />
      </section>
    </>
  )
}

function recommendedAriaDescription(recommended: boolean): string {
  return recommended
    ? '。建议先做；其他未完成任务同样可选'
    : ''
}

export function TodayTaskList({
  tasks,
  onTaskRequested,
}: {
  readonly tasks: readonly DailyTaskViewModel[]
  readonly onTaskRequested: (taskId: string) => void
}) {
  return (
    <ul className="task-choice-list">
      {tasks.map((task) => {
        const isStartable = task.availability === 'startable'
        const stateClass =
          task.availability === 'unavailable' &&
          task.unavailableReason === 'invalid-task-data'
            ? 'error'
            : task.availability
        const detail =
          task.availability === 'unavailable'
            ? task.unavailableDescription
            : task.meta
        const actionLabel =
          task.availability === 'startable'
            ? task.actionLabel
            : task.statusLabel
        const ariaLabel =
          task.availability === 'startable'
            ? `${task.actionLabel}：${task.title}${recommendedAriaDescription(task.recommended)}`
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
              disabled={!isStartable}
              data-module-id={task.moduleId}
              data-task-id={task.taskId ?? undefined}
              data-availability={task.availability}
              data-recommended={task.recommended ? 'true' : 'false'}
              aria-label={ariaLabel}
              onClick={
                task.availability === 'startable'
                  ? () => onTaskRequested(task.taskId)
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
  onAssessmentRequested,
  onTaskRequested,
}: {
  readonly modules: readonly PracticeModuleViewModel[]
  readonly onAssessmentRequested: () => void
  readonly onTaskRequested: (taskId: string) => void
}) {
  return (
    <>
      <PageHeader eyebrow="PRACTICE" title="选择训练" />
      <p className="page-intro">
        今日任务可自由选择；“建议先做”只是推荐，不影响其他可用任务。
      </p>
      <section className="module-grid" aria-label="训练模块">
        {modules.map((module) => {
          const presentation =
            practiceModulePresentation[module.moduleId]
          const isAssessment = module.moduleId === 'assessment'
          const isDisabled = isAssessment
            ? module.request.state === 'disabled'
            : module.availability === 'unavailable'
          const taskId = isAssessment ? undefined : module.taskId ?? undefined
          const isRecommended = !isAssessment && module.recommended
          const description = isAssessment
            ? module.request.state === 'disabled'
              ? module.request.reason
              : presentation.description
            : module.availability === 'unavailable'
              ? module.unavailableDescription
              : presentation.description
          const actionLabel = isAssessment
            ? module.request.label
            : module.availability === 'startable'
              ? module.actionLabel
              : module.statusLabel
          const ariaLabel = isDisabled
            ? `${presentation.title}：${description}`
            : `${actionLabel}：${presentation.title}${recommendedAriaDescription(isRecommended)}`
          let onClick: (() => void) | undefined
          if (isAssessment) {
            if (module.request.state === 'enabled') {
              onClick = onAssessmentRequested
            }
          } else if (module.availability === 'startable') {
            const requestedTaskId = module.taskId
            onClick = () => onTaskRequested(requestedTaskId)
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

function ProgressPage({ progress }: { readonly progress: ProgressViewModel }) {
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
