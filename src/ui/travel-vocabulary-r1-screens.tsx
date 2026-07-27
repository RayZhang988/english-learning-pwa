import { Icon } from './icons.tsx'
import { LoadingState } from './feedback-states.tsx'
import { TrainingScreen } from './training-primitives.tsx'
import type {
  TravelVocabularyR1ActionViewModel,
  TravelVocabularyR1IntroScreenProps,
  TravelVocabularyR1MigrationScreenProps,
  TravelVocabularyR1NoticeViewModel,
  TravelVocabularyR1QuestionScreenProps,
  TravelVocabularyR1QuestionTarget,
  TravelVocabularyR1ResultsScreenProps,
  TravelVocabularyR1ResumeScreenProps,
  TravelVocabularyR1StageResultScreenProps,
  TravelVocabularyR1StageReviewScreenProps,
  TravelVocabularyR1StageRouteItemViewModel,
  TravelVocabularyR1StatusScreenProps,
} from './travel-vocabulary-r1-types.ts'

const introStages: readonly TravelVocabularyR1StageRouteItemViewModel[] = [
  {
    id: 'stage-1-foundation',
    order: 1,
    label: '基础',
    state: 'current',
  },
  {
    id: 'stage-2-essential',
    order: 2,
    label: '核心',
    state: 'upcoming',
  },
  {
    id: 'stage-3-independent',
    order: 3,
    label: '独立',
    state: 'upcoming',
  },
  {
    id: 'stage-4-advanced',
    order: 4,
    label: '进阶',
    state: 'upcoming',
  },
  {
    id: 'stage-5-specialized',
    order: 5,
    label: '高阶',
    state: 'upcoming',
  },
]

function isActionDisabled(
  action: TravelVocabularyR1ActionViewModel,
): boolean {
  return action.disabled || Boolean(action.busy)
}

function actionLabel(
  action: TravelVocabularyR1ActionViewModel,
): string {
  return action.busy && action.busyLabel
    ? action.busyLabel
    : action.label
}

function actionAccessibleLabel(
  action: TravelVocabularyR1ActionViewModel,
): string {
  return action.disabled && action.disabledReason
    ? `${action.label}，${action.disabledReason}`
    : actionLabel(action)
}

function TravelVocabularyR1Notice({
  notice,
}: {
  readonly notice: TravelVocabularyR1NoticeViewModel
}) {
  return (
    <aside
      className={`travel-r1-notice travel-r1-notice--${notice.kind}`}
      role="status"
    >
      <span className="travel-r1-notice__icon" aria-hidden="true">
        <Icon name={notice.kind === 'offline' ? 'wifi-off' : 'info'} />
      </span>
      <span>
        <strong>{notice.title}</strong>
        <small>{notice.description}</small>
      </span>
    </aside>
  )
}

function TravelVocabularyR1StageRoute({
  stages,
  label = '五个抽样阶段',
}: {
  readonly stages: readonly TravelVocabularyR1StageRouteItemViewModel[]
  readonly label?: string
}) {
  return (
    <ol className="travel-r1-route" aria-label={label}>
      {stages.map((stage) => (
        <li
          className={`travel-r1-route__stop travel-r1-route__stop--${stage.state}`}
          key={stage.id}
          aria-current={stage.state === 'current' ? 'step' : undefined}
        >
          <span className="travel-r1-route__marker" aria-hidden="true">
            {stage.state === 'complete' ? (
              <Icon name="check" />
            ) : (
              stage.order
            )}
          </span>
          <span>{stage.label}</span>
        </li>
      ))}
    </ol>
  )
}

