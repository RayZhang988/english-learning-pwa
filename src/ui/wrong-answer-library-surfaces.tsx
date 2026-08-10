import type { ReactNode } from 'react'
import { EmptyState, ErrorState, LoadingState } from './feedback-states.tsx'
import { Icon } from './icons.tsx'

export type WrongAnswerLibraryTab = 'active' | 'history'
export type WrongAnswerLibraryStatus = 'loading' | 'error' | 'ready'
export type WrongAnswerReviewPhase = 'answering' | 'feedback' | 'saving' | 'error' | 'unscorable' | 'round-completed'

/** Rendered by 01 from the 06/07/08 review view union; this shell never scores it. */
export type WrongAnswerReviewQuestionSlot =
  | { readonly kind: 'vocabulary'; readonly content: ReactNode }
  | { readonly kind: 'listening'; readonly content: ReactNode }
  | { readonly kind: 'speaking'; readonly content: ReactNode }

export interface WrongAnswerLibraryRecordViewModel {
  readonly id: string
  readonly summary: string
  readonly sourceLabel: string
  readonly incorrectCount: number
  readonly lastIncorrectAtLabel: string
  readonly consecutiveCorrect: 0 | 1
  readonly movedAtLabel?: string
}

export interface WrongAnswerLibraryViewModel {
  readonly status: WrongAnswerLibraryStatus
  readonly activeCount: number
  readonly selectedTab: WrongAnswerLibraryTab
  readonly activeRecords: readonly WrongAnswerLibraryRecordViewModel[]
  readonly historyRecords: readonly WrongAnswerLibraryRecordViewModel[]
  readonly canStart: boolean
  readonly hasResumableRound: boolean
  readonly busy?: boolean
  readonly error?: { readonly title: string; readonly description: string }
  readonly corruptRecovery?: { readonly confirming: boolean; readonly busy: boolean }
}

export interface WrongAnswerReviewViewModel {
  readonly phase: WrongAnswerReviewPhase
  readonly answeredCount: number
  readonly correctCount: number
  readonly accuracy: number | null
  readonly remainingCount: number
  readonly questionSlot?: WrongAnswerReviewQuestionSlot
  /** Supplied by 01 from the active module state; 02 never guesses readiness. */
  readonly primaryAction?: { readonly label: string; readonly disabled: boolean; readonly hidden?: boolean; readonly busy?: boolean }
  /** A completed round exposes this only when another active record really exists. */
  readonly newRoundAction?: { readonly label: string; readonly disabled: boolean; readonly hidden?: boolean }
  readonly feedback?:
    | { readonly outcome: 'correct'; readonly consecutiveCorrect: 1; readonly message: string }
    | { readonly outcome: 'incorrect'; readonly consecutiveCorrect: 0; readonly message: string }
    | { readonly outcome: 'moved-to-history'; readonly consecutiveCorrect: 2; readonly message: string }
  readonly error?: { readonly title: string; readonly description: string }
}

export interface WrongAnswerLibraryEntryProps {
  readonly status: WrongAnswerLibraryStatus
  readonly activeCount: number
  readonly disabled?: boolean
  readonly onOpen: () => void | Promise<void>
}

export function WrongAnswerLibraryEntry({ status, activeCount, disabled, onOpen }: WrongAnswerLibraryEntryProps) {
  const loading = status === 'loading'
  const unavailable = status === 'error'
  return <button className="wrong-answer-entry" type="button" onClick={onOpen} disabled={disabled || loading || unavailable} aria-busy={loading} data-wrong-answer-library-entry="open">
    <span className="wrong-answer-entry__icon" aria-hidden="true"><Icon name="book" /></span>
    <span className="wrong-answer-entry__body"><span className="eyebrow">LEARNING TOOL</span><strong>错题库</strong><small>{loading ? '正在读取错题记录' : unavailable ? '暂时无法读取错题记录' : activeCount === 0 ? '暂无待复习错题' : `待复习 ${activeCount} 题`}</small></span>
    <Icon name="arrow-right" aria-hidden="true" />
  </button>
}

function accuracy(value: number | null): string { return value === null ? '暂无' : `${Math.round(value * 100)}%` }

