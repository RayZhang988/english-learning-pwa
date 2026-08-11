import type {
  LearningEvent,
  LearningTask,
  LearningTaskSupplyItem,
  StandardErrorTag,
} from '../../learning-engine/index.ts'
import type { WrongAnswerEvidence } from '../../learning-engine/index.ts'
import type { TrainingSupplyRound } from '../../learning-engine/index.ts'

export const VOCABULARY_SESSION_SCHEMA_VERSION = 1 as const

export type VocabularyQuestionType =
  | 'term-to-meaning'
  | 'meaning-to-term'
  | 'example-comprehension'
  | 'scene-word-choice'

export interface VocabularyQuestionOption {
  readonly id: string
  readonly label: string
}

export interface VocabularyQuestion {
  readonly id: string
  readonly type: VocabularyQuestionType
  readonly instructionZh: string
  readonly prompt: string
  readonly promptLocale: 'en-US' | 'zh-CN'
  readonly partOfSpeech: string | null
  readonly options: readonly VocabularyQuestionOption[]
  readonly correctOptionId: string
  readonly exampleEn: string | null
  readonly explanationZh: string | null
  readonly errorTag: Extract<
    StandardErrorTag,
    'meaning-recall' | 'form-recall' | 'word-choice'
  >
}

export interface VocabularyItem {
  readonly id: string
  readonly term: string
  readonly partOfSpeech: string
  readonly meaningZh: string
  readonly exampleEn: string
  readonly exampleZh: string
}

export interface VocabularySingleChoiceQuiz {
  readonly id: string
  readonly format: 'single-choice'
  readonly promptZh: string
  readonly options: readonly string[]
  readonly correctOptionIndex: number
  readonly rationaleZh: string
}

export interface VocabularyIntentMatchingQuiz {
  readonly id: string
  readonly format: 'intent-matching'
  readonly promptZh: string
  readonly pairs: readonly {
    readonly intentZh: string
    readonly answer: string
  }[]
  readonly rationaleZh: string
}

export type VocabularySceneQuiz =
  | VocabularySingleChoiceQuiz
  | VocabularyIntentMatchingQuiz

export interface VocabularyTrainingUnit {
  readonly learningUnitId: string
  readonly contentRef: string
  readonly difficultyLevel: number
  readonly estimatedSeconds: number
  readonly tags: readonly string[]
  readonly activityType: 'vocabulary-set' | 'vocabulary-review'
  readonly instructionsZh: string
  readonly items: readonly VocabularyItem[]
  readonly reviewItems: readonly VocabularyItem[]
  readonly sceneQuiz: VocabularySceneQuiz
}

export interface VocabularyCatalog {
  readonly schemaVersion: 1
  readonly packageVersion: '1.0.0'
  readonly courseId: string
  readonly units: readonly VocabularyTrainingUnit[]
  readonly trainingSupplyIndex?: unknown
  getUnit(contentRef: string): VocabularyTrainingUnit | undefined
  getItem(itemId: string): VocabularyItem | undefined
}

export interface VocabularyContentDocuments {
  readonly packageIndex: unknown
  readonly manifest: unknown
  readonly lessonsByPath: Readonly<Record<string, unknown>>
  /** Optional for released packages created before QA-011. */
  readonly trainingSupplyIndex?: unknown
}

export type VocabularySupplyVariantId =
  | 'term-to-meaning-choice'
  | 'meaning-to-term-choice'
  | 'example-gap-choice'

export interface VocabularySupplyItem extends LearningTaskSupplyItem {
  readonly source: {
    readonly sourceType: 'vocabulary-item'
    readonly sourceId: string
    readonly variantId: VocabularySupplyVariantId
    readonly distractorItemIds: readonly string[]
  }
}

export interface VocabularyStreamState {
  readonly activeItem: VocabularySupplyItem
  readonly activeRequestId: string
  readonly nextSupplyCursor: string | null
  /** R11-A: persisted randomized supplier order and acknowledged cursor. */
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

export interface VocabularyAnswerRecord {
  readonly questionId: string
  readonly selectedOptionId: string
  readonly correct: boolean
  readonly submittedAt: string
}

export interface VocabularyAnswerFeedback {
  readonly correct: boolean
  readonly title: string
  readonly description: string
  readonly exampleEn: string | null
  readonly explanationZh: string | null
}

export type VocabularySessionPhase =
  | 'answering'
  | 'feedback'
  | 'paused'
  | 'completed'
  | 'error'

export interface VocabularySessionFailure {
  readonly category: 'network' | 'content' | 'interrupted'
  readonly message: string
}

export interface VocabularySession {
  readonly schemaVersion: 1
  readonly task: LearningTask
  readonly questions: readonly VocabularyQuestion[]
  readonly questionIndex: number
  readonly selectedOptionId: string | null
  readonly answers: readonly VocabularyAnswerRecord[]
  readonly phase: VocabularySessionPhase
  readonly pausedFromPhase: 'answering' | 'feedback' | null
  readonly activeDurationSeconds: number
  readonly reportedDurationSeconds: number
  readonly startedAt: string
  readonly lastActiveAt: string | null
  readonly updatedAt: string
  readonly pendingEvents: readonly LearningEvent[]
  /** R13-D durable outbox. Only formally incorrect vocabulary answers enter it. */
  readonly pendingWrongAnswerEvidence?: readonly WrongAnswerEvidence[]
  readonly failure: VocabularySessionFailure | null
  /** Present only for QA-011 training-budget tasks. */
  readonly stream: VocabularyStreamState | null
}

export interface VocabularySessionResult {
  readonly correctCount: number
  readonly questionCount: number
  readonly performanceScore: number
  readonly errorTags: readonly StandardErrorTag[]
}
