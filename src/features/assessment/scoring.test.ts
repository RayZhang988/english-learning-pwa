import { describe, expect, it } from 'vitest'
import { placementBankV1 } from '../../../content/assessment/placement-bank.v1.ts'
import {
  deriveFixedSpeechMetrics,
  scoreAssessmentSubmission,
} from './scoring.ts'

function itemById(id: string) {
  const item = placementBankV1.items.find((candidate) => candidate.id === id)
  if (!item) {
    throw new Error(`Missing test item ${id}`)
  }
  return item
}

describe('assessment scoring', () => {
  it('scores a choice against the private answer key', () => {
    const item = itemById('vocab-word-01')
    expect(
      scoreAssessmentSubmission(item, {
        kind: 'choice',
        selectedOptionId: 'a',
        durationMs: 2_000,
      }).score,
    ).toBe(1)
  })

  it('does not turn low recognizer confidence into a learner error', () => {
    const item = itemById('speak-read-01')
    const result = scoreAssessmentSubmission(item, {
      kind: 'speech',
      durationMs: 4_000,
      observation: {
        status: 'scored',
        transcript: 'I would like a glass of water please',
        metrics: {
          completeness: 1,
          intelligibility: 1,
          fluency: 0.9,
          languageControl: 1,
          taskCompletion: 1,
          recognitionConfidence: 0.2,
        },
      },
    })

    expect(result.score).toBeNull()
    expect(result.failureReason).toBe('recognition-failed')
    expect(result.fallback).toBe('recording-playback')
  })

  it('routes recognition failures to recording playback when available', () => {
    const item = itemById('speak-repeat-02')
    const result = scoreAssessmentSubmission(item, {
      kind: 'speech',
      durationMs: 4_000,
      observation: {
        status: 'unscorable',
        reason: 'offline',
        recordingAvailable: true,
      },
    })

    expect(result.score).toBeNull()
    expect(result.fallback).toBe('recording-playback')
  })

  it('derives limited fixed-text evidence without claiming phoneme scoring', () => {
    const metrics = deriveFixedSpeechMetrics({
      referenceText: 'Please bring the blue bag',
      transcript: 'please bring the blue bag',
      durationMs: 3_000,
      recognitionConfidence: 0.85,
    })

    expect(metrics.completeness).toBe(1)
    expect(metrics.intelligibility).toBe(1)
    expect(metrics.recognitionConfidence).toBe(0.85)
  })
})
