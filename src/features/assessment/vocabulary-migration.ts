import { placementBankV1 } from '../../../content/assessment/placement-bank.v1.ts'
import {
  buildVocabularyAbilityProfileV2,
} from './vocabulary-profile.ts'
import {
  completeMigratedVocabularyAssessmentV2,
  createVocabularyAssessmentSessionV2,
  replayVocabularyAssessmentResponseV2,
} from './vocabulary-engine.ts'
import { parseAssessmentRuntimeSnapshot } from './snapshot.ts'
import type { AssessmentRuntimeSnapshotV1 } from './runtime-types.ts'
import type {
  VocabularyAssessmentBankV2,
  VocabularyAssessmentResponseV2,
  VocabularyAssessmentRuntimeSnapshotV2,
  VocabularyAssessmentSessionV2,
  VocabularySubmissionSummaryV2,
} from './vocabulary-types.ts'

function legacyResponse(
  response: AssessmentRuntimeSnapshotV1['session']['responses'][number],
  bank: VocabularyAssessmentBankV2,
): VocabularyAssessmentResponseV2 | null {
  if (response.domain !== 'vocabulary') {
    return null
  }
  const item = bank.items.find(
    (candidate) => candidate.id === response.itemId,
  )
  if (!item) {
    return null
  }
  const answer =
    response.score === null
      ? 'uncertain'
      : response.score >= 0.75
        ? 'correct'
        : 'incorrect'
  return {
    itemId: item.id,
    format: item.format,
    difficulty: item.difficulty,
    submittedAt: response.submittedAt,
    durationMs: response.durationMs,
    answer,
    score: answer === 'correct' ? 1 : answer === 'incorrect' ? 0 : 0.25,
    reliability:
      answer === 'uncertain'
        ? 0.45
        : Math.max(0.5, response.reliability),
    rapidGuess: false,
  }
}

function rebuildSession(
  legacy: AssessmentRuntimeSnapshotV1,
  bank: VocabularyAssessmentBankV2,
): VocabularyAssessmentSessionV2 {
  let session = createVocabularyAssessmentSessionV2({
    id: legacy.session.id,
    startedAt: legacy.session.startedAt,
    bank,
  })
  for (const response of legacy.session.responses) {
    const migrated = legacyResponse(response, bank)
    if (migrated) {
      session = replayVocabularyAssessmentResponseV2({
        session,
        bank,
        response: migrated,
      })
    }
  }
  return session
}

function summary(
  legacy: AssessmentRuntimeSnapshotV1,
): VocabularySubmissionSummaryV2 | null {
  if (
    legacy.lastSubmission === null ||
    legacy.session.responses.at(-1)?.domain !== 'vocabulary'
  ) {
    return null
  }
  return {
    itemId: legacy.lastSubmission.itemId,
    status:
      legacy.lastSubmission.status === 'skipped'
        ? 'uncertain'
        : 'recorded',
  }
}

/**
 * Explicitly preserves the full v1 snapshot while importing only vocabulary
 * evidence. It never resumes legacy listening or speaking phases.
 */
export function migrateAssessmentRuntimeSnapshotV1ToVocabularyV2(input: {
  readonly snapshot: unknown
  readonly bank: VocabularyAssessmentBankV2
  readonly updatedAt: string
}): VocabularyAssessmentRuntimeSnapshotV2 {
  const legacy = parseAssessmentRuntimeSnapshot(
    input.snapshot,
    placementBankV1,
  )
  let session = rebuildSession(legacy, input.bank)
  const stillInVocabulary =
    legacy.session.status === 'in-progress' &&
    legacy.session.phase === 'vocabulary'

  if (!stillInVocabulary) {
    session = completeMigratedVocabularyAssessmentV2(session)
    const completedAt =
      legacy.profile?.completedAt ?? input.updatedAt
    const profile = buildVocabularyAbilityProfileV2({
      session,
      completedAt,
      durationSeconds: legacy.activeElapsedMs / 1000,
    })
    return {
      schemaVersion: 2,
      assessmentKind: 'adaptive-vocabulary',
      bankId: input.bank.id,
      lifecycle: 'completed',
      resumeTo: null,
      session,
      selectedOptionId: null,
      activeElapsedMs: legacy.activeElapsedMs,
      itemStartedAtActiveMs: null,
      lastSubmission: null,
      profile,
      legacySource: {
        kind: 'assessment-runtime-v1',
        snapshot: legacy,
      },
      updatedAt: input.updatedAt,
    }
  }

  const legacyCurrentId = legacy.session.currentItemId
  const currentItem =
    legacyCurrentId === null
      ? null
      : input.bank.items.find(
          (candidate) => candidate.id === legacyCurrentId,
        ) ?? null
  if (currentItem) {
    session = {
      ...session,
      currentItemId: currentItem.id,
    }
  }
  const legacyFeedback =
    legacy.lifecycle === 'feedback' ||
    (legacy.lifecycle === 'paused' &&
      legacy.resumeTo === 'feedback')
  const resumeTo = legacyFeedback ? 'feedback' : 'active'
  const lastSubmission = legacyFeedback ? summary(legacy) : null

  return {
    schemaVersion: 2,
    assessmentKind: 'adaptive-vocabulary',
    bankId: input.bank.id,
    lifecycle: legacy.lifecycle === 'intro' ? 'intro' : 'paused',
    resumeTo: legacy.lifecycle === 'intro' ? null : resumeTo,
    session,
    selectedOptionId:
      currentItem && resumeTo === 'active'
        ? legacy.selectedOptionId
        : null,
    activeElapsedMs: legacy.activeElapsedMs,
    itemStartedAtActiveMs:
      currentItem && resumeTo === 'active'
        ? legacy.itemStartedAtActiveMs
        : null,
    lastSubmission,
    profile: null,
    legacySource: {
      kind: 'assessment-runtime-v1',
      snapshot: legacy,
    },
    updatedAt: input.updatedAt,
  }
}
