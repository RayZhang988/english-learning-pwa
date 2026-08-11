import { Icon } from './icons.tsx'
import {
  AudioPlayer,
  ChoiceList,
  FeedbackPanel,
  KeywordDictationField,
  ListeningPlaybackControls,
  Recorder,
  TrainingScreen,
  type TrainingContextNoticeViewModel,
} from './training-primitives.tsx'
import type {
  AudioPlayerViewModel,
  ChoiceViewModel,
  FeedbackViewModel,
  ListeningPlaybackControlsViewModel,
  ListeningQuestionInputIntent,
  ListeningQuestionViewModel,
  ListeningRepeatMode,
  RecorderViewModel,
  TrainingHeaderViewModel,
} from './view-models.ts'

interface TrainingActionViewModel {
  readonly label: string
  readonly disabled?: boolean
  readonly loading?: boolean
}

interface TrainingScreenPresentationProps {
  readonly exitLabel?: string
  readonly exitDisabled?: boolean
  readonly exitBusy?: boolean
  readonly contextNotice?: TrainingContextNoticeViewModel
}

export interface TrainingContentRetryCallbacks {
  /**
   * User intent only. The owning runtime decides whether and how to retry
   * content supply; UI never selects the next item.
   */
  readonly onRetryTrainingContent?: () => void
}

export interface VocabularyScreenViewModel {
  readonly header: TrainingHeaderViewModel
  readonly instruction: string
  readonly term: string
  readonly pronunciation?: string
  readonly partOfSpeech?: string
  readonly choices: readonly ChoiceViewModel[]
  readonly feedback?: FeedbackViewModel
  readonly exampleEn?: string
  readonly explanationZh?: string
  readonly action: TrainingActionViewModel
}

export interface VocabularyTrainingScreenCallbacks
  extends TrainingContentRetryCallbacks {
  readonly onExit: () => void
  readonly onSelect: (id: string) => void
  readonly onAction: () => void
}

export interface VocabularyTrainingScreenProps
  extends VocabularyTrainingScreenCallbacks,
    TrainingScreenPresentationProps {
  readonly viewModel: VocabularyScreenViewModel
}

