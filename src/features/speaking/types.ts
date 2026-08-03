import type { LearningEvent, LearningTask, LearningTaskSupplyItem } from '../../learning-engine/index.ts'
import type { WrongAnswerEvidence } from '../../learning-engine/index.ts'
import type {
  MicrophonePermissionState,
  NetworkStatus,
} from '../../platform/index.ts'

export const SPEAKING_SESSION_SCHEMA_VERSION = 1 as const

export type SpeakingActivityType =
  | 'fixed-response'
  | 'guided-roleplay'

export interface SpeakingPrompt {
  readonly id: string
  readonly cueZh: string
  readonly partnerLine: string
  readonly modelAnswer: string
  readonly acceptedAnswers: readonly string[]
  readonly requiredConcepts: readonly string[]
}

export interface SpeakingTrainingUnit {
  readonly learningUnitId: string
  readonly contentRef: string
  readonly difficultyLevel: number
  readonly estimatedSeconds: number
  readonly tags: readonly string[]
  readonly activityType: SpeakingActivityType
  readonly instructionsZh: string
  readonly prompts: readonly SpeakingPrompt[]
  /** Fixed-response prompts declared in the lesson's published sceneQuiz. */
  readonly scenePrompts: readonly SpeakingPrompt[]
}

export interface SpeakingCatalog {
  readonly schemaVersion: 1
  readonly packageVersion: '1.0.0'
  readonly courseId: 'survival-travel-american-4w'
  readonly units: readonly SpeakingTrainingUnit[]
  readonly trainingSupplyIndex?: unknown
  getUnit(contentRef: string): SpeakingTrainingUnit | undefined
}

export interface SpeakingContentDocuments {
  readonly packageIndex: unknown
  readonly manifest: unknown
  readonly lessonsByPath: Readonly<Record<string, unknown>>
  readonly trainingSupplyIndex?: unknown
}

export interface SpeakingSupplyItem extends LearningTaskSupplyItem {
  readonly source: {
    readonly sourceType: 'speaking-prompt' | 'speaking-scene-quiz'
    readonly sourceId: string
    readonly variantId: 'activity-prompt' | 'scene-fixed-response'
  }
}

export interface SpeakingStreamState {
  readonly activeItem: SpeakingSupplyItem | null
  readonly activeRequestId: string
  readonly nextSupplyCursor: string | null
  readonly completedItemIds: readonly string[]
  readonly completedItemCount: number
  readonly recognizedItemCount: number
  readonly unscorableItemCount: number
  readonly finishCurrentItem: boolean
  /** The acknowledged exhausted request that a recovery event must match. */
  readonly exhaustionRequestId: string | null
  /** Stable outbox identity while recovery publication is pending. */
  readonly recoveryEventId: string | null
}

export type SpeakingMatchLevel =
  | 'match'
  | 'close'
  | 'partial'
  | 'different'

export interface SpeakingTextMatch {
  readonly level: SpeakingMatchLevel
  readonly similarity: number
  readonly transcript: string
  readonly normalizedTranscript: string
  readonly closestAcceptedAnswer: string
  readonly normalizedAcceptedAnswer: string
}

export type SpeakingRecognitionErrorCode =
  | 'aborted'
  | 'audio-capture'
  | 'language-not-supported'
  | 'network'
  | 'no-speech'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'unavailable'
  | 'unknown'

export type SpeakingRecognitionOutcome =
  | {
      readonly status: 'recognized'
      readonly transcript: string
      readonly alternatives: readonly string[]
    }
  | {
      readonly status: 'failed'
      readonly code: SpeakingRecognitionErrorCode
      readonly message: string
    }

export interface SpeakingRecognitionCapabilities {
  readonly supported: boolean
  readonly requiresSiri: boolean
}

export interface SpeakingRecognitionHandle {
  readonly result: Promise<SpeakingRecognitionOutcome>
  stop(): void
  abort(): void
}

export interface SpeakingRecognitionPort {
  capabilities(): SpeakingRecognitionCapabilities
  start(locale: 'en-US'): SpeakingRecognitionHandle
}

export interface SpeakingRecordingCapabilities {
  readonly supported: boolean
  readonly supportedMimeTypes: readonly string[]
}

export interface SpeakingRecording {
  readonly id: string
  readonly blob: Blob
  readonly mimeType: string
  readonly durationMs: number
}

