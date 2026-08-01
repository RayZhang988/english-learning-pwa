import { useId } from 'react'
import { trainingBlockDurationLabel } from '../config/training-test-mode.ts'
import { Icon } from './icons.tsx'
import { TrainingBudgetProgress } from './training-budget-surfaces.tsx'
import {
  formatDurationEstimateBasis,
  formatEffectiveDuration,
  formatEstimatedDuration,
} from './duration-format.ts'
import type {
  ActualEffectiveDurationViewModel,
  DailyEffectiveDurationSummaryViewModel,
  TaskDurationEstimateViewModel,
  TrainingCompletionDurationViewModel,
  TrainingUnitScoreViewModel,
} from './duration-view-models.ts'

export function TrainingUnitScore({
  score,
}: {
  readonly score: TrainingUnitScoreViewModel
}) {
  if (score.state === 'unavailable') {
    return (
      <section className="training-unit-score training-unit-score--unavailable">
        <span className="eyebrow">SCORE</span>
        <strong>本次暂无可核验评分</strong>
        <small>旧训练记录没有保存正确题数，系统不会用小数倒推。</small>
      </section>
    )
  }
  return (
    <section
      className="training-unit-score"
      aria-label={`本次成绩：正确 ${score.correctCount} 题，共 ${score.totalCount} 道可评分题；正确率 ${
        score.percentage === null ? '无法计算' : `${score.percentage}%`
      }；无法评分 ${score.unscorableCount} 题。`}
    >
      <span className="eyebrow">SCORE</span>
      <div className="training-unit-score__primary">
        <strong>
          {score.correctCount} / {score.totalCount}
        </strong>
        <span>
          {score.percentage === null
            ? '正确率无法计算'
            : `正确率 ${score.percentage}%`}
        </span>
      </div>
      {score.unscorableCount > 0 ? (
        <small>另有 {score.unscorableCount} 题因设备或识别原因无法评分</small>
      ) : null}
    </section>
  )
}

export function TaskDurationEstimate({
  estimate,
  appearance = 'compact',
}: {
  readonly estimate: TaskDurationEstimateViewModel
  readonly appearance?: 'compact' | 'strip'
}) {
  const durationLabel = formatEstimatedDuration(
    estimate.estimateSeconds,
  )
  const basisLabel = formatDurationEstimateBasis(estimate.basis)

  return (
    <span
      className={`duration-estimate duration-estimate--${appearance}`}
      data-duration-basis={estimate.basis}
      data-estimate-seconds={estimate.estimateSeconds}
      aria-label={`预计有效练习：${durationLabel}，${basisLabel}`}
    >
      <span aria-hidden="true">
        <small>预计有效练习</small>
        <strong>{durationLabel}</strong>
      </span>
      <em aria-hidden="true">{basisLabel}</em>
    </span>
  )
}

function actualDurationLabel(
  duration: ActualEffectiveDurationViewModel,
): string {
  return duration.state === 'reliable'
    ? formatEffectiveDuration(duration.effectiveSeconds)
    : '本次暂无可靠用时'
}

export function ActualEffectiveDuration({
  duration,
}: {
  readonly duration: ActualEffectiveDurationViewModel
}) {
  const valueLabel = actualDurationLabel(duration)
  const description =
    duration.state === 'reliable'
      ? '已排除后台、暂停和长时间无操作。'
      : '旧记录或缺少可信计时片段，不以墙钟时间代替。'

  return (
    <section
      className={`actual-duration actual-duration--${duration.state}`}
      data-duration-state={duration.state}
      aria-label={`实际有效练习：${valueLabel}。${description}`}
    >
      <span className="eyebrow">实际有效练习</span>
      <strong aria-hidden="true">{valueLabel}</strong>
      <p aria-hidden="true">{description}</p>
    </section>
  )
}