function RecordList({ records, history }: { readonly records: readonly WrongAnswerLibraryRecordViewModel[]; readonly history: boolean }) {
  if (records.length === 0) return <EmptyState title={history ? '还没有历史记录' : '暂无待复习错题'} description={history ? '连续答对两次的错题会保留在这里，方便回看。' : '正式答错的题目会自动加入这里；无法评分的题目不会被算作错题。'} />
  return <ul className="wrong-answer-record-list" aria-label={history ? '历史错题记录' : '待复习错题'}>{records.map((record) => <li key={record.id}>
    <article><span className="wrong-answer-record__source">{record.sourceLabel}</span><h2>{record.summary}</h2>
      {history ? record.movedAtLabel ? <p>移入历史：{record.movedAtLabel}</p> : null : <dl><div><dt>累计答错</dt><dd>{record.incorrectCount} 次</dd></div><div><dt>最近答错</dt><dd>{record.lastIncorrectAtLabel}</dd></div><div><dt>连续答对</dt><dd>{record.consecutiveCorrect}/2</dd></div></dl>}
    </article></li>)}</ul>
}

export interface WrongAnswerLibraryScreenProps {
  readonly viewModel: WrongAnswerLibraryViewModel
  readonly onExit: () => void | Promise<void>
  readonly onSwitchTab: (tab: WrongAnswerLibraryTab) => void | Promise<void>
  readonly onStartRound: () => void | Promise<void>
  readonly onResumeRound: () => void | Promise<void>
  readonly onRetry: () => void | Promise<void>
  readonly onRequestCorruptReset?: () => void | Promise<void>
  readonly onCancelCorruptReset?: () => void | Promise<void>
  readonly onConfirmCorruptReset?: () => void | Promise<void>
}

export function WrongAnswerLibraryScreen({ viewModel, onExit, onSwitchTab, onStartRound, onResumeRound, onRetry, onRequestCorruptReset, onCancelCorruptReset, onConfirmCorruptReset }: WrongAnswerLibraryScreenProps) {
  return <main className="wrong-answer-library" aria-busy={viewModel.status === 'loading' || viewModel.busy}>
    <header className="wrong-answer-library__header"><button type="button" className="back-button" onClick={onExit} aria-label="返回训练"><Icon name="arrow-left" /></button><span className="eyebrow">LEARNING TOOL</span><h1>错题库</h1><p>日常、额外和场景训练中的正式错题集中在这里复习。</p></header>
    {viewModel.status === 'loading' ? <LoadingState label="正在读取错题库" /> : null}
    {viewModel.status === 'error' ? <><ErrorState title={viewModel.error?.title ?? '错题库暂时无法打开'} description={viewModel.error?.description ?? '请稍后重试。'} onRetry={onRetry} />{viewModel.corruptRecovery ? <section className="wrong-answer-library__recovery" aria-live="polite">{viewModel.corruptRecovery.confirming ? <><h2>只重置错题库？</h2><p>已备份损坏值。此操作只删除错题库，不会删除水平测试、今日计划或训练记录。</p><button type="button" disabled={viewModel.corruptRecovery.busy} onClick={onCancelCorruptReset}>取消</button><button type="button" disabled={viewModel.corruptRecovery.busy} aria-busy={viewModel.corruptRecovery.busy} onClick={onConfirmCorruptReset}>确认只重置错题库</button></> : <button type="button" disabled={viewModel.corruptRecovery.busy} onClick={onRequestCorruptReset}>重置损坏的错题库…</button>}</section> : null}</> : null}
    {viewModel.status === 'ready' ? <>
      <div className="wrong-answer-library__tabs" role="tablist" aria-label="错题库视图"><button id="wrong-answer-tab-active" type="button" role="tab" aria-selected={viewModel.selectedTab === 'active'} aria-controls="wrong-answer-panel-active" disabled={viewModel.busy} onClick={() => onSwitchTab('active')}>待复习 <span>{viewModel.activeCount}</span></button><button id="wrong-answer-tab-history" type="button" role="tab" aria-selected={viewModel.selectedTab === 'history'} aria-controls="wrong-answer-panel-history" disabled={viewModel.busy} onClick={() => onSwitchTab('history')}>历史记录</button></div>
      <section id={viewModel.selectedTab === 'active' ? 'wrong-answer-panel-active' : 'wrong-answer-panel-history'} role="tabpanel" aria-labelledby={viewModel.selectedTab === 'active' ? 'wrong-answer-tab-active' : 'wrong-answer-tab-history'}>{viewModel.selectedTab === 'active' ? <><RecordList records={viewModel.activeRecords} history={false} />{viewModel.activeCount > 0 ? <button className="primary-button wrong-answer-library__start" type="button" disabled={viewModel.busy || !viewModel.canStart} onClick={viewModel.hasResumableRound ? onResumeRound : onStartRound}>{viewModel.hasResumableRound ? '继续本轮复习' : '开始复习'}</button> : null}</> : <RecordList records={viewModel.historyRecords} history />}</section>
    </> : null}
  </main>
}

