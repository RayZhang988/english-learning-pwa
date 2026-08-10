import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { browserListeningSpeech } from '../features/listening/index.ts'
import { browserMicrophonePermission } from '../platform/index.ts'
import { startWrongAnswerReviewRound, type WrongAnswerLibraryState } from '../learning-engine/index.ts'
import { WrongAnswerLibraryScreen, WrongAnswerReviewScreen, type WrongAnswerLibraryTab, type WrongAnswerReviewViewModel } from '../ui/index.ts'
import { playSceneVocabularyTarget } from './scene-vocabulary-target-playback.ts'
import { WrongAnswerLibraryCorruptStateError, wrongAnswerLibraryStore } from './wrong-answer-library-store.ts'
import { WrongAnswerReviewCoordinator, type WrongAnswerReviewActive, type WrongAnswerReviewCoordinatorSnapshot } from './wrong-answer-review-coordinator.ts'
import { wrongAnswerReviewContentResolver } from './wrong-answer-review-content-resolver.ts'

const sourceLabel = { 'daily-training': '日常训练', 'extra-training': '额外训练', 'scenario-training': '场景训练', 'wrong-answer-review': '错题复习' } as const
function records(library: WrongAnswerLibraryState) { return Object.values(library.records).map((record) => ({ status: record.status, view: { id: record.recordId, summary: `${record.domain === 'vocabulary' ? '词汇' : record.domain === 'listening' ? '听力' : '口语'}错题`, sourceLabel: sourceLabel[record.lastSource], incorrectCount: record.incorrectCount, lastIncorrectAtLabel: new Date(record.lastIncorrectAt).toLocaleString('zh-CN'), consecutiveCorrect: Math.min(record.consecutiveReviewCorrect, 1) as 0 | 1, ...(record.movedToHistoryAt ? { movedAtLabel: new Date(record.movedToHistoryAt).toLocaleString('zh-CN') } : {}) } })) }

export function WrongAnswerLibraryRouteHost() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<WrongAnswerLibraryTab>('active')
  const [state, setState] = useState<{
    readonly library?: WrongAnswerLibraryState
    readonly error?: Error
    readonly busy: boolean
    readonly corrupt: boolean
    readonly confirmingReset: boolean
  }>({ busy: false, corrupt: false, confirmingReset: false })
  const load = () => {
    setState({ busy: false, corrupt: false, confirmingReset: false })
    void wrongAnswerLibraryStore.load().then(
      (library) => setState({ library, busy: false, corrupt: false, confirmingReset: false }),
      (reason: unknown) => {
        const error = reason instanceof Error ? reason : new Error('错题库读取失败。')
        setState({ error, busy: false, corrupt: error instanceof WrongAnswerLibraryCorruptStateError, confirmingReset: false })
      },
    )
  }
  useEffect(load, [])
  const library = state.library; const mapped = library ? records(library) : []
  const start = async () => { if (state.busy) return; setState((current) => ({ ...current, busy: true })); try { await wrongAnswerLibraryStore.update((current) => startWrongAnswerReviewRound(current, { roundId: crypto.randomUUID(), seed: crypto.randomUUID(), startedAt: new Date().toISOString() })); navigate('/practice/wrong-answers/review') } catch (error) { setState({ library, busy: false, error: error instanceof Error ? error : new Error('无法开始复习。'), corrupt: false, confirmingReset: false }) } }
  const confirmReset = async () => {
    if (state.busy || !state.corrupt || !state.confirmingReset) return
    setState((current) => ({ ...current, busy: true }))
    try {
      await wrongAnswerLibraryStore.resetAfterUserRecovery()
      const next = await wrongAnswerLibraryStore.load()
      setState({ library: next, busy: false, corrupt: false, confirmingReset: false })
    } catch (reason) {
      setState((current) => ({ ...current, busy: false, error: reason instanceof Error ? reason : new Error('无法重置错题库。') }))
    }
  }
  return <WrongAnswerLibraryScreen viewModel={{ status: state.error ? 'error' : library ? 'ready' : 'loading', activeCount: mapped.filter((entry) => entry.status === 'active').length, selectedTab: tab, activeRecords: mapped.filter((entry) => entry.status === 'active').map((entry) => entry.view), historyRecords: mapped.filter((entry) => entry.status === 'history').map((entry) => entry.view), canStart: Boolean(library && (!library.activeRound || library.activeRound.status !== 'active')), hasResumableRound: library?.activeRound?.status === 'active', busy: state.busy, ...(state.error ? { error: { title: state.corrupt ? '无法恢复错题库' : '错题库暂时无法打开', description: state.error.message } } : {}), ...(state.corrupt ? { corruptRecovery: { confirming: state.confirmingReset, busy: state.busy } } : {}) }} onExit={() => navigate('/practice')} onSwitchTab={setTab} onStartRound={start} onResumeRound={() => navigate('/practice/wrong-answers/review')} onRetry={load} onRequestCorruptReset={() => setState((current) => ({ ...current, confirmingReset: true }))} onCancelCorruptReset={() => setState((current) => ({ ...current, confirmingReset: false }))} onConfirmCorruptReset={confirmReset} />
}

