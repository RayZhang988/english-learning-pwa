import type {
  LearningEvent,
  LearningTask,
  LearningTaskSupplyItem,
  WrongAnswerEvidence,
  StandardErrorTag,
} from '../../learning-engine/index.ts'
import type { TrainingSupplyRound } from '../../learning-engine/index.ts'

export const LISTENING_SESSION_SCHEMA_VERSION = 1 as const

export type ListeningPlaybackRate = 0.75 | 1 | 1.25
export type ListeningRepeatMode = 'none' | 'segment' | 'all'
export type ListeningPlaybackStatus =
  | 'idle'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'unavailable'
  | 'error'

export interface ListeningTranscriptLine {
  readonly id: string
  readonly speaker: string | null
  readonly text: string
  readonly translationZh: string
}

export interface ListeningSegment {
  readonly id: string
  readonly locale: 'en-US'
  readonly text: string
  readonly label: string
  readonly speaker: string | null
}

export interface ListeningPlaybackPolicy {
  readonly allowSegmentSelection: boolean
  readonly allowRepeat: boolean
  readonly allowedRates: readonly ListeningPlaybackRate[]
  readonly sequenceMode: 'current-segment' | 'all-segments'
}

export interface ListeningChoiceOption {
  readonly id: string
  readonly label: string
  /**
   * Released R9 content always provides this field. It stays optional only so
   * schema-1 checkpoints and isolated legacy fixtures remain readable.
   */
  readonly translationZh?: string
}

interface ListeningQuestionBase {
  readonly id: string
  readonly promptZh: string
  readonly primarySegmentId: string
  readonly segments: readonly ListeningSegment[]
  readonly playbackPolicy: ListeningPlaybackPolicy
  readonly rationaleZh: string
  readonly errorTag: Extract<
    StandardErrorTag,
    'sound-discrimination' | 'detail-missed' | 'inference'
  >
}

export interface ListeningChoiceQuestion
  extends ListeningQuestionBase {
  readonly type:
    | 'word-discrimination'
    | 'short-sentence-choice'
    | 'core-information'
    | 'scene-comprehension'
  readonly options: readonly ListeningChoiceOption[]
  readonly correctOptionId: string
}

export interface ListeningNormalizationHints {
  readonly trim: true
  readonly caseFoldLocale: 'en-US'
  readonly collapseWhitespace: true
  readonly normalizeApostrophes: true
  readonly stripTerminalPunctuation: true
}

export type ListeningDictationAnswerType =
  | 'place-name'
  | 'surname'
  | 'number'
  | 'time'
  | 'manner-or-short-phrase'
  | 'product-description'
  | 'reservation-details'
  | 'allergy-information'
  | 'payment-method'
  | 'direction-and-distance'
  | 'transfer-instruction'
  | 'ticket-details'
  | 'size-or-condition'
  | 'checkout-time'
  | 'device-problem'
  | 'gate-code'
  | 'availability-time'
  | 'room-number'
  | 'gate-and-time'

export type ListeningDictationInputFormat =
  | 'english-words'
  | 'digits'
  | 'clock-time'
  | 'gate-code'
  | 'room-number'

/**
 * Published by the course author. This is deliberately a learner-facing
 * instruction, not a value derived from any accepted answer.
 */
export interface ListeningDictationAnswerGuidance {
  readonly answerType: ListeningDictationAnswerType
  readonly guidanceZh: string
  readonly acceptedInputFormats: readonly ListeningDictationInputFormat[]
}

export interface ListeningKeywordDictationQuestion
  extends ListeningQuestionBase {
  readonly type: 'keyword-dictation'
  readonly targetKeywords: readonly string[]
  readonly standardAnswer: string
  readonly acceptedAnswers: readonly string[]
  readonly normalizationHints: ListeningNormalizationHints
  readonly answerGuidance: ListeningDictationAnswerGuidance
}

export type ListeningQuestion =
  | ListeningChoiceQuestion
  | ListeningKeywordDictationQuestion

export interface ListeningTrainingUnit {
  readonly learningUnitId: string
  readonly contentRef: string
  readonly difficultyLevel: number
  readonly estimatedSeconds: number
  readonly tags: readonly string[]
  readonly activityType:
    | 'listening-dialogue'
    | 'listening-narrative'
    | 'listening-announcement'
  readonly titleZh: string
  readonly transcript: readonly ListeningTranscriptLine[]
  readonly questions: readonly ListeningQuestion[]
}

