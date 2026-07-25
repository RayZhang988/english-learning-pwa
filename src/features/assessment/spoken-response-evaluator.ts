import type { AssessmentRecognitionOutcome } from '../../platform/index.ts'
import {
  deriveSpokenResponseMetrics,
  scoreAssessmentSubmission,
  type SpokenResponseMetricSignals,
} from './scoring.ts'
import type {
  FailedSpeechObservation,
  SpeechAssessmentItem,
  SpeechFailureReason,
  SpeechObservation,
} from './types.ts'

export interface SpokenResponseEvidenceInput {
  /**
   * The private bank item is required because key concepts must never be sent
   * to the presentation layer.
   */
  readonly item: SpeechAssessmentItem
  /**
   * This is the public 01 platform result without renamed or guessed fields.
   */
  readonly recognition: AssessmentRecognitionOutcome
  readonly durationMs: number
  readonly recordingAvailable: boolean
  readonly online: boolean
  /**
   * Optional non-private numeric rubric signals. Omit values that the current
   * platform cannot actually measure.
   */
  readonly signals?: SpokenResponseMetricSignals
}

export type SpokenResponseEvidence = SpeechObservation

export interface SpokenResponseEvidenceEvaluator {
  evaluate(input: SpokenResponseEvidenceInput): SpokenResponseEvidence
}

function unscorable(
  reason: SpeechFailureReason,
  recordingAvailable: boolean,
): FailedSpeechObservation {
  return {
    status: 'unscorable',
    reason,
    recordingAvailable,
  }
}

function recognitionFailureReason(
  code: Extract<
    AssessmentRecognitionOutcome,
    { readonly status: 'failed' }
  >['code'],
  online: boolean,
  recordingAvailable: boolean,
): SpeechFailureReason {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return 'permission-denied'
  }
  if (code === 'unavailable' || code === 'language-not-supported') {
    return 'recognizer-unavailable'
  }
  if (code === 'network') {
    return online ? 'recognition-failed' : 'offline'
  }
  if (code === 'no-speech') {
    return 'no-speech'
  }
  if (code === 'audio-capture' && !recordingAvailable) {
    return 'recording-failed'
  }
  return 'recognition-failed'
}

function isFiniteUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function isValidDuration(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/**
 * Converts the production recognition result into evidence accepted by the
 * existing assessment runtime. It is pure and deterministic, so retrying the
 * conversion cannot create or mutate a response.
 */
export function evaluateSpokenResponseEvidence(
  input: SpokenResponseEvidenceInput,
): SpokenResponseEvidence {
  if (
    input.item.kind !== 'speech' ||
    input.item.format !== 'spoken-response' ||
    input.item.scoring.rubric !== 'spoken-response'
  ) {
    throw new TypeError(
      'evaluateSpokenResponseEvidence requires a spoken-response item',
    )
  }

  if (input.recognition.status === 'failed') {
    return unscorable(
      recognitionFailureReason(
        input.recognition.code,
        input.online,
        input.recordingAvailable,
      ),
      input.recordingAvailable,
    )
  }

  const transcript = input.recognition.transcript.trim()
  if (!transcript) {
    return unscorable('no-speech', input.recordingAvailable)
  }
  if (!isFiniteUnit(input.recognition.confidence)) {
    return unscorable('recognition-failed', input.recordingAvailable)
  }
  if (!isValidDuration(input.durationMs)) {
    return unscorable('recording-failed', input.recordingAvailable)
  }

  let observation: SpeechObservation
  try {
    observation = {
      status: 'scored',
      transcript,
      metrics: deriveSpokenResponseMetrics({
        keyConcepts: input.item.scoring.keyConcepts,
        transcript,
        durationMs: input.durationMs,
        recognitionConfidence: input.recognition.confidence,
        signals: input.signals,
      }),
    }
  } catch {
    return unscorable('recognition-failed', input.recordingAvailable)
  }

  const scored = scoreAssessmentSubmission(input.item, {
    kind: 'speech',
    observation,
    durationMs: input.durationMs,
  })
  if (scored.score === null) {
    return unscorable('recognition-failed', input.recordingAvailable)
  }

  return observation
}

export const productionSpokenResponseEvidenceEvaluator: SpokenResponseEvidenceEvaluator =
  Object.freeze({
    evaluate: evaluateSpokenResponseEvidence,
  })
