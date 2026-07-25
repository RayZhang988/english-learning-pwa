import type {
  LearningEvent,
  LearningTask,
  StandardErrorTag,
} from '../../learning-engine/index.ts'

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
}

export interface ListeningChoiceOption {
  readonly id: string
  readonly label: string
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

export interface ListeningKeywordDictationQuestion
  extends ListeningQuestionBase {
  readonly type: 'keyword-dictation'
  readonly targetKeywords: readonly string[]
  readonly standardAnswer: string
  readonly acceptedAnswers: readonly string[]
  readonly normalizationHints: ListeningNormalizationHints
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
  readonly extensionVersion: '1.0.0'
  readonly courseId: string
  readonly units: readonly ListeningTrainingUnit[]
  getUnit(contentRef: string): ListeningTrainingUnit | undefined
}

export interface ListeningContentDocuments {
  readonly packageIndex: unknown
  readonly manifest: unknown
  readonly lessonsByPath: Readonly<Record<string, unknown>>
  readonly extensionIndex: unknown
  readonly exerciseBundlesByPath: Readonly<Record<string, unknown>>
}

export interface ListeningPlaybackState {
  readonly status: ListeningPlaybackStatus
  readonly currentSegmentId: string
  readonly rate: ListeningPlaybackRate
  readonly repeatMode: ListeningRepeatMode
  readonly playCounts: Readonly<Record<string, number>>
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
  readonly failure: ListeningSessionFailure | null
}

export interface ListeningSessionResult {
  readonly correctCount: number
  readonly questionCount: number
  readonly performanceScore: number
  readonly assistanceLevel: number
  readonly errorTags: readonly StandardErrorTag[]
}
