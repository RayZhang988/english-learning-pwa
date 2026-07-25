import { validateAssessmentBank } from './bank.ts'
import {
  INTERNAL_LEVEL_MAX,
  INTERNAL_LEVEL_MIN,
} from './levels.ts'
import {
  ASSESSMENT_RUNTIME_SCHEMA_VERSION,
  type AssessmentRuntimeSnapshotV1,
  type AssessmentSubmissionSummary,
} from './runtime-types.ts'
import type {
  AbilityDomain,
  AbilityProfile,
  AssessmentBank,
  AssessmentItemFormat,
  AssessmentResponseRecord,
  AssessmentSession,
  DomainEstimateState,
} from './types.ts'

type UnknownRecord = Record<string, unknown>

const domains = [
  'vocabulary',
  'listening',
  'speaking',
] as const satisfies readonly AbilityDomain[]

const phases = [...domains, 'complete'] as const
const formats = [
  'word-meaning',
  'sentence-understanding',
  'listening-gist',
  'listening-detail',
  'listening-inference',
  'read-aloud',
  'repeat',
  'spoken-response',
] as const satisfies readonly AssessmentItemFormat[]

const failureReasons = [
  'permission-denied',
  'recognizer-unavailable',
  'offline',
  'no-speech',
  'recognition-failed',
  'recording-failed',
  'audio-unavailable',
  'audio-playback-failed',
  'item-corrupt',
  'user-skipped',
] as const

function invalid(message: string): never {
  throw new TypeError(`Invalid assessment runtime snapshot: ${message}`)
}

function isRecord(value: unknown): value is UnknownRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function requireRecord(value: unknown, field: string): UnknownRecord {
  if (!isRecord(value)) {
    invalid(`${field} must be an object`)
  }
  return value
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`${field} must be a non-empty string`)
  }
  return value
}

function requireNullableString(
  value: unknown,
  field: string,
): string | null {
  if (value !== null && typeof value !== 'string') {
    invalid(`${field} must be a string or null`)
  }
  return value
}

function requireFinite(
  value: unknown,
  field: string,
  minimum = -Infinity,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum
  ) {
    invalid(`${field} must be a finite number >= ${minimum}`)
  }
  return value
}

function requireInteger(
  value: unknown,
  field: string,
  minimum = 0,
): number {
  const number = requireFinite(value, field, minimum)
  if (!Number.isInteger(number)) {
    invalid(`${field} must be an integer`)
  }
  return number
}

function requireTimestamp(value: unknown, field: string): string {
  const timestamp = requireString(value, field)
  if (!Number.isFinite(Date.parse(timestamp))) {
    invalid(`${field} must be a valid ISO timestamp`)
  }
  return timestamp
}

function requireUnit(value: unknown, field: string): number {
  const number = requireFinite(value, field, 0)
  if (number > 1) {
    invalid(`${field} must be <= 1`)
  }
  return number
}

function requireStringArray(
  value: unknown,
  field: string,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === 'string')
  ) {
    invalid(`${field} must be a string array`)
  }
  return value
}

function validateResponse(
  value: unknown,
  index: number,
  bank: AssessmentBank,
): AssessmentResponseRecord {
  const label = `session.responses[${index}]`
  const record = requireRecord(value, label)
  const itemId = requireString(record.itemId, `${label}.itemId`)
  const item = bank.items.find((candidate) => candidate.id === itemId)
  if (!item) {
    invalid(`${label} references an unknown item`)
  }
  if (record.domain !== item.domain || record.format !== item.format) {
    invalid(`${label} does not match its bank item`)
  }
  requireTimestamp(record.submittedAt, `${label}.submittedAt`)
  requireFinite(record.durationMs, `${label}.durationMs`, 0)
  if (record.score !== null) {
    requireUnit(record.score, `${label}.score`)
  }
  requireUnit(record.reliability, `${label}.reliability`)
  if (
    record.failureReason !== null &&
    !failureReasons.includes(
      record.failureReason as (typeof failureReasons)[number],
    )
  ) {
    invalid(`${label}.failureReason is unsupported`)
  }
  if (
    (record.score === null) !==
    (record.failureReason !== null)
  ) {
    invalid(`${label} must contain either a score or a failure`)
  }
  return record as unknown as AssessmentResponseRecord
}