export function VocabularyTrainingScreen({
  viewModel,
  onExit,
  onSelect,
  onAction,
  onRetryTrainingContent,
  exitLabel = '退出词汇训练',
  exitDisabled,
  exitBusy,
  contextNotice,
}: VocabularyTrainingScreenProps) {
  return (
    <TrainingScreen
      header={viewModel.header}
      exitLabel={exitLabel}
      exitDisabled={exitDisabled}
      exitBusy={exitBusy}
      onExit={onExit}
      contextNotice={contextNotice}
      onRetryTrainingContent={onRetryTrainingContent}
      action={(
        <button
          className="primary-button"
          type="button"
          disabled={viewModel.action.disabled || viewModel.action.loading}
          onClick={onAction}
        >
          {viewModel.action.loading ? '正在处理' : viewModel.action.label}
        </button>
      )}
    >
      <section className="word-card">
        <span className="eyebrow">{viewModel.instruction}</span>
        <h2 lang="en-US">{viewModel.term}</h2>
        <div className="word-card__meta">
          {viewModel.pronunciation ? (
            <span lang="en-US">{viewModel.pronunciation}</span>
          ) : null}
          {viewModel.partOfSpeech ? <span>{viewModel.partOfSpeech}</span> : null}
        </div>
      </section>

      <ChoiceList
        label={viewModel.instruction}
        choices={viewModel.choices}
        onSelect={onSelect}
      />

      {viewModel.feedback ? (
        <>
          <FeedbackPanel feedback={viewModel.feedback} />
          {viewModel.exampleEn || viewModel.explanationZh ? (
            <section className="answer-explanation">
              {viewModel.exampleEn ? (
                <p lang="en-US">{viewModel.exampleEn}</p>
              ) : null}
              {viewModel.explanationZh ? (
                <small>{viewModel.explanationZh}</small>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </TrainingScreen>
  )
}

export interface ListeningScreenViewModel {
  readonly header: TrainingHeaderViewModel
  readonly instruction: string
  readonly player: AudioPlayerViewModel
  readonly playbackControls: ListeningPlaybackControlsViewModel
  readonly question: ListeningQuestionViewModel
  readonly feedback?: FeedbackViewModel
  readonly transcript?: readonly {
    readonly id: string
    readonly speaker?: string
    readonly text: string
    readonly translationZh?: string
  }[]
  readonly rationaleZh?: string
  readonly action: TrainingActionViewModel
}

export interface ListeningTrainingScreenCallbacks
  extends TrainingContentRetryCallbacks {
  readonly onExit: () => void
  readonly onToggleAudio: () => void
  readonly onPlaybackRateChange: (value: number) => void
  readonly onSegmentChange: (segmentId: string) => void
  readonly onRepeatModeChange: (mode: ListeningRepeatMode) => void
  readonly onQuestionInput: (intent: ListeningQuestionInputIntent) => void
  readonly onAction: () => void
}

export interface ListeningTrainingScreenProps
  extends ListeningTrainingScreenCallbacks,
    TrainingScreenPresentationProps {
  readonly viewModel: ListeningScreenViewModel
}

export function ListeningTrainingScreen({
  viewModel,
  onExit,
  onToggleAudio,
  onPlaybackRateChange,
  onSegmentChange,
  onRepeatModeChange,
  onQuestionInput,
  onAction,
  onRetryTrainingContent,
  exitLabel = '退出听力训练',
  exitDisabled,
  exitBusy,
  contextNotice,
}: ListeningTrainingScreenProps) {
  return (
    <TrainingScreen
      header={viewModel.header}
      exitLabel={exitLabel}
      exitDisabled={exitDisabled}
      exitBusy={exitBusy}
      onExit={onExit}
      contextNotice={contextNotice}
      onRetryTrainingContent={onRetryTrainingContent}
      actionLayout={
        viewModel.question.kind === 'keyword-dictation' ? 'input' : 'single'
      }
      action={(
        <button
          className="primary-button"
          type="button"
          disabled={viewModel.action.disabled || viewModel.action.loading}
          onClick={onAction}
        >
          {viewModel.action.loading ? '正在处理' : viewModel.action.label}
        </button>
      )}
    >
      <section className="question-block">
        <span className="eyebrow">{viewModel.instruction}</span>
        <h2>{viewModel.question.prompt}</h2>
      </section>
      <AudioPlayer player={viewModel.player} onToggle={onToggleAudio} />
      <ListeningPlaybackControls
        controls={viewModel.playbackControls}
        onPlaybackRateChange={onPlaybackRateChange}
        onSegmentChange={onSegmentChange}
        onRepeatModeChange={onRepeatModeChange}
      />
      {viewModel.question.kind === 'single-choice' ? (
        viewModel.question.available ? (
          <ChoiceList
            label={viewModel.question.prompt}
            choices={viewModel.question.choices}
            onSelect={(choiceId) =>
              onQuestionInput({ type: 'select-choice', choiceId })
            }
          />
        ) : (
          <p className="listening-choice-waiting" role="status">
            {viewModel.question.waitingLabel}
          </p>
        )
      ) : (
        <KeywordDictationField
          question={viewModel.question}
          onChange={(value) =>
            onQuestionInput({ type: 'change-keyword-dictation', value })
          }
        />
      )}
      {viewModel.feedback ? (
        <FeedbackPanel feedback={viewModel.feedback} />
      ) : null}
      {viewModel.transcript ? (
        <section className="transcript-panel">
          <span className="eyebrow">TRANSCRIPT</span>
          {viewModel.transcript.map((line) => (
            <div key={line.id}>
              {line.speaker ? <strong>{line.speaker}</strong> : null}
              <p lang="en-US">{line.text}</p>
              {line.translationZh ? <small>{line.translationZh}</small> : null}
            </div>
          ))}
          {viewModel.rationaleZh ? (
            <p className="transcript-panel__rationale">
              <Icon name="info" />
              {viewModel.rationaleZh}
            </p>
          ) : null}
        </section>
      ) : null}
    </TrainingScreen>
  )
}

export interface SpeakingScreenViewModel {
  readonly header: TrainingHeaderViewModel
  readonly instruction: string
  readonly prompt: string
  readonly cueZh?: string
  readonly partnerLine?: string
  readonly modelAnswer?: string
  readonly contentMatch?: SpeakingContentMatchViewModel
  readonly recorder: RecorderViewModel
  readonly feedback?: FeedbackViewModel
  readonly action: TrainingActionViewModel
  readonly secondaryActionLabel?: string
}

export type SpeakingContentMatchViewModel =
  | {
      readonly state: 'recognized'
      readonly targetText: string
      readonly targetTranslationZh: string
      readonly recognizedText: string
      readonly level: 'match' | 'close' | 'partial' | 'different'
      readonly resultLabel: string
      readonly guidance: string
    }
  | {
      readonly state: 'unscorable'
      readonly targetText: string
      readonly targetTranslationZh: string
      readonly recognizedText: null
      readonly resultLabel: string
      readonly guidance: string
    }

export interface SpeakingTrainingScreenCallbacks
  extends TrainingContentRetryCallbacks {
  readonly onExit: () => void
  readonly onRecorderAction: () => void
  readonly onPlayback?: () => void
  readonly onAction: () => void
  readonly onSecondaryAction?: () => void
}

export interface SpeakingTrainingScreenProps
  extends SpeakingTrainingScreenCallbacks,
    TrainingScreenPresentationProps {
  readonly viewModel: SpeakingScreenViewModel
}

export function SpeakingTrainingScreen({
  viewModel,
  onExit,
  onRecorderAction,
  onPlayback,
  onAction,
  onSecondaryAction,
  onRetryTrainingContent,
  exitLabel = '退出口语训练',
  exitDisabled,
  exitBusy,
  contextNotice,
}: SpeakingTrainingScreenProps) {
  const originalPlaybackLabel =
    viewModel.secondaryActionLabel === '播放示范原句'
      ? viewModel.secondaryActionLabel
      : undefined
  const onOriginalPlayback = originalPlaybackLabel
    ? onSecondaryAction
    : undefined
  return (
    <TrainingScreen
      header={viewModel.header}
      exitLabel={exitLabel}
      exitDisabled={exitDisabled}
      exitBusy={exitBusy}
      onExit={onExit}
      contextNotice={contextNotice}
      onRetryTrainingContent={onRetryTrainingContent}
      actionLayout="stacked"
      action={(
        <div className="training-action__stack">
          <button
            className="primary-button"
            type="button"
            disabled={viewModel.action.disabled || viewModel.action.loading}
            onClick={onAction}
          >
            {viewModel.action.loading ? '正在处理' : viewModel.action.label}
          </button>
          {viewModel.secondaryActionLabel && onSecondaryAction && !originalPlaybackLabel ? (
            <button
              className="text-button"
              type="button"
              onClick={onSecondaryAction}
            >
              {viewModel.secondaryActionLabel}
            </button>
          ) : null}
        </div>
      )}
    >
      <section className="speaking-prompt">
        <span className="eyebrow">{viewModel.instruction}</span>
        {viewModel.partnerLine ? (
          <p className="speaking-prompt__partner" lang="en-US">
            {viewModel.partnerLine}
          </p>
        ) : null}
        <h2 lang="en-US">{viewModel.prompt}</h2>
        {viewModel.cueZh ? <p>{viewModel.cueZh}</p> : null}
        {viewModel.modelAnswer ? (
          <aside>
            <span>示范表达</span>
            <p lang="en-US">{viewModel.modelAnswer}</p>
          </aside>
        ) : null}
      </section>
      <Recorder
        recorder={viewModel.recorder}
        onPrimaryAction={onRecorderAction}
        onPlayback={onPlayback}
        originalPlaybackLabel={originalPlaybackLabel}
        onOriginalPlayback={onOriginalPlayback}
      />
      {viewModel.contentMatch ? (
        <section
          className="speaking-content-match"
          data-content-match-state={viewModel.contentMatch.state}
          data-content-match-level={
            viewModel.contentMatch.state === 'recognized'
              ? viewModel.contentMatch.level
              : undefined
          }
          aria-label="口语内容匹配结果"
        >
          <header>
            <span className="eyebrow">CONTENT CHECK</span>
            <strong>{viewModel.contentMatch.resultLabel}</strong>
          </header>
          <dl>
            <div>
              <dt>目标表达</dt>
              <dd lang="en-US">{viewModel.contentMatch.targetText}</dd>
            </div>
            <div>
              <dt>中文翻译</dt>
              <dd>{viewModel.contentMatch.targetTranslationZh}</dd>
            </div>
            <div>
              <dt>实际识别</dt>
              <dd
                lang={
                  viewModel.contentMatch.recognizedText
                    ? 'en-US'
                    : undefined
                }
              >
                {viewModel.contentMatch.recognizedText ??
                  '本次没有得到可用的识别文本'}
              </dd>
            </div>
          </dl>
          <p>{viewModel.contentMatch.guidance}</p>
          <small>这里只比较表达内容，不是发音、口音或流利度评分。</small>
        </section>
      ) : null}
      {viewModel.feedback ? (
        <FeedbackPanel feedback={viewModel.feedback} />
      ) : null}
    </TrainingScreen>
  )
}