export function TravelVocabularyR1IntroScreen({
  viewModel,
  onStart,
  onExit,
}: TravelVocabularyR1IntroScreenProps) {
  const startDisabled = isActionDisabled(viewModel.startAction)

  return (
    <TrainingScreen
      className="travel-r1-screen travel-r1-screen--intro"
      header={{
        eyebrow: 'TRAVEL WORDS',
        title: '旅游英语词汇测试',
      }}
      exitLabel="退出旅游英语词汇测试"
      onExit={() => onExit(viewModel.sessionId)}
      action={(
        <button
          className="primary-button"
          type="button"
          disabled={startDisabled}
          aria-label={actionAccessibleLabel(viewModel.startAction)}
          onClick={
            startDisabled
              ? undefined
              : () => onStart(viewModel.sessionId)
          }
        >
          {actionLabel(viewModel.startAction)}
          <Icon name="arrow-right" />
        </button>
      )}
    >
      {viewModel.notice ? (
        <TravelVocabularyR1Notice notice={viewModel.notice} />
      ) : null}

      <section className="travel-r1-intro">
        <span className="travel-r1-passport-mark" aria-hidden="true">
          <b>Aa</b>
          <small>5 STOPS</small>
        </span>
        <span className="eyebrow">只测旅游英语单词</span>
        <h2>分 5 个阶段，估算你的旅游词汇起点</h2>
        <p>
          每题只显示一个英文单词，请选择最接近的中文释义；不确定时可以直接标记，不必猜答案。
        </p>
      </section>

      <section className="travel-r1-intro-metrics" aria-label="测试规模">
        <article>
          <strong>5</strong>
          <span>个难度阶段</span>
        </article>
        <article>
          <strong>30</strong>
          <span>词 / 阶段</span>
        </article>
        <article>
          <strong>约 150</strong>
          <span>题总样本</span>
        </article>
      </section>

      <TravelVocabularyR1StageRoute stages={introStages} />

      <section className="travel-r1-facts" aria-label="测试说明">
        <div>
          <Icon name="target" />
          <span>
            <strong>不设规定时长</strong>
            <small>按自己的节奏完成，只记录实际有效作答时间。</small>
          </span>
        </div>
        <div>
          <Icon name="refresh" />
          <span>
            <strong>可以退出后继续</strong>
            <small>恢复时沿用本次抽中的原题和选项顺序。</small>
          </span>
        </div>
      </section>

      <p className="assessment-disclaimer">
        结果是旅游英语词汇量的抽样估算，只用于安排学习起点，不代表学历、学校成绩或官方 CET
        考试结果。
      </p>
    </TrainingScreen>
  )
}

function questionTarget(
  viewModel: TravelVocabularyR1QuestionScreenProps['viewModel'],
): TravelVocabularyR1QuestionTarget {
  return {
    sessionId: viewModel.sessionId,
    questionId: viewModel.question.id,
    questionIndex: viewModel.question.index,
  }
}

