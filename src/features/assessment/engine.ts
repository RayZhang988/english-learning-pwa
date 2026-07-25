import {
  clampInternalLevel,
  INTERNAL_LEVEL_MAX,
  INTERNAL_LEVEL_MIN,
} from './levels.ts'
import { toPublicAssessmentItem, validateAssessmentBank } from './bank.ts'
import {
  ASSESSMENT_TIMING,
  DOMAIN_ORDER,
  DOMAIN_RULES,
} from './rules.ts'
import {
  scoreAssessmentSubmission,
  type SubmissionScore,
} from './scoring.ts'
import type {
  AbilityDomain,
  AssessmentBank,
  AssessmentItem,
  AssessmentItemFormat,
  AssessmentPhase,
  AssessmentResponseRecord,
  AssessmentSession,
  AssessmentSubmission,
  DomainEstimateState,
  PublicAssessmentItem,
} from './types.ts'

const INITIAL_LEVEL = 5.5
const STANDARD_ERROR_SCALE = 2.4

export interface NextAssessmentStep {
  readonly session: AssessmentSession
  readonly item: PublicAssessmentItem | null
}

export interface SubmittedAssessmentStep {
  readonly session: AssessmentSession
  readonly scoring: SubmissionScore
}

function parseTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${field} must be a valid ISO timestamp`)
  }
  return timestamp
}

function standardError(information: number): number {
  return (
    Math.round(
      (STANDARD_ERROR_SCALE / Math.sqrt(1 + Math.max(0, information))) *
        1000,
    ) / 1000
  )
}

function initialEstimate(domain: AbilityDomain): DomainEstimateState {
  return {
    domain,
    level: INITIAL_LEVEL,
    information: 0,
    standardError: standardError(0),
    scoredCount: 0,
    attemptedCount: 0,
    consecutiveFailures: 0,
    reliabilityTotal: 0,
    coveredFormats: [],
    lastScore: null,
    status: 'collecting',
    stopReason: null,
  }
}

export function createAssessmentSession(input: {
  readonly id: string
  readonly startedAt: string
  readonly bank: AssessmentBank
}): AssessmentSession {
  if (input.id.trim().length === 0) {
    throw new TypeError('Assessment session id cannot be empty')
  }
  parseTimestamp(input.startedAt, 'startedAt')
  validateAssessmentBank(input.bank)

  return {
    schemaVersion: 1,
    id: input.id,
    bankId: input.bank.id,
    startedAt: input.startedAt,
    phase: 'vocabulary',
    status: 'in-progress',
    currentItemId: null,
    responses: [],
    estimates: {
      vocabulary: initialEstimate('vocabulary'),
      listening: initialEstimate('listening'),
      speaking: initialEstimate('speaking'),
    },
    completionReason: null,
  }
}

function findItem(bank: AssessmentBank, itemId: string): AssessmentItem {
  const item = bank.items.find((candidate) => candidate.id === itemId)
  if (!item) {
    throw new RangeError(`Assessment item not found: ${itemId}`)
  }
  return item
}

function assertMatchingBank(
  session: AssessmentSession,
  bank: AssessmentBank,
): void {
  if (session.bankId !== bank.id) {
    throw new TypeError(
      `Session bank ${session.bankId} does not match ${bank.id}`,
    )
  }
}

function scoredFormatCount(
  session: AssessmentSession,
  domain: AbilityDomain,
  format: AssessmentItemFormat,
): number {
  return session.responses.filter(
    (response) =>
      response.domain === domain &&
      response.format === format &&
      response.score !== null,
  ).length
}

function coverageSatisfied(
  session: AssessmentSession,
  domain: AbilityDomain,
): boolean {
  return DOMAIN_RULES[domain].requiredFormats.every(
    (requirement) =>
      scoredFormatCount(session, domain, requirement.format) >=
      requirement.count,
  )
}

function canStopForPrecision(
  session: AssessmentSession,
  domain: AbilityDomain,
): boolean {
  const estimate = session.estimates[domain]
  const rule = DOMAIN_RULES[domain]
  return (
    estimate.scoredCount >= rule.minimumScored &&
    estimate.standardError <= rule.targetStandardError &&
    coverageSatisfied(session, domain)
  )
}

function stopDomain(
  session: AssessmentSession,
  domain: AbilityDomain,
  reason: NonNullable<DomainEstimateState['stopReason']>,
  status: DomainEstimateState['status'] = 'stopped',
): AssessmentSession {
  return {
    ...session,
    currentItemId: null,
    estimates: {
      ...session.estimates,
      [domain]: {
        ...session.estimates[domain],
        status,
        stopReason: reason,
      },
    },
  }
}

function nextPhase(domain: AbilityDomain): AssessmentPhase {
  const index = DOMAIN_ORDER.indexOf(domain)
  return DOMAIN_ORDER[index + 1] ?? 'complete'
}

function advancePhase(
  session: AssessmentSession,
  domain: AbilityDomain,
): AssessmentSession {
  const phase = nextPhase(domain)
  if (phase === 'complete') {
    return {
      ...session,
      phase,
      currentItemId: null,
      status: 'completed',
      completionReason: 'all-domains-stopped',
    }
  }

  return {
    ...session,
    phase,
    currentItemId: null,
  }
}

function predictedScore(level: number, difficulty: number): number {
  return 1 / (1 + Math.exp((difficulty - level) / 1.75))
}

function desiredDifficulty(estimate: DomainEstimateState): number {
  if (estimate.lastScore === null) {
    return estimate.level
  }
  if (estimate.lastScore >= 0.75) {
    return clampInternalLevel(estimate.level + 1.25)
  }
  if (estimate.lastScore <= 0.25) {
    return clampInternalLevel(estimate.level - 1.25)
  }
  return estimate.level
}

function unmetCoverageFormat(
  session: AssessmentSession,
  domain: AbilityDomain,
): AssessmentItemFormat | null {
  const requirement = DOMAIN_RULES[domain].requiredFormats.find(
    (candidate) =>
      scoredFormatCount(session, domain, candidate.format) < candidate.count,
  )
  return requirement?.format ?? null
}

function selectCandidate(
  session: AssessmentSession,
  bank: AssessmentBank,
  domain: AbilityDomain,
): AssessmentItem | undefined {
  const used = new Set(session.responses.map((response) => response.itemId))
  if (session.currentItemId) {
    used.add(session.currentItemId)
  }

  const domainCandidates = bank.items.filter(
    (item) => item.domain === domain && !used.has(item.id),
  )
  const uncoveredFormat = unmetCoverageFormat(session, domain)
  const candidates = uncoveredFormat
    ? domainCandidates.filter((item) => item.format === uncoveredFormat)
    : domainCandidates
  const pool = candidates.length > 0 ? candidates : domainCandidates
  const target = desiredDifficulty(session.estimates[domain])

  return [...pool].sort((left, right) => {
    const leftDistance = Math.abs(left.difficulty - target)
    const rightDistance = Math.abs(right.difficulty - target)
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance
    }

    if (left.discrimination !== right.discrimination) {
      return right.discrimination - left.discrimination
    }

    return left.id.localeCompare(right.id)
  })[0]
}

function completeForTime(
  session: AssessmentSession,
  reason: 'time-limit' | 'user-stopped',
): AssessmentSession {
  let estimates = session.estimates
  for (const domain of DOMAIN_ORDER) {
    if (estimates[domain].status === 'collecting') {
      estimates = {
        ...estimates,
        [domain]: {
          ...estimates[domain],
          status: 'stopped',
          stopReason: reason,
        },
      }
    }
  }

  return {
    ...session,
    phase: 'complete',
    status: 'partial',
    currentItemId: null,
    estimates,
    completionReason: reason,
  }
}

export function stopAssessment(
  session: AssessmentSession,
): AssessmentSession {
  if (session.status !== 'in-progress') {
    return session
  }
  return completeForTime(session, 'user-stopped')
}

export function getNextAssessmentItem(
  session: AssessmentSession,
  bank: AssessmentBank,
  now: string,
): NextAssessmentStep {
  assertMatchingBank(session, bank)
  validateAssessmentBank(bank)

  if (session.currentItemId) {
    return {
      session,
      item: toPublicAssessmentItem(
        findItem(bank, session.currentItemId),
      ),
    }
  }

  if (session.status !== 'in-progress' || session.phase === 'complete') {
    return { session, item: null }
  }

  const elapsed =
    parseTimestamp(now, 'now') - parseTimestamp(session.startedAt, 'startedAt')
  if (elapsed < 0) {
    throw new RangeError('now cannot be earlier than startedAt')
  }
  if (elapsed >= ASSESSMENT_TIMING.hardLimitMs) {
    return {
      session: completeForTime(session, 'time-limit'),
      item: null,
    }
  }

  const domain = session.phase
  let nextSession = session
  const estimate = nextSession.estimates[domain]
  const rule = DOMAIN_RULES[domain]

  if (estimate.status !== 'collecting') {
    return getNextAssessmentItem(
      advancePhase(nextSession, domain),
      bank,
      now,
    )
  }

  if (canStopForPrecision(nextSession, domain)) {
    nextSession = stopDomain(nextSession, domain, 'precision-reached')
    return getNextAssessmentItem(
      advancePhase(nextSession, domain),
      bank,
      now,
    )
  }

  if (
    elapsed >= ASSESSMENT_TIMING.stopStartingOptionalItemsMs &&
    estimate.scoredCount >= rule.minimumScored &&
    coverageSatisfied(nextSession, domain)
  ) {
    nextSession = stopDomain(nextSession, domain, 'time-limit')
    return getNextAssessmentItem(
      advancePhase(nextSession, domain),
      bank,
      now,
    )
  }

  if (estimate.attemptedCount >= rule.maximumAttempts) {
    nextSession = stopDomain(nextSession, domain, 'item-limit')
    return getNextAssessmentItem(
      advancePhase(nextSession, domain),
      bank,
      now,
    )
  }

  const candidate = selectCandidate(nextSession, bank, domain)
  if (!candidate) {
    nextSession = stopDomain(nextSession, domain, 'bank-exhausted')
    return getNextAssessmentItem(
      advancePhase(nextSession, domain),
      bank,
      now,
    )
  }

  nextSession = {
    ...nextSession,
    currentItemId: candidate.id,
  }

  return {
    session: nextSession,
    item: toPublicAssessmentItem(candidate),
  }
}

function addCoveredFormat(
  formats: readonly AssessmentItemFormat[],
  format: AssessmentItemFormat,
): readonly AssessmentItemFormat[] {
  return formats.includes(format) ? formats : [...formats, format]
}

function updateEstimate(
  estimate: DomainEstimateState,
  item: AssessmentItem,
  scoring: SubmissionScore,
): DomainEstimateState {
  const attemptedCount = estimate.attemptedCount + 1
  if (scoring.score === null) {
    const consecutiveFailures = estimate.consecutiveFailures + 1
    const unavailable =
      consecutiveFailures >=
      DOMAIN_RULES[estimate.domain].consecutiveFailureLimit

    return {
      ...estimate,
      attemptedCount,
      consecutiveFailures,
      status: unavailable ? 'unavailable' : estimate.status,
      stopReason: unavailable ? 'consecutive-failures' : estimate.stopReason,
    }
  }

  const probability = predictedScore(estimate.level, item.difficulty)
  const gain = 2.4 / (1 + estimate.scoredCount * 0.12)
  const delta =
    gain *
    item.discrimination *
    scoring.reliability *
    (scoring.score - probability)
  const level = clampInternalLevel(
    estimate.level + Math.min(2, Math.max(-2, delta)),
  )
  const itemInformation =
    probability *
    (1 - probability) *
    item.discrimination *
    item.discrimination *
    scoring.reliability
  const information = estimate.information + itemInformation

  return {
    ...estimate,
    level,
    information,
    standardError: standardError(information),
    scoredCount: estimate.scoredCount + 1,
    attemptedCount,
    consecutiveFailures: 0,
    reliabilityTotal: estimate.reliabilityTotal + scoring.reliability,
    coveredFormats: addCoveredFormat(estimate.coveredFormats, item.format),
    lastScore: scoring.score,
  }
}

export function submitAssessmentResponse(input: {
  readonly session: AssessmentSession
  readonly bank: AssessmentBank
  readonly submission: AssessmentSubmission
  readonly submittedAt: string
}): SubmittedAssessmentStep {
  const { session, bank, submission, submittedAt } = input
  assertMatchingBank(session, bank)
  if (session.status !== 'in-progress' || !session.currentItemId) {
    throw new TypeError('There is no current assessment item to submit')
  }

  parseTimestamp(submittedAt, 'submittedAt')
  const item = findItem(bank, session.currentItemId)
  if (item.domain !== session.phase) {
    throw new TypeError('Current item does not match the active domain')
  }

  const scoring = scoreAssessmentSubmission(item, submission)
  const record: AssessmentResponseRecord = {
    itemId: item.id,
    domain: item.domain,
    format: item.format,
    submittedAt,
    durationMs: submission.durationMs,
    score: scoring.score,
    reliability: scoring.reliability,
    failureReason: scoring.failureReason,
  }
  const estimate = updateEstimate(
    session.estimates[item.domain],
    item,
    scoring,
  )

  return {
    session: {
      ...session,
      currentItemId: null,
      responses: [...session.responses, record],
      estimates: {
        ...session.estimates,
        [item.domain]: estimate,
      },
    },
    scoring,
  }
}

export function isBoundaryEstimate(level: number): boolean {
  return (
    level <= INTERNAL_LEVEL_MIN + 0.5 ||
    level >= INTERNAL_LEVEL_MAX - 0.5
  )
}
