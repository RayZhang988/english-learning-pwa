import type {
  WrongAnswerEvidence,
  WrongAnswerLibraryState,
  WrongAnswerRecord,
} from '../../learning-engine/index.ts'
import {
  advanceWrongAnswerReviewRound,
  applyWrongAnswerEvidence,
  assertRecoverableWrongAnswerReviewRound,
  submitWrongAnswerReviewAnswer,
  updateWrongAnswerReviewRoundSnapshot,
} from '../../learning-engine/index.ts'
import { matchSpeakingText } from './matching.ts'
import { browserSpeakingRecognition } from './recognition.ts'
import { browserSpeakingRecorder } from './recording.ts'
import type { SpeakingPrompt, SpeakingRecognitionPort, SpeakingRecording, SpeakingRecordingPort, SpeakingSupplyItem, SpeakingTextMatch } from './types.ts'

type Alias = {
  readonly reviewContentId: string
  readonly originalQuestionType: string
  readonly domain: 'speaking'
  readonly source: { readonly kind: 'daily-supply'; readonly itemId: string; readonly sourceId: string; readonly contentRef: string }
}

/** 05's opaque identity index is deliberately parsed here, never reconstructed
 * from display text, prompt ids, or a variant family. */
export class SpeakingWrongAnswerContentResolver {
  private readonly byItemId = new Map<string, Alias>()
  constructor(index: unknown) {
    if (typeof index !== 'object' || index === null || (index as { schemaVersion?: unknown }).schemaVersion !== 1) throw new TypeError('Unsupported review-content index.')
    const aliases = (index as { aliases?: unknown }).aliases
    if (typeof aliases !== 'object' || aliases === null) throw new TypeError('Review-content index has no aliases.')
    for (const value of Object.values(aliases as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const alias = value as Alias
      if (alias.domain !== 'speaking' || !alias.source || alias.source.kind !== 'daily-supply' || !alias.reviewContentId || !alias.originalQuestionType || !alias.source.itemId || !alias.source.sourceId || !alias.source.contentRef) continue
      if (this.byItemId.has(alias.source.itemId)) throw new TypeError('Duplicate speaking review alias.')
      this.byItemId.set(alias.source.itemId, alias)
    }
    if (this.byItemId.size !== 122) throw new TypeError(`Speaking review index must contain exactly 122 aliases; got ${this.byItemId.size}.`)
  }
  resolveItem(item: SpeakingSupplyItem): Alias {
    const alias = this.byItemId.get(item.itemId)
    if (!alias || alias.source.sourceId !== item.source.sourceId || alias.source.contentRef !== item.contentRef) throw new TypeError('Speaking supply item has no matching review identity.')
    return alias
  }
  resolvePrompt(contentRef: string, prompt: SpeakingPrompt): Alias {
    const aliases = [...this.byItemId.values()].filter((alias) => alias.source.contentRef === contentRef && alias.source.sourceId === prompt.id)
    if (aliases.length !== 1) throw new TypeError('Speaking prompt has no unique review identity.')
    return aliases[0]
  }
}

export interface SpeakingWrongAnswerEvidenceSink { publishWrongAnswerEvidence(evidence: WrongAnswerEvidence): Promise<void> }
export interface SpeakingWrongAnswerIdentityResolver {
  resolveItem(item: SpeakingSupplyItem): Alias
  resolvePrompt(contentRef: string, prompt: SpeakingPrompt): Alias
}

export function speakingWrongAnswerOutcome(match: ReturnType<typeof matchSpeakingText> | null): 'correct' | 'incorrect' | 'unscorable' {
  if (match === null) return 'unscorable'
  return match.level === 'partial' || match.level === 'different' ? 'incorrect' : 'correct'
}

export function createSpeakingWrongAnswerEvidence(input: {
  readonly eventId: string; readonly occurredAt: string; readonly source: WrongAnswerEvidence['source']; readonly identity: Alias; readonly match: ReturnType<typeof matchSpeakingText> | null
}): WrongAnswerEvidence {
  return { schemaVersion: 1, eventId: input.eventId, occurredAt: input.occurredAt, domain: 'speaking', source: input.source, reviewContentId: input.identity.reviewContentId, originalQuestionType: input.identity.originalQuestionType, outcome: speakingWrongAnswerOutcome(input.match), formallyScored: input.match !== null }
}

/** Stateless adapter for 01's durable unified library. It records only the
 * current dedicated-review item; normal training correctness never reaches 04. */
export function submitSpeakingWrongAnswerReview(input: {
  readonly library: WrongAnswerLibraryState; readonly eventId: string; readonly occurredAt: string; readonly transcript: string; readonly prompt: SpeakingPrompt; readonly record: WrongAnswerRecord
}) {
  const match = matchSpeakingText(input.transcript, input.prompt.acceptedAnswers)
  const evidence: WrongAnswerEvidence = { schemaVersion: 1, eventId: input.eventId, occurredAt: input.occurredAt, domain: 'speaking', source: 'wrong-answer-review', reviewContentId: input.record.reviewContentId, originalQuestionType: input.record.originalQuestionType, outcome: speakingWrongAnswerOutcome(match), formallyScored: true }
  return { match, ...submitWrongAnswerReviewAnswer(input.library, evidence) }
}

export function resumeSpeakingWrongAnswerReview(library: WrongAnswerLibraryState) { return assertRecoverableWrongAnswerReviewRound(library) }
export function advanceSpeakingWrongAnswerReview(library: WrongAnswerLibraryState, occurredAt: string) { return advanceWrongAnswerReviewRound(library, occurredAt) }
export function applySpeakingWrongAnswerEvidence(library: WrongAnswerLibraryState, evidence: WrongAnswerEvidence) { return applyWrongAnswerEvidence(library, evidence) }

export interface SpeakingWrongAnswerReviewStore {
  load(): Promise<WrongAnswerLibraryState>
  save(state: WrongAnswerLibraryState): Promise<void>
}

export interface SpeakingWrongAnswerReviewView {
  readonly library: WrongAnswerLibraryState
  readonly round: ReturnType<typeof resumeSpeakingWrongAnswerReview>
  readonly record: WrongAnswerRecord | null
  readonly prompt: SpeakingPrompt | null
  readonly stage: 'answering' | 'feedback'
  readonly feedback: { readonly transcript: string; readonly match: SpeakingTextMatch } | null
  readonly recordingAvailable: boolean
  readonly unscorable: boolean
}

/** Durable, UI-free review runtime. The UI/01 supplies the randomized round
 * and persistence port; this module restores the original prompt and applies
 * only the existing finite text matcher. Recording/recognition remains the
 * normal speaking adapter's responsibility, so no pronunciation rubric is
 * introduced here. */
export class SpeakingWrongAnswerReviewRuntime {
  private state: WrongAnswerLibraryState | null = null
  private readonly store: SpeakingWrongAnswerReviewStore
  private readonly promptForRecord: (record: WrongAnswerRecord) => Promise<SpeakingPrompt>
  private readonly recorder: SpeakingRecordingPort
  private readonly recognition: SpeakingRecognitionPort
  private recording: SpeakingRecording | null = null
  private handle: ReturnType<SpeakingRecognitionPort['start']> | null = null
  private generation = 0
  private active: { record: WrongAnswerRecord; prompt: SpeakingPrompt } | null = null
  private feedback: { transcript: string; match: SpeakingTextMatch } | null = null
  private unscorable = false
  private pendingStart: Promise<SpeakingWrongAnswerReviewView> | null = null
  private pendingStop: Promise<unknown> | null = null
  constructor(store: SpeakingWrongAnswerReviewStore, promptForRecord: (record: WrongAnswerRecord) => Promise<SpeakingPrompt>, options: { recorder?: SpeakingRecordingPort; recognition?: SpeakingRecognitionPort; requestMicrophone?: () => Promise<MediaStream> } = {}) {
    this.store = store
    this.promptForRecord = promptForRecord
    this.recorder = options.recorder ?? browserSpeakingRecorder
    this.recognition = options.recognition ?? browserSpeakingRecognition
    this.requestMicrophone = options.requestMicrophone
  }
  private readonly requestMicrophone: (() => Promise<MediaStream>) | undefined
  async initialize() { this.state = await this.store.load(); const round = resumeSpeakingWrongAnswerReview(this.state); await this.loadActive(); return this.view(round) }
  private require() { if (!this.state) throw new TypeError('Speaking wrong-answer review is not initialized.'); return this.state }
  private async loadActive() { const state = this.require(); const round = resumeSpeakingWrongAnswerReview(state); if (!round || round.status !== 'active') { this.active = null; return }; const record = state.records[round.order[round.index]]; if (!record) throw new TypeError('Speaking wrong-answer review record is missing.'); this.active = { record, prompt: await this.promptForRecord(record) }; this.feedback = round.stage === 'feedback' && typeof round.answerDraft === 'string' ? { transcript: round.answerDraft, match: matchSpeakingText(round.answerDraft, this.active.prompt.acceptedAnswers) } : null }
  private view(round = resumeSpeakingWrongAnswerReview(this.require())): SpeakingWrongAnswerReviewView { return { library: this.require(), round, record: this.active?.record ?? null, prompt: this.active?.prompt ?? null, stage: round?.stage ?? 'answering', feedback: this.feedback, recordingAvailable: this.recording !== null, unscorable: this.unscorable } }
  current() { return this.view() }
  startRecording() { if (this.pendingStart) return this.pendingStart; const run = (async () => { if (!this.active || !this.requestMicrophone) { this.unscorable = true; return this.view() }; const generation = ++this.generation; try { const stream = await this.requestMicrophone(); if (generation !== this.generation) return this.view(); this.recorder.start(stream); this.handle = this.recognition.capabilities().supported ? this.recognition.start('en-US') : null; this.unscorable = false } catch { this.unscorable = true }; return this.view() })(); this.pendingStart = run; void run.finally(() => { if (this.pendingStart === run) this.pendingStart = null }); return run }
  stopRecording(eventId: string, occurredAt: string) { if (this.pendingStop) return this.pendingStop; const run = (async () => { const generation = this.generation; try { this.handle?.stop(); const recording = await this.recorder.stop(); const outcome = this.handle ? await this.handle.result : { status: 'failed' as const, code: 'unavailable' as const, message: 'Recognition unavailable' }; if (generation !== this.generation || outcome.status !== 'recognized') { this.unscorable = true; return this.view() }; this.recording = recording; return this.submitTranscript(outcome.transcript, eventId, occurredAt) } catch { this.unscorable = true; return this.view() } })(); this.pendingStop = run; void run.finally(() => { if (this.pendingStop === run) this.pendingStop = null }); return run }
  async playRecording() { if (!this.recording) throw new TypeError('No review recording is available.'); await this.recorder.play(this.recording); return this.view() }
  cancelRecording() { this.generation += 1; this.handle?.abort(); this.recorder.cancel(); this.recording = null; this.unscorable = false; return this.view() }
  async submitTranscript(transcript: string, eventId: string, occurredAt: string) {
    const state = this.require()
    const round = resumeSpeakingWrongAnswerReview(state)
    if (!round || round.status !== 'active' || round.stage !== 'answering') throw new TypeError('No answering speaking wrong-answer review item.')
    const record = state.records[round.order[round.index]]
    if (!record) throw new TypeError('Speaking wrong-answer review record is missing.')
    const prompt = this.active?.prompt ?? await this.promptForRecord(record)
    const result = submitSpeakingWrongAnswerReview({ library: state, eventId, occurredAt, transcript, prompt, record })
    const persisted = updateWrongAnswerReviewRoundSnapshot(result.state, { ...result.state.activeRound!, answerDraft: transcript, updatedAt: occurredAt })
    await this.store.save(persisted)
    this.state = persisted
    this.feedback = { transcript, match: result.match }
    return { ...result, prompt, view: this.view() }
  }
  async advance(occurredAt: string) { this.generation += 1; const next = advanceSpeakingWrongAnswerReview(this.require(), occurredAt); await this.store.save(next); this.state = next; this.recording = null; this.feedback = null; this.unscorable = false; await this.loadActive(); return this.view() }
  snapshot() { return this.require() }
}
