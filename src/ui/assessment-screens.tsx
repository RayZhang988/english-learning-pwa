import { Icon, type IconName } from './icons.tsx'
import {
  AudioPlayer,
  ChoiceList,
  FeedbackPanel,
  Recorder,
  TrainingScreen,
} from './training-primitives.tsx'
import type {
  AbilityResultViewModel,
  AudioPlayerViewModel,
  ChoiceViewModel,
  FeedbackViewModel,
  RecorderViewModel,
  TrainingHeaderViewModel,
} from './view-models.ts'

export interface AssessmentIntroViewModel {
  readonly title: string
  readonly description: string
  readonly durationLabel: string
  readonly sections: readonly {
    readonly id: 'vocabulary' | 'listening' | 'speaking'
    readonly label: string
    readonly description: string
  }[]
  readonly disclaimer: string
  readonly readinessNote?: string
}

const assessmentIcons: Record<
  AssessmentIntroViewModel['sections'][number]['id'],
  IconName
> = {
  vocabulary: 'book',
  listening: 'headphones',
  speaking: 'mic',
}

export function AssessmentIntroScreen({
  viewModel,
  onStart,
  onExit,
}: {
  readonly viewModel: AssessmentIntroViewModel
  readonly onStart: () => void
  readonly onExit: () => void
}) {
  return (
    <TrainingScreen
      header={{ eyebrow: 'ASSESSMENT', title: '水平测试' }}
      exitLabel="退出水平测试"
      onExit={onExit}
      action={(
        <button className="primary-button" type="button" onClick={onStart}>
          检查设备并开始
          <Icon name="arrow-right" />
        </button>
      )}
    >
      <section className="assessment-intro">
        <span className="assessment-intro__mark">Aa</span>
        <span className="eyebrow">{viewModel.durationLabel}</span>
        <h2>{viewModel.title}</h2>
        <p>{viewModel.description}</p>
      </section>

      <section className="assessment-domains" aria-label="测试专项">
        {viewModel.sections.map((section) => (
          <article key={section.id}>
            <span className={`task-icon task-icon--${section.id === 'speaking' ? 'coral' : section.id === 'vocabulary' ? 'mint' : 'indigo'}`}>
              <Icon name={assessmentIcons[section.id]} />
            </span>
            <div>
              <h3>{section.label}</h3>
              <p>{section.description}</p>
            </div>
          </article>
        ))}
      </section>

      {viewModel.readinessNote ? (
        <p className="inline-note">
          <Icon name="info" />
          {viewModel.readinessNote}
        </p>
      ) : null}

      <p className="assessment-disclaimer">{viewModel.disclaimer}</p>
    </TrainingScreen>
  )
}

export interface AssessmentChoiceViewModel {
  /**
   * Stable runtime identifiers. The UI returns both values unchanged.
   */
  readonly sessionId: string
  readonly itemId: string
  readonly header: TrainingHeaderViewModel
  readonly instruction: string
  readonly prompt: string
  readonly stimulus?: string
  readonly choices: readonly ChoiceViewModel[]
  readonly audio?: AudioPlayerViewModel
  readonly submission?: AssessmentLastSubmissionViewModel
  readonly primaryAction: AssessmentQuestionPrimaryActionViewModel
  readonly skipAction?: AssessmentSecondaryActionViewModel
  readonly pauseAction?: AssessmentSecondaryActionViewModel
}

export interface AssessmentQuestionTarget {
  readonly sessionId: string
  readonly itemId: string
}

export interface AssessmentChoiceSelectionIntent
  extends AssessmentQuestionTarget {
  readonly optionId: string
}

export interface AssessmentActionViewModel {
  readonly label: string
  readonly disabled: boolean
  readonly busy?: boolean
  readonly busyLabel?: string
  readonly disabledReason?: string
}

export type AssessmentQuestionPrimaryActionViewModel =
  | (AssessmentActionViewModel & {
      readonly kind: 'submit'
    })
  | (AssessmentActionViewModel & {
      readonly kind: 'continue'
    })

export interface AssessmentSecondaryActionViewModel
  extends AssessmentActionViewModel {
  readonly busy?: false
  readonly busyLabel?: never
}

export type AssessmentSubmissionFailureReason =
  | 'permission-denied'
  | 'recognizer-unavailable'
  | 'offline'
  | 'no-speech'
  | 'recognition-failed'
  | 'recording-failed'
  | 'audio-unavailable'
  | 'audio-playback-failed'
  | 'item-corrupt'
  | 'user-skipped'

