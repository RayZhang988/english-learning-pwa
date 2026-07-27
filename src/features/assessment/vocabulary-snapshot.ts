import { placementBankV1 } from '../../../content/assessment/placement-bank.v1.ts'
import {
  createVocabularyAssessmentSessionV2,
  replayVocabularyAssessmentResponseV2,
} from './vocabulary-engine.ts'
import { buildVocabularyAbilityProfileV2 } from './vocabulary-profile.ts'
import { parseAssessmentRuntimeSnapshot } from './snapshot.ts'
import type {
  AbilityProfileV2,
  VocabularyAdaptiveEstimateV2,
  VocabularyAssessmentBankV2,
  VocabularyAssessmentResponseV2,
  VocabularyAssessmentRuntimeSnapshotV2,
  VocabularyAssessmentSessionV2,
  VocabularySubmissionSummaryV2,
} from './vocabulary-types.ts'

type UnknownRecord = Record<string, unknown>

function invalid(message: string): never {
  throw new TypeError(
    `Invalid vocabulary assessment runtime snapshot: ${message}`,
  )
}

function record(value: unknown, field: string): UnknownRecord {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    invalid(`${field} must be an object`)
  }
  return value as UnknownRecord
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`${field} must be a non-empty string`)
  }
  return value
}

function nullableString(
  value: unknown,
  field: string,
): string | null {
  if (value !== null && typeof value !== 'string') {
    invalid(`${field} must be a string or null`)
  }
  return value
}

function finite(
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

function timestamp(value: unknown, field: string): string {
  const result = string(value, field)
  if (!Number.isFinite(Date.parse(result))) {
    invalid(`${field} must be a valid ISO timestamp`)
  }
  return result
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    invalid(`${field} must be boolean`)
  }
  return value
}

function response(
  value: unknown,
  index: number,
  bank: VocabularyAssessmentBankV2,
): VocabularyAssessmentResponseV2 {
  const label = `session.responses[${index}]`
  const source = record(value, label)
  const itemId = string(source.itemId, `${label}.itemId`)
  const item = bank.items.find((candidate) => candidate.id === itemId)
  if (!item) {
    invalid(`${label} references an unknown item`)
  }
  if (
    source.format !== item.format ||
    source.difficulty !== item.difficulty
  ) {
    invalid(`${label} does not match its bank item`)
  }
  timestamp(source.submittedAt, `${label}.submittedAt`)
  finite(source.durationMs, `${label}.durationMs`, 0)
  if (
    source.answer !== 'correct' &&
    source.answer !== 'incorrect' &&
    source.answer !== 'uncertain'
  ) {
    invalid(`${label}.answer is unsupported`)
  }
  const score = finite(source.score, `${label}.score`, 0)
  const reliability = finite(
    source.reliability,
    `${label}.reliability`,
    0,
  )
  if (score > 1 || reliability > 1) {
    invalid(`${label} score and reliability must be <= 1`)
  }
  const expectedScore =
    source.answer === 'correct'
      ? 1
      : source.answer === 'incorrect'
        ? 0
        : 0.25
  if (score !== expectedScore) {
    invalid(`${label}.score does not match its answer`)
  }
  boolean(source.rapidGuess, `${label}.rapidGuess`)
  return source as unknown as VocabularyAssessmentResponseV2
}

function estimatesMatch(
  actual: UnknownRecord,
  expected: VocabularyAdaptiveEstimateV2,
): boolean {
  const entries = Object.entries(expected)
  if (Object.keys(actual).length !== entries.length) {
    return false
  }
  return entries.every(([key, expectedValue]) => {
    const actualValue = actual[key]
    return typeof expectedValue === 'number'
      ? typeof actualValue === 'number' &&
          Math.abs(actualValue - expectedValue) <= 0.000_001
      : actualValue === expectedValue
  })
}