export function TravelVocabularyR1QuestionScreen({
  viewModel,
  onExit,
  onSelectChoice,
  onMarkUncertain,
  onClearAnswer,
  onNavigate,
  onReviewStage,
  onPause,
}: TravelVocabularyR1QuestionScreenProps) {
  const currentTarget = questionTarget(viewModel)
  const uncertainSelected =
    viewModel.question.answerState === 'uncertain'
  const uncertainDisabled = isActionDisabled(
    viewModel.uncertainAction,
  )
  const reviewDisabled = isActionDisabled(viewModel.reviewAction)
  const pauseDisabled = isActionDisabled(viewModel.pauseAction)

  return (
    <TrainingScreen
      className="travel-r1-screen travel-r1-screen--question"
      header={{
        eyebrow: `STAGE ${viewModel.stage.order} / 5`,
        title: viewModel.stage.label,
        progress: viewModel.headerProgress,
      }}
      exitLabel="保存并退出旅游英语词汇测试"
      onExit={() => onExit(viewModel.sessionId)}
      actionLayout="stacked"
      action={(
        <div className="training-action__stack">
          <div className="travel-r1-question-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={
                viewModel.previousTarget === null ||
                isActionDisabled(viewModel.previousAction)
              }
              aria-label={actionAccessibleLabel(
                viewModel.previousAction,
              )}
              onClick={
                viewModel.previousTarget === null ||
                isActionDisabled(viewModel.previousAction)
                  ? undefined
                  : () => onNavigate(viewModel.previousTarget!)
              }
            >
              <Icon name="arrow-left" />
              {actionLabel(viewModel.previousAction)}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={
                viewModel.nextTarget === null ||
                isActionDisabled(viewModel.nextAction)
              }
              aria-label={actionAccessibleLabel(viewModel.nextAction)}
              onClick={
                viewModel.nextTarget === null ||
                isActionDisabled(viewModel.nextAction)
                  ? undefined
                  : () => onNavigate(viewModel.nextTarget!)
              }
            >
              {actionLabel(viewModel.nextAction)}
              <Icon name="arrow-right" />
            </button>
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={reviewDisabled}
            aria-label={actionAccessibleLabel(viewModel.reviewAction)}
            onClick={
              reviewDisabled
                ? undefined
                : () => onReviewStage(viewModel.sessionId)
            }
          >
            {actionLabel(viewModel.reviewAction)}
            <Icon name="check" />
          </button>
          <button
            className="text-button"
            type="button"
            disabled={pauseDisabled}
            aria-label={actionAccessibleLabel(viewModel.pauseAction)}
            onClick={
              pauseDisabled
                ? undefined
                : () => onPause(viewModel.sessionId)
            }
          >
            {actionLabel(viewModel.pauseAction)}
          </button>
        </div>
      )}
    >
      {viewModel.notice ? (
        <TravelVocabularyR1Notice notice={viewModel.notice} />
      ) : null}

      <TravelVocabularyR1StageRoute stages={viewModel.stages} />

      <div className="travel-r1-question-meta" aria-label="当前作答进度">
        <span>{viewModel.stageProgressLabel}</span>
        <span>{viewModel.answeredLabel}</span>
        <span>{viewModel.elapsedLabel}</span>
      </div>

      <details className="travel-r1-question-map">
        <summary>
          <span>查看本阶段 30 题</span>
          <small>已答、未答和不确定状态</small>
        </summary>
        <div className="travel-r1-question-map__legend" aria-hidden="true">
          <span><i data-state="answered" />已答</span>
          <span><i data-state="uncertain" />不确定</span>
          <span><i data-state="unanswered" />未答</span>
        </div>
        <div className="travel-r1-question-map__grid">
          {viewModel.questionMap.map((item) => {
            const stateLabel =
              item.answerState === 'answered'
                ? '已答'
                : item.answerState === 'uncertain'
                  ? '不确定'
                  : '未答'
            const disabled = item.disabled

            return (
              <button
                className={`travel-r1-question-number travel-r1-question-number--${item.answerState}`}
                type="button"
                key={item.questionId}
                disabled={disabled}
                aria-current={item.current ? 'step' : undefined}
                aria-label={`${item.numberLabel}，${stateLabel}${item.current ? '，当前题' : ''}`}
                onClick={
                  disabled
                    ? undefined
                    : () =>
                        onNavigate({
                          sessionId: viewModel.sessionId,
                          questionId: item.questionId,
                          questionIndex: item.questionIndex,
                        })
                }
              >
                {item.numberLabel}
              </button>
            )
          })}
        </div>
      </details>

      <section
        className="travel-r1-word-card"
        aria-labelledby="travel-r1-current-word"
      >
        <span className="eyebrow">
          {viewModel.question.numberLabel}
        </span>
        <h2 id="travel-r1-current-word" lang="en-US">
          {viewModel.question.word}
        </h2>
        <p>{viewModel.question.prompt}</p>
      </section>

      <div
        className="travel-r1-choice-list"
        role="radiogroup"
        aria-label={`${viewModel.question.word} 的中文释义`}
      >
        {viewModel.question.options.map((option) => (
          <button
            className={
              option.selected
                ? 'choice-row choice-row--selected'
                : 'choice-row choice-row--default'
            }
            type="button"
            role="radio"
            aria-checked={option.selected}
            disabled={option.disabled}
            key={option.id}
            onClick={
              option.disabled
                ? undefined
                : () =>
                    onSelectChoice({
                      ...currentTarget,
                      optionId: option.id,
                    })
            }
          >
            <span className="choice-row__marker" aria-hidden="true" />
            <span className="choice-row__copy">
              <strong>{option.label}</strong>
            </span>
          </button>
        ))}

        <button
          className={
            uncertainSelected
              ? 'travel-r1-uncertain choice-row choice-row--selected'
              : 'travel-r1-uncertain choice-row choice-row--default'
          }
          type="button"
          role="radio"
          aria-checked={uncertainSelected}
          disabled={uncertainDisabled}
          aria-label={actionAccessibleLabel(
            viewModel.uncertainAction,
          )}
          onClick={
            uncertainDisabled
              ? undefined
              : () => onMarkUncertain(currentTarget)
          }
        >
          <span className="choice-row__marker" aria-hidden="true">?</span>
          <span className="choice-row__copy">
            <strong>{actionLabel(viewModel.uncertainAction)}</strong>
            <small>不会强迫猜答案，本题仍计入有效作答。</small>
          </span>
        </button>
      </div>

      {viewModel.clearAction ? (
        <button
          className="text-button travel-r1-clear-answer"
          type="button"
          disabled={isActionDisabled(viewModel.clearAction)}
          aria-label={actionAccessibleLabel(viewModel.clearAction)}
          onClick={
            isActionDisabled(viewModel.clearAction)
              ? undefined
              : () => onClearAnswer(currentTarget)
          }
        >
          {actionLabel(viewModel.clearAction)}
        </button>
      ) : null}

      {viewModel.reviewAction.disabledReason ? (
        <p className="travel-r1-action-reason" role="status">
          {viewModel.reviewAction.disabledReason}
        </p>
      ) : null}
    </TrainingScreen>
  )
}