export interface ListeningCatalog {
  readonly schemaVersion: 1
  readonly packageVersion: '1.0.0'
  /**
   * 1.1.0 is retained only for isolated legacy test catalogs. Released
   * documents are parsed strictly as 1.2.0 by createListeningCatalog().
   */
  readonly extensionVersion: '1.1.0' | '1.2.0'
  readonly courseId: string
  readonly units: readonly ListeningTrainingUnit[]
  readonly trainingSupplyIndex?: unknown
  getUnit(contentRef: string): ListeningTrainingUnit | undefined
}

export interface ListeningContentDocuments {
  readonly packageIndex: unknown
  readonly manifest: unknown
  readonly lessonsByPath: Readonly<Record<string, unknown>>
  readonly extensionIndex: unknown
  readonly exerciseBundlesByPath: Readonly<Record<string, unknown>>
  readonly bilingualChoiceOptions: unknown
  /** Optional for released packages created before QA-011. */
  readonly trainingSupplyIndex?: unknown
}

export interface ListeningSupplyItem extends LearningTaskSupplyItem {
  /** Published 05 identity for normalized spoken audio; not a UI-derived value. */
  readonly playbackContentId: string
  readonly source: {
    readonly sourceType:
      | 'listening-extension'
      | 'listening-core-check'
      | 'listening-scene-quiz'
    readonly sourceId: string
    readonly variantId: string
  }
}

export interface ListeningStreamState {
  readonly activeItem: ListeningSupplyItem
  readonly activeRequestId: string
  readonly nextSupplyCursor: string | null
  readonly supplyRound?: TrainingSupplyRound
  readonly completedItemIds: readonly string[]
  readonly completedItemCount: number
  readonly correctItemCount: number
  readonly finishCurrentItem: boolean
  /** The acknowledged exhausted request that a recovery event must match. */
  readonly exhaustionRequestId: string | null
  /** Stable outbox identity while an exhaustion recovery is being published. */
  readonly recoveryEventId: string | null
}

export interface ListeningPlaybackState {
  readonly status: ListeningPlaybackStatus
  readonly currentSegmentId: string
  readonly rate: ListeningPlaybackRate
  readonly repeatMode: ListeningRepeatMode
  readonly playCounts: Readonly<Record<string, number>>
  /**
   * Counts only utterances that reached their real onEnd callback. Missing on
   * an old schema-1 checkpoint is handled by the legacy ended-state fallback.
   */
  readonly completedPlayCounts?: Readonly<Record<string, number>>
  readonly errorMessage: string | null
}

export interface ListeningAnswerRecord {
  readonly questionId: string
  readonly response: string
  readonly correct: boolean
  readonly submittedAt: string
  readonly playCount: number
  readonly rate: ListeningPlaybackRate
  readonly repeatMode: ListeningRepeatMode
}

export interface ListeningAnswerFeedback {
  readonly correct: boolean
  readonly title: string
  readonly description: string
  readonly rationaleZh: string
}

export type ListeningSessionPhase =
  | 'answering'
  | 'feedback'
  | 'paused'
  | 'completed'
  | 'error'

export interface ListeningSessionFailure {
  readonly category: 'device' | 'network' | 'content' | 'interrupted'
  readonly message: string
}

export interface ListeningSession {
  readonly schemaVersion: 1
  readonly task: LearningTask
  readonly transcript: readonly ListeningTranscriptLine[]
  readonly questions: readonly ListeningQuestion[]
  readonly questionIndex: number
  readonly selectedOptionId: string | null
  readonly dictationInput: string
  readonly answers: readonly ListeningAnswerRecord[]
  readonly phase: ListeningSessionPhase
  readonly pausedFromPhase: 'answering' | 'feedback' | null
  readonly playback: ListeningPlaybackState
  readonly activeDurationSeconds: number
  readonly reportedDurationSeconds: number
  readonly startedAt: string
  readonly lastActiveAt: string | null
  readonly updatedAt: string
  readonly pendingEvents: readonly LearningEvent[]
  /** Durable outbox: formal incorrect answers are never inferred after reload. */
  readonly pendingWrongAnswerEvidence?: readonly WrongAnswerEvidence[]
  readonly failure: ListeningSessionFailure | null
  /** Present only for QA-011 training-budget tasks. */
  readonly stream: ListeningStreamState | null
}

export interface ListeningSessionResult {
  readonly correctCount: number
  readonly questionCount: number
  readonly performanceScore: number
  readonly assistanceLevel: number
  readonly errorTags: readonly StandardErrorTag[]
}
