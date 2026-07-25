import { describe, expect, it } from 'vitest'
import { placementBankV1 } from '../../../content/assessment/placement-bank.v1.ts'
import type { AssessmentRecognitionOutcome } from '../../platform/index.ts'
import { scoreAssessmentSubmission } from './scoring.ts'
import {
  evaluateSpokenResponseEvidence,
  productionSpokenResponseEvidenceEvaluator,
  type SpokenResponseEvidenceInput,
} from './spoken-response-evaluator.ts'
import type { SpeechAssessmentItem } from './types.ts'

function spokenResponseItem(id = 'speak-response-04'): SpeechAssessmentItem {
  const item = placementBankV1.items.find((candidate) => candidate.id === id)
  if (
    !item ||
    item.kind !== 'speech' ||
    item.format !== 'spoken-response'
  ) {
    throw new Error(`Missing spoken-response test item ${id}`)
  }
  return item
}

function input(
  recognition: AssessmentRecognitionOutcome,
  overrides: Partial<
    Omit<SpokenResponseEvidenceInput, 'item' | 'recognition'>
  > = {},
): SpokenResponseEvidenceInput {
  return {
    item: spokenResponseItem(),
    recognition,
    durationMs: 6_000,
    recordingAvailable: true,
    online: true,
    ...overrides,
  }
}

describe('production spoken-response evidence evaluator', () => {
  it('turns a real platform success into evidence scored by existing rules', () => {
    const evidence = evaluateSpokenResponseEvidence(
      input({
        status: 'recognized',
        transcript: 'Could I have a quiet room for two nights please?',
        confidence: 0.82,
      }),
    )

    expect(evidence).toEqual({
      status: 'scored',
      transcript: 'Could I have a quiet room for two nights please?',
      metrics: {
        completeness: 1,
        intelligibility: 0.5,
        fluency: 0.7,
        languageControl: 0.5,
        taskCompletion: 1,
        recognitionConfidence: 0.82,
      },
    })
    expect(
      scoreAssessmentSubmission(spokenResponseItem(), {
        kind: 'speech',
        observation: evidence,
        durationMs: 6_000,
      }),
    ).toEqual({
      score: 0.705,
      reliability: 0.91,
      failureReason: null,
      fallback: null,
    })
  })

  it('does not turn low recognition confidence into a wrong answer', () => {
    expect(
      evaluateSpokenResponseEvidence(
        input({
          status: 'recognized',
          transcript: 'I need a quiet room for two nights',
          confidence: 0.2,
        }),
      ),
    ).toEqual({
      status: 'unscorable',
      reason: 'recognition-failed',
      recordingAvailable: true,
    })
  })

  it('treats an empty successful transcript as no-speech evidence', () => {
    expect(
      evaluateSpokenResponseEvidence(
        input({
          status: 'recognized',
          transcript: '   ',
          confidence: 0.9,
        }),
      ),
    ).toEqual({
      status: 'unscorable',
      reason: 'no-speech',
      recordingAvailable: true,
    })
  })

  it.each([
    {
      recognition: {
        status: 'failed',
        code: 'not-allowed',
      } as const satisfies AssessmentRecognitionOutcome,
      online: true,
      recordingAvailable: false,
      reason: 'permission-denied',
    },
    {
      recognition: {
        status: 'failed',
        code: 'network',
      } as const satisfies AssessmentRecognitionOutcome,
      online: false,
      recordingAvailable: true,
      reason: 'offline',
    },
    {
      recognition: {
        status: 'failed',
        code: 'no-speech',
      } as const satisfies AssessmentRecognitionOutcome,
      online: true,
      recordingAvailable: true,
      reason: 'no-speech',
    },
    {
      recognition: {
        status: 'failed',
        code: 'confidence-unavailable',
      } as const satisfies AssessmentRecognitionOutcome,
      online: true,
      recordingAvailable: true,
      reason: 'recognition-failed',
    },
  ])(
    'maps $recognition.code to unscorable $reason evidence',
    ({ recognition, online, recordingAvailable, reason }) => {
      const evidence = evaluateSpokenResponseEvidence(
        input(recognition, { online, recordingAvailable }),
      )

      expect(evidence).toEqual({
        status: 'unscorable',
        reason,
        recordingAvailable,
      })
      expect(
        scoreAssessmentSubmission(spokenResponseItem(), {
          kind: 'speech',
          observation: evidence,
          durationMs: 6_000,
        }).score,
      ).toBeNull()
    },
  )

  it('is deterministic and does not mutate evidence on repeated calls', () => {
    const recognition = Object.freeze({
      status: 'recognized',
      transcript: 'I need a quiet room for two nights',
      confidence: 0.9,
    } as const satisfies AssessmentRecognitionOutcome)
    const request = Object.freeze(input(recognition))

    const first =
      productionSpokenResponseEvidenceEvaluator.evaluate(request)
    const second =
      productionSpokenResponseEvidenceEvaluator.evaluate(request)

    expect(second).toEqual(first)
    expect(request.recognition).toBe(recognition)
    expect(request).toEqual(input(recognition))
  })
})