export function TravelVocabularyR1StageReviewScreen({
  viewModel,
  onExit,
  onBack,
  onNavigate,
  onSubmitStage,
}: TravelVocabularyR1StageReviewScreenProps) {
  const submitDisabled = isActionDisabled(viewModel.submitAction)
  const backDisabled = isActionDisabled(viewModel.backAction)

  return (
    <TrainingScreen
      className="travel-r1-screen travel-r1-screen--review"
      header={{
        eyebrow: `STAGE ${viewModel.stage.order} / 5`,
        title: '提交前检查',
        progress: viewModel.headerProgress,
      }}
      exitLabel="保存并退出旅游英语词汇测试"
      onExit={() => onExit(viewModel.sessionId)}
      actionLayout="stacked"
      action={(
        <div className="training-action__stack">
          <button
            className="primary-button"
            type="button"
            disabled={submitDisabled}
            aria-label={actionAccessibleLabel(viewModel.submitAction)}
            onClick={
              submitDisabled
                ? undefined
                : () => onSubmitStage(viewModel.sessionId)
            }
          >
            {actionLabel(viewModel.submitAction)}
            <Icon name="check" />
          </button>
          <button
            className="text-button"
            type="button"
            disabled={backDisabled}
            aria-label={actionAccessibleLabel(viewModel.backAction)}
            onClick={
              backDisabled
                ? undefined
                : () => onBack(viewModel.sessionId)
            }
          >
            {actionLabel(viewModel.backAction)}
          </button>
        </div>
      )}
    >
      <section className="travel-r1-review-card">
        <span className="travel-r1-review-card__icon" aria-hidden="true">
          <Icon
            name={
              viewModel.unansweredQuestions.length === 0
                ? 'check'
                : 'info'
            }
          />
        </span>
        <span className="eyebrow">{viewModel.answeredLabel}</span>
        <h2>{viewModel.stage.label}</h2>
        <p>{viewModel.reviewDescription}</p>
      </section>

      {viewModel.unansweredQuestions.length > 0 ? (
        <section
          className="travel-r1-unanswered"
          aria-labelledby="travel-r1-unanswered-heading"
        >
          <h2 id="travel-r1-unanswered-heading">仍未作答</h2>
          <p>先返回这些题目完成选择，再提交本阶段。</p>
          <div className="travel-r1-unanswered__grid">
            {viewModel.unansweredQuestions.map((question) => (
              <button
                type="button"
                key={question.questionId}
                aria-label={`返回第 ${question.numberLabel} 题补答`}
                onClick={() =>
                  onNavigate({
                    sessionId: viewModel.sessionId,
                    questionId: question.questionId,
                    questionIndex: question.questionIndex,
                  })
                }
              >
                {question.numberLabel}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="travel-r1-confirmation" role="status">
          <Icon name="check" />
          <div>
            <h2>30 题均已作答</h2>
            <p>确认提交后，本阶段答案和结果将锁定，不能再修改。</p>
          </div>
        </section>
      )}

      {viewModel.submitAction.disabledReason ? (
        <p className="travel-r1-action-reason" role="status">
          {viewModel.submitAction.disabledReason}
        </p>
      ) : null}
    </TrainingScreen>
  )
}

export function TravelVocabularyR1StageResultScreen({
  viewModel,
  onExit,
  onContinueToNextStage,
  onPause,
}: TravelVocabularyR1StageResultScreenProps) {
  const continueDisabled = isActionDisabled(
    viewModel.continueAction,
  )
  const pauseDisabled = isActionDisabled(viewModel.pauseAction)

  return (
    <TrainingScreen
      className="travel-r1-screen travel-r1-screen--stage-result"
      header={{
        eyebrow: `STAGE ${viewModel.stage.order} / 5`,
        title: '阶段结果',
        progress: viewModel.headerProgress,
      }}
      exitLabel="保存并退出旅游英语词汇测试"
      onExit={() => onExit(viewModel.sessionId)}
      actionLayout="stacked"
      action={(
        <div className="training-action__stack">
          <button
            className="primary-button"
            type="button"
            disabled={continueDisabled}
            aria-label={actionAccessibleLabel(
              viewModel.continueAction,
            )}
            onClick={
              continueDisabled
                ? undefined
                : () =>
                    onContinueToNextStage(viewModel.sessionId)
            }
          >
            {actionLabel(viewModel.continueAction)}
            <Icon name="arrow-right" />
          </button>
          <button
            className="text-button"
            type="button"
            disabled={pauseDisabled}
            aria-label={actionAccessibleLabel(viewModel.pauseAction)}
            onClick={
              pauseDisabled
                ? undefined
                : () => onPause(viewModel.sessionId)
            }
          >
            {actionLabel(viewModel.pauseAction)}
          </button>
        </div>
      )}
    >
      <TravelVocabularyR1StageRoute stages={viewModel.stages} />

      <section className="travel-r1-stage-score">
        <span className="eyebrow">{viewModel.stage.label}</span>
        <strong>{viewModel.correctCountLabel}</strong>
        <span>回答正确</span>
        <p>本阶段成绩已计入估算；没有满分门槛，任何有效结果都会进入下一阶段。</p>
      </section>

      <section className="travel-r1-stage-metrics" aria-label="阶段作答明细">
        <article>
          <span>错误</span>
          <strong>{viewModel.incorrectCountLabel}</strong>
        </article>
        <article>
          <span>不确定</span>
          <strong>{viewModel.uncertainCountLabel}</strong>
        </article>
        <article>
          <span>估算掌握比例</span>
          <strong>{viewModel.masteryRateLabel}</strong>
        </article>
      </section>

      <dl className="travel-r1-estimate-list">
        <div>
          <dt>本阶段代表词数</dt>
          <dd>{viewModel.representativeWordCountLabel}</dd>
        </div>
        <div>
          <dt>阶段估算</dt>
          <dd>{viewModel.estimatedWordsLabel}</dd>
        </div>
        <div>
          <dt>合理区间</dt>
          <dd>{viewModel.reasonableIntervalLabel}</dd>
        </div>
      </dl>
    </TrainingScreen>
  )
}

export function TravelVocabularyR1ResumeScreen({
  viewModel,
  onExit,
  onResume,
}: TravelVocabularyR1ResumeScreenProps) {
  const resumeDisabled = isActionDisabled(viewModel.resumeAction)

  return (
    <TrainingScreen
      className="travel-r1-screen travel-r1-screen--resume"
      header={{
        eyebrow: 'SAVED LOCALLY',
        title: '继续旅游英语词汇测试',
        progress: viewModel.headerProgress,
      }}
      exitLabel="退出恢复页面"
      onExit={() => onExit(viewModel.sessionId)}
      action={(
        <button
          className="primary-button"
          type="button"
          disabled={resumeDisabled}
          aria-label={actionAccessibleLabel(viewModel.resumeAction)}
          onClick={
            resumeDisabled
              ? undefined
              : () => onResume(viewModel.sessionId)
          }
        >
          {actionLabel(viewModel.resumeAction)}
          <Icon name="arrow-right" />
        </button>
      )}
    >
      {viewModel.notice ? (
        <TravelVocabularyR1Notice notice={viewModel.notice} />
      ) : null}
      <TravelVocabularyR1StageRoute stages={viewModel.stages} />

      <section className="travel-r1-resume-card">
        <span className="travel-r1-resume-card__icon" aria-hidden="true">
          <Icon name="refresh" />
        </span>
        <span className="eyebrow">本机已保存</span>
        <h2>从上次位置继续</h2>
        <dl>
          <div>
            <dt>当前位置</dt>
            <dd>{viewModel.currentPositionLabel}</dd>
          </div>
          <div>
            <dt>已完成</dt>
            <dd>{viewModel.answeredLabel}</dd>
          </div>
          <div>
            <dt>有效时间</dt>
            <dd>{viewModel.elapsedLabel}</dd>
          </div>
        </dl>
        <p>恢复后继续使用本次已抽中的原题和原选项顺序，不会刷新换题。</p>
      </section>
    </TrainingScreen>
  )
}

export function TravelVocabularyR1MigrationScreen({
  viewModel,
  onExit,
  onStartNewAssessment,
}: TravelVocabularyR1MigrationScreenProps) {
  const startDisabled = isActionDisabled(viewModel.startAction)

  return (
    <TrainingScreen
      className="travel-r1-screen travel-r1-screen--migration"
      header={{
        eyebrow: 'NEW MEASUREMENT',
        title: '测试规则已更新',
      }}
      exitLabel="退出旅游英语词汇测试"
      onExit={() => onExit(viewModel.sessionId)}
      action={(
        <button
          className="primary-button"
          type="button"
          disabled={startDisabled}
          aria-label={actionAccessibleLabel(viewModel.startAction)}
          onClick={
            startDisabled
              ? undefined
              : () => onStartNewAssessment(viewModel.sessionId)
          }
        >
          {actionLabel(viewModel.startAction)}
          <Icon name="refresh" />
        </button>
      )}
    >
      <section className="travel-r1-migration-card" role="status">
        <span className="travel-r1-migration-card__icon" aria-hidden="true">
          <Icon name="refresh" />
        </span>
        <span className="eyebrow">{viewModel.legacySourceLabel}</span>
        <h2>需要重新开始新的旅游英语词汇测试</h2>
        <p>
          旧测试的题型和估算方式与当前五阶段抽样不兼容，不能换算成新的词汇量或等级。
        </p>
        <p>
          原记录会由应用层保留；开始后将使用一组新的旅游英语单词样本。
        </p>
      </section>
    </TrainingScreen>
  )
}

export function TravelVocabularyR1ResultsScreen({
  viewModel,
  onExit,
  onContinue,
}: TravelVocabularyR1ResultsScreenProps) {
  const continueDisabled = isActionDisabled(
    viewModel.continueAction,
  )

  return (
    <TrainingScreen
      className="travel-r1-screen travel-r1-screen--results"
      header={{
        eyebrow: 'TRAVEL WORDS',
        title: '旅游英语词汇结果',
      }}
      exitLabel="退出旅游英语词汇结果"
      onExit={() => onExit(viewModel.sessionId)}
      action={(
        <button
          className="primary-button"
          type="button"
          disabled={continueDisabled}
          aria-label={actionAccessibleLabel(
            viewModel.continueAction,
          )}
          onClick={
            continueDisabled
              ? undefined
              : () => onContinue(viewModel.sessionId)
          }
        >
          {actionLabel(viewModel.continueAction)}
          <Icon name="arrow-right" />
        </button>
      )}
    >
      <section className="travel-r1-result-hero">
        <span className="travel-r1-level-badge">
          {viewModel.levelLabel}
        </span>
        <span className="eyebrow">估算旅游英语词汇量</span>
        <strong>{viewModel.estimatedWordsLabel}</strong>
        <span>{viewModel.reasonableIntervalLabel}</span>
      </section>

      <section className="travel-r1-result-overview" aria-label="测试汇总">
        <article>
          <span>总作答</span>
          <strong>{viewModel.answeredCountLabel}</strong>
        </article>
        <article>
          <span>正确</span>
          <strong>{viewModel.correctCountLabel}</strong>
        </article>
        <article>
          <span>不确定</span>
          <strong>{viewModel.uncertainCountLabel}</strong>
        </article>
        <article>
          <span>有效时间</span>
          <strong>{viewModel.elapsedLabel}</strong>
        </article>
      </section>

      <section
        className="travel-r1-result-stages"
        aria-labelledby="travel-r1-stage-results-heading"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">FIVE STAGES</span>
            <h2 id="travel-r1-stage-results-heading">五阶段明细</h2>
          </div>
        </div>
        {viewModel.stageResults.map((stage) => (
          <article key={stage.id}>
            <header>
              <span>{stage.order}</span>
              <div>
                <h3>{stage.label}</h3>
                <small>{stage.representativeWordCountLabel}</small>
              </div>
              <strong>{stage.correctCountLabel}</strong>
            </header>
            <dl>
              <div>
                <dt>掌握比例</dt>
                <dd>{stage.masteryRateLabel}</dd>
              </div>
              <div>
                <dt>阶段估算</dt>
                <dd>{stage.estimatedWordsLabel}</dd>
              </div>
              <div>
                <dt>合理区间</dt>
                <dd>{stage.reasonableIntervalLabel}</dd>
              </div>
            </dl>
          </article>
        ))}
      </section>

      <section
        className="travel-r1-calibration"
        aria-labelledby="travel-r1-calibration-heading"
      >
        <span className="eyebrow">ABILITY STATUS</span>
        <h2 id="travel-r1-calibration-heading">能力校准状态</h2>
        <div>
          <article>
            <span>词汇</span>
            <strong>{viewModel.vocabularyCalibrationLabel}</strong>
          </article>
          <article>
            <span>听力</span>
            <strong>{viewModel.listeningCalibrationLabel}</strong>
          </article>
          <article>
            <span>口语</span>
            <strong>{viewModel.speakingCalibrationLabel}</strong>
          </article>
        </div>
        <p>{viewModel.calibrationDescription}</p>
      </section>

      <section className="travel-r1-disclaimer" aria-label="结果说明">
        <Icon name="info" />
        <div>
          <h2>这是一项学习起点估算</h2>
          <p>{viewModel.disclaimer}</p>
          <p>{viewModel.levelDisclaimer}</p>
        </div>
      </section>
    </TrainingScreen>
  )
}

export function TravelVocabularyR1StatusScreen({
  viewModel,
  onExit,
  onRetry,
  onRestoreLocal,
}: TravelVocabularyR1StatusScreenProps) {
  const action =
    viewModel.kind === 'error'
      ? viewModel.retryAction
      : viewModel.kind === 'offline'
        ? viewModel.restoreAction
        : undefined
  const actionDisabled = action ? isActionDisabled(action) : true
  const actionHandler =
    viewModel.kind === 'error' ? onRetry : onRestoreLocal

  return (
    <TrainingScreen
      className="travel-r1-screen travel-r1-screen--status"
      header={{
        eyebrow: 'TRAVEL WORDS',
        title: '旅游英语词汇测试',
      }}
      exitLabel="退出旅游英语词汇测试"
      onExit={onExit}
      action={
        action && actionHandler ? (
          <button
            className="primary-button"
            type="button"
            disabled={actionDisabled}
            aria-label={actionAccessibleLabel(action)}
            onClick={actionDisabled ? undefined : actionHandler}
          >
            {actionLabel(action)}
            <Icon
              name={
                viewModel.kind === 'error'
                  ? 'refresh'
                  : 'arrow-right'
              }
            />
          </button>
        ) : undefined
      }
    >
      {viewModel.kind === 'loading' ? (
        <LoadingState label={viewModel.label} />
      ) : (
        <section
          className={`travel-r1-system-card travel-r1-system-card--${viewModel.kind}`}
          role={viewModel.kind === 'error' ? 'alert' : 'status'}
        >
          <span className="travel-r1-system-card__icon" aria-hidden="true">
            <Icon
              name={
                viewModel.kind === 'error'
                  ? 'info'
                  : 'wifi-off'
              }
            />
          </span>
          <h2>{viewModel.title}</h2>
          <p>{viewModel.description}</p>
        </section>
      )}
    </TrainingScreen>
  )
}