export interface SpeakingRecordingLifecycleCallbacks {
  onStarted(): void
  onPaused(): void
  onResumed(): void
  onStopped(): void
  onError(error: unknown): void
}

export interface SpeakingPlaybackLifecycleCallbacks {
  onStarted(): void
  onPaused(): void
  onWaiting(): void
  onEnded(): void
  onError(error: unknown): void
}

export interface SpeakingRecordingPort {
  capabilities(): SpeakingRecordingCapabilities
  start(
    stream: MediaStream,
    lifecycle?: SpeakingRecordingLifecycleCallbacks,
  ): void
  stop(): Promise<SpeakingRecording>
  cancel(): void
  play(
    recording: SpeakingRecording,
    lifecycle?: SpeakingPlaybackLifecycleCallbacks,
  ): Promise<void>
  stopPlayback(): void
  discard(recording: SpeakingRecording): void
  dispose(): void
}

export type SpeakingFallbackReason =
  | 'permission-denied'
  | 'recording-unsupported'
  | 'recording-failed'
  | 'recognition-unsupported'
  | 'recognition-offline'
  | 'recognition-denied'
  | 'recognition-network'
  | 'recognition-no-speech'
  | 'recognition-failed'
  | 'playback-failed'
  | 'interrupted'

export interface SpeakingRecorderState {
  readonly status:
    | 'permission'
    | 'ready'
    | 'recording'
    | 'processing'
    | 'review'
    | 'unavailable'
    | 'error'
  readonly durationMs: number
  readonly playbackAvailable: boolean
  readonly message: string | null
}

export interface SpeakingRecognitionState {
  readonly status:
    | 'idle'
    | 'listening'
    | 'processing'
    | 'recognized'
    | 'unavailable'
    | 'error'
  readonly transcript: string | null
  readonly errorCode: SpeakingRecognitionErrorCode | null
  readonly message: string | null
}

export interface SpeakingAnswerRecord {
  readonly promptId: string
  readonly recorded: boolean
  readonly recordingDurationMs: number
  readonly transcript: string | null
  readonly match: SpeakingTextMatch | null
  readonly fallbackReason: SpeakingFallbackReason | null
  readonly failureCategory:
    | 'device'
    | 'permission'
    | 'network'
    | 'interrupted'
    | null
  readonly retryCount: number
  readonly submittedAt: string
}

export interface SpeakingSessionFailure {
  readonly category: 'content' | 'network'
  readonly message: string
}

export type SpeakingSessionPhase =
  | 'practicing'
  | 'feedback'
  | 'paused'
  | 'completed'
  | 'error'

export interface SpeakingSession {
  readonly schemaVersion: 1
  readonly task: LearningTask
  readonly unit: SpeakingTrainingUnit | null
  readonly phase: SpeakingSessionPhase
  readonly pausedFromPhase: 'practicing' | 'feedback' | null
  readonly promptIndex: number
  readonly answers: readonly SpeakingAnswerRecord[]
  readonly permission: MicrophonePermissionState
  readonly network: NetworkStatus
  readonly recorder: SpeakingRecorderState
  readonly recognition: SpeakingRecognitionState
  readonly retryCount: number
  readonly activeDurationSeconds: number
  readonly reportedDurationSeconds: number
  readonly startedAt: string
  readonly updatedAt: string
  readonly lastActiveAt: string | null
  readonly pendingEvents: readonly LearningEvent[]
  /** Durable R13-D outbox. It is intentionally separate from learning events. */
  readonly pendingWrongAnswerEvidence?: readonly WrongAnswerEvidence[]
  readonly failure: SpeakingSessionFailure | null
  /** Present only when 01 has injected the QA-011 training-budget port. */
  readonly stream: SpeakingStreamState | null
}

export interface SpeakingSessionResult {
  readonly promptCount: number
  readonly recognizedCount: number
  /** Existing content-match rubric: match/close are correct. */
  readonly correctCount: number
  readonly incorrectCount: number
  readonly unscorableCount: number
  readonly performanceScore: number | null
  readonly evidenceQuality: number
  readonly assistanceLevel: number
  readonly errorTags: readonly ['other'] | readonly []
  readonly failureCategory:
    | 'device'
    | 'permission'
    | 'network'
    | 'interrupted'
    | null
}
