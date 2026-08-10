import {
  advanceWrongAnswerReviewRound,
  assertRecoverableWrongAnswerReviewRound,
  submitWrongAnswerReviewAnswer,
  updateWrongAnswerReviewRoundSnapshot,
  type ReviewContentIdentity,
  type WrongAnswerEvidence,
  type WrongAnswerLibraryState,
  type WrongAnswerLibraryStatePort,
  type WrongAnswerRecord,
} from '../../learning-engine/index.ts'
import { judgeListeningAnswer } from './answers.ts'
import { ListeningError } from './errors.ts'
import { ListeningPlaybackController } from './playback-controller.ts'
import { browserListeningSpeech, type ListeningSpeechPort } from './speech-synthesis.ts'
import { resolveListeningSupplyQuestion } from './supply.ts'
import type { ListeningAnswerRecord, ListeningCatalog, ListeningPlaybackState, ListeningQuestion, ListeningSupplyItem, ListeningTrainingUnit } from './types.ts'

/**
 * The 05 alias source is the sole bridge back to released content.  It rejects
 * source/type drift rather than guessing from playback text or audio identity.
 */
export function resolveListeningWrongAnswerReviewItem(
  catalog: ListeningCatalog,
  item: ListeningSupplyItem,
  identity: ReviewContentIdentity,
): { readonly unit: ListeningTrainingUnit; readonly question: ListeningQuestion; readonly identity: ReviewContentIdentity } {
  const resolved = resolveListeningSupplyQuestion(catalog, item)
  const expected = resolved.question.type === 'word-discrimination' ? 'listening-word-discrimination'
    : resolved.question.type === 'short-sentence-choice' ? 'listening-short-sentence-choice'
      : resolved.question.type === 'keyword-dictation' ? 'listening-keyword-dictation'
        : resolved.question.type === 'core-information' ? 'listening-full-transcript-detail-choice'
          : 'listening-scene-audio-single-choice'
  if (identity.originalQuestionType !== expected) throw new ListeningError('content-invalid', 'Wrong-answer review alias and listening question type do not match.')
  return { ...resolved, identity }
}

export interface ListeningWrongAnswerReviewSnapshot {
  readonly schemaVersion: 1
  readonly recordId: string
  readonly identity: ReviewContentIdentity
  readonly unit: ListeningTrainingUnit
  readonly question: ListeningQuestion
  readonly selectedOptionId: string | null
  readonly dictationInput: string
  readonly answer: ListeningAnswerRecord | null
  readonly playback: ListeningPlaybackState
  readonly phase: 'answering' | 'feedback' | 'completed' | 'error'
  readonly pendingEvidence: WrongAnswerEvidence | null
  readonly updatedAt: string
}

export interface ListeningWrongAnswerReviewRuntimeOptions {
  readonly record: WrongAnswerRecord
  /** Must resolve 05's exact alias, including its original question type. */
  readonly resolve: (record: WrongAnswerRecord) => Promise<{ unit: ListeningTrainingUnit; question: ListeningQuestion; identity: ReviewContentIdentity }>
  /** One 04-owned atomic state. Draft, evidence and round progress never use separate writes. */
  readonly state: WrongAnswerLibraryStatePort
  readonly restoredSnapshot?: ListeningWrongAnswerReviewSnapshot
  /** Observation only. Persistence is complete before this callback runs. */
  readonly onView?: (snapshot: ListeningWrongAnswerReviewSnapshot) => void
  readonly speech?: ListeningSpeechPort
  readonly now?: () => string
}

const LISTENING_DRAFT_PREFIX = 'listening-wrong-answer-review:v1:'

function encodeSnapshot(snapshot: ListeningWrongAnswerReviewSnapshot): string {
  return `${LISTENING_DRAFT_PREFIX}${JSON.stringify(snapshot)}`
}

