import {
  deriveFixedSpeechMetrics,
  evaluateSpokenResponseEvidence,
  placementBankV1,
  type SpeechObservation,
} from '../../features/assessment/index.ts'
import type { AssessmentCaptureState } from './assessment-capture-controller.ts'

export function createAssessmentSpeechObservation(
  itemId: string,
  capture: AssessmentCaptureState,
  online: boolean,
): SpeechObservation | null {
  if (
    capture.status !== 'review' &&
    capture.status !== 'unavailable' &&
    capture.status !== 'error'
  ) {
    return null
  }
  const item = placementBankV1.items.find(
    (candidate) => candidate.id === itemId,
  )
  if (!item || item.kind !== 'speech') {
    return {
      status: 'unscorable',
      reason: 'recognition-failed',
      recordingAvailable: true,
    }
  }
  if (item.format === 'spoken-response') {
    return evaluateSpokenResponseEvidence({
      item,
      recognition: capture.result.recognition,
      durationMs: capture.result.durationMs,
      recordingAvailable: capture.result.recordingAvailable,
      online,
    })
  }
  if (capture.result.failure) {
    return capture.result.failure
  }
  if (capture.result.recognition.status === 'failed') {
    return {
      status: 'unscorable',
      reason: 'recognition-failed',
      recordingAvailable: capture.result.recordingAvailable,
    }
  }
  if (item.scoring.referenceText === null) {
    return {
      status: 'unscorable',
      reason: 'recognition-failed',
      recordingAvailable: true,
    }
  }
  return {
    status: 'scored',
    transcript: capture.result.recognition.transcript,
    metrics: deriveFixedSpeechMetrics({
      referenceText: item.scoring.referenceText,
      transcript: capture.result.recognition.transcript,
      durationMs: capture.result.durationMs,
      recognitionConfidence:
        capture.result.recognition.confidence,
    }),
  }
}
