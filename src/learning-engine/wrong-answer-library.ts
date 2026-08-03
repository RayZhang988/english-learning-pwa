import type {
  WrongAnswerEvidence,
  WrongAnswerLibraryState,
  WrongAnswerRecord,
  WrongAnswerReviewRound,
} from './contracts.ts'
import { parseTimestamp, uniqueStrings } from './utils.ts'

const MAX_PROCESSED_EVIDENCE_IDS = 500

export type ApplyWrongAnswerEvidenceResult = {
  readonly state: WrongAnswerLibraryState
  readonly record: WrongAnswerRecord | null
  readonly reason: 'accepted' | 'duplicate' | 'ignored-unscorable' | 'ignored-correct'
}

export type StartWrongAnswerReviewRoundInput = {
  readonly roundId: string
  readonly seed: string
  readonly startedAt: string
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty opaque string`)
  }
}

export function wrongAnswerRecordId(identity: {
  readonly reviewContentId: string
  readonly originalQuestionType: string
}): string {
  assertNonEmpty(identity.reviewContentId, 'reviewContentId')
  assertNonEmpty(identity.originalQuestionType, 'originalQuestionType')
  return `${identity.reviewContentId}::${identity.originalQuestionType}`
}

export function createWrongAnswerLibraryState(): WrongAnswerLibraryState {
  return { schemaVersion: 1, records: {}, processedEvidenceIds: [], activeRound: null }
}

function assertEvidence(evidence: WrongAnswerEvidence): void {
  if (evidence.schemaVersion !== 1) throw new TypeError('Unsupported wrong-answer evidence schema')
  assertNonEmpty(evidence.eventId, 'eventId')
  wrongAnswerRecordId(evidence)
  parseTimestamp(evidence.occurredAt, 'occurredAt')
  if (evidence.outcome === 'incorrect' && !evidence.formallyScored) {
    throw new TypeError('Incorrect wrong-answer evidence must be formally scored')
  }
  if (evidence.source === 'wrong-answer-review' && evidence.outcome === 'unscorable') {
    return
  }
}

function withEvidenceId(state: WrongAnswerLibraryState, eventId: string): WrongAnswerLibraryState {
  return { ...state, processedEvidenceIds: [...state.processedEvidenceIds, eventId].slice(-MAX_PROCESSED_EVIDENCE_IDS) }
}

/**
 * Applies only formal wrong-answer facts. Ordinary correct attempts are
 * deliberately ignored; only a correct answer inside the dedicated review
 * session advances the two-in-a-row removal rule.
 */
export function applyWrongAnswerEvidence(
  state: WrongAnswerLibraryState,
  evidence: WrongAnswerEvidence,
): ApplyWrongAnswerEvidenceResult {
  assertEvidence(evidence)
  const recordId = wrongAnswerRecordId(evidence)
  const previous = state.records[recordId] ?? null
  if (state.processedEvidenceIds.includes(evidence.eventId)) {
    return { state, record: previous, reason: 'duplicate' }
  }
  if (evidence.outcome === 'unscorable') {
    return { state: withEvidenceId(state, evidence.eventId), record: previous, reason: 'ignored-unscorable' }
  }
  if (evidence.outcome === 'correct' && evidence.source !== 'wrong-answer-review') {
    return { state: withEvidenceId(state, evidence.eventId), record: previous, reason: 'ignored-correct' }
  }
  if (previous !== null && parseTimestamp(evidence.occurredAt, 'occurredAt') < parseTimestamp(previous.lastIncorrectAt, 'lastIncorrectAt')) {
    throw new RangeError('Wrong-answer evidence cannot predate the record')
  }

  const record: WrongAnswerRecord = evidence.outcome === 'incorrect'
    ? {
        schemaVersion: 1,
        recordId,
        reviewContentId: evidence.reviewContentId,
        originalQuestionType: evidence.originalQuestionType,
        domain: evidence.domain,
        status: 'active',
        incorrectCount: (previous?.incorrectCount ?? 0) + 1,
        consecutiveReviewCorrect: 0,
        lastIncorrectAt: evidence.occurredAt,
        lastSource: evidence.source,
        sources: uniqueStrings([...(previous?.sources ?? []), evidence.source]),
      }
    : (() => {
        if (previous === null || previous.status !== 'active') {
          throw new TypeError('Review correctness requires an active wrong-answer record')
        }
        const streak = previous.consecutiveReviewCorrect + 1
        return { ...previous, consecutiveReviewCorrect: streak as 1 | 2, status: streak >= 2 ? 'history' : 'active' }
      })()
  const next = withEvidenceId({ ...state, records: { ...state.records, [recordId]: record } }, evidence.eventId)
  return { state: next, record, reason: 'accepted' }
}

function hashSeed(seed: string): number {
  let value = 2166136261
  for (let index = 0; index < seed.length; index += 1) value = Math.imul(value ^ seed.charCodeAt(index), 16777619)
  return value >>> 0
}

function randomFromSeed(seed: string): () => number {
  let value = hashSeed(seed)
  return () => {
    value += 0x6d2b79f5
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable Fisher-Yates shuffle: same seed and active set always has same order. */
export function randomizeWrongAnswerRecordIds(ids: readonly string[], seed: string): readonly string[] {
  assertNonEmpty(seed, 'seed')
  const order = [...new Set(ids)].sort()
  const random = randomFromSeed(seed)
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[order[index], order[swapIndex]] = [order[swapIndex], order[index]]
  }
  return order
}

export function startWrongAnswerReviewRound(
  state: WrongAnswerLibraryState,
  input: StartWrongAnswerReviewRoundInput,
): WrongAnswerLibraryState {
  assertNonEmpty(input.roundId, 'roundId')
  assertNonEmpty(input.seed, 'seed')
  parseTimestamp(input.startedAt, 'startedAt')
  if (state.activeRound?.status === 'active') throw new TypeError('An active wrong-answer review round must be resumed or exited')
  const order = randomizeWrongAnswerRecordIds(Object.values(state.records).filter((record) => record.status === 'active').map((record) => record.recordId), input.seed)
  const round: WrongAnswerReviewRound = { schemaVersion: 1, roundId: input.roundId, seed: input.seed, order, index: 0, stage: 'answering', answerDraft: null, answeredCount: 0, correctCount: 0, startedAt: input.startedAt, updatedAt: input.startedAt, status: order.length === 0 ? 'completed' : 'active', failure: null }
  return { ...state, activeRound: round }
}

/** Rejects corrupted/drifted snapshots rather than silently reordering them. */
export function assertRecoverableWrongAnswerReviewRound(state: WrongAnswerLibraryState): WrongAnswerReviewRound | null {
  const round = state.activeRound
  if (round === null) return null
  const unique = new Set(round.order)
  const expectedAnsweredCount = round.stage === 'feedback' ? round.index + 1 : round.index
  if (unique.size !== round.order.length || round.index < 0 || round.index > round.order.length || round.answeredCount !== expectedAnsweredCount || round.correctCount > round.answeredCount) throw new TypeError('Wrong-answer review snapshot is corrupt')
  const firstUnansweredIndex = round.stage === 'feedback' ? round.index + 1 : round.index
  for (const recordId of round.order.slice(firstUnansweredIndex)) {
    const record = state.records[recordId]
    if (record === undefined || record.status !== 'active') throw new TypeError('Wrong-answer review snapshot has identity drift')
  }
  return round
}

export function updateWrongAnswerReviewRoundSnapshot(
  state: WrongAnswerLibraryState,
  input: Pick<WrongAnswerReviewRound, 'index' | 'stage' | 'answerDraft' | 'answeredCount' | 'correctCount' | 'updatedAt' | 'status'>,
): WrongAnswerLibraryState {
  const round = assertRecoverableWrongAnswerReviewRound(state)
  if (round === null) throw new TypeError('No wrong-answer review round to update')
  parseTimestamp(input.updatedAt, 'updatedAt')
  if (input.updatedAt < round.updatedAt) throw new RangeError('Review snapshot cannot move backwards in time')
  const next = { ...round, ...input }
  const expectedAnsweredCount = next.stage === 'feedback' ? next.index + 1 : next.index
  if (next.index < 0 || next.index > next.order.length || next.answeredCount !== expectedAnsweredCount || next.correctCount > next.answeredCount) throw new RangeError('Invalid wrong-answer review round progress')
  return { ...state, activeRound: next }
}

/**
 * Scores exactly the item currently shown by the dedicated review session.
 * It is the sole route by which correct answers advance removal progress.
 */
export function submitWrongAnswerReviewAnswer(
  state: WrongAnswerLibraryState,
  evidence: WrongAnswerEvidence,
): ApplyWrongAnswerEvidenceResult {
  if (evidence.source !== 'wrong-answer-review') throw new TypeError('Review answer must use wrong-answer-review source')
  const round = assertRecoverableWrongAnswerReviewRound(state)
  if (round === null || round.status !== 'active' || round.stage !== 'answering') throw new TypeError('No answering wrong-answer review item')
  const recordId = wrongAnswerRecordId(evidence)
  if (round.order[round.index] !== recordId) throw new TypeError('Review evidence does not match the current randomized item')
  const result = applyWrongAnswerEvidence(state, evidence)
  if (result.reason === 'duplicate') return result
  if (result.reason === 'ignored-unscorable') return result
  const answeredCount = round.answeredCount + 1
  const correctCount = round.correctCount + (evidence.outcome === 'correct' ? 1 : 0)
  return {
    ...result,
    state: {
      ...result.state,
      activeRound: {
        ...round,
        stage: 'feedback',
        answeredCount,
        correctCount,
        updatedAt: evidence.occurredAt,
      },
    },
  }
}

/** Leaves feedback only after it has been persisted; no reshuffle is possible. */
export function advanceWrongAnswerReviewRound(
  state: WrongAnswerLibraryState,
  updatedAt: string,
): WrongAnswerLibraryState {
  const round = assertRecoverableWrongAnswerReviewRound(state)
  if (round === null || round.status !== 'active' || round.stage !== 'feedback') throw new TypeError('No review feedback to advance')
  parseTimestamp(updatedAt, 'updatedAt')
  if (updatedAt < round.updatedAt) throw new RangeError('Review round cannot move backwards in time')
  const index = round.index + 1
  return {
    ...state,
    activeRound: {
      ...round,
      index,
      stage: 'answering',
      answerDraft: null,
      updatedAt,
      status: index === round.order.length ? 'completed' : 'active',
    },
  }
}
