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