function validateEstimate(
  value: unknown,
  domain: AbilityDomain,
  responses: readonly AssessmentResponseRecord[],
): DomainEstimateState {
  const label = `session.estimates.${domain}`
  const estimate = requireRecord(value, label)
  if (estimate.domain !== domain) {
    invalid(`${label}.domain is inconsistent`)
  }
  const level = requireFinite(estimate.level, `${label}.level`)
  if (level < INTERNAL_LEVEL_MIN || level > INTERNAL_LEVEL_MAX) {
    invalid(`${label}.level is outside the internal scale`)
  }
  requireFinite(estimate.information, `${label}.information`, 0)
  requireFinite(
    estimate.standardError,
    `${label}.standardError`,
    0,
  )
  const attemptedCount = requireInteger(
    estimate.attemptedCount,
    `${label}.attemptedCount`,
  )
  const scoredCount = requireInteger(
    estimate.scoredCount,
    `${label}.scoredCount`,
  )
  const domainResponses = responses.filter(
    (response) => response.domain === domain,
  )
  const scoredResponses = domainResponses.filter(
    (response) => response.score !== null,
  )
  if (
    attemptedCount !== domainResponses.length ||
    scoredCount !== scoredResponses.length
  ) {
    invalid(`${label} counts do not match response evidence`)
  }
  requireInteger(
    estimate.consecutiveFailures,
    `${label}.consecutiveFailures`,
  )
  const reliabilityTotal = requireFinite(
    estimate.reliabilityTotal,
    `${label}.reliabilityTotal`,
    0,
  )
  const expectedReliability = scoredResponses.reduce(
    (total, response) => total + response.reliability,
    0,
  )
  if (Math.abs(reliabilityTotal - expectedReliability) > 0.001) {
    invalid(`${label}.reliabilityTotal does not match responses`)
  }
  if (
    !Array.isArray(estimate.coveredFormats) ||
    !estimate.coveredFormats.every((format) =>
      formats.includes(format as AssessmentItemFormat),
    )
  ) {
    invalid(`${label}.coveredFormats is invalid`)
  }
  const expectedFormats = new Set(
    scoredResponses.map((response) => response.format),
  )
  const actualFormats = new Set(
    estimate.coveredFormats as readonly AssessmentItemFormat[],
  )
  if (
    expectedFormats.size !== actualFormats.size ||
    [...expectedFormats].some((format) => !actualFormats.has(format))
  ) {
    invalid(`${label}.coveredFormats does not match responses`)
  }
  if (
    estimate.lastScore !== null &&
    (typeof estimate.lastScore !== 'number' ||
      estimate.lastScore < 0 ||
      estimate.lastScore > 1)
  ) {
    invalid(`${label}.lastScore is invalid`)
  }
  if (
    estimate.status !== 'collecting' &&
    estimate.status !== 'stopped' &&
    estimate.status !== 'unavailable'
  ) {
    invalid(`${label}.status is unsupported`)
  }
  const stopReasons = [
    'precision-reached',
    'item-limit',
    'consecutive-failures',
    'bank-exhausted',
    'time-limit',
    'user-stopped',
  ]
  if (
    estimate.stopReason !== null &&
    !stopReasons.includes(String(estimate.stopReason))
  ) {
    invalid(`${label}.stopReason is unsupported`)
  }
  return estimate as unknown as DomainEstimateState
}

function validateSession(
  value: unknown,
  bank: AssessmentBank,
): AssessmentSession {
  const session = requireRecord(value, 'session')
  if (session.schemaVersion !== 1) {
    invalid('session.schemaVersion is unsupported')
  }
  requireString(session.id, 'session.id')
  if (session.bankId !== bank.id) {
    invalid('session.bankId does not match the runtime bank')
  }
  requireTimestamp(session.startedAt, 'session.startedAt')
  if (!phases.includes(session.phase as (typeof phases)[number])) {
    invalid('session.phase is unsupported')
  }
  if (
    session.status !== 'in-progress' &&
    session.status !== 'completed' &&
    session.status !== 'partial'
  ) {
    invalid('session.status is unsupported')
  }
  const currentItemId = requireNullableString(
    session.currentItemId,
    'session.currentItemId',
  )
  if (!Array.isArray(session.responses)) {
    invalid('session.responses must be an array')
  }
  const responses = session.responses.map((response, index) =>
    validateResponse(response, index, bank),
  )
  if (
    new Set(responses.map((response) => response.itemId)).size !==
    responses.length
  ) {
    invalid('session.responses contains duplicate item submissions')
  }
  const estimatesRecord = requireRecord(
    session.estimates,
    'session.estimates',
  )
  const estimates = {
    vocabulary: validateEstimate(
      estimatesRecord.vocabulary,
      'vocabulary',
      responses,
    ),
    listening: validateEstimate(
      estimatesRecord.listening,
      'listening',
      responses,
    ),
    speaking: validateEstimate(
      estimatesRecord.speaking,
      'speaking',
      responses,
    ),
  }
  if (currentItemId !== null) {
    const current = bank.items.find((item) => item.id === currentItemId)
    if (!current || current.domain !== session.phase) {
      invalid('session.currentItemId is not valid for the active phase')
    }
    if (
      responses.some((response) => response.itemId === currentItemId)
    ) {
      invalid('session.currentItemId was already submitted')
    }
  }
  if (session.status === 'in-progress') {
    if (
      session.phase === 'complete' ||
      session.completionReason !== null
    ) {
      invalid('in-progress session has completion metadata')
    }
  } else if (
    session.phase !== 'complete' ||
    currentItemId !== null ||
    session.completionReason === null
  ) {
    invalid('completed session has inconsistent state')
  }
  return {
    ...(session as unknown as AssessmentSession),
    responses,
    estimates,
  }
}

