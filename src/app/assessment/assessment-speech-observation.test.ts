import { describe, expect, it } from 'vitest'
import type { AssessmentCaptureState } from './assessment-capture-controller.ts'
import { createAssessmentSpeechObservation } from './assessment-speech-observation.ts'

function recognizedCapture(
  transcript: string,
  confidence = 0.82,
): AssessmentCaptureState {
  return {
    status: 'review',
    result: {
      recognition: {
        status: 'recognized',
        transcript,
        confidence,
      },
      durationMs: 6_000,
      recordingAvailable: true,
      failure: null,
    },
    playbackAvailable: true,
  }
}

describe('assessment production speech observation adapter', () => {
  it('uses the 03 production evaluator only for spoken-response', () => {
    const observation = createAssessmentSpeechObservation(
      'speak-response-04',
      recognizedCapture(
        'Could I have a quiet room for two nights please?',
      ),
      true,
    )

    expect(observation).toMatchObject({
      status: 'scored',
      transcript: 'Could I have a quiet room for two nights please?',
      metrics: {
        taskCompletion: 1,
        recognitionConfidence: 0.82,
      },
    })
  })

  it('keeps read-aloud on the fixed-text metric path', () => {
    const observation = createAssessmentSpeechObservation(
      'speak-read-01',
      recognizedCapture('I would like a glass of water, please.'),
      true,
    )

    expect(observation).toMatchObject({
      status: 'scored',
      metrics: {
        completeness: 1,
        recognitionConfidence: 0.82,
      },
    })
  })

  it('passes an existing recording fallback through unchanged', () => {
    const capture: AssessmentCaptureState = {
      status: 'review',
      result: {
        recognition: {
          status: 'failed',
          code: 'network',
        },
        durationMs: 6_000,
        recordingAvailable: true,
        failure: {
          status: 'unscorable',
          reason: 'offline',
          recordingAvailable: true,
        },
      },
      playbackAvailable: true,
    }

    expect(
      createAssessmentSpeechObservation(
        'speak-response-04',
        capture,
        false,
      ),
    ).toEqual(capture.result.failure)
  })
})
