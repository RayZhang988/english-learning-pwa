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
} from '../../learning-engine/index.ts'
import { matchSpeakingText } from './matching.ts'
import type { SpeakingPrompt, SpeakingSupplyItem } from './types.ts'

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

/** Durable, UI-free review runtime. The UI/01 supplies the randomized round
 * and persistence port; this module restores the original prompt and applies
 * only the existing finite text matcher. Recording/recognition remains the
 * normal speaking adapter's responsibility, so no pronunciation rubric is
 * introduced here. */
export class SpeakingWrongAnswerReviewRuntime {
  private state: WrongAnswerLibraryState | null = null
  private readonly store: SpeakingWrongAnswerReviewStore
  private readonly promptForRecord: (record: WrongAnswerRecord) => Promise<SpeakingPrompt>
  constructor(store: SpeakingWrongAnswerReviewStore, promptForRecord: (record: WrongAnswerRecord) => Promise<SpeakingPrompt>) {
    this.store = store
    this.promptForRecord = promptForRecord
  }
  async initialize() { this.state = await this.store.load(); return resumeSpeakingWrongAnswerReview(this.state) }
  private require() { if (!this.state) throw new TypeError('Speaking wrong-answer review is not initialized.'); return this.state }
  async submitTranscript(transcript: string, eventId: string, occurredAt: string) {
    const state = this.require()
    const round = resumeSpeakingWrongAnswerReview(state)
    if (!round || round.status !== 'active' || round.stage !== 'answering') throw new TypeError('No answering speaking wrong-answer review item.')
    const record = state.records[round.order[round.index]]
    if (!record) throw new TypeError('Speaking wrong-answer review record is missing.')
    const prompt = await this.promptForRecord(record)
    const result = submitSpeakingWrongAnswerReview({ library: state, eventId, occurredAt, transcript, prompt, record })
    await this.store.save(result.state)
    this.state = result.state
    return { ...result, prompt }
  }
  async advance(occurredAt: string) { const next = advanceSpeakingWrongAnswerReview(this.require(), occurredAt); await this.store.save(next); this.state = next; return next }
  snapshot() { return this.require() }
}