export function DailyEffectiveDurationSummary({
  viewModel,
}: {
  readonly viewModel: DailyEffectiveDurationSummaryViewModel
}) {
  const headingId = useId()
  const total =
    viewModel.total.coverage === 'unavailable'
      ? '今日暂无可靠用时'
      : formatEffectiveDuration(viewModel.total.effectiveSeconds)
  const totalLabel =
    viewModel.total.coverage === 'complete'
      ? '可信合计'
      : viewModel.total.coverage === 'partial'
        ? '已确认合计'
        : '可信合计'

  return (
    <section
      className="daily-duration-summary"
      aria-labelledby={headingId}
      data-total-coverage={viewModel.total.coverage}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">EFFECTIVE PRACTICE</span>
          <h2 id={headingId}>今日实际有效练习</h2>
        </div>
        <span className="daily-duration-summary__total">
          <small>{totalLabel}</small>
          <strong>{total}</strong>
        </span>
      </div>
      <ul>
        {viewModel.items.map((item) => (
          <li
            key={item.moduleId}
            data-module-id={item.moduleId}
            data-duration-state={item.duration.state}
          >
            <span>{item.label}</span>
            <strong>{actualDurationLabel(item.duration)}</strong>
          </li>
        ))}
      </ul>
      <p>
        {viewModel.total.coverage === 'partial'
          ? '仅合计有可信计时的任务；缺失项不会按 0 分钟处理。'
          : viewModel.total.coverage === 'unavailable'
            ? '旧记录没有可信计时来源，不显示推测总时长。'
            : '后台、暂停和长时间无操作不计入。'}
      </p>
    </section>
  )
}

export function TrainingCompletionDurationScreen({
  viewModel,
  onAction,
  onContinueTraining,
}: {
  readonly viewModel: TrainingCompletionDurationViewModel
  readonly onAction: () => void
  readonly onContinueTraining?: () => void
}) {
  const extraTrainingEntry = viewModel.extraTrainingEntry
  const continueAction = extraTrainingEntry?.action
  const continueDisabled =
    Boolean(continueAction?.disabled) ||
    Boolean(continueAction?.loading) ||
    !onContinueTraining

  return (
    <main
      className="training-completion-screen"
      data-module-id={viewModel.moduleId}
    >
      <section className="training-completion-card">
        <span
          className="training-completion-card__icon"
          aria-hidden="true"
        >
          <Icon name="check" />
        </span>
        <span className="eyebrow">SESSION COMPLETE</span>
        <h1>{viewModel.title}</h1>
        <p>{viewModel.description}</p>
        <TrainingUnitScore score={viewModel.score} />
        {viewModel.trainingBudget ? (
          <TrainingBudgetProgress viewModel={viewModel.trainingBudget} />
        ) : null}
        <ActualEffectiveDuration
          duration={viewModel.actualDuration}
        />
        {extraTrainingEntry ? (
          <section
            className="daily-completion-extra-entry"
            aria-label={`${viewModel.title}后的继续训练`}
          >
            <span className="eyebrow">OPTIONAL PRACTICE</span>
            <h2>今日 15 分钟已完成</h2>
            <p>
              可继续进行不限时练习，随时退出并保存进度。本次训练区块为
              {trainingBlockDurationLabel()}有效训练；额外练习不会改变今日完成状态。
            </p>
            {extraTrainingEntry.action.disabledReason ? (
              <small>
                {extraTrainingEntry.action.disabledReason}
              </small>
            ) : null}
            <button
              className="primary-button"
              type="button"
              disabled={continueDisabled}
              aria-busy={
                extraTrainingEntry.action.loading || undefined
              }
              onClick={
                continueDisabled ? undefined : onContinueTraining
              }
            >
              {extraTrainingEntry.action.loading
                ? '正在打开'
                : extraTrainingEntry.action.label}
            </button>
          </section>
        ) : null}
        <button
          className={
            extraTrainingEntry
              ? 'secondary-button training-completion-card__return'
              : 'primary-button'
          }
          type="button"
          onClick={onAction}
        >
          {viewModel.actionLabel}
        </button>
      </section>
    </main>
  )
}
