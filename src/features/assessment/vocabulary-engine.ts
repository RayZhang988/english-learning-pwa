import {
  clampInternalLevel,
  INTERNAL_LEVEL_MAX,
  INTERNAL_LEVEL_MIN,
} from './levels.ts'
import {
  toPublicVocabularyAssessmentItemV2,
  validateVocabularyAssessmentBankV2,
} from './vocabulary-bank.ts'
import { VOCABULARY_ASSESSMENT_RULES_V2 } from './vocabulary-rules.ts'
import type {
  PublicVocabularyAssessmentItemV2,
  VocabularyAdaptiveEstimateV2,
  VocabularyAnswerV2,
  VocabularyAssessmentBankV2,
  VocabularyAssessmentItemV2,
  VocabularyAssessmentResponseV2,
  VocabularyAssessmentSessionV2,
  VocabularyAssessmentStopReasonV2,
} from './vocabulary-types.ts'

const INITIAL_LEVEL = 0.5
const STANDARD_ERROR_SCALE = 2.8

export interface NextVocabularyAssessmentStepV2 {
  readonly session: VocabularyAssessmentSessionV2
  readonly item: PublicVocabularyAssessmentItemV2 | null
}

export interface VocabularyAssessmentSubmissionV2 {
  readonly selectedOptionId: string | null
  readonly durationMs: number
}