function decodeSnapshot(value: string | readonly string[] | null): ListeningWrongAnswerReviewSnapshot | null {
  if (typeof value !== 'string' || !value.startsWith(LISTENING_DRAFT_PREFIX)) return null
  let decoded: unknown
  try { decoded = JSON.parse(value.slice(LISTENING_DRAFT_PREFIX.length)) } catch (error) {
    throw new ListeningError('session-recovery-invalid', 'Wrong-answer listening draft is corrupt.', { cause: error })
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new ListeningError('session-recovery-invalid', 'Wrong-answer listening draft is corrupt.')
  const snapshot = decoded as Partial<ListeningWrongAnswerReviewSnapshot>
  if (snapshot.schemaVersion !== 1 || typeof snapshot.recordId !== 'string' || !snapshot.identity || !snapshot.question || !snapshot.unit || !snapshot.playback || !['answering', 'feedback', 'completed', 'error'].includes(String(snapshot.phase)) || typeof snapshot.updatedAt !== 'string') {
    throw new ListeningError('session-recovery-invalid', 'Wrong-answer listening draft is corrupt.')
  }
  return snapshot as ListeningWrongAnswerReviewSnapshot
}

function playback(question: ListeningQuestion): ListeningPlaybackState {
  return { status: 'idle', currentSegmentId: question.primarySegmentId, rate: question.playbackPolicy.allowedRates.includes(1) ? 1 : question.playbackPolicy.allowedRates[0]!, repeatMode: 'none', playCounts: {}, completedPlayCounts: {}, errorMessage: null }
}

/** Dedicated review runtime. It deliberately has no LearningTask or supply request. */
export class ListeningWrongAnswerReviewRuntime {
  private snapshot: ListeningWrongAnswerReviewSnapshot | null = null
  private writeTail: Promise<void> = Promise.resolve()
  private generation = 0
  private controller: ListeningPlaybackController | null = null
  private readonly speech: ListeningSpeechPort
  private readonly now: () => string
  private readonly options: ListeningWrongAnswerReviewRuntimeOptions
  constructor(options: ListeningWrongAnswerReviewRuntimeOptions) {
    this.options = options
    this.speech = options.speech ?? browserListeningSpeech
    this.now = options.now ?? (() => new Date().toISOString())
  }
  get currentSnapshot() { return this.snapshot }
  private assertActiveRecord(state: WrongAnswerLibraryState) {
    const round = assertRecoverableWrongAnswerReviewRound(state)
    const record = round?.status === 'active' ? state.records[round.order[round.index]!] : undefined
    if (!round || !record || record.recordId !== this.options.record.recordId) throw new ListeningError('session-transition-invalid', 'Wrong-answer listening review moved to another item.')
    return { round, record }
  }
  private async save(snapshot: ListeningWrongAnswerReviewSnapshot) {
    await this.options.state.update((latest) => {
      const { round } = this.assertActiveRecord(latest)
      return updateWrongAnswerReviewRoundSnapshot(latest, {
        index: round.index, stage: round.stage, answerDraft: encodeSnapshot(snapshot),
        answeredCount: round.answeredCount, correctCount: round.correctCount,
        updatedAt: snapshot.updatedAt, status: round.status,
      })
    })
    this.snapshot = snapshot
    this.options.onView?.(snapshot)
    return snapshot
  }
  private queuePlayback(playback: ListeningPlaybackState, generation: number) {
    this.writeTail = this.writeTail.catch(() => undefined).then(async () => {
      if (generation !== this.generation || !this.snapshot) return
      // Merge only the controller delta into the newest acknowledged state.
      await this.save({ ...this.snapshot, playback, updatedAt: this.now() })
    })
    void this.writeTail.catch(() => undefined)
  }
  private attach(snapshot: ListeningWrongAnswerReviewSnapshot) {
    this.controller?.dispose()
    const generation = ++this.generation
    if (snapshot.phase === 'completed' || snapshot.phase === 'error') { this.controller = null; return }
    this.controller = new ListeningPlaybackController({ question: snapshot.question, initialState: snapshot.playback, speech: this.speech,
      onStateChange: (state) => this.queuePlayback(state, generation),
      onFailure: () => { void this.writeTail.then(() => generation === this.generation && this.snapshot ? this.save({ ...this.snapshot, phase: 'error', playback: { ...this.snapshot.playback, status: 'error', errorMessage: '设备语音暂时不可用。' }, updatedAt: this.now() }) : undefined) },
    })
  }
  private require() { if (!this.snapshot) throw new ListeningError('session-transition-invalid', 'Wrong-answer listening review is not initialized.'); return this.snapshot }
  async initialize() {
    const library = await this.options.state.load()
    const { round, record } = this.assertActiveRecord(library)
    if (record.reviewContentId !== this.options.record.reviewContentId || record.originalQuestionType !== this.options.record.originalQuestionType) throw new ListeningError('session-recovery-invalid', 'Wrong-answer review record identity drift.')
    const restored = decodeSnapshot(round.answerDraft) ?? this.options.restoredSnapshot
    if (restored) {
      if (restored.recordId !== this.options.record.recordId || restored.identity.reviewContentId !== this.options.record.reviewContentId || restored.identity.originalQuestionType !== this.options.record.originalQuestionType) throw new ListeningError('session-recovery-invalid', 'Wrong-answer review snapshot identity drift.')
      const normalized = restored.playback.status === 'playing' ? { ...restored, playback: { ...restored.playback, status: 'paused' as const }, updatedAt: this.now() } : restored
      this.snapshot = normalized
      if (normalized !== restored || !decodeSnapshot(round.answerDraft)) await this.save(normalized)
      this.attach(this.snapshot); return this.snapshot
    }
    const resolved = await this.options.resolve(this.options.record)
    if (resolved.identity.reviewContentId !== this.options.record.reviewContentId || resolved.identity.originalQuestionType !== this.options.record.originalQuestionType || resolved.question.type === undefined) throw new ListeningError('content-invalid', 'Wrong-answer review resolver returned identity drift.')
    const created = await this.save({ schemaVersion: 1, recordId: this.options.record.recordId, identity: resolved.identity, unit: resolved.unit, question: resolved.question, selectedOptionId: null, dictationInput: '', answer: null, playback: playback(resolved.question), phase: 'answering', pendingEvidence: null, updatedAt: this.now() })
    this.attach(created); return created
  }
  async togglePlayback() { this.controller?.toggle(); await this.writeTail; return this.require() }
  async setRate(rate: number) { this.controller?.setRate(rate); await this.writeTail; return this.require() }
  async setRepeatMode(mode: ListeningPlaybackState['repeatMode']) { this.controller?.setRepeatMode(mode); await this.writeTail; return this.require() }
  async selectSegment(segmentId: string) { this.controller?.selectSegment(segmentId); await this.writeTail; return this.require() }
  async select(optionId: string) { const s = this.require(); if (s.phase !== 'answering' || s.question.type === 'keyword-dictation' || !s.question.options.some((option) => option.id === optionId)) throw new ListeningError('session-transition-invalid', 'Invalid wrong-answer review option.'); return this.save({ ...s, selectedOptionId: optionId, updatedAt: this.now() }) }
  async changeDictation(value: string) { const s = this.require(); if (s.phase !== 'answering' || s.question.type !== 'keyword-dictation') throw new ListeningError('session-transition-invalid', 'Wrong-answer review question is not dictation.'); return this.save({ ...s, dictationInput: value, updatedAt: this.now() }) }
  async submit() {
    const s = this.require(); const response = s.question.type === 'keyword-dictation' ? s.dictationInput : s.selectedOptionId
    if (s.phase !== 'answering' || !response || (s.playback.completedPlayCounts?.[s.question.primarySegmentId] ?? 0) === 0) throw new ListeningError('session-transition-invalid', 'Play and answer before submitting wrong-answer review.')
    this.controller?.interrupt(); const correct = judgeListeningAnswer(s.question, response); const submittedAt = this.now()
    const answer = { questionId: s.question.id, response, correct, submittedAt, playCount: s.playback.playCounts[s.question.primarySegmentId] ?? 0, rate: s.playback.rate, repeatMode: s.playback.repeatMode }
    const feedback = { ...s, answer, phase: 'feedback' as const, pendingEvidence: null, updatedAt: submittedAt }
    await this.options.state.update((latest) => {
      const { round } = this.assertActiveRecord(latest)
      const evidence: WrongAnswerEvidence = { schemaVersion: 1, eventId: `listening-review:${round.roundId}:${s.recordId}`, occurredAt: submittedAt, domain: 'listening', source: 'wrong-answer-review', outcome: correct ? 'correct' : 'incorrect', formallyScored: true, reviewContentId: s.identity.reviewContentId, originalQuestionType: s.identity.originalQuestionType }
      const scored = submitWrongAnswerReviewAnswer(latest, evidence).state
      const scoredRound = scored.activeRound!
      return updateWrongAnswerReviewRoundSnapshot(scored, {
        index: scoredRound.index, stage: scoredRound.stage, answerDraft: encodeSnapshot(feedback),
        answeredCount: scoredRound.answeredCount, correctCount: scoredRound.correctCount,
        updatedAt: submittedAt, status: scoredRound.status,
      })
    })
    this.snapshot = feedback
    this.options.onView?.(feedback)
    return feedback
  }
  async flush() { return this.require() }
  /** The round owner may request its next randomized record only after this acknowledgement. */
  async advance() {
    const s = this.require()
    if (s.phase !== 'feedback') throw new ListeningError('session-transition-invalid', 'Wrong-answer review can advance only after feedback.')
    const completed = { ...s, phase: 'completed' as const, updatedAt: this.now() }
    await this.options.state.update((latest) => {
      this.assertActiveRecord(latest)
      return advanceWrongAnswerReviewRound(latest, completed.updatedAt)
    })
    this.controller?.dispose(); this.controller = null; this.generation += 1
    this.snapshot = completed
    this.options.onView?.(completed)
    return completed
  }
  async retryPlayback() {
    const s = this.require()
    if (s.phase !== 'error') throw new ListeningError('session-transition-invalid', 'Listening playback is not in an error state.')
    const recovered = await this.save({ ...s, phase: 'answering', playback: playback(s.question), updatedAt: this.now() })
    this.attach(recovered)
    return recovered
  }
  dispose() { this.controller?.dispose(); this.controller = null }
}
