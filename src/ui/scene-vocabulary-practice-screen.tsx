import { ErrorState, LoadingState } from './feedback-states.tsx'
import { Icon } from './icons.tsx'
import type {
  SceneVocabularyPracticePresentation,
  SceneVocabularyPracticeView,
} from './scene-vocabulary-practice-types.ts'
import { TrainingScreen } from './training-primitives.tsx'

export interface SceneVocabularyPracticeScreenCallbacks {
  readonly onExit: () => void
  readonly onOptionSelected: (optionId: string) => void
  readonly onSubmit: () => void
  readonly onContinue: () => void
  readonly onResumePrevious?: () => void
  readonly onStartNewRound?: () => void
  /** Receives only 06's target-only playback intent; never a full sentence. */
  readonly onTargetPlayback: (
    intent: NonNullable<SceneVocabularyPracticeView['question']>['targetPlayback'],
  ) => void
  readonly onRetry?: () => void
}

export interface SceneVocabularyPracticeScreenProps
  extends SceneVocabularyPracticeScreenCallbacks {
  readonly presentation: SceneVocabularyPracticePresentation
  readonly sceneTitle?: string
}

function accuracyLabel(accuracy: number | null): string {
  return accuracy === null
    ? '暂无'
    : `${new Intl.NumberFormat('zh-CN', {
        style: 'percent',
        maximumFractionDigits: 0,
      }).format(accuracy)}`
}

function ProgressSummary({
  view,
}: {
  readonly view: SceneVocabularyPracticeView
}) {
  return (
    <dl className="scene-vocabulary-progress" aria-label="本场练习进度">
      <div>
        <dt>已答题</dt>
        <dd>{view.progress.answeredCount}</dd>
      </div>
      <div>
        <dt>答对</dt>
        <dd>{view.progress.correctCount}</dd>
      </div>
      <div>
        <dt>正确率</dt>
        <dd>{accuracyLabel(view.progress.accuracy)}</dd>
      </div>
    </dl>
  )
}

function QuestionContent({
  view,
  onOptionSelected,
  onTargetPlayback,
}: Pick<
  SceneVocabularyPracticeScreenCallbacks,
  'onOptionSelected' | 'onTargetPlayback'
> & {
  readonly view: SceneVocabularyPracticeView
}) {
  const question = view.question
  if (!question) {
    return null
  }

  const selectedOptionId = question.options.find(
    (option) => option.state === 'selected',
  )?.id
  const inputLocked = view.status !== 'question'

  return (
    <>
      <section className="scene-vocabulary-prompt" aria-labelledby="scene-vocabulary-question">
        <span className="eyebrow">USEFUL ENGLISH</span>
        <p className="scene-vocabulary-sentence" lang="en-US">
          {question.sentenceEn.beforeTarget}
          <button
            className="scene-vocabulary-target"
            type="button"
            onClick={() => onTargetPlayback(question.targetPlayback)}
            aria-label={`播放单词 ${question.targetPlayback.text} 的发音`}
            data-target-playback="play-target-only"
          >
            {question.sentenceEn.targetText}
          </button>
          {question.sentenceEn.afterTarget}
        </p>
        <h2 id="scene-vocabulary-question">
          {question.sentenceEn.targetText} 是什么意思？
        </h2>
        <p className="scene-vocabulary-hint">
          点击高亮单词可播放这个词的发音。
        </p>
      </section>

      <div className="scene-vocabulary-options" role="radiogroup" aria-label={question.promptZh}>
        {question.options.map((option) => {
          const checked = option.state !== 'default'
          const disabled = inputLocked
          return (
            <button
              className={`scene-vocabulary-option scene-vocabulary-option--${option.state}`}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              key={option.id}
              data-scene-vocabulary-option={option.id}
              onClick={disabled ? undefined : () => onOptionSelected(option.id)}
            >
              <span className="scene-vocabulary-option__marker" aria-hidden="true">
                {option.state === 'correct' ? <Icon name="check" /> : null}
                {option.state === 'incorrect' ? <Icon name="close" /> : null}
              </span>
              <span>{option.labelZh}</span>
            </button>
          )
        })}
      </div>

      {view.status === 'question' && !selectedOptionId ? (
        <p className="scene-vocabulary-selection-note" role="status">
          请选择一个中文含义后提交。
        </p>
      ) : null}
    </>
  )
}