export interface AssessmentFallbackNoticeViewModel {
  readonly kind: 'recording-playback' | 'retry-audio' | 'device-check'
  readonly label: string
  readonly description?: string
}

export interface AssessmentLastSubmissionViewModel {
  /**
   * Exact AssessmentSubmissionSummary.itemId returned by 03.
   */
  readonly itemId: string
  readonly status: 'recorded' | 'unscorable' | 'skipped'
  readonly failureReason: AssessmentSubmissionFailureReason | null
  readonly fallback: AssessmentFallbackNoticeViewModel | null
  readonly feedback: FeedbackViewModel
}

export interface AssessmentChoiceScreenProps {
  readonly viewModel: AssessmentChoiceViewModel
  readonly onExit: (sessionId: string) => void
  readonly onSelect: (intent: AssessmentChoiceSelectionIntent) => void
  readonly onSubmit: (target: AssessmentQuestionTarget) => void
  readonly onContinue: (target: AssessmentQuestionTarget) => void
  readonly onSkip: (target: AssessmentQuestionTarget) => void
  readonly onPause: (target: AssessmentQuestionTarget) => void
  readonly onToggleAudio?: (target: AssessmentQuestionTarget) => void
}

function actionLabel(action: AssessmentActionViewModel): string {
  if (action.busy && action.busyLabel) {
    return action.busyLabel
  }
  return action.label
}

function actionAccessibleLabel(
  action: AssessmentActionViewModel,
): string {
  return action.disabled && action.disabledReason
    ? `${action.label}，${action.disabledReason}`
    : actionLabel(action)
}