function session(
  value: unknown,
  bank: VocabularyAssessmentBankV2,
): VocabularyAssessmentSessionV2 {
  const source = record(value, 'session')
  if (
    source.schemaVersion !== 2 ||
    source.assessmentKind !== 'adaptive-vocabulary' ||
    source.bankId !== bank.id
  ) {
    invalid('session identity is incompatible')
  }
  const id = string(source.id, 'session.id')
  const startedAt = timestamp(source.startedAt, 'session.startedAt')
  if (source.phase !== 'vocabulary' && source.phase !== 'complete') {
    invalid('session.phase is unsupported')
  }
  if (
    source.status !== 'in-progress' &&
    source.status !== 'completed' &&
    source.status !== 'partial'
  ) {
    invalid('session.status is unsupported')
  }
  const currentItemId = nullableString(
    source.currentItemId,
    'session.currentItemId',
  )
  if (!Array.isArray(source.responses)) {
    invalid('session.responses must be an array')
  }
  const responses = source.responses.map((candidate, index) =>
    response(candidate, index, bank),
  )
  if (
    new Set(responses.map((candidate) => candidate.itemId)).size !==
    responses.length
  ) {
    invalid('session.responses contains duplicate items')
  }

  let rebuilt = createVocabularyAssessmentSessionV2({
    id,
    startedAt,
    bank,
  })
  for (const candidate of responses) {
    rebuilt = replayVocabularyAssessmentResponseV2({
      session: rebuilt,
      bank,
      response: candidate,
    })
  }
  const estimate = record(source.estimate, 'session.estimate')
  if (!estimatesMatch(estimate, rebuilt.estimate)) {
    const completionFieldsOnly =
      estimatesMatch(
        {
          ...estimate,
          status: rebuilt.estimate.status,
          stopReason: rebuilt.estimate.stopReason,
        },
        rebuilt.estimate,
      )
    if (!completionFieldsOnly) {
      invalid('session.estimate does not match response evidence')
    }
  }

  if (currentItemId !== null) {
    const current = bank.items.find(
      (candidate) => candidate.id === currentItemId,
    )
    if (
      !current ||
      responses.some(
        (candidate) => candidate.itemId === currentItemId,
      )
    ) {
      invalid('session.currentItemId is invalid')
    }
  }
  if (source.status === 'in-progress') {
    if (
      source.phase !== 'vocabulary' ||
      source.completionReason !== null ||
      estimate.status !== 'collecting' ||
      estimate.stopReason !== null
    ) {
      invalid('in-progress session has completion metadata')
    }
  } else if (
    source.phase !== 'complete' ||
    currentItemId !== null ||
    typeof source.completionReason !== 'string' ||
    estimate.status !== 'stopped' ||
    estimate.stopReason !== source.completionReason
  ) {
    invalid('completed session has inconsistent state')
  }

  return structuredClone(
    source as unknown as VocabularyAssessmentSessionV2,
  )
}

function submissionSummary(
  value: unknown,
  parsedSession: VocabularyAssessmentSessionV2,
): VocabularySubmissionSummaryV2 | null {
  if (value === null) {
    return null
  }
  const source = record(value, 'lastSubmission')
  const itemId = string(source.itemId, 'lastSubmission.itemId')
  if (
    source.status !== 'recorded' &&
    source.status !== 'uncertain'
  ) {
    invalid('lastSubmission.status is unsupported')
  }
  if (parsedSession.responses.at(-1)?.itemId !== itemId) {
    invalid('lastSubmission does not match latest response')
  }
  return source as unknown as VocabularySubmissionSummaryV2
}

function profile(
  value: unknown,
  parsedSession: VocabularyAssessmentSessionV2,
): AbilityProfileV2 {
  const source = record(value, 'profile')
  if (
    source.schemaVersion !== 2 ||
    source.assessmentKind !== 'adaptive-vocabulary' ||
    source.assessmentId !== parsedSession.id ||
    source.bankId !== parsedSession.bankId
  ) {
    invalid('profile identity is incompatible')
  }
  string(source.profileId, 'profile.profileId')
  timestamp(source.completedAt, 'profile.completedAt')
  finite(source.durationSeconds, 'profile.durationSeconds', 0)
  string(source.disclaimer, 'profile.disclaimer')
  const abilities = record(source.abilities, 'profile.abilities')
  const vocabulary = record(
    abilities.vocabulary,
    'profile.abilities.vocabulary',
  )
  const listening = record(
    abilities.listening,
    'profile.abilities.listening',
  )
  const speaking = record(
    abilities.speaking,
    'profile.abilities.speaking',
  )
  if (
    vocabulary.calibrationState !== 'estimated' &&
    vocabulary.calibrationState !== 'insufficient-evidence'
  ) {
    invalid('vocabulary calibration state is invalid')
  }
  for (const [domain, ability] of [
    ['listening', listening],
    ['speaking', speaking],
  ] as const) {
    if (
      ability.domain !== domain ||
      ability.calibrationState !== 'pending-calibration' ||
      ability.internalLevel !== null ||
      ability.cefrEstimate !== 'unknown' ||
      ability.confidence !== 0
    ) {
      invalid(`${domain} must remain pending calibration`)
    }
  }
  const vocabularySize = record(
    source.vocabularySize,
    'profile.vocabularySize',
  )
  if (
    vocabularySize.wordCountRange !== null ||
    vocabularySize.wordCountCalibration !== 'unavailable'
  ) {
    invalid('profile must not invent a total vocabulary count')
  }
  const parsed = structuredClone(
    source as unknown as AbilityProfileV2,
  )
  const expected = buildVocabularyAbilityProfileV2({
    session: parsedSession,
    completedAt: parsed.completedAt,
    durationSeconds: parsed.durationSeconds,
  })
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
    invalid('profile does not match session evidence')
  }
  return parsed
}