function validateSubmissionSummary(
  value: unknown,
  session: AssessmentSession,
): AssessmentSubmissionSummary | null {
  if (value === null) {
    return null
  }
  const summary = requireRecord(value, 'lastSubmission')
  const itemId = requireString(
    summary.itemId,
    'lastSubmission.itemId',
  )
  const response = session.responses.at(-1)
  if (!response || response.itemId !== itemId) {
    invalid('lastSubmission does not match the latest response')
  }
  if (
    summary.status !== 'recorded' &&
    summary.status !== 'unscorable' &&
    summary.status !== 'skipped'
  ) {
    invalid('lastSubmission.status is unsupported')
  }
  if (
    summary.failureReason !== null &&
    !failureReasons.includes(
      summary.failureReason as (typeof failureReasons)[number],
    )
  ) {
    invalid('lastSubmission.failureReason is unsupported')
  }
  const fallbacks = [
    'recording-playback',
    'device-check',
    'retry-audio',
    null,
  ]
  if (!fallbacks.includes(summary.fallback as never)) {
    invalid('lastSubmission.fallback is unsupported')
  }
  return summary as unknown as AssessmentSubmissionSummary
}

function validateProfile(
  value: unknown,
  session: AssessmentSession,
): AbilityProfile {
  const profile = requireRecord(value, 'profile')
  if (
    profile.schemaVersion !== 1 ||
    profile.assessmentId !== session.id ||
    profile.bankId !== session.bankId
  ) {
    invalid('profile identity does not match the session')
  }
  requireString(profile.profileId, 'profile.profileId')
  requireTimestamp(profile.completedAt, 'profile.completedAt')
  requireFinite(profile.durationSeconds, 'profile.durationSeconds', 0)
  if (profile.outcome !== 'completed' && profile.outcome !== 'partial') {
    invalid('profile.outcome is unsupported')
  }
  requireString(profile.disclaimer, 'profile.disclaimer')
  const abilities = requireRecord(profile.abilities, 'profile.abilities')
  for (const domain of domains) {
    const ability = requireRecord(
      abilities[domain],
      `profile.abilities.${domain}`,
    )
    if (ability.domain !== domain) {
      invalid(`profile.abilities.${domain}.domain is inconsistent`)
    }
    if (
      ability.status !== 'estimated' &&
      ability.status !== 'low-confidence' &&
      ability.status !== 'unavailable'
    ) {
      invalid(`profile.abilities.${domain}.status is unsupported`)
    }
    requireUnit(
      ability.confidence,
      `profile.abilities.${domain}.confidence`,
    )
    requireInteger(
      ability.evidenceCount,
      `profile.abilities.${domain}.evidenceCount`,
    )
    requireStringArray(
      ability.warnings,
      `profile.abilities.${domain}.warnings`,
    )
  }
  return profile as unknown as AbilityProfile
}