function VocabularySlot({ active, coordinator, disabled }: { readonly active: Extract<WrongAnswerReviewActive, { kind: 'vocabulary' }>; readonly coordinator: WrongAnswerReviewCoordinator; readonly disabled: boolean }) {
  const scene = active.question.scenePresentation
  return <article><p>{active.question.prompt}</p>{scene ? <p lang="en-US">{scene.sentenceEn.beforeTarget}<button type="button" disabled={disabled} onClick={() => playSceneVocabularyTarget(browserListeningSpeech, scene.targetPlayback)}>{scene.sentenceEn.targetText}</button>{scene.sentenceEn.afterTarget}</p> : null}<div role="group" aria-label="词汇答案">{active.question.options.map((option) => <button type="button" key={option.id} disabled={disabled} aria-pressed={active.selectedOptionId === option.id} onClick={() => { void coordinator.selectVocabulary(option.id) }}>{option.label}</button>)}</div></article>
}
function ListeningSlot({ active, coordinator, phase, disabled }: { readonly active: Extract<WrongAnswerReviewActive, { kind: 'listening' }>; readonly coordinator: WrongAnswerReviewCoordinator; readonly phase: WrongAnswerReviewViewModel['phase']; readonly disabled: boolean }) {
  const { snapshot } = active; const question = snapshot.question; const discloseTranslation = phase === 'feedback'
  return <article><button type="button" disabled={disabled} onClick={() => { void coordinator.listening('toggle') }}>{snapshot.playback.status === 'playing' ? '暂停音频' : '播放音频'}</button><label>播放速度<select value={snapshot.playback.rate} disabled={disabled} onChange={(event) => { void coordinator.setListeningRate(Number(event.currentTarget.value)) }}>{question.playbackPolicy.allowedRates.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></label><div role="group" aria-label="重复方式">{([['none', '不重复'], ['segment', '重复当前片段'], ['all', '循环全部片段']] as const).map(([mode, label]) => <button type="button" key={mode} disabled={disabled} aria-pressed={snapshot.playback.repeatMode === mode} onClick={() => { void coordinator.setListeningRepeat(mode) }}>{label}</button>)}</div>{question.playbackPolicy.allowSegmentSelection ? <div>{question.segments.map((segment) => <button type="button" key={segment.id} disabled={disabled} aria-pressed={snapshot.playback.currentSegmentId === segment.id} onClick={() => { void coordinator.selectListeningSegment(segment.id) }}>{segment.label}</button>)}</div> : null}<h2>{question.promptZh}</h2>{question.type === 'keyword-dictation' ? <><p>填写 {question.targetKeywords.length} 项关键词，按听到的顺序输入。</p><input value={snapshot.dictationInput} disabled={disabled} onChange={(event) => { void coordinator.changeListening(event.currentTarget.value) }} />{phase === 'feedback' ? <div><p>参考答案：{question.standardAnswer}</p><p>目标关键词：{question.targetKeywords.join('、')}</p></div> : null}</> : <div role="group" aria-label="听力答案">{question.options.map((option) => <button type="button" key={option.id} disabled={disabled} aria-pressed={snapshot.selectedOptionId === option.id} onClick={() => { void coordinator.selectListening(option.id) }}><span lang="en-US">{option.label}</span>{discloseTranslation && option.translationZh ? <small>{option.translationZh}</small> : null}</button>)}</div>}{phase === 'feedback' && snapshot.answer ? <p>{snapshot.answer.correct ? '回答正确' : '回答不正确'}。{question.rationaleZh}</p> : null}</article>
}
function SpeakingSlot({ active, coordinator, disabled }: { readonly active: Extract<WrongAnswerReviewActive, { kind: 'speaking' }>; readonly coordinator: WrongAnswerReviewCoordinator; readonly disabled: boolean }) {
  const { view } = active
  return <article><p>{view.prompt?.cueZh}</p><h2 lang="en-US">{view.prompt?.partnerLine}</h2><button type="button" disabled={disabled || view.mediaStatus !== 'idle' || view.advancing} onClick={() => { void coordinator.startSpeaking() }}>开始录音</button><button type="button" disabled={disabled || view.mediaStatus !== 'capturing' || view.advancing} onClick={() => { void coordinator.stopSpeaking() }}>停止录音</button><button type="button" disabled={disabled || !view.recordingAvailable || view.mediaStatus !== 'idle' || view.advancing} onClick={() => { void coordinator.playSpeaking() }}>回放录音</button>{view.feedback ? <div><p>识别文本：<span lang="en-US">{view.feedback.transcript}</span></p><p>参考回答：<span lang="en-US">{view.prompt?.modelAnswer}</span></p></div> : null}</article>
}

function phase(snapshot: WrongAnswerReviewCoordinatorSnapshot): WrongAnswerReviewViewModel['phase'] { const round = snapshot.library?.activeRound; if (snapshot.status === 'error') return 'error'; if (snapshot.busy) return 'saving'; if (!round || round.status === 'completed') return 'round-completed'; if (snapshot.active?.kind === 'speaking' && snapshot.active.view.unscorable) return 'unscorable'; if (snapshot.active?.kind === 'listening' && snapshot.active.snapshot.phase === 'error') return 'error'; return round.stage === 'feedback' ? 'feedback' : 'answering' }
function feedback(snapshot: WrongAnswerReviewCoordinatorSnapshot): WrongAnswerReviewViewModel['feedback'] { const round = snapshot.library?.activeRound; const active = snapshot.active; if (!round || round.stage !== 'feedback' || !active) return undefined; const record = snapshot.library?.records[active.record.recordId]; if (record?.status === 'history') return { outcome: 'moved-to-history', consecutiveCorrect: 2, message: '回答正确，已移入历史' }; const correct = active.kind === 'vocabulary' ? active.selectedOptionId === active.question.correctOptionId : active.kind === 'listening' ? active.snapshot.answer?.correct === true : active.view.feedback?.match.level === 'match' || active.view.feedback?.match.level === 'close'; return correct ? { outcome: 'correct', consecutiveCorrect: 1, message: '回答正确' } : { outcome: 'incorrect', consecutiveCorrect: 0, message: '回答不正确' } }

export function WrongAnswerReviewRouteHost() {
  const navigate = useNavigate(); const coordinatorRef = useRef<WrongAnswerReviewCoordinator | null>(null); if (!coordinatorRef.current) coordinatorRef.current = new WrongAnswerReviewCoordinator({ state: wrongAnswerLibraryStore, resolver: wrongAnswerReviewContentResolver, speaking: { requestMicrophone: () => browserMicrophonePermission.request() } })
  const coordinator = coordinatorRef.current; const [snapshot, setSnapshot] = useState(coordinator.snapshot)
  useEffect(() => { const unsubscribe = coordinator.subscribe(() => setSnapshot(coordinator.snapshot)); void coordinator.initialize(); return () => { unsubscribe(); coordinator.dispose() } }, [coordinator])
  const currentPhase = phase(snapshot); const active = snapshot.active; const disabled = snapshot.busy || currentPhase === 'feedback'
  let slot: { kind: 'vocabulary' | 'listening' | 'speaking'; content: ReactNode } | undefined
  if (active?.kind === 'vocabulary') slot = { kind: 'vocabulary', content: <VocabularySlot active={active} coordinator={coordinator} disabled={disabled} /> }
  if (active?.kind === 'listening') slot = { kind: 'listening', content: <ListeningSlot active={active} coordinator={coordinator} phase={currentPhase} disabled={disabled} /> }
  if (active?.kind === 'speaking') slot = { kind: 'speaking', content: <SpeakingSlot active={active} coordinator={coordinator} disabled={snapshot.busy || currentPhase === 'feedback'} /> }
  const round = snapshot.library?.activeRound; const responseReady = active?.kind === 'vocabulary' ? Boolean(active.selectedOptionId) : active?.kind === 'listening' ? Boolean(active.snapshot.question.type === 'keyword-dictation' ? active.snapshot.dictationInput.trim() : active.snapshot.selectedOptionId) && (active.snapshot.playback.completedPlayCounts?.[active.snapshot.question.primarySegmentId] ?? 0) > 0 : false
  const model: WrongAnswerReviewViewModel = { phase: currentPhase, answeredCount: round?.answeredCount ?? 0, correctCount: round?.correctCount ?? 0, accuracy: round && round.answeredCount > 0 ? round.correctCount / round.answeredCount : null, remainingCount: round ? Math.max(0, round.order.length - round.answeredCount) : 0, questionSlot: slot, feedback: feedback(snapshot), ...(currentPhase === 'answering' && active?.kind !== 'speaking' ? { primaryAction: { label: '提交答案', disabled: !responseReady } } : {}), ...(currentPhase === 'feedback' ? { primaryAction: { label: '下一题', disabled: false } } : {}), ...(currentPhase === 'round-completed' && Object.values(snapshot.library?.records ?? {}).some((record) => record.status === 'active') ? { newRoundAction: { label: '开始新一轮', disabled: false } } : {}), ...(snapshot.error ? { error: { title: '本题暂时无法继续', description: snapshot.error.message } } : {}) }
  const newRound = async () => { await coordinator.startNewRound({ roundId: crypto.randomUUID(), seed: crypto.randomUUID(), startedAt: new Date().toISOString() }) }
  return <WrongAnswerReviewScreen viewModel={model} onExit={() => navigate('/practice/wrong-answers')} onSubmit={async () => { await coordinator.submit() }} onAdvance={async () => { await coordinator.advance() }} onRetry={async () => { if (currentPhase === 'unscorable') coordinator.retrySpeaking(); else if (currentPhase === 'error' && active?.kind === 'listening' && active.snapshot.phase === 'error') await coordinator.listening('retry'); else await coordinator.initialize() }} onNewRound={newRound} />
}
