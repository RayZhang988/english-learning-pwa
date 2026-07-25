import type {
  AssessmentItem,
  AssessmentSubmission,
  FailedSpeechObservation,
  ScoredSpeechObservation,
  SpeechAssessmentItem,
  SpeechFailureReason,
  SpeechMetrics,
} from './types.ts'

export type AssessmentFallback =
  | 'recording-playback'
  | 'device-check'
  | 'retry-audio'
  | null

export interface SubmissionScore {
  readonly score: number | null
  readonly reliability: number
  readonly failureReason:
    | SpeechFailureReason
    | 'audio-unavailable'
    | 'audio-playback-failed'
    | 'item-corrupt'
    | 'user-skipped'
    | null
  readonly fallback: AssessmentFallback
}

const MIN_RECOGNITION_CONFIDENCE = 0.35

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function assertUnit(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} must be between 0 and 1`)
  }
}

function assertDuration(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new TypeError('durationMs must be a non-negative finite number')
  }
}

function failureFallback(
  observation: FailedSpeechObservation,
): AssessmentFallback {
  if (observation.recordingAvailable) {
    return 'recording-playback'
  }

  return 'device-check'
}

function scoreRecognizedSpeech(
  item: SpeechAssessmentItem,
  observation: ScoredSpeechObservation,
): SubmissionScore {
  const metrics = observation.metrics
  for (const [field, value] of Object.entries(metrics)) {
    assertUnit(value, `speech.${field}`)
  }

  if (metrics.recognitionConfidence < MIN_RECOGNITION_CONFIDENCE) {
    return {
      score: null,
      reliability: 0,
      failureReason: 'recognition-failed',
      fallback: 'recording-playback',
    }
  }

  let score: number
  if (item.scoring.rubric === 'read-aloud') {
    score =
      metrics.completeness * 0.5 +
      metrics.intelligibility * 0.3 +
      metrics.fluency * 0.2
  } else if (item.scoring.rubric === 'repeat') {
    score =
      metrics.completeness * 0.55 +
      metrics.intelligibility * 0.3 +
      metrics.fluency * 0.15
  } else {
    score =
      metrics.taskCompletion * 0.35 +
      metrics.intelligibility * 0.25 +
      metrics.languageControl * 0.25 +
      metrics.fluency * 0.15
  }

  return {
    score: Math.round(clampUnit(score) * 1000) / 1000,
    // Recognition confidence affects evidence weight, never the ability score.
    reliability:
      Math.round((0.5 + metrics.recognitionConfidence * 0.5) * 1000) / 1000,
    failureReason: null,
    fallback: null,
  }
}

export function scoreAssessmentSubmission(
  item: AssessmentItem,
  submission: AssessmentSubmission,
): SubmissionScore {
  assertDuration(submission.durationMs)

  if (submission.kind === 'unscorable') {
    return {
      score: null,
      reliability: 0,
      failureReason: submission.reason,
      fallback:
        submission.reason === 'user-skipped'
          ? null
          : submission.reason === 'item-corrupt'
            ? 'device-check'
            : 'retry-audio',
    }
  }

  if (item.kind === 'choice') {
    if (submission.kind !== 'choice') {
      throw new TypeError(`Choice item ${item.id} requires a choice submission`)
    }

    return {
      score:
        submission.selectedOptionId === item.scoring.correctOptionId ? 1 : 0,
      reliability: 1,
      failureReason: null,
      fallback: null,
    }
  }

  if (submission.kind !== 'speech') {
    throw new TypeError(`Speech item ${item.id} requires a speech submission`)
  }

  if (submission.observation.status === 'unscorable') {
    return {
      score: null,
      reliability: 0,
      failureReason: submission.observation.reason,
      fallback: failureFallback(submission.observation),
    }
  }

  return scoreRecognizedSpeech(item, submission.observation)
}

function normalizeTokens(text: string): readonly string[] {
  return text
    .toLocaleLowerCase('en-US')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function longestCommonSubsequenceLength(
  left: readonly string[],
  right: readonly string[],
): number {
  const row = Array<number>(right.length + 1).fill(0)

  for (const leftToken of left) {
    let diagonal = 0
    for (let index = 1; index <= right.length; index += 1) {
      const previous = row[index] ?? 0
      row[index] =
        leftToken === right[index - 1]
          ? diagonal + 1
          : Math.max(row[index] ?? 0, row[index - 1] ?? 0)
      diagonal = previous
    }
  }

  return row[right.length] ?? 0
}

function fluencyFromRate(wordCount: number, durationMs: number): number {
  if (wordCount === 0 || durationMs <= 0) {
    return 0
  }

  const wordsPerMinute = wordCount / (durationMs / 60_000)
  if (wordsPerMinute < 40) {
    return clampUnit(wordsPerMinute / 80)
  }
  if (wordsPerMinute <= 190) {
    return clampUnit(0.5 + (wordsPerMinute - 40) / 300)
  }
  return clampUnit(1 - (wordsPerMinute - 190) / 220)
}

function containsTokenSequence(
  tokens: readonly string[],
  phrase: readonly string[],
): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) {
    return false
  }

  for (
    let startIndex = 0;
    startIndex <= tokens.length - phrase.length;
    startIndex += 1
  ) {
    if (
      phrase.every(
        (token, phraseIndex) => tokens[startIndex + phraseIndex] === token,
      )
    ) {
      return true
    }
  }

  return false
}

/**
 * A limited transcript-match helper for fixed read/repeat tasks. It does not
 * inspect phonemes and must never be presented as professional pronunciation
 * scoring.
 */
export function deriveFixedSpeechMetrics(input: {
  readonly referenceText: string
  readonly transcript: string
  readonly durationMs: number
  readonly recognitionConfidence: number
}): SpeechMetrics {
  assertDuration(input.durationMs)
  assertUnit(input.recognitionConfidence, 'recognitionConfidence')

  const reference = normalizeTokens(input.referenceText)
  const transcript = normalizeTokens(input.transcript)
  if (reference.length === 0) {
    throw new TypeError('referenceText must contain recognizable words')
  }

  const matched = longestCommonSubsequenceLength(reference, transcript)
  const completeness = matched / reference.length
  const intelligibility =
    transcript.length === 0 ? 0 : matched / transcript.length
  const fluency = fluencyFromRate(transcript.length, input.durationMs)

  return {
    completeness: clampUnit(completeness),
    intelligibility: clampUnit(intelligibility),
    fluency,
    languageControl: clampUnit(completeness),
    taskCompletion: clampUnit(completeness),
    recognitionConfidence: input.recognitionConfidence,
  }
}

export interface SpokenResponseMetricSignals {
  /**
   * Optional rubric evidence from a real, documented analyzer. Omit a field
   * when the platform cannot measure it; callers must not manufacture values.
   */
  readonly intelligibility?: number
  readonly fluency?: number
  readonly languageControl?: number
}

/**
 * Derives deliberately limited evidence for an open spoken response.
 *
 * Task completion comes only from the assessment item's private concept
 * groups. Fluency uses recognized word rate unless a real analyzer supplies a
 * value. Transcript-only recognition cannot establish pronunciation quality
 * or grammatical control, so those unobserved traits receive the neutral
 * midpoint rather than a fabricated high/low judgement.
 */
export function deriveSpokenResponseMetrics(input: {
  readonly keyConcepts: readonly (readonly string[])[]
  readonly transcript: string
  readonly durationMs: number
  readonly recognitionConfidence: number
  readonly signals?: SpokenResponseMetricSignals
}): SpeechMetrics {
  assertDuration(input.durationMs)
  assertUnit(input.recognitionConfidence, 'recognitionConfidence')
  if (input.keyConcepts.length === 0) {
    throw new TypeError('spoken-response requires at least one key concept')
  }

  const transcript = normalizeTokens(input.transcript)
  const matchedConcepts = input.keyConcepts.filter((alternatives) =>
    alternatives.some((alternative) =>
      containsTokenSequence(transcript, normalizeTokens(alternative)),
    ),
  ).length
  const taskCompletion = matchedConcepts / input.keyConcepts.length

  const intelligibility = input.signals?.intelligibility ?? 0.5
  const languageControl = input.signals?.languageControl ?? 0.5
  const fluency =
    input.signals?.fluency ??
    fluencyFromRate(transcript.length, input.durationMs)

  assertUnit(intelligibility, 'spokenResponse.intelligibility')
  assertUnit(languageControl, 'spokenResponse.languageControl')
  assertUnit(fluency, 'spokenResponse.fluency')

  return {
    completeness: clampUnit(taskCompletion),
    intelligibility,
    fluency,
    languageControl,
    taskCompletion: clampUnit(taskCompletion),
    recognitionConfidence: input.recognitionConfidence,
  }
}

export interface SpeechEvidenceEvaluator {
  /**
   * The platform/recognizer supplies evidence. The assessment owns the rubric
   * and converts that evidence into a placement score.
   */
  evaluate(
    item: SpeechAssessmentItem,
  ): Promise<ScoredSpeechObservation | FailedSpeechObservation>
}
