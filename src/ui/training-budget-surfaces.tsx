import type {
  TrainingBudgetProgressViewModel,
  TrainingBudgetTargetViewModel,
} from './training-budget-view-models.ts'
import {
  formatTrainingBudgetClock,
  formatTrainingBudgetTarget,
} from './training-budget-format.ts'

export function TrainingBudgetTarget({
  viewModel,
  appearance = 'compact',
}: {
  readonly viewModel: TrainingBudgetTargetViewModel
  readonly appearance?: 'compact' | 'strip'
}) {
  const targetLabel = formatTrainingBudgetTarget(
    viewModel.targetEffectiveSeconds,
  )

  return (
    <span
      className={`training-budget-target training-budget-target--${appearance}`}
      data-training-duration-kind="training-budget"
      data-target-effective-seconds={viewModel.targetEffectiveSeconds}
      aria-label={`训练目标：${targetLabel}。只累计前台有效练习`}
    >
      <span aria-hidden="true">
        <small>训练目标</small>
        <strong>{targetLabel}</strong>
      </span>
      <em aria-hidden="true">有效时间</em>
    </span>
  )
}

function budgetStatusCopy(
  status: TrainingBudgetProgressViewModel['status'],
): {
  readonly title: string
  readonly description: string
} {
  switch (status) {
    case 'running':
      return {
        title: '有效训练进行中',
        description:
          '只在前台有效练习时累计；暂停、后台、等待和长时间无操作不计入。',
      }
    case 'finish-current-item':
      return {
        title: '时间已到，完成本题后结束',
        description:
          '当前播放、作答、反馈或录音会自然完成，不会被中途截断。',
      }
    case 'content-exhausted':
      return {
        title: '题库暂时不足，训练尚未完成',
        description:
          '当前没有可继续提供的合格题目；已完成内容和剩余有效时间都会保留。',
      }
    case 'completed':
      return {
        title: '有效训练目标已完成',
        description:
          '本次预算任务已由训练运行时确认完成。',
      }
  }
}

export function TrainingBudgetProgress({
  viewModel,
  onRetryContent,
}: {
  readonly viewModel: TrainingBudgetProgressViewModel
  readonly onRetryContent?: () => void
}) {
  const statusCopy = budgetStatusCopy(viewModel.status)
  const targetLabel = formatTrainingBudgetClock(
    viewModel.targetEffectiveSeconds,
  )
  const remainingLabel = formatTrainingBudgetClock(
    viewModel.remainingEffectiveSeconds,
  )
  const isExhausted = viewModel.status === 'content-exhausted'
  const retryDisabled =
    isExhausted &&
    (viewModel.retryAction.disabled ||
      viewModel.retryAction.loading ||
      !onRetryContent)

  return (
    <section
      className={[
        'training-budget-progress',
        `training-budget-progress--${viewModel.status}`,
      ].join(' ')}
      data-budget-status={viewModel.status}
      data-target-effective-seconds={viewModel.targetEffectiveSeconds}
      data-remaining-effective-seconds={
        viewModel.remainingEffectiveSeconds
      }
      data-completed-item-count={viewModel.completedItemCount}
      aria-label={`${statusCopy.title}。目标 ${targetLabel}，剩余有效时间 ${remainingLabel}，累计完成 ${viewModel.completedItemCount} 题。${statusCopy.description}`}
    >
      <div className="training-budget-progress__status">
        <span className="eyebrow">EFFECTIVE TRAINING</span>
        <h2
          aria-live={viewModel.status === 'running' ? undefined : 'polite'}
        >
          {statusCopy.title}
        </h2>
        <p>{statusCopy.description}</p>
      </div>

      <dl className="training-budget-progress__metrics">
        <div>
          <dt>目标</dt>
          <dd aria-label={`目标有效训练 ${targetLabel}`}>{targetLabel}</dd>
        </div>
        <div>
          <dt>剩余有效时间</dt>
          <dd aria-label={`剩余有效时间 ${remainingLabel}`}>
            {remainingLabel}
          </dd>
        </div>
        <div>
          <dt>累计完成题数</dt>
          <dd>{viewModel.completedItemCount} 题</dd>
        </div>
      </dl>

      {isExhausted ? (
        <div className="training-budget-progress__recovery">
          <p>
            {viewModel.contentExhausted.description}
            {viewModel.retryAction.disabledReason
              ? ` ${viewModel.retryAction.disabledReason}`
              : ''}
          </p>
          <button
            className="secondary-button"
            type="button"
            disabled={retryDisabled}
            aria-busy={viewModel.retryAction.loading || undefined}
            aria-label={`${viewModel.retryAction.label}：题库暂时不足，训练尚未完成`}
            onClick={retryDisabled ? undefined : onRetryContent}
          >
            {viewModel.retryAction.loading
              ? '正在重新获取'
              : viewModel.retryAction.label}
          </button>
        </div>
      ) : null}
    </section>
  )
}