export function parseAssessmentRuntimeSnapshot(
  value: unknown,
  bank: AssessmentBank,
): AssessmentRuntimeSnapshotV1 {
  validateAssessmentBank(bank)
  const snapshot = requireRecord(value, 'snapshot')
  if (snapshot.schemaVersion !== ASSESSMENT_RUNTIME_SCHEMA_VERSION) {
    invalid('schemaVersion is unsupported')
  }
  if (snapshot.bankId !== bank.id) {
    invalid('bankId does not match the supplied bank')
  }
  const lifecycles = [
    'intro',
    'active',
    'feedback',
    'paused',
    'completed',
  ]
  if (!lifecycles.includes(String(snapshot.lifecycle))) {
    invalid('lifecycle is unsupported')
  }
  if (
    snapshot.resumeTo !== null &&
    snapshot.resumeTo !== 'active' &&
    snapshot.resumeTo !== 'feedback'
  ) {
    invalid('resumeTo is unsupported')
  }
  requireTimestamp(snapshot.updatedAt, 'updatedAt')
  const activeElapsedMs = requireFinite(
    snapshot.activeElapsedMs,
    'activeElapsedMs',
    0,
  )
  const itemStartedAtActiveMs =
    snapshot.itemStartedAtActiveMs === null
      ? null
      : requireFinite(
          snapshot.itemStartedAtActiveMs,
          'itemStartedAtActiveMs',
          0,
        )
  if (
    itemStartedAtActiveMs !== null &&
    itemStartedAtActiveMs > activeElapsedMs
  ) {
    invalid('itemStartedAtActiveMs exceeds activeElapsedMs')
  }
  const session = validateSession(snapshot.session, bank)
  const selectedOptionId = requireNullableString(
    snapshot.selectedOptionId,
    'selectedOptionId',
  )
  const lastSubmission = validateSubmissionSummary(
    snapshot.lastSubmission,
    session,
  )
  const lifecycle = snapshot.lifecycle
  const currentItem =
    session.currentItemId === null
      ? null
      : bank.items.find((item) => item.id === session.currentItemId) ??
        null

  if (lifecycle === 'intro') {
    if (
      session.responses.length !== 0 ||
      session.currentItemId !== null ||
      session.status !== 'in-progress' ||
      selectedOptionId !== null ||
      itemStartedAtActiveMs !== null ||
      lastSubmission !== null ||
      snapshot.profile !== null ||
      snapshot.resumeTo !== null
    ) {
      invalid('intro lifecycle contains active session data')
    }
  } else if (lifecycle === 'active') {
    if (
      session.status !== 'in-progress' ||
      !currentItem ||
      itemStartedAtActiveMs === null ||
      lastSubmission !== null ||
      snapshot.profile !== null ||
      snapshot.resumeTo !== null
    ) {
      invalid('active lifecycle is inconsistent')
    }
  } else if (lifecycle === 'feedback') {
    if (
      session.status !== 'in-progress' ||
      session.currentItemId !== null ||
      selectedOptionId !== null ||
      itemStartedAtActiveMs !== null ||
      lastSubmission === null ||
      snapshot.profile !== null ||
      snapshot.resumeTo !== null
    ) {
      invalid('feedback lifecycle is inconsistent')
    }
  } else if (lifecycle === 'paused') {
    if (
      session.status !== 'in-progress' ||
      (snapshot.resumeTo === 'active' &&
        (!currentItem || itemStartedAtActiveMs === null)) ||
      (snapshot.resumeTo === 'feedback' &&
        (session.currentItemId !== null ||
          itemStartedAtActiveMs !== null ||
          lastSubmission === null)) ||
      snapshot.resumeTo === null ||
      snapshot.profile !== null
    ) {
      invalid('paused lifecycle is inconsistent')
    }
  } else if (
    session.status === 'in-progress' ||
    session.currentItemId !== null ||
    selectedOptionId !== null ||
    itemStartedAtActiveMs !== null ||
    snapshot.profile === null ||
    snapshot.resumeTo !== null
  ) {
    invalid('completed lifecycle is inconsistent')
  }

  if (selectedOptionId !== null) {
    if (
      !currentItem ||
      currentItem.kind !== 'choice' ||
      !currentItem.options.some(
        (option) => option.id === selectedOptionId,
      )
    ) {
      invalid('selectedOptionId is not valid for the current item')
    }
  }
  if (currentItem?.kind === 'speech' && selectedOptionId !== null) {
    invalid('speech item cannot have a selected option')
  }

  const profile =
    snapshot.profile === null
      ? null
      : validateProfile(snapshot.profile, session)

  return structuredClone({
    schemaVersion: ASSESSMENT_RUNTIME_SCHEMA_VERSION,
    bankId: bank.id,
    lifecycle,
    resumeTo: snapshot.resumeTo,
    session,
    selectedOptionId,
    activeElapsedMs,
    itemStartedAtActiveMs,
    lastSubmission,
    profile,
    updatedAt: snapshot.updatedAt,
  } as AssessmentRuntimeSnapshotV1)
}
