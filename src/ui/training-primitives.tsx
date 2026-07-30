import { useId, type ReactNode } from 'react'
import { TaskDurationEstimate } from './duration-surfaces.tsx'
import { TrainingBudgetProgress } from './training-budget-surfaces.tsx'
import { Icon } from './icons.tsx'
import type {
  AudioPlayerViewModel,
  ChoiceViewModel,
  FeedbackViewModel,
  ListeningKeywordDictationQuestionViewModel,
  ListeningPlaybackControlsViewModel,
  ListeningRepeatMode,
  RecorderViewModel,
  TrainingHeaderViewModel,
} from './view-models.ts'

export interface TrainingContextNoticeViewModel {
  readonly eyebrow: string
  readonly title: string
  readonly description: string
}

export function TrainingScreen({
  className,
  header,
  exitLabel,
  exitDisabled,
  exitBusy,
  onExit,
  contextNotice,
  children,
  action,
  actionLayout = 'single',
  onRetryTrainingContent,
}: {
  readonly className?: string
  readonly header: TrainingHeaderViewModel
  readonly exitLabel: string
  readonly exitDisabled?: boolean
  readonly exitBusy?: boolean
  readonly onExit: () => void
  readonly contextNotice?: TrainingContextNoticeViewModel
  readonly children: ReactNode
  readonly action?: ReactNode
  readonly actionLayout?: 'single' | 'stacked' | 'input'
  readonly onRetryTrainingContent?: () => void
}) {
  return (
    <main
      className={[
        'training-screen',
        `training-screen--${actionLayout}-action`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="training-topbar">
        <button
          className="icon-button"
          type="button"
          disabled={exitDisabled || exitBusy}
          aria-busy={exitBusy || undefined}
          onClick={exitDisabled || exitBusy ? undefined : onExit}
          aria-label={exitLabel}
        >
          <Icon name="close" />
        </button>
        <div className="training-topbar__title">
          <span className="eyebrow">{header.eyebrow}</span>
          <h1>{header.title}</h1>
        </div>
        <span className="training-topbar__spacer" aria-hidden="true" />
      </header>

      {contextNotice ? (
        <section
          className="training-context-notice"
          aria-label={`${contextNotice.title}。${contextNotice.description}`}
        >
          <span className="eyebrow">{contextNotice.eyebrow}</span>
          <h2>{contextNotice.title}</h2>
          <p>{contextNotice.description}</p>
        </section>
      ) : null}

      {header.trainingBudget ? (
        <TrainingBudgetProgress
          viewModel={header.trainingBudget}
          onRetryContent={onRetryTrainingContent}
        />
      ) : header.durationEstimate ? (
        <div className="training-duration-strip">
          <TaskDurationEstimate
            estimate={header.durationEstimate}
            appearance="strip"
          />
        </div>
      ) : null}

      {header.progress ? (
        <div className="training-progress">
          <span>{header.progress.label}</span>
          <span
            className="training-progress__track"
            role="progressbar"
            aria-label={header.progress.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={header.progress.value}
          >
            <i style={{ width: `${header.progress.value}%` }} />
          </span>
        </div>
      ) : null}

      <div className="training-screen__content">{children}</div>
      {action ? <footer className="training-action">{action}</footer> : null}
    </main>
  )
}

export function ChoiceList({
  label,
  choices,
  onSelect,
}: {
  readonly label: string
  readonly choices: readonly ChoiceViewModel[]
  readonly onSelect: (id: string) => void
}) {
  return (
    <div className="choice-list" role="radiogroup" aria-label={label}>
      {choices.map((choice) => {
        const selected =
          choice.state === 'selected' ||
          choice.state === 'correct' ||
          choice.state === 'incorrect'

        return (
          <button
            className={`choice-row choice-row--${choice.state}`}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={choice.state === 'disabled'}
            key={choice.id}
            onClick={() => onSelect(choice.id)}
          >
            <span className="choice-row__marker" aria-hidden="true">
              {choice.state === 'correct' ? (
                <Icon name="check" />
              ) : choice.state === 'incorrect' ? (
                <Icon name="close" />
              ) : null}
            </span>
            <span className="choice-row__copy">
              <strong>{choice.label}</strong>
              {choice.supportingText ? (
                <small>{choice.supportingText}</small>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function FeedbackPanel({
  feedback,
}: {
  readonly feedback: FeedbackViewModel
}) {
  const icon =
    feedback.tone === 'success'
      ? 'check'
      : feedback.tone === 'device'
        ? 'wifi-off'
        : 'info'

  return (
    <section
      className={`training-feedback training-feedback--${feedback.tone}`}
      aria-live="polite"
    >
      <span className="training-feedback__icon">
        <Icon name={icon} />
      </span>
      <div>
        <h2>{feedback.title}</h2>
        {feedback.description ? <p>{feedback.description}</p> : null}
      </div>
    </section>
  )
}

export function AudioPlayer({
  player,
  onToggle,
}: {
  readonly player: AudioPlayerViewModel
  readonly onToggle: () => void
}) {
  const unavailable =
    player.status === 'unavailable' || player.status === 'error'
  const playing = player.status === 'playing'

  return (
    <section className="audio-player" aria-label="音频播放器">
      <button
        className="audio-player__control"
        type="button"
        disabled={unavailable}
        onClick={onToggle}
        aria-label={playing ? '暂停音频' : '播放音频'}
      >
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <div className="audio-player__body">
        <div className="audio-player__status">
          <strong>{player.statusLabel}</strong>
          <span>
            {player.elapsedLabel} / {player.durationLabel}
          </span>
        </div>
        <span
          className="audio-player__track"
          role="progressbar"
          aria-label="音频播放进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={player.progressValue}
        >
          <i style={{ width: `${player.progressValue}%` }} />
        </span>
        {player.rateLabel || player.playCountLabel ? (
          <div className="audio-player__meta">
            <span>{player.rateLabel}</span>
            <span>{player.playCountLabel}</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}

export function ListeningPlaybackControls({
  controls,
  onPlaybackRateChange,
  onSegmentChange,
  onRepeatModeChange,
}: {
  readonly controls: ListeningPlaybackControlsViewModel
  readonly onPlaybackRateChange: (value: number) => void
  readonly onSegmentChange: (segmentId: string) => void
  readonly onRepeatModeChange: (mode: ListeningRepeatMode) => void
}) {
  const controlId = useId()
  const headingId = `${controlId}-heading`

  return (
    <section className="listening-controls" aria-labelledby={headingId}>
      <span className="eyebrow" id={headingId}>
        播放设置
      </span>

      <fieldset
        className="listening-control-group listening-control-group--rate"
        disabled={controls.rate.disabled}
      >
        <legend>{controls.rate.label}</legend>
        <div className="listening-segmented-control">
          {controls.rate.options.map((option) => (
            <label
              className="listening-segmented-option"
              key={option.value}
            >
              <input
                type="radio"
                name={`${controlId}-rate`}
                value={option.value}
                checked={option.value === controls.rate.currentValue}
                disabled={option.disabled}
                onChange={() => onPlaybackRateChange(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="listening-segment-select">
        <span>{controls.segment.label}</span>
        <select
          value={controls.segment.currentId}
          disabled={controls.segment.disabled}
          onChange={(event) => onSegmentChange(event.currentTarget.value)}
        >
          {controls.segment.options.map((option) => (
            <option
              value={option.id}
              disabled={option.disabled}
              key={option.id}
            >
              {option.label}
              {option.supportingText ? ` · ${option.supportingText}` : ''}
            </option>
          ))}
        </select>
      </label>

      <fieldset
        className="listening-control-group listening-control-group--repeat"
        disabled={controls.repeat.disabled}
      >
        <legend>{controls.repeat.label}</legend>
        <div className="listening-segmented-control">
          {controls.repeat.options.map((option) => (
            <label
              className="listening-segmented-option"
              key={option.value}
            >
              <input
                type="radio"
                name={`${controlId}-repeat`}
                value={option.value}
                checked={option.value === controls.repeat.currentMode}
                disabled={option.disabled}
                onChange={() => onRepeatModeChange(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  )
}

export function KeywordDictationField({
  question,
  onChange,
}: {
  readonly question: ListeningKeywordDictationQuestionViewModel
  readonly onChange: (value: string) => void
}) {
  const textInput = question.textInput
  const inputId = useId()
  const descriptionId = textInput.description
    ? `${inputId}-description`
    : undefined
  const statusId = textInput.statusLabel ? `${inputId}-status` : undefined
  const describedBy = [descriptionId, statusId].filter(Boolean).join(' ')

  return (
    <div
      className="keyword-dictation"
      data-state={textInput.state}
      aria-busy={textInput.state === 'submitting'}
    >
      <label htmlFor={inputId}>{textInput.label}</label>
      <div
        className="keyword-dictation__target"
        aria-label="本题填写目标"
      >
        <span>本题需要填写</span>
        <strong>{question.requirements.targetLabel}</strong>
      </div>
      <ul
        className="keyword-dictation__requirements"
        aria-label="听写填写规则"
      >
        <li>{question.requirements.countLabel}</li>
        <li>{question.requirements.orderLabel}</li>
        <li>{question.requirements.formatLabel}</li>
      </ul>
      {textInput.description ? (
        <p id={descriptionId}>{textInput.description}</p>
      ) : null}
      <input
        id={inputId}
        type="text"
        value={textInput.value}
        placeholder={textInput.placeholder}
        disabled={textInput.disabled}
        aria-describedby={describedBy || undefined}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {textInput.statusLabel ? (
        <span
          className="keyword-dictation__status"
          id={statusId}
          aria-live={
            textInput.state === 'submitting' ||
            textInput.state === 'submitted'
              ? 'polite'
              : 'off'
          }
        >
          {textInput.statusLabel}
        </span>
      ) : null}
      {question.review ? (
        <section
          className="keyword-dictation__review"
          aria-label="关键词听写答案对照"
        >
          <strong>{question.review.resultLabel}</strong>
          <dl>
            <div>
              <dt>你的输入</dt>
              <dd lang="en-US">{question.review.response}</dd>
            </div>
            <div>
              <dt>参考答案</dt>
              <dd lang="en-US">{question.review.standardAnswer}</dd>
            </div>
          </dl>
          <div>
            <span>目标关键词（按顺序）</span>
            <ol>
              {question.review.targetKeywords.map((keyword, index) => (
                <li key={`${index}:${keyword}`} lang="en-US">{keyword}</li>
              ))}
            </ol>
          </div>
        </section>
      ) : null}
    </div>
  )
}

export function Recorder({
  recorder,
  onPrimaryAction,
  onPlayback,
}: {
  readonly recorder: RecorderViewModel
  readonly onPrimaryAction: () => void
  readonly onPlayback?: () => void
}) {
  const isRecording = recorder.status === 'recording'
  const isProcessing = recorder.status === 'processing'
  const primaryLabel =
    recorder.status === 'permission'
      ? '允许麦克风'
      : isRecording
        ? '停止录音'
        : recorder.status === 'review'
          ? '重新录音'
          : '开始录音'

  return (
    <section className={`recorder recorder--${recorder.status}`}>
      <button
        className="recorder__control"
        type="button"
        onClick={onPrimaryAction}
        disabled={isProcessing || recorder.status === 'unavailable'}
        aria-label={primaryLabel}
      >
        <span aria-hidden="true">
          <Icon name={isRecording ? 'stop' : 'mic'} />
        </span>
      </button>
      <strong>{recorder.statusLabel}</strong>
      {recorder.timeLabel ? (
        <span className="recorder__time">{recorder.timeLabel}</span>
      ) : null}
      {recorder.description ? <p>{recorder.description}</p> : null}
      {recorder.playbackAvailable && onPlayback ? (
        <button
          className="secondary-button recorder__playback"
          type="button"
          aria-label="播放录音"
          onClick={onPlayback}
        >
          <Icon name="play" />
          播放录音
        </button>
      ) : null}
    </section>
  )
}