function AssessmentSubmissionNotice({
  submission,
}: {
  readonly submission: AssessmentLastSubmissionViewModel
}) {
  return (
    <section
      className="assessment-submission"
      data-item-id={submission.itemId}
      data-submission-status={submission.status}
      data-failure-reason={submission.failureReason ?? undefined}
      data-fallback={submission.fallback?.kind}
      aria-label="本题记录状态"
    >
      <FeedbackPanel feedback={submission.feedback} />
      {submission.fallback ? (
        <div className="assessment-fallback">
          <span className="assessment-fallback__icon" aria-hidden="true">
            <Icon
              name={
                submission.fallback.kind === 'recording-playback'
                  ? 'play'
                  : submission.fallback.kind === 'retry-audio'
                    ? 'headphones'
                    : 'info'
              }
            />
          </span>
          <div>
            <strong>{submission.fallback.label}</strong>
            {submission.fallback.description ? (
              <p>{submission.fallback.description}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function AssessmentQuestionActions({
  target,
  primaryAction,
  skipAction,
  pauseAction,
  onSubmit,
  onContinue,
  onSkip,
  onPause,
}: {
  readonly target: AssessmentQuestionTarget
  readonly primaryAction: AssessmentQuestionPrimaryActionViewModel
  readonly skipAction?: AssessmentSecondaryActionViewModel
  readonly pauseAction?: AssessmentSecondaryActionViewModel
  readonly onSubmit: (target: AssessmentQuestionTarget) => void
  readonly onContinue: (target: AssessmentQuestionTarget) => void
  readonly onSkip: (target: AssessmentQuestionTarget) => void
  readonly onPause: (target: AssessmentQuestionTarget) => void
}) {
  const hasSecondaryActions = Boolean(skipAction || pauseAction)

  return (
    <div
      className="training-action__stack"
      data-session-id={target.sessionId}
      data-item-id={target.itemId}
    >
      <button
        className="primary-button"
        type="button"
        disabled={primaryAction.disabled || primaryAction.busy}
        aria-label={actionAccessibleLabel(primaryAction)}
        aria-busy={primaryAction.busy || undefined}
        onClick={() => {
          if (primaryAction.kind === 'continue') {
            onContinue(target)
          } else {
            onSubmit(target)
          }
        }}
      >
        {actionLabel(primaryAction)}
      </button>
      {hasSecondaryActions ? (
        <div className="assessment-secondary-actions">
          {skipAction ? (
            <button
              className="text-button"
              type="button"
              disabled={skipAction.disabled}
              aria-label={actionAccessibleLabel(skipAction)}
              onClick={() => onSkip(target)}
            >
              {skipAction.label}
            </button>
          ) : null}
          {pauseAction ? (
            <button
              className="text-button"
              type="button"
              disabled={pauseAction.disabled}
              aria-label={actionAccessibleLabel(pauseAction)}
              onClick={() => onPause(target)}
            >
              {pauseAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function AssessmentChoiceScreen({
  viewModel,
  onExit,
  onSelect,
  onSubmit,
  onContinue,
  onSkip,
  onPause,
  onToggleAudio,
}: AssessmentChoiceScreenProps) {
  const target: AssessmentQuestionTarget = {
    sessionId: viewModel.sessionId,
    itemId: viewModel.itemId,
  }

  return (
    <TrainingScreen
      header={viewModel.header}
      exitLabel="退出水平测试"
      onExit={() => onExit(viewModel.sessionId)}
      actionLayout="stacked"
      action={(
        <AssessmentQuestionActions
          target={target}
          primaryAction={viewModel.primaryAction}
          skipAction={viewModel.skipAction}
          pauseAction={viewModel.pauseAction}
          onSubmit={onSubmit}
          onContinue={onContinue}
          onSkip={onSkip}
          onPause={onPause}
        />
      )}
    >
      <section
        className="question-block"
        data-session-id={viewModel.sessionId}
        data-item-id={viewModel.itemId}
      >
        <span className="eyebrow">{viewModel.instruction}</span>
        <h2>{viewModel.prompt}</h2>
        {viewModel.stimulus ? (
          <p className="question-block__stimulus">{viewModel.stimulus}</p>
        ) : null}
      </section>

      {viewModel.audio && onToggleAudio ? (
        <AudioPlayer
          player={viewModel.audio}
          onToggle={() => onToggleAudio(target)}
        />
      ) : null}

      <ChoiceList
        label={viewModel.instruction}
        choices={viewModel.choices}
        onSelect={(optionId) => onSelect({ ...target, optionId })}
      />
      {viewModel.submission ? (
        <AssessmentSubmissionNotice submission={viewModel.submission} />
      ) : null}
    </TrainingScreen>
  )
}

export interface AssessmentSpeechViewModel {
  /**
   * Stable runtime identifiers. The UI returns both values unchanged.
   */
  readonly sessionId: string
  readonly itemId: string
  readonly header: TrainingHeaderViewModel
  readonly instruction: string
  readonly prompt: string
  readonly stimulus?: string
  /**
   * Optional example audio supplied for repeat items. The integration layer
   * owns playback state and limits; the UI only renders the player.
   */
  readonly audio?: AssessmentSpeechAudioViewModel
  readonly recorder: RecorderViewModel
  readonly submission?: AssessmentLastSubmissionViewModel
  readonly primaryAction: AssessmentQuestionPrimaryActionViewModel
  readonly skipAction?: AssessmentSecondaryActionViewModel
  readonly pauseAction?: AssessmentSecondaryActionViewModel
}

export type AssessmentSpeechAudioViewModel = AudioPlayerViewModel

export interface AssessmentSpeechScreenProps {
  readonly viewModel: AssessmentSpeechViewModel
  readonly onExit: (sessionId: string) => void
  readonly onToggleAudio?: (target: AssessmentQuestionTarget) => void
  readonly onRecorderAction: (target: AssessmentQuestionTarget) => void
  readonly onPlayback?: (target: AssessmentQuestionTarget) => void
  readonly onSubmit: (target: AssessmentQuestionTarget) => void
  readonly onContinue: (target: AssessmentQuestionTarget) => void
  readonly onSkip: (target: AssessmentQuestionTarget) => void
  readonly onPause: (target: AssessmentQuestionTarget) => void
}

export function AssessmentSpeechScreen({
  viewModel,
  onExit,
  onToggleAudio,
  onRecorderAction,
  onPlayback,
  onSubmit,
  onContinue,
  onSkip,
  onPause,
}: AssessmentSpeechScreenProps) {
  const target: AssessmentQuestionTarget = {
    sessionId: viewModel.sessionId,
    itemId: viewModel.itemId,
  }

  return (
    <TrainingScreen
      header={viewModel.header}
      exitLabel="退出水平测试"
      onExit={() => onExit(viewModel.sessionId)}
      actionLayout="stacked"
      action={(
        <AssessmentQuestionActions
          target={target}
          primaryAction={viewModel.primaryAction}
          skipAction={viewModel.skipAction}
          pauseAction={viewModel.pauseAction}
          onSubmit={onSubmit}
          onContinue={onContinue}
          onSkip={onSkip}
          onPause={onPause}
        />
      )}
    >
      <section
        className="question-block"
        data-session-id={viewModel.sessionId}
        data-item-id={viewModel.itemId}
      >
        <span className="eyebrow">{viewModel.instruction}</span>
        <h2>{viewModel.prompt}</h2>
        {viewModel.stimulus ? (
          <p className="question-block__stimulus">{viewModel.stimulus}</p>
        ) : null}
      </section>
      {viewModel.audio && onToggleAudio ? (
        <AudioPlayer
          player={viewModel.audio}
          onToggle={() => onToggleAudio(target)}
        />
      ) : null}
      <Recorder
        recorder={viewModel.recorder}
        onPrimaryAction={() => onRecorderAction(target)}
        onPlayback={
          onPlayback ? () => onPlayback(target) : undefined
        }
      />
      {viewModel.submission ? (
        <AssessmentSubmissionNotice submission={viewModel.submission} />
      ) : null}
    </TrainingScreen>
  )
}

export interface AssessmentPausedViewModel {
  readonly sessionId: string
  readonly header: TrainingHeaderViewModel
  readonly title: string
  readonly description: string
  readonly statusLabel?: string
  readonly resumeAction: AssessmentActionViewModel
  readonly stopAction?: AssessmentSecondaryActionViewModel
}

export interface AssessmentPausedScreenProps {
  readonly viewModel: AssessmentPausedViewModel
  readonly onExit: (sessionId: string) => void
  readonly onResume: (sessionId: string) => void
  readonly onStop: (sessionId: string) => void
}

export function AssessmentPausedScreen({
  viewModel,
  onExit,
  onResume,
  onStop,
}: AssessmentPausedScreenProps) {
  return (
    <TrainingScreen
      header={viewModel.header}
      exitLabel="关闭暂停页面"
      onExit={() => onExit(viewModel.sessionId)}
      actionLayout="stacked"
      action={(
        <div
          className="training-action__stack"
          data-session-id={viewModel.sessionId}
        >
          <button
            className="primary-button"
            type="button"
            disabled={
              viewModel.resumeAction.disabled ||
              viewModel.resumeAction.busy
            }
            aria-label={actionAccessibleLabel(viewModel.resumeAction)}
            aria-busy={viewModel.resumeAction.busy || undefined}
            onClick={() => onResume(viewModel.sessionId)}
          >
            {actionLabel(viewModel.resumeAction)}
          </button>
          {viewModel.stopAction ? (
            <button
              className="text-button"
              type="button"
              disabled={viewModel.stopAction.disabled}
              aria-label={actionAccessibleLabel(viewModel.stopAction)}
              onClick={() => onStop(viewModel.sessionId)}
            >
              {viewModel.stopAction.label}
            </button>
          ) : null}
        </div>
      )}
    >
      <section
        className="assessment-paused"
        data-session-id={viewModel.sessionId}
        aria-labelledby="assessment-paused-title"
      >
        <span className="assessment-paused__mark" aria-hidden="true">
          <Icon name="pause" />
        </span>
        {viewModel.statusLabel ? (
          <span className="eyebrow">{viewModel.statusLabel}</span>
        ) : null}
        <h2 id="assessment-paused-title">{viewModel.title}</h2>
        <p>{viewModel.description}</p>
      </section>
    </TrainingScreen>
  )
}

export interface AssessmentResultsViewModel {
  readonly outcomeLabel: string
  readonly completedAtLabel: string
  readonly abilities: readonly AbilityResultViewModel[]
  readonly disclaimer: string
}

export function AssessmentResultsScreen({
  viewModel,
  onContinue,
  onExit,
}: {
  readonly viewModel: AssessmentResultsViewModel
  readonly onContinue: () => void
  readonly onExit: () => void
}) {
  return (
    <TrainingScreen
      header={{ eyebrow: 'RESULT', title: viewModel.outcomeLabel }}
      exitLabel="关闭测试结果"
      onExit={onExit}
      action={(
        <button className="primary-button" type="button" onClick={onContinue}>
          进入今日计划
          <Icon name="arrow-right" />
        </button>
      )}
    >
      <p className="page-intro">{viewModel.completedAtLabel}</p>
      <section className="ability-results" aria-label="专项能力结果">
        {viewModel.abilities.map((ability) => (
          <article
            className={`ability-result ability-result--${ability.status}`}
            key={ability.domain}
          >
            <div className="ability-result__summary">
              <span>{ability.label}</span>
              <strong>{ability.levelLabel}</strong>
            </div>
            <div className="ability-result__meta">
              <span>{ability.rangeLabel}</span>
              <span>{ability.confidenceLabel}</span>
            </div>
            <p>{ability.message}</p>
            {ability.warnings.length > 0 ? (
              <ul>
                {ability.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </section>
      <p className="assessment-disclaimer">{viewModel.disclaimer}</p>
    </TrainingScreen>
  )
}