export function parseVocabularyAssessmentRuntimeSnapshotV2(
  value: unknown,
  bank: VocabularyAssessmentBankV2,
): VocabularyAssessmentRuntimeSnapshotV2 {
  const source = record(value, 'snapshot')
  if (
    source.schemaVersion !== 2 ||
    source.assessmentKind !== 'adaptive-vocabulary' ||
    source.bankId !== bank.id
  ) {
    invalid('snapshot identity is incompatible')
  }
  if (
    source.lifecycle !== 'intro' &&
    source.lifecycle !== 'active' &&
    source.lifecycle !== 'feedback' &&
    source.lifecycle !== 'paused' &&
    source.lifecycle !== 'completed'
  ) {
    invalid('lifecycle is unsupported')
  }
  if (
    source.resumeTo !== null &&
    source.resumeTo !== 'active' &&
    source.resumeTo !== 'feedback'
  ) {
    invalid('resumeTo is unsupported')
  }
  const updatedAt = timestamp(source.updatedAt, 'updatedAt')
  const activeElapsedMs = finite(
    source.activeElapsedMs,
    'activeElapsedMs',
    0,
  )
  const itemStartedAtActiveMs =
    source.itemStartedAtActiveMs === null
      ? null
      : finite(
          source.itemStartedAtActiveMs,
          'itemStartedAtActiveMs',
          0,
        )
  if (
    itemStartedAtActiveMs !== null &&
    itemStartedAtActiveMs > activeElapsedMs
  ) {
    invalid('itemStartedAtActiveMs exceeds activeElapsedMs')
  }
  const parsedSession = session(source.session, bank)
  const selectedOptionId = nullableString(
    source.selectedOptionId,
    'selectedOptionId',
  )
  const parsedSummary = submissionSummary(
    source.lastSubmission,
    parsedSession,
  )
  const currentItem =
    parsedSession.currentItemId === null
      ? null
      : bank.items.find(
          (candidate) =>
            candidate.id === parsedSession.currentItemId,
        ) ?? null
  if (
    selectedOptionId !== null &&
    (!currentItem ||
      !currentItem.options.some(
        (option) => option.id === selectedOptionId,
      ))
  ) {
    invalid('selectedOptionId is not valid for the current item')
  }

  if (source.lifecycle === 'intro') {
    if (
      parsedSession.responses.length !== 0 ||
      parsedSession.currentItemId !== null ||
      selectedOptionId !== null ||
      itemStartedAtActiveMs !== null ||
      parsedSummary !== null ||
      source.profile !== null ||
      source.resumeTo !== null
    ) {
      invalid('intro lifecycle is inconsistent')
    }
  } else if (source.lifecycle === 'active') {
    if (
      parsedSession.status !== 'in-progress' ||
      !currentItem ||
      itemStartedAtActiveMs === null ||
      parsedSummary !== null ||
      source.profile !== null ||
      source.resumeTo !== null
    ) {
      invalid('active lifecycle is inconsistent')
    }
  } else if (source.lifecycle === 'feedback') {
    if (
      parsedSession.status !== 'in-progress' ||
      parsedSession.currentItemId !== null ||
      selectedOptionId !== null ||
      itemStartedAtActiveMs !== null ||
      parsedSummary === null ||
      source.profile !== null ||
      source.resumeTo !== null
    ) {
      invalid('feedback lifecycle is inconsistent')
    }
  } else if (source.lifecycle === 'paused') {
    if (
      parsedSession.status !== 'in-progress' ||
      source.resumeTo === null ||
      (source.resumeTo === 'active' &&
        currentItem !== null &&
        itemStartedAtActiveMs === null) ||
      (source.resumeTo === 'feedback' &&
        parsedSummary === null) ||
      source.profile !== null
    ) {
      invalid('paused lifecycle is inconsistent')
    }
  } else if (
    parsedSession.status === 'in-progress' ||
    parsedSession.currentItemId !== null ||
    selectedOptionId !== null ||
    itemStartedAtActiveMs !== null ||
    parsedSummary !== null ||
    source.profile === null ||
    source.resumeTo !== null
  ) {
    invalid('completed lifecycle is inconsistent')
  }

  const parsedProfile =
    source.profile === null
      ? null
      : profile(source.profile, parsedSession)
  if (
    parsedProfile !== null &&
    parsedProfile.durationSeconds !==
      Math.round(activeElapsedMs / 1000)
  ) {
    invalid('profile duration does not match active elapsed time')
  }
  let legacySource = null
  if (source.legacySource !== null) {
    const legacy = record(source.legacySource, 'legacySource')
    if (legacy.kind !== 'assessment-runtime-v1') {
      invalid('legacySource.kind is unsupported')
    }
    legacySource = {
      kind: 'assessment-runtime-v1' as const,
      snapshot: parseAssessmentRuntimeSnapshot(
        legacy.snapshot,
        placementBankV1,
      ),
    }
  }

  return structuredClone({
    schemaVersion: 2,
    assessmentKind: 'adaptive-vocabulary',
    bankId: bank.id,
    lifecycle: source.lifecycle,
    resumeTo: source.resumeTo,
    session: parsedSession,
    selectedOptionId,
    activeElapsedMs,
    itemStartedAtActiveMs,
    lastSubmission: parsedSummary,
    profile: parsedProfile,
    legacySource,
    updatedAt,
  } as VocabularyAssessmentRuntimeSnapshotV2)
}
