import {
  ActualEffectiveDuration,
  TrainingUnitScore,
} from './duration-surfaces.tsx'
import {
  toTrainingDisplaySeconds,
  trainingBlockDurationLabel,
} from '../config/training-test-mode.ts'
import {
  ListeningTrainingScreen,
  SpeakingTrainingScreen,
  VocabularyTrainingScreen,
  type ListeningTrainingScreenProps,
  type SpeakingTrainingScreenProps,
  type VocabularyTrainingScreenProps,
} from './practice-screens.tsx'
import { Icon, type IconName } from './icons.tsx'
import {
  formatTrainingBudgetClock,
  formatTrainingBudgetTarget,
} from './training-budget-format.ts'
import type {
  ExtraTrainingActionViewModel,
  ExtraTrainingActiveSessionViewModel,
  ExtraTrainingCompletionViewModel,
  ExtraTrainingModuleId,
  ExtraTrainingModuleViewModel,
  ExtraTrainingPickerViewModel,
} from './extra-training-view-models.ts'
import type { TrainingHeaderViewModel } from './view-models.ts'

type MaybeAsyncIntent<TValue> = (
  value: TValue,
) => void | Promise<void>

function singleFlightIntent<TValue>(
  intent: MaybeAsyncIntent<TValue>,
  value: TValue,
): () => void {
  let pending = false

  return () => {
    if (pending) {
      return
    }

    pending = true
    try {
      const result = intent(value)
      void Promise.resolve(result).then(
        () => {
          pending = false
        },
        () => {
          pending = false
        },
      )
    } catch (error) {
      pending = false
      throw error
    }
  }
}

function actionDisabled(
  action: ExtraTrainingActionViewModel,
): boolean {
  return Boolean(action.disabled || action.loading)
}

const modulePresentation: Record<
  ExtraTrainingModuleId,
  {
    readonly icon: IconName
    readonly eyebrow: string
    readonly accent: 'mint' | 'indigo' | 'coral'
  }
> = {
  vocabulary: {
    icon: 'book',
    eyebrow: 'VOCABULARY',
    accent: 'mint',
  },
  listening: {
    icon: 'headphones',
    eyebrow: 'LISTENING',
    accent: 'indigo',
  },
  speaking: {
    icon: 'mic',
    eyebrow: 'SPEAKING',
    accent: 'coral',
  },
}

function statusCopy(module: ExtraTrainingModuleViewModel): {
  readonly label: string
  readonly description: string
} {
  switch (module.status) {
    case 'available':
      return {
        label: '可开始新一轮',
        description: `从新的 ${trainingBlockDurationLabel()}有效训练块开始。`,
      }
    case 'paused':
      return {
        label: '已保存，可继续',
        description: '从上次退出时保存的位置继续。',
      }
    case 'running':
      return {
        label: '正在进行',
        description: '已有一轮额外训练正在进行。',
      }
    case 'completed':
      return {
        label: '本轮已完成',
        description: '这轮记录已完成；可以另开一轮继续练习。',
      }
    case 'content-exhausted':
      return {
        label: '题库暂时不足',
        description: module.failureDescription,
      }
    case 'failed':
      return {
        label:
          module.failureReason === 'device-failure'
            ? '设备暂时不可用'
            : '内容暂时无法加载',
        description: module.failureDescription,
      }
    case 'expired':
      return {
        label: '上次训练已跨日结束',
        description: `旧会话不会并入今天；可以开始新的 ${trainingBlockDurationLabel()}。`,
      }
  }
}

function moduleAction(
  module: ExtraTrainingModuleViewModel,
): ExtraTrainingActionViewModel {
  switch (module.status) {
    case 'available':
    case 'completed':
    case 'expired':
      return module.startAction
    case 'paused':
    case 'running':
      return module.resumeAction
    case 'content-exhausted':
    case 'failed':
      return module.retryAction
  }
}

function moduleIntent(
  module: ExtraTrainingModuleViewModel,
  callbacks: Pick<
    ExtraTrainingPickerScreenProps,
    | 'onStartRequested'
    | 'onResumeRequested'
    | 'onRetryRequested'
  >,
): () => void {
  switch (module.status) {
    case 'available':
    case 'completed':
    case 'expired':
      return singleFlightIntent(
        callbacks.onStartRequested,
        module.moduleId,
      )
    case 'paused':
    case 'running':
      return singleFlightIntent(
        callbacks.onResumeRequested,
        module.sessionId,
      )
    case 'content-exhausted':
    case 'failed':
      return singleFlightIntent(
        callbacks.onRetryRequested,
        module.sessionId,
      )
  }
}