export interface SubmittedVocabularyAssessmentStepV2 {
  readonly session: VocabularyAssessmentSessionV2
  readonly response: VocabularyAssessmentResponseV2
}

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${field} must be a valid ISO timestamp`)
  }
  return parsed
}

function assertDuration(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new TypeError('durationMs must be a non-negative finite number')
  }
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function standardError(information: number): number {
  return round(
    STANDARD_ERROR_SCALE /
      Math.sqrt(1 + Math.max(0, information)),
  )
}

function predictedScore(level: number, difficulty: number): number {
  return 1 / (1 + Math.exp((difficulty - level) / 1.6))
}

function initialEstimate(): VocabularyAdaptiveEstimateV2 {
  return {
    level: INITIAL_LEVEL,
    information: 0,
    standardError: standardError(0),
    lowerBound: INTERNAL_LEVEL_MIN,
    upperBound: INTERNAL_LEVEL_MAX,
    hasLowerEvidence: false,
    hasUpperEvidence: false,
    nextDifficulty: INTERNAL_LEVEL_MIN,
    attemptedCount: 0,
    reliableEvidenceCount: 0,
    correctCount: 0,
    incorrectCount: 0,
    uncertainCount: 0,
    rapidGuessCount: 0,
    guessingStreak: 0,
    consecutiveCorrect: 0,
    consecutiveIncorrect: 0,
    consecutiveUncertain: 0,
    reversalCount: 0,
    nearThresholdCount: 0,
    reliabilityTotal: 0,
    wordMeaningCount: 0,
    sentenceUnderstandingCount: 0,
    lastAnswer: null,
    confidence: 0,
    status: 'collecting',
    stopReason: null,
  }
}

export function createVocabularyAssessmentSessionV2(input: {
  readonly id: string
  readonly startedAt: string
  readonly bank: VocabularyAssessmentBankV2
}): VocabularyAssessmentSessionV2 {
  if (input.id.trim().length === 0) {
    throw new TypeError('Vocabulary assessment session id cannot be empty')
  }
  parseTimestamp(input.startedAt, 'startedAt')
  validateVocabularyAssessmentBankV2(input.bank)

  return {
    schemaVersion: 2,
    assessmentKind: 'adaptive-vocabulary',
    id: input.id,
    bankId: input.bank.id,
    startedAt: input.startedAt,
    phase: 'vocabulary',
    status: 'in-progress',
    currentItemId: null,
    responses: [],
    estimate: initialEstimate(),
    completionReason: null,
  }
}

function assertMatchingBank(
  session: VocabularyAssessmentSessionV2,
  bank: VocabularyAssessmentBankV2,
): void {
  if (session.bankId !== bank.id) {
    throw new TypeError(
      `Session bank ${session.bankId} does not match ${bank.id}`,
    )
  }
}

function findItem(
  bank: VocabularyAssessmentBankV2,
  itemId: string,
): VocabularyAssessmentItemV2 {
  const item = bank.items.find((candidate) => candidate.id === itemId)
  if (!item) {
    throw new RangeError(`Vocabulary assessment item not found: ${itemId}`)
  }
  return item
}

function desiredFormat(
  estimate: VocabularyAdaptiveEstimateV2,
): VocabularyAssessmentItemV2['format'] | null {
  if (
    estimate.wordMeaningCount + 1 <
    estimate.sentenceUnderstandingCount
  ) {
    return 'word-meaning'
  }
  if (
    estimate.sentenceUnderstandingCount + 1 <
    estimate.wordMeaningCount
  ) {
    return 'sentence-understanding'
  }
  return null
}

function selectCandidate(
  session: VocabularyAssessmentSessionV2,
  bank: VocabularyAssessmentBankV2,
): VocabularyAssessmentItemV2 | undefined {
  const used = new Set(
    session.responses.map((response) => response.itemId),
  )
  if (session.currentItemId) {
    used.add(session.currentItemId)
  }
  const available = bank.items.filter((item) => !used.has(item.id))
  const preferredFormat = desiredFormat(session.estimate)
  const preferred = preferredFormat
    ? available.filter((item) => item.format === preferredFormat)
    : available
  const pool = preferred.length > 0 ? preferred : available
  const target = session.estimate.nextDifficulty

  return [...pool].sort((left, right) => {
    const distance =
      Math.abs(left.difficulty - target) -
      Math.abs(right.difficulty - target)
    if (distance !== 0) {
      return distance
    }
    const calibration =
      left.calibration.difficultyStandardError -
      right.calibration.difficultyStandardError
    if (calibration !== 0) {
      return calibration
    }
    if (left.discrimination !== right.discrimination) {
      return right.discrimination - left.discrimination
    }
    return left.id.localeCompare(right.id)
  })[0]
}

function isOppositeAnswer(
  previous: VocabularyAnswerV2 | null,
  current: VocabularyAnswerV2,
): boolean {
  return (
    (previous === 'correct' && current === 'incorrect') ||
    (previous === 'incorrect' && current === 'correct')
  )
}

function nextTarget(input: {
  readonly estimate: VocabularyAdaptiveEstimateV2
  readonly itemDifficulty: number
  readonly answer: VocabularyAnswerV2
  readonly rapidGuess: boolean
  readonly lowerBound: number
  readonly upperBound: number
  readonly hasLowerEvidence: boolean
  readonly hasUpperEvidence: boolean
}): number {
  if (input.rapidGuess) {
    return input.estimate.nextDifficulty
  }
  if (input.answer === 'correct' && !input.hasUpperEvidence) {
    return clampInternalLevel(input.itemDifficulty + 2)
  }
  if (input.answer !== 'correct' && !input.hasLowerEvidence) {
    return clampInternalLevel(input.itemDifficulty - 1)
  }

  const midpoint = (input.lowerBound + input.upperBound) / 2
  const bias =
    input.answer === 'correct'
      ? 0.5
      : input.answer === 'incorrect'
        ? -0.5
        : -0.75
  return Math.round(clampInternalLevel(midpoint + bias) * 2) / 2
}

function calculateConfidence(input: {
  readonly estimate: VocabularyAdaptiveEstimateV2
  readonly responses: readonly VocabularyAssessmentResponseV2[]
  readonly lowerBound: number
  readonly upperBound: number
  readonly standardError: number
  readonly nearThresholdCount: number
  readonly reliableEvidenceCount: number
  readonly reliabilityTotal: number
  readonly rapidGuessCount: number
}): number {
  const rules = VOCABULARY_ASSESSMENT_RULES_V2
  const precision = clampUnit(1 - input.standardError / 3.5)
  const evidence = clampUnit(
    input.reliableEvidenceCount / rules.minimumReliableEvidence,
  )
  const rangeWidth = input.upperBound - input.lowerBound
  const convergence = Math.max(
    clampUnit(1 - rangeWidth / 12),
    clampUnit(
      input.nearThresholdCount / rules.minimumNearThreshold,
    ) * 0.8,
  )
  const coverage = Math.min(
    1,
    Math.min(
      input.estimate.wordMeaningCount +
        (input.responses.at(-1)?.format === 'word-meaning' ? 1 : 0),
      input.estimate.sentenceUnderstandingCount +
        (input.responses.at(-1)?.format ===
        'sentence-understanding'
          ? 1
          : 0),
    ) / rules.minimumPerFormat,
  )
  const reliability =
    input.reliableEvidenceCount === 0
      ? 0
      : clampUnit(
          input.reliabilityTotal / input.reliableEvidenceCount,
        )
  const guessingPenalty =
    1 -
    0.5 *
      clampUnit(
        input.rapidGuessCount /
          Math.max(1, input.responses.length),
      )

  return round(
    clampUnit(
      (precision * 0.25 +
        evidence * 0.25 +
        convergence * 0.25 +
        coverage * 0.15 +
        reliability * 0.1) *
        guessingPenalty,
    ),
    2,
  )
}

function updateEstimate(
  estimate: VocabularyAdaptiveEstimateV2,
  item: VocabularyAssessmentItemV2,
  response: VocabularyAssessmentResponseV2,
  responses: readonly VocabularyAssessmentResponseV2[],
): VocabularyAdaptiveEstimateV2 {
  const reliable = response.reliability >= 0.5
  let lowerBound = estimate.lowerBound
  let upperBound = estimate.upperBound
  let hasLowerEvidence = estimate.hasLowerEvidence
  let hasUpperEvidence = estimate.hasUpperEvidence

  if (reliable && response.answer === 'correct') {
    lowerBound = Math.max(lowerBound, item.difficulty)
    hasLowerEvidence = true
  } else if (reliable && response.answer === 'incorrect') {
    upperBound = Math.min(upperBound, item.difficulty)
    hasUpperEvidence = true
  } else if (response.answer === 'uncertain') {
    upperBound = Math.min(
      upperBound,
      clampInternalLevel(item.difficulty + 1),
    )
    hasUpperEvidence = true
  }

  let contradiction = false
  if (lowerBound > upperBound) {
    contradiction = true
    const center = (lowerBound + upperBound) / 2
    lowerBound = clampInternalLevel(center - 0.75)
    upperBound = clampInternalLevel(center + 0.75)
  }

  const probability = predictedScore(estimate.level, item.difficulty)
  const gain =
    2.2 / Math.sqrt(1 + estimate.reliableEvidenceCount * 0.18)
  const delta =
    gain *
    item.discrimination *
    response.reliability *
    (response.score - probability)
  const level = clampInternalLevel(
    estimate.level + Math.min(2, Math.max(-2, delta)),
  )
  const itemInformation =
    probability *
    (1 - probability) *
    item.discrimination *
    item.discrimination *
    response.reliability
  const information = estimate.information + itemInformation
  const nextResponses = [...responses, response]
  const nearThresholdCount = nextResponses.filter(
    (candidate) =>
      candidate.reliability >= 0.45 &&
      Math.abs(candidate.difficulty - level) <= 1.5,
  ).length
  const reliableEvidenceCount =
    estimate.reliableEvidenceCount + (reliable ? 1 : 0)
  const reliabilityTotal =
    estimate.reliabilityTotal + (reliable ? response.reliability : 0)
  const rapidGuessCount =
    estimate.rapidGuessCount + (response.rapidGuess ? 1 : 0)
  const standardErrorValue = standardError(information)
  const updated: VocabularyAdaptiveEstimateV2 = {
    ...estimate,
    level,
    information,
    standardError: standardErrorValue,
    lowerBound,
    upperBound,
    hasLowerEvidence,
    hasUpperEvidence,
    nextDifficulty: nextTarget({
      estimate,
      itemDifficulty: item.difficulty,
      answer: response.answer,
      rapidGuess: response.rapidGuess,
      lowerBound,
      upperBound,
      hasLowerEvidence,
      hasUpperEvidence,
    }),
    attemptedCount: estimate.attemptedCount + 1,
    reliableEvidenceCount,
    correctCount:
      estimate.correctCount + (response.answer === 'correct' ? 1 : 0),
    incorrectCount:
      estimate.incorrectCount +
      (response.answer === 'incorrect' ? 1 : 0),
    uncertainCount:
      estimate.uncertainCount +
      (response.answer === 'uncertain' ? 1 : 0),
    rapidGuessCount,
    guessingStreak:
      response.rapidGuess || response.answer === 'uncertain'
        ? estimate.guessingStreak + 1
        : 0,
    consecutiveCorrect:
      response.answer === 'correct' ? estimate.consecutiveCorrect + 1 : 0,
    consecutiveIncorrect:
      response.answer === 'incorrect'
        ? estimate.consecutiveIncorrect + 1
        : 0,
    consecutiveUncertain:
      response.answer === 'uncertain'
        ? estimate.consecutiveUncertain + 1
        : 0,
    reversalCount:
      estimate.reversalCount +
      (contradiction ||
      isOppositeAnswer(estimate.lastAnswer, response.answer)
        ? 1
        : 0),
    nearThresholdCount,
    reliabilityTotal,
    wordMeaningCount:
      estimate.wordMeaningCount +
      (item.format === 'word-meaning' ? 1 : 0),
    sentenceUnderstandingCount:
      estimate.sentenceUnderstandingCount +
      (item.format === 'sentence-understanding' ? 1 : 0),
    lastAnswer: response.answer,
    confidence: 0,
  }

  return {
    ...updated,
    confidence: calculateConfidence({
      estimate,
      responses: nextResponses,
      lowerBound,
      upperBound,
      standardError: standardErrorValue,
      nearThresholdCount,
      reliableEvidenceCount,
      reliabilityTotal,
      rapidGuessCount,
    }),
  }
}

function boundaryEvidence(
  responses: readonly VocabularyAssessmentResponseV2[],
  boundary: 'lower' | 'upper',
): number {
  return responses.filter((response) => {
    if (response.reliability < 0.5) {
      return false
    }
    return boundary === 'lower'
      ? response.difficulty <= 1 && response.answer === 'incorrect'
      : response.difficulty >= 11 && response.answer === 'correct'
  }).length
}

function stopReason(
  session: VocabularyAssessmentSessionV2,
  elapsedMs: number,
): VocabularyAssessmentStopReasonV2 | null {
  const rules = VOCABULARY_ASSESSMENT_RULES_V2
  const estimate = session.estimate
  if (estimate.guessingStreak >= rules.responseQualityStreakLimit) {
    return 'response-quality-limit'
  }
  if (
    elapsedMs >= rules.targetMinimumMs &&
    estimate.reliableEvidenceCount >= rules.minimumReliableEvidence
  ) {
    const lowerBoundaryEvidence = boundaryEvidence(
      session.responses,
      'lower',
    )
    const upperBoundaryEvidence = boundaryEvidence(
      session.responses,
      'upper',
    )
    if (
      lowerBoundaryEvidence >= 3 &&
      !estimate.hasLowerEvidence
    ) {
      return 'lower-boundary'
    }
    if (
      upperBoundaryEvidence >= 3 &&
      !estimate.hasUpperEvidence
    ) {
      return 'upper-boundary'
    }
    const boundaryStillUnconfirmed =
      (estimate.upperBound <= 1 &&
        !estimate.hasLowerEvidence &&
        lowerBoundaryEvidence < 3) ||
      (estimate.lowerBound >= 11 &&
        !estimate.hasUpperEvidence &&
        upperBoundaryEvidence < 3)
    if (
      !boundaryStillUnconfirmed &&
      estimate.wordMeaningCount >= rules.minimumPerFormat &&
      estimate.sentenceUnderstandingCount >= rules.minimumPerFormat &&
      estimate.nearThresholdCount >= rules.minimumNearThreshold &&
      estimate.upperBound - estimate.lowerBound <=
        rules.maximumConvergedRange &&
      estimate.confidence >= rules.minimumConvergedConfidence
    ) {
      return 'threshold-converged'
    }
  }
  if (
    elapsedMs >= rules.targetMaximumMs &&
    estimate.reliableEvidenceCount >= 6
  ) {
    return 'time-limit'
  }
  if (estimate.attemptedCount >= rules.maximumAttempts) {
    return 'item-limit'
  }
  return null
}

function complete(
  session: VocabularyAssessmentSessionV2,
  reason: VocabularyAssessmentStopReasonV2,
  status: VocabularyAssessmentSessionV2['status'] = 'completed',
): VocabularyAssessmentSessionV2 {
  return {
    ...session,
    phase: 'complete',
    status,
    currentItemId: null,
    estimate: {
      ...session.estimate,
      status: 'stopped',
      stopReason: reason,
    },
    completionReason: reason,
  }
}

export function getNextVocabularyAssessmentItemV2(
  session: VocabularyAssessmentSessionV2,
  bank: VocabularyAssessmentBankV2,
  now: string,
): NextVocabularyAssessmentStepV2 {
  assertMatchingBank(session, bank)
  validateVocabularyAssessmentBankV2(bank)
  if (session.currentItemId) {
    return {
      session,
      item: toPublicVocabularyAssessmentItemV2(
        findItem(bank, session.currentItemId),
      ),
    }
  }
  if (session.status !== 'in-progress' || session.phase === 'complete') {
    return { session, item: null }
  }

  const elapsedMs =
    parseTimestamp(now, 'now') -
    parseTimestamp(session.startedAt, 'startedAt')
  if (elapsedMs < 0) {
    throw new RangeError('now cannot be earlier than startedAt')
  }
  if (elapsedMs >= VOCABULARY_ASSESSMENT_RULES_V2.hardLimitMs) {
    return {
      session: complete(session, 'time-limit', 'partial'),
      item: null,
    }
  }
  const reason = stopReason(session, elapsedMs)
  if (reason) {
    const partial =
      reason === 'response-quality-limit' ||
      (reason === 'time-limit' &&
        session.estimate.reliableEvidenceCount <
          VOCABULARY_ASSESSMENT_RULES_V2.minimumReliableEvidence)
    return {
      session: complete(
        session,
        reason,
        partial ? 'partial' : 'completed',
      ),
      item: null,
    }
  }

  const candidate = selectCandidate(session, bank)
  if (!candidate) {
    return {
      session: complete(session, 'bank-exhausted', 'partial'),
      item: null,
    }
  }
  const nextSession = {
    ...session,
    currentItemId: candidate.id,
  }
  return {
    session: nextSession,
    item: toPublicVocabularyAssessmentItemV2(candidate),
  }
}

export function submitVocabularyAssessmentResponseV2(input: {
  readonly session: VocabularyAssessmentSessionV2
  readonly bank: VocabularyAssessmentBankV2
  readonly submission: VocabularyAssessmentSubmissionV2
  readonly submittedAt: string
}): SubmittedVocabularyAssessmentStepV2 {
  const { session, bank, submission, submittedAt } = input
  assertMatchingBank(session, bank)
  if (session.status !== 'in-progress' || !session.currentItemId) {
    throw new TypeError('There is no current vocabulary item to submit')
  }
  parseTimestamp(submittedAt, 'submittedAt')
  assertDuration(submission.durationMs)
  const item = findItem(bank, session.currentItemId)
  if (
    submission.selectedOptionId !== null &&
    !item.options.some(
      (option) => option.id === submission.selectedOptionId,
    )
  ) {
    throw new TypeError(
      `Option ${submission.selectedOptionId} does not belong to ${item.id}`,
    )
  }

  const rapidGuess =
    submission.durationMs <
    VOCABULARY_ASSESSMENT_RULES_V2.rapidGuessThresholdMs
  const answer: VocabularyAnswerV2 =
    submission.selectedOptionId === null
      ? 'uncertain'
      : submission.selectedOptionId === item.scoring.correctOptionId
        ? 'correct'
        : 'incorrect'
  const response: VocabularyAssessmentResponseV2 = {
    itemId: item.id,
    format: item.format,
    difficulty: item.difficulty,
    submittedAt,
    durationMs: submission.durationMs,
    answer,
    score: answer === 'correct' ? 1 : answer === 'incorrect' ? 0 : 0.25,
    reliability: rapidGuess ? 0.3 : answer === 'uncertain' ? 0.45 : 1,
    rapidGuess,
  }
  const nextSession = replayVocabularyAssessmentResponseV2({
    session,
    bank,
    response,
  })

  return {
    session: nextSession,
    response,
  }
}

/**
 * Rebuilds deterministic v2 estimate state from already validated evidence.
 * Used by snapshot validation and the explicit v1 migration path.
 */
export function replayVocabularyAssessmentResponseV2(input: {
  readonly session: VocabularyAssessmentSessionV2
  readonly bank: VocabularyAssessmentBankV2
  readonly response: VocabularyAssessmentResponseV2
}): VocabularyAssessmentSessionV2 {
  const { session, bank, response } = input
  assertMatchingBank(session, bank)
  if (
    session.responses.some(
      (candidate) => candidate.itemId === response.itemId,
    )
  ) {
    throw new TypeError(`Duplicate vocabulary response ${response.itemId}`)
  }
  const item = findItem(bank, response.itemId)
  if (
    response.format !== item.format ||
    response.difficulty !== item.difficulty
  ) {
    throw new TypeError(
      `Vocabulary response ${response.itemId} does not match its item`,
    )
  }
  const estimate = updateEstimate(
    session.estimate,
    item,
    response,
    session.responses,
  )

  return {
    ...session,
    currentItemId: null,
    responses: [...session.responses, response],
    estimate,
  }
}

export function stopVocabularyAssessmentV2(
  session: VocabularyAssessmentSessionV2,
): VocabularyAssessmentSessionV2 {
  if (session.status !== 'in-progress') {
    return session
  }
  return complete(session, 'user-stopped', 'partial')
}

export function expireVocabularyAssessmentV2(
  session: VocabularyAssessmentSessionV2,
): VocabularyAssessmentSessionV2 {
  if (session.status !== 'in-progress') {
    return session
  }
  return complete(session, 'time-limit', 'partial')
}

export function completeMigratedVocabularyAssessmentV2(
  session: VocabularyAssessmentSessionV2,
): VocabularyAssessmentSessionV2 {
  return complete(
    session,
    'legacy-migrated',
    session.estimate.reliableEvidenceCount >= 4
      ? 'completed'
      : 'partial',
  )
}