export interface WrongAnswerReviewScreenProps {
  readonly viewModel: WrongAnswerReviewViewModel
  readonly onExit: () => void | Promise<void>
  readonly onSubmit: () => void | Promise<void>
  readonly onAdvance: () => void | Promise<void>
  readonly onRetry: () => void | Promise<void>
  readonly onNewRound: () => void | Promise<void>
}

export function WrongAnswerReviewScreen({ viewModel, onExit, onSubmit, onAdvance, onRetry, onNewRound }: WrongAnswerReviewScreenProps) {
  const busy = viewModel.phase === 'saving'
  const questionClassName = `wrong-answer-review__question${viewModel.questionSlot ? ` wrong-answer-review__question--${viewModel.questionSlot.kind}` : ''}`
  const action = viewModel.primaryAction
  const actionButton = action && !action.hidden ? <button className="primary-button" type="button" disabled={busy || action.busy || action.disabled} aria-busy={action.busy} onClick={viewModel.phase === 'feedback' ? onAdvance : onSubmit}>{action.label}</button> : null
  return <main className="wrong-answer-review" aria-busy={busy}><header className="wrong-answer-review__header"><button type="button" className="back-button" onClick={onExit} disabled={busy} aria-label="退出错题复习"><Icon name="arrow-left" /></button><div><span className="eyebrow">WRONG ANSWER REVIEW</span><h1>错题复习</h1></div></header>
    <dl className="wrong-answer-review__stats" aria-label="本轮复习进度"><div><dt>已答</dt><dd>{viewModel.answeredCount}</dd></div><div><dt>答对</dt><dd>{viewModel.correctCount}</dd></div><div><dt>正确率</dt><dd>{accuracy(viewModel.accuracy)}</dd></div><div><dt>剩余</dt><dd>{viewModel.remainingCount}</dd></div></dl>
    {viewModel.phase === 'round-completed' ? <section className="wrong-answer-review__complete" aria-live="polite"><h2>本轮复习完成</h2><p>本轮已答 {viewModel.answeredCount} 题，答对 {viewModel.correctCount} 题。</p>{viewModel.newRoundAction && !viewModel.newRoundAction.hidden ? <button className="primary-button" type="button" disabled={viewModel.newRoundAction.disabled} onClick={onNewRound}>{viewModel.newRoundAction.label}</button> : null}</section> : null}
    {viewModel.phase === 'error' ? <>{viewModel.questionSlot ? <section className={questionClassName} aria-live="polite">{viewModel.questionSlot.content}</section> : null}<ErrorState title={viewModel.error?.title ?? '本轮复习暂时无法继续'} description={viewModel.error?.description ?? '已保存的进度不会丢失。'} onRetry={onRetry} /></> : null}
    {viewModel.phase === 'unscorable' ? <><section className={questionClassName} aria-live="polite">{viewModel.questionSlot?.content}</section><section className="wrong-answer-review__notice" role="alert"><h2>本题暂时无法评分</h2><p>可重试或稍后继续；这不会被记为错题，也不会改变连续答对进度。</p><button className="secondary-button" type="button" onClick={onRetry}>重试本题</button></section></> : null}
    {viewModel.phase === 'answering' || viewModel.phase === 'feedback' || busy ? <section className={questionClassName} aria-live="polite">{viewModel.questionSlot?.content}{busy ? <p className="wrong-answer-review__saving">正在保存本题结果…</p> : null}{viewModel.phase === 'feedback' && viewModel.feedback ? <div className={`wrong-answer-review__feedback wrong-answer-review__feedback--${viewModel.feedback.outcome}`}><h2>{viewModel.feedback.message}</h2><p>{viewModel.feedback.outcome === 'incorrect' ? '连续答对已归零。' : viewModel.feedback.outcome === 'moved-to-history' ? '已连续答对 2 次，已移入历史记录。' : '连续答对 1/2，再答对一次即可移入历史记录。'}</p>{actionButton}</div> : viewModel.phase === 'answering' ? actionButton : null}</section> : null}
  </main>
}
