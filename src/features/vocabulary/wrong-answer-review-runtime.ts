import { advanceWrongAnswerReviewRound, assertRecoverableWrongAnswerReviewRound, submitWrongAnswerReviewAnswer, type WrongAnswerLibraryState, type WrongAnswerLibraryStatePort } from '../../learning-engine/index.ts'
import { VocabularyError } from './errors.ts'
import { createVocabularyWrongAnswerEvidence, type ReviewContentAlias } from './wrong-answer-review.ts'

/** Compatibility name for 01 callers. The port is the single atomic 04 contract. */
export type WrongAnswerReviewStatePort = WrongAnswerLibraryStatePort
export interface VocabularyReviewQuestion {
  readonly identity: ReviewContentAlias
  readonly questionId: string
  readonly correctOptionId: string
  readonly prompt: string
  readonly options: readonly { readonly id: string; readonly label: string }[]
  readonly scenePresentation?: {
    readonly sentenceEn: { readonly beforeTarget: string; readonly targetText: string; readonly afterTarget: string }
    readonly targetPlayback: { readonly intent: 'play-target-only'; readonly text: string; readonly locale: 'en-US' }
  }
}
export interface VocabularyWrongAnswerReviewRuntimeOptions { readonly state: WrongAnswerLibraryStatePort; readonly resolve: (identity: { readonly reviewContentId: string; readonly originalQuestionType: string }) => Promise<VocabularyReviewQuestion>; readonly now?: () => string }

export class VocabularyWrongAnswerReviewRuntime {
  private readonly now: () => string
  private state: WrongAnswerLibraryState | null = null
  private readonly options: VocabularyWrongAnswerReviewRuntimeOptions
  constructor(options: VocabularyWrongAnswerReviewRuntimeOptions) { this.options = options; this.now = options.now ?? (() => new Date().toISOString()) }
  async initialize(): Promise<WrongAnswerLibraryState> { const state = await this.options.state.load(); assertRecoverableWrongAnswerReviewRound(state); this.state = state; return state }
  private require(): WrongAnswerLibraryState { if (!this.state) throw new VocabularyError('session-transition-invalid', 'Wrong-answer review has not been initialized.'); return this.state }
  async currentQuestion(): Promise<VocabularyReviewQuestion | null> { const state = this.require(); const round = assertRecoverableWrongAnswerReviewRound(state); if (!round || round.status !== 'active') return null; const record = state.records[round.order[round.index]!]; if (!record) throw new VocabularyError('session-recovery-invalid', 'Wrong-answer review record is unavailable.'); return this.options.resolve(record) }
  async submit(selectedOptionId: string): Promise<WrongAnswerLibraryState> {
    const question = await this.currentQuestion()
    if (!question) throw new VocabularyError('session-transition-invalid', 'No active wrong-answer review question.')
    const now = this.now()
    const roundId = this.require().activeRound!.roundId
    const evidence = createVocabularyWrongAnswerEvidence({ identity: question.identity, source: 'wrong-answer-review', taskOrSessionId: roundId, questionId: question.questionId, submittedAt: now, correct: selectedOptionId === question.correctOptionId })
    const persisted = await this.options.state.update((latest) => submitWrongAnswerReviewAnswer(latest, evidence).state)
    this.state = persisted
    return persisted
  }
  async advance(): Promise<WrongAnswerLibraryState> {
    this.require()
    const persisted = await this.options.state.update((latest) => advanceWrongAnswerReviewRound(latest, this.now()))
    this.state = persisted
    return persisted
  }
}
