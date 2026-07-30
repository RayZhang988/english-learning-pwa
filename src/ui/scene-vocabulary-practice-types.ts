/**
 * Structural copy of 06's public SceneVocabularyPracticeView contract.
 *
 * Keep this presentation type data-only: the integration layer can pass the
 * 06 view through without transforming its score, question order, or state.
 */
export type SceneVocabularyOptionState =
  | 'default'
  | 'selected'
  | 'correct'
  | 'incorrect'

export interface SceneVocabularyPracticeView {
  readonly status: 'question' | 'feedback'
  readonly progress: {
    readonly answeredCount: number
    readonly correctCount: number
    readonly incorrectCount: number
    /** 06 owns scoring; UI only formats this already-derived ratio. */
    readonly accuracy: number | null
  }
  readonly question?: {
    readonly questionId: string
    readonly promptZh: '这个词是什么意思？'
    readonly sentenceEn: {
      readonly beforeTarget: string
      readonly targetText: string
      readonly afterTarget: string
    }
    readonly options: readonly {
      readonly id: string
      readonly labelZh: string
      readonly state: SceneVocabularyOptionState
    }[]
    /** This exact object must be returned unchanged to the playback adapter. */
    readonly targetPlayback: {
      readonly intent: 'play-target-only'
      readonly text: string
      readonly locale: 'en-US'
    }
  }
  readonly feedback?: {
    readonly correct: boolean
    readonly correctMeaningZh: string
  }
}

export type SceneVocabularyPracticePresentation =
  | {
      readonly status: 'loading'
      readonly label?: string
    }
  | {
      readonly status: 'error'
      readonly title?: string
      readonly description: string
      /** A destructive action is exposed only for a confirmed invalid scene snapshot. */
      readonly invalidSnapshotRecovery?: {
        readonly confirming: boolean
        readonly busy?: boolean
      }
    }
  | {
      readonly status: 'ready'
      readonly view: SceneVocabularyPracticeView
      /** Supplied by the integration after it restores an upstream snapshot. */
      readonly recoveryNotice?: {
        readonly title: string
        readonly description: string
      }
    }
  | {
      /** The route supplies this only when a durable scene session exists. */
      readonly status: 'resume-choice'
      readonly view: SceneVocabularyPracticeView
    }
