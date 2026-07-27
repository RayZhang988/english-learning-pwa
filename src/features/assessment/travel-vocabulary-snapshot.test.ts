import { describe, expect, it } from 'vitest'
import { travelVocabularyBankR1 } from '../../../content/assessment/travel-vocabulary-bank.r1.ts'
import {
  createTravelVocabularyAssessmentRuntimeR1,
} from './travel-vocabulary-runtime.ts'
import { parseTravelVocabularyRuntimeSnapshotR1 } from './travel-vocabulary-snapshot.ts'

function random() {
  return 0.314_159
}

const now = () => '2026-07-27T06:00:00.000Z'

describe('R1 travel vocabulary snapshot validation', () => {
  it('round-trips a valid active snapshot', () => {
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now,
      createId: () => 'snapshot-valid',
      random,
    })
    runtime.start()
    const snapshot = runtime.toSnapshot()

    expect(
      parseTravelVocabularyRuntimeSnapshotR1(
        snapshot,
        travelVocabularyBankR1,
      ),
    ).toEqual(snapshot)
  })

  it('normalizes a legacy schema-3 active snapshot without completionReason', () => {
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now,
      createId: () => 'snapshot-legacy-active',
      random,
    })
    runtime.start()
    const snapshot = structuredClone(runtime.toSnapshot())
    const { completionReason: _completionReason, ...legacySession } =
      snapshot.session

    const parsed = parseTravelVocabularyRuntimeSnapshotR1(
      { ...snapshot, session: legacySession },
      travelVocabularyBankR1,
    )

    expect(parsed.session.completionReason).toBeNull()
    expect(parsed.lifecycle).toBe('active')
  })

  it('normalizes a completed legacy schema-3 snapshot and profile', async () => {
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now,
      createId: () => 'snapshot-legacy-completed',
      random,
    })
    runtime.start()
    for (let stageIndex = 0; stageIndex < 5; stageIndex += 1) {
      await runtime.submitStage()
      if (stageIndex < 4) {
        runtime.continueToNextStage()
      }
    }
    const snapshot = structuredClone(runtime.toSnapshot())
    if (!snapshot.profile) {
      throw new Error('Missing completed profile')
    }
    const { completionReason: _sessionReason, ...legacySession } =
      snapshot.session
    const { completionReason: _profileReason, ...legacyProfile } =
      snapshot.profile

    const parsed = parseTravelVocabularyRuntimeSnapshotR1(
      {
        ...snapshot,
        session: legacySession,
        profile: legacyProfile,
      },
      travelVocabularyBankR1,
    )

    expect(parsed.session.completionReason).toBe(
      'all-stages-completed',
    )
    expect(parsed.profile?.completionReason).toBe(
      'all-stages-completed',
    )
  })

  it('rejects a future version', () => {
    const snapshot = createTravelVocabularyAssessmentRuntimeR1({
      now,
      createId: () => 'snapshot-future',
      random,
    }).toSnapshot()

    expect(() =>
      parseTravelVocabularyRuntimeSnapshotR1(
        { ...snapshot, schemaVersion: 4 },
        travelVocabularyBankR1,
      ),
    ).toThrow('snapshot identity is incompatible')
  })

  it('rejects an unsupported completion reason', () => {
    const snapshot = createTravelVocabularyAssessmentRuntimeR1({
      now,
      createId: () => 'snapshot-bad-reason',
      random,
    }).toSnapshot()

    expect(() =>
      parseTravelVocabularyRuntimeSnapshotR1(
        {
          ...snapshot,
          session: {
            ...snapshot.session,
            completionReason: 'fabricated-reason',
          },
        },
        travelVocabularyBankR1,
      ),
    ).toThrow('completionReason must be null while in progress')
  })

  it('rejects a duplicate sampled word', () => {
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now,
      createId: () => 'snapshot-duplicate',
      random,
    })
    runtime.start()
    const snapshot = runtime.toSnapshot()
    const firstStage = snapshot.session.stagePlans[0]
    const first = firstStage?.questions[0]
    if (!firstStage || !first) {
      throw new Error('Missing sampled question')
    }
    const corrupted = {
      ...snapshot,
      session: {
        ...snapshot.session,
        stagePlans: snapshot.session.stagePlans.map((stage, index) =>
          index === 0
            ? {
                ...stage,
                questions: stage.questions.map((question, questionIndex) =>
                  questionIndex === 1 ? first : question,
                ),
              }
            : stage,
        ),
      },
    }

    expect(() =>
      parseTravelVocabularyRuntimeSnapshotR1(
        corrupted,
        travelVocabularyBankR1,
      ),
    ).toThrow('duplicate words')
  })

  it('rejects an option order that no longer contains the correct meaning', () => {
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now,
      createId: () => 'snapshot-options',
      random,
    })
    runtime.start()
    const snapshot = runtime.toSnapshot()
    const corrupted = structuredClone(snapshot)
    const question = corrupted.session.stagePlans[0]?.questions[0]
    if (!question) {
      throw new Error('Missing sampled question')
    }
    const options = question.options.map((option) => ({
      ...option,
      text: `损坏-${option.id}`,
    }))
    const stagePlans = corrupted.session.stagePlans.map(
      (stage, stageIndex) => ({
        ...stage,
        questions: stage.questions.map(
          (candidate, questionIndex) =>
            stageIndex === 0 && questionIndex === 0
              ? { ...candidate, options }
              : candidate,
        ),
      }),
    )

    expect(() =>
      parseTravelVocabularyRuntimeSnapshotR1(
        {
          ...corrupted,
          session: { ...corrupted.session, stagePlans },
        },
        travelVocabularyBankR1,
      ),
    ).toThrow('omits the target meaning')
  })
})