function Feedback({
  view,
}: {
  readonly view: SceneVocabularyPracticeView
}) {
  if (view.status !== 'feedback' || !view.feedback) {
    return null
  }

  return (
    <section
      className={`scene-vocabulary-feedback scene-vocabulary-feedback--${
        view.feedback.correct ? 'correct' : 'incorrect'
      }`}
      aria-live="polite"
    >
      <span aria-hidden="true">
        <Icon name={view.feedback.correct ? 'check' : 'close'} />
      </span>
      <div>
        <h2>{view.feedback.correct ? '回答正确' : '回答不正确'}</h2>
        <p>
          正确词义：<strong>{view.feedback.correctMeaningZh}</strong>
        </p>
      </div>
    </section>
  )
}

export function SceneVocabularyPracticeScreen({
  presentation,
  sceneTitle = '场景词汇',
  onExit,
  onOptionSelected,
  onSubmit,
  onContinue,
  onResumePrevious,
  onStartNewRound,
  onTargetPlayback,
  onRetry,
}: SceneVocabularyPracticeScreenProps) {
  const header = {
    eyebrow: 'SCENE VOCABULARY',
    title: sceneTitle,
  } as const

  if (presentation.status === 'loading') {
    return (
      <TrainingScreen header={header} exitLabel="退出场景训练" onExit={onExit}>
        <LoadingState label={presentation.label ?? '正在准备场景词汇练习'} />
      </TrainingScreen>
    )
  }

  if (presentation.status === 'error') {
    return (
      <TrainingScreen header={header} exitLabel="退出场景训练" onExit={onExit}>
        <ErrorState
          title={presentation.title ?? '暂时无法打开场景词汇练习'}
          description={presentation.description}
          onRetry={onRetry}
        />
      </TrainingScreen>
    )
  }

  if (presentation.status === 'resume-choice') {
    return (
      <TrainingScreen
        className="scene-vocabulary-screen"
        header={header}
        exitLabel="退出场景训练"
        onExit={onExit}
      >
        <ProgressSummary view={presentation.view} />
        <section className="scene-vocabulary-resume-choice" aria-labelledby="scene-vocabulary-resume-title">
          <span className="eyebrow">SAVED PRACTICE</span>
          <h2 id="scene-vocabulary-resume-title">继续上次训练？</h2>
          <p>已保存当前题、选择和反馈状态。开始新一轮不会改动每日或额外训练记录。</p>
          <div className="scene-vocabulary-resume-choice__actions">
            <button className="primary-button" type="button" onClick={onResumePrevious}>
              继续上次训练
            </button>
            <button className="secondary-button" type="button" onClick={onStartNewRound}>
              开始新一轮
            </button>
          </div>
        </section>
      </TrainingScreen>
    )
  }

  const { view, recoveryNotice } = presentation
  const selected = view.question?.options.some(
    (option) => option.state === 'selected',
  ) ?? false
  const action =
    view.status === 'question' ? (
      <button
        className="primary-button"
        type="button"
        disabled={!selected}
        onClick={selected ? onSubmit : undefined}
      >
        提交答案
      </button>
    ) : (
      <button className="primary-button" type="button" onClick={onContinue}>
        继续
      </button>
    )

  return (
    <TrainingScreen
      className="scene-vocabulary-screen"
      header={header}
      exitLabel="退出场景训练"
      onExit={onExit}
      action={action}
    >
      {recoveryNotice ? (
        <aside className="scene-vocabulary-recovery" role="status">
          <Icon name="refresh" aria-hidden="true" />
          <div>
            <strong>{recoveryNotice.title}</strong>
            <span>{recoveryNotice.description}</span>
          </div>
        </aside>
      ) : null}
      <ProgressSummary view={view} />
      <QuestionContent
        view={view}
        onOptionSelected={onOptionSelected}
        onTargetPlayback={onTargetPlayback}
      />
      <Feedback view={view} />
    </TrainingScreen>
  )
}