function hasProgress(
  module: ExtraTrainingModuleViewModel,
): module is Extract<
  ExtraTrainingModuleViewModel,
  {
    readonly status:
      | 'paused'
      | 'running'
      | 'completed'
      | 'content-exhausted'
      | 'failed'
  }
> {
  return (
    module.status === 'paused' ||
    module.status === 'running' ||
    module.status === 'completed' ||
    module.status === 'content-exhausted' ||
    module.status === 'failed'
  )
}

export interface ExtraTrainingPickerScreenProps {
  readonly viewModel: ExtraTrainingPickerViewModel
  readonly onStartRequested: MaybeAsyncIntent<ExtraTrainingModuleId>
  readonly onResumeRequested: MaybeAsyncIntent<string>
  readonly onRetryRequested: MaybeAsyncIntent<string>
  readonly onReturnToCompletedPlan: () => void | Promise<void>
}

export function ExtraTrainingPickerScreen({
  viewModel,
  onStartRequested,
  onResumeRequested,
  onRetryRequested,
  onReturnToCompletedPlan,
}: ExtraTrainingPickerScreenProps) {
  const returnDisabled = actionDisabled(viewModel.returnAction)
  const returnIntent = singleFlightIntent(
    onReturnToCompletedPlan,
    undefined,
  )

  return (
    <main className="extra-training-picker">
      <header className="extra-training-picker__header">
        <span
          className="extra-training-picker__mark"
          aria-hidden="true"
        >
          <Icon name="spark" />
        </span>
        <span className="eyebrow">OPTIONAL PRACTICE</span>
        <h1>继续训练</h1>
        <p>
          每次选择一个 {trainingBlockDurationLabel()}有效训练块。它属于额外练习，
          不会改变今日 3/3 完成状态。
        </p>
      </header>

      <section
        className="extra-training-picker__modules"
        aria-label="选择额外训练模块"
      >
        {viewModel.modules.map((module) => {
          const presentation = modulePresentation[module.moduleId]
          const copy = statusCopy(module)
          const action = moduleAction(module)
          const disabled = actionDisabled(action)
          const intent = moduleIntent(module, {
            onStartRequested,
            onResumeRequested,
            onRetryRequested,
          })
          const targetLabel = formatTrainingBudgetTarget(
            toTrainingDisplaySeconds(module.targetEffectiveSeconds),
          )

          return (
            <article
              className={[
                'extra-training-module-card',
                `extra-training-module-card--${presentation.accent}`,
              ].join(' ')}
              data-module-id={module.moduleId}
              data-extra-training-status={module.status}
              key={module.moduleId}
            >
              <span
                className="extra-training-module-card__icon"
                aria-hidden="true"
              >
                <Icon name={presentation.icon} />
              </span>
              <div className="extra-training-module-card__body">
                <span className="eyebrow">
                  {presentation.eyebrow}
                </span>
                <div className="extra-training-module-card__title">
                  <h2>{module.title}</h2>
                  <span>{copy.label}</span>
                </div>
                <p>{module.description}</p>
                <p className="extra-training-module-card__state">
                  {copy.description}
                </p>
                <dl className="extra-training-module-card__metrics">
                  <div>
                    <dt>本轮目标</dt>
                    <dd>{targetLabel}</dd>
                  </div>
                  {hasProgress(module) ? (
                    <>
                      <div>
                        <dt>剩余有效时间</dt>
                        <dd>
                          {formatTrainingBudgetClock(
                            toTrainingDisplaySeconds(
                              module.remainingEffectiveSeconds,
                            ),
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>累计完成</dt>
                        <dd>{module.completedItemCount} 题</dd>
                      </div>
                    </>
                  ) : module.status === 'expired' ? (
                    <div>
                      <dt>上次累计</dt>
                      <dd>{module.completedItemCount} 题</dd>
                    </div>
                  ) : null}
                </dl>
                {action.disabledReason ? (
                  <small className="extra-training-module-card__reason">
                    {action.disabledReason}
                  </small>
                ) : null}
                <button
                  className="secondary-button"
                  type="button"
                  disabled={disabled}
                  aria-busy={action.loading || undefined}
                  aria-label={`${action.label}：${module.title}，${copy.label}`}
                  onClick={disabled ? undefined : intent}
                >
                  {action.loading ? '正在处理' : action.label}
                  <Icon name="arrow-right" />
                </button>
              </div>
            </article>
          )
        })}
      </section>

      <button
        className="text-button extra-training-picker__return"
        type="button"
        disabled={returnDisabled}
        aria-busy={viewModel.returnAction.loading || undefined}
        onClick={returnDisabled ? undefined : returnIntent}
      >
        {viewModel.returnAction.loading
          ? '正在返回'
          : viewModel.returnAction.label}
      </button>
    </main>
  )
}

function extraTrainingHeader(
  header: TrainingHeaderViewModel,
  extraTraining: ExtraTrainingActiveSessionViewModel,
): TrainingHeaderViewModel {
  return {
    eyebrow: header.eyebrow,
    title: header.title,
    progress: header.progress,
    trainingBudget: extraTraining.budget,
  }
}

function contextNotice(
  moduleLabel: string,
  exitAction: ExtraTrainingActionViewModel,
) {
  return {
    eyebrow: 'EXTRA PRACTICE',
    title: `额外训练 · ${moduleLabel}`,
    description: [
      '退出并保存当前进度；本轮属于额外练习，不会改变今日 3/3 完成状态。',
      exitAction.disabledReason,
    ]
      .filter(Boolean)
      .join(' '),
  } as const
}

type ExtraVocabularyTrainingScreenProps = Omit<
  VocabularyTrainingScreenProps,
  | 'viewModel'
  | 'onExit'
  | 'onRetryTrainingContent'
  | 'exitLabel'
  | 'exitDisabled'
  | 'exitBusy'
  | 'contextNotice'
> & {
  readonly viewModel: VocabularyTrainingScreenProps['viewModel']
  readonly extraTraining: ExtraTrainingActiveSessionViewModel<'vocabulary'>
  readonly onExitRequested: MaybeAsyncIntent<string>
  readonly onRetryRequested: MaybeAsyncIntent<string>
}

export function ExtraVocabularyTrainingScreen({
  viewModel,
  extraTraining,
  onExitRequested,
  onRetryRequested,
  ...callbacks
}: ExtraVocabularyTrainingScreenProps) {
  return (
    <VocabularyTrainingScreen
      {...callbacks}
      viewModel={{
        ...viewModel,
        header: extraTrainingHeader(
          viewModel.header,
          extraTraining,
        ),
      }}
      exitLabel={
        extraTraining.exitAction.loading
          ? '正在保存额外词汇训练'
          : '退出并保存额外词汇训练'
      }
      exitDisabled={actionDisabled(extraTraining.exitAction)}
      exitBusy={extraTraining.exitAction.loading}
      contextNotice={contextNotice(
        '词汇',
        extraTraining.exitAction,
      )}
      onExit={singleFlightIntent(
        onExitRequested,
        extraTraining.sessionId,
      )}
      onRetryTrainingContent={singleFlightIntent(
        onRetryRequested,
        extraTraining.sessionId,
      )}
    />
  )
}

type ExtraListeningTrainingScreenProps = Omit<
  ListeningTrainingScreenProps,
  | 'viewModel'
  | 'onExit'
  | 'onRetryTrainingContent'
  | 'exitLabel'
  | 'exitDisabled'
  | 'exitBusy'
  | 'contextNotice'
> & {
  readonly viewModel: ListeningTrainingScreenProps['viewModel']
  readonly extraTraining: ExtraTrainingActiveSessionViewModel<'listening'>
  readonly onExitRequested: MaybeAsyncIntent<string>
  readonly onRetryRequested: MaybeAsyncIntent<string>
}

export function ExtraListeningTrainingScreen({
  viewModel,
  extraTraining,
  onExitRequested,
  onRetryRequested,
  ...callbacks
}: ExtraListeningTrainingScreenProps) {
  return (
    <ListeningTrainingScreen
      {...callbacks}
      viewModel={{
        ...viewModel,
        header: extraTrainingHeader(
          viewModel.header,
          extraTraining,
        ),
      }}
      exitLabel={
        extraTraining.exitAction.loading
          ? '正在保存额外听力训练'
          : '退出并保存额外听力训练'
      }
      exitDisabled={actionDisabled(extraTraining.exitAction)}
      exitBusy={extraTraining.exitAction.loading}
      contextNotice={contextNotice(
        '听力',
        extraTraining.exitAction,
      )}
      onExit={singleFlightIntent(
        onExitRequested,
        extraTraining.sessionId,
      )}
      onRetryTrainingContent={singleFlightIntent(
        onRetryRequested,
        extraTraining.sessionId,
      )}
    />
  )
}

type ExtraSpeakingTrainingScreenProps = Omit<
  SpeakingTrainingScreenProps,
  | 'viewModel'
  | 'onExit'
  | 'onRetryTrainingContent'
  | 'exitLabel'
  | 'exitDisabled'
  | 'exitBusy'
  | 'contextNotice'
> & {
  readonly viewModel: SpeakingTrainingScreenProps['viewModel']
  readonly extraTraining: ExtraTrainingActiveSessionViewModel<'speaking'>
  readonly onExitRequested: MaybeAsyncIntent<string>
  readonly onRetryRequested: MaybeAsyncIntent<string>
}

export function ExtraSpeakingTrainingScreen({
  viewModel,
  extraTraining,
  onExitRequested,
  onRetryRequested,
  ...callbacks
}: ExtraSpeakingTrainingScreenProps) {
  return (
    <SpeakingTrainingScreen
      {...callbacks}
      viewModel={{
        ...viewModel,
        header: extraTrainingHeader(
          viewModel.header,
          extraTraining,
        ),
      }}
      exitLabel={
        extraTraining.exitAction.loading
          ? '正在保存额外口语训练'
          : '退出并保存额外口语训练'
      }
      exitDisabled={actionDisabled(extraTraining.exitAction)}
      exitBusy={extraTraining.exitAction.loading}
      contextNotice={contextNotice(
        '口语',
        extraTraining.exitAction,
      )}
      onExit={singleFlightIntent(
        onExitRequested,
        extraTraining.sessionId,
      )}
      onRetryTrainingContent={singleFlightIntent(
        onRetryRequested,
        extraTraining.sessionId,
      )}
    />
  )
}

export interface ExtraTrainingCompletionScreenProps {
  readonly viewModel: ExtraTrainingCompletionViewModel
  readonly onChooseAnotherRequested: MaybeAsyncIntent<string>
  readonly onReturnToCompletedPlan: MaybeAsyncIntent<string>
}

export function ExtraTrainingCompletionScreen({
  viewModel,
  onChooseAnotherRequested,
  onReturnToCompletedPlan,
}: ExtraTrainingCompletionScreenProps) {
  const chooseDisabled = actionDisabled(
    viewModel.chooseAgainAction,
  )
  const returnDisabled = actionDisabled(viewModel.returnAction)

  return (
    <main
      className="training-completion-screen extra-training-completion-screen"
      data-module-id={viewModel.moduleId}
      data-extra-training-session-id={viewModel.sessionId}
    >
      <section className="training-completion-card">
        <span
          className="training-completion-card__icon"
          aria-hidden="true"
        >
          <Icon name="check" />
        </span>
        <span className="eyebrow">EXTRA PRACTICE COMPLETE</span>
        <h1>{viewModel.title}</h1>
        <p>{viewModel.description}</p>
        <p className="extra-training-completion-screen__count">
          本轮累计完成 {viewModel.completedItemCount} 题
        </p>
        <TrainingUnitScore score={viewModel.score} />
        <ActualEffectiveDuration
          duration={viewModel.actualDuration}
        />
        <div className="extra-training-completion-screen__actions">
          <button
            className="primary-button"
            type="button"
            disabled={chooseDisabled}
            aria-busy={
              viewModel.chooseAgainAction.loading || undefined
            }
            onClick={
              chooseDisabled
                ? undefined
                : singleFlightIntent(
                    onChooseAnotherRequested,
                    viewModel.sessionId,
                  )
            }
          >
            {viewModel.chooseAgainAction.loading
              ? '正在打开'
              : viewModel.chooseAgainAction.label}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={returnDisabled}
            aria-busy={viewModel.returnAction.loading || undefined}
            onClick={
              returnDisabled
                ? undefined
                : singleFlightIntent(
                    onReturnToCompletedPlan,
                    viewModel.sessionId,
                  )
            }
          >
            {viewModel.returnAction.loading
              ? '正在返回'
              : viewModel.returnAction.label}
          </button>
        </div>
      </section>
    </main>
  )
}

export type {
  ExtraListeningTrainingScreenProps,
  ExtraSpeakingTrainingScreenProps,
  ExtraVocabularyTrainingScreenProps,
}
