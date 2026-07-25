import { useState, type CSSProperties } from 'react'
import { OfflineNotice } from './feedback-states.tsx'
import { Icon, type IconName } from './icons.tsx'

type AppSection = 'today' | 'practice' | 'progress'
export type DailyTaskStatus = 'complete' | 'current' | 'upcoming'
export type PracticeModuleId =
  | 'assessment'
  | 'vocabulary'
  | 'listening'
  | 'speaking'
export type TrainingPracticeModuleId = Exclude<
  PracticeModuleId,
  'assessment'
>

export type DailyTaskRequestViewModel =
  | {
      readonly state: 'enabled'
      readonly label: string
    }
  | {
      readonly state: 'disabled'
      readonly label: string
      readonly reason: string
    }

export type DailyPlanPrimaryActionViewModel =
  | {
      readonly state: 'enabled'
      readonly label: string
      /**
       * Must match one DailyTaskViewModel.id from the same plan.
       */
      readonly taskId: string
    }
  | {
      readonly state: 'disabled'
      readonly label: string
      readonly reason: string
    }

export interface DailyTaskViewModel {
  /**
   * Exact LearningTask.taskId. The UI never generates, normalizes or rewrites it.
   */
  readonly id: string
  readonly title: string
  readonly meta: string
  readonly status: DailyTaskStatus
  readonly icon: IconName
  readonly accent: 'indigo' | 'coral' | 'mint'
  readonly request: DailyTaskRequestViewModel
}

export interface DailyPlanViewModel {
  readonly dateLabel: string
  readonly greeting: string
  readonly streakDays: number
  readonly summary: string
  readonly progressLabel: string
  readonly progressPercent: number
  readonly tasks: readonly DailyTaskViewModel[]
  readonly primaryAction: DailyPlanPrimaryActionViewModel
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
  | {
      /**
       * Stable UI identity only. Never use this value as a task id.
       */
      readonly moduleId: TrainingPracticeModuleId
      readonly request:
        | {
            readonly state: 'enabled'
            readonly label: string
            /**
             * Exact LearningTask.taskId. The UI returns it unchanged.
             */
            readonly taskId: string
          }
        | {
            readonly state: 'disabled'
            readonly label: string
            readonly reason: string
          }
    }

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
    request: {
      state: 'disabled',
      label: '暂不可用',
      reason: '词汇训练入口尚未接入。',
    },
  },
  {
    moduleId: 'listening',
    request: {
      state: 'disabled',
      label: '暂不可用',
      reason: '听力训练入口尚未接入。',
    },
  },
  {
    moduleId: 'speaking',
    request: {
      state: 'disabled',
      label: '暂不可用',
      reason: '口语训练入口尚未接入。',
    },
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

function isTaskRequestable(task: DailyTaskViewModel): boolean {
  return task.status !== 'complete' && task.request.state === 'enabled'
}

function primaryTaskFor(
  plan: DailyPlanViewModel,
): DailyTaskViewModel | undefined {
  const primaryAction = plan.primaryAction
  if (primaryAction.state === 'disabled') {
    return undefined
  }

  return plan.tasks.find(
    (task) =>
      task.id === primaryAction.taskId && isTaskRequestable(task),
  )
}

function TodayPage({
  plan,
  onTaskRequested,
}: {
  readonly plan: DailyPlanViewModel
  readonly onTaskRequested: (taskId: string) => void
}) {
  const primaryTask = primaryTaskFor(plan)
  const primaryDisabledReason =
    plan.primaryAction.state === 'disabled'
      ? plan.primaryAction.reason
      : primaryTask
        ? undefined
        : '当前计划指定的任务暂时不可执行。'

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
            <span className="eyebrow">DAILY RHYTHM</span>
            <h2 id="plan-heading">接下来</h2>
          </div>
          <span className="section-heading__count">{plan.tasks.length} 项</span>
        </div>

        <ol className="task-rail">
          {plan.tasks.map((task, index) => {
            const requestable = isTaskRequestable(task)
            const requestDescription =
              task.request.state === 'disabled'
                ? `，${task.request.reason}`
                : ''

            return (
              <li
                className={`task-rail__item task-rail__item--${task.status}`}
                key={task.id}
              >
                <button
                  className={`task-row task-row--${task.status}`}
                  type="button"
                  disabled={!requestable}
                  data-task-id={task.id}
                  aria-label={`${task.request.label}：${task.title}${requestDescription}`}
                  onClick={() => onTaskRequested(task.id)}
                >
                  <span className="task-rail__step" aria-hidden="true">
                    {task.status === 'complete' ? (
                      <Icon name="check" />
                    ) : (
                      String(index + 1).padStart(2, '0')
                    )}
                  </span>
                  <span className={`task-icon task-icon--${task.accent}`}>
                    <Icon name={task.icon} />
                  </span>
                  <span className="task-row__copy">
                    <strong>{task.title}</strong>
                    <small>{task.meta}</small>
                  </span>
                  <span
                    className={`task-row__status task-row__status--${task.request.state}`}
                  >
                    {task.request.label}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </section>

      <button
        className="primary-button"
        type="button"
        disabled={!primaryTask}
        data-task-id={primaryTask?.id}
        aria-label={
          primaryDisabledReason
            ? `${plan.primaryAction.label}，${primaryDisabledReason}`
            : plan.primaryAction.label
        }
        onClick={() => {
          if (primaryTask) {
            onTaskRequested(primaryTask.id)
          }
        }}
      >
        {plan.primaryAction.label}
        <Icon name="arrow-right" />
      </button>
    </>
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
      <p className="page-intro">选择水平测试或专项训练。</p>
      <section className="module-grid" aria-label="训练模块">
        {modules.map((module) => {
          const presentation =
            practiceModulePresentation[module.moduleId]
          const isDisabled = module.request.state === 'disabled'
          const taskId =
            module.moduleId === 'assessment' ||
            module.request.state === 'disabled'
              ? undefined
              : module.request.taskId
          const description = isDisabled
            ? module.request.reason
            : presentation.description
          const ariaLabel = isDisabled
            ? `${presentation.title}：${module.request.reason}`
            : `${module.request.label}：${presentation.title}`
          let onClick: (() => void) | undefined
          if (module.request.state === 'enabled') {
            if (module.moduleId === 'assessment') {
              onClick = onAssessmentRequested
            } else {
              const requestedTaskId = module.request.taskId
              onClick = () => onTaskRequested(requestedTaskId)
            }
          }

          return (
            <button
              className="module-card"
              type="button"
              key={module.moduleId}
              disabled={isDisabled}
              data-module-id={module.moduleId}
              data-task-id={taskId}
              aria-label={ariaLabel}
              onClick={onClick}
            >
              <span
                className={`task-icon task-icon--${presentation.accent}`}
              >
                <Icon name={presentation.icon} />
              </span>
              <h2>{presentation.title}</h2>
              <p>{description}</p>
              <span className="module-card__action">
                {module.request.label}
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
