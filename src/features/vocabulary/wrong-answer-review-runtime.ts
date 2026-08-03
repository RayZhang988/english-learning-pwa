import { advanceWrongAnswerReviewRound, assertRecoverableWrongAnswerReviewRound, submitWrongAnswerReviewAnswer, type WrongAnswerLibraryState } from '../../learning-engine/index.ts'
import { VocabularyError } from './errors.ts'
import { createVocabularyWrongAnswerEvidence, type ReviewContentAlias } from './wrong-answer-review.ts'

/** The application owns storage of this state; 06 deliberately does not create a second library. */
export interface WrongAnswerReviewStatePort { load(): Promise<WrongAnswerLibraryState>; save(state: WrongAnswerLibraryState): Promise<void> }
export interface VocabularyReviewQuestion { readonly identity: ReviewContentAlias; readonly questionId: string; readonly correctOptionId: string; readonly prompt: string; readonly options: readonly { readonly id: string; readonly label: string }[] }
export interface VocabularyWrongAnswerReviewRuntimeOptions { readonly state: WrongAnswerReviewStatePort; readonly resolve: (identity: { readonly reviewContentId: string; readonly originalQuestionType: string }) => Promise<VocabularyReviewQuestion>; readonly now?: () => string }

export class VocabularyWrongAnswerReviewRuntime {
  private readonly now: () => string
  private state: WrongAnswerLibraryState | null = null
  private readonly options: VocabularyWrongAnswerReviewRuntimeOptions
  constructor(options: VocabularyWrongAnswerReviewRuntimeOptions) { this.options = options; this.now = options.now ?? (() => new Date().toISOString()) }
  async initialize(): Promise<WrongAnswerLibraryState> { const state = await this.options.state.load(); assertRecoverableWrongAnswerReviewRound(state); this.state = state; return state }
  private require(): WrongAnswerLibraryState { if (!this.state) throw new VocabularyError('session-transition-invalid', 'Wrong-answer review has not been initialized.'); return this.state }
  async currentQuestion(): Promise<VocabularyReviewQuestion | null> { const state = this.require(); const round = assertRecoverableWrongAnswerReviewRound(state); if (!round || round.status !== 'active') return null; const record = state.records[round.order[round.index]!]; if (!record) throw new VocabularyError('session-recovery-invalid', 'Wrong-answer review record is unavailable.'); return this.options.resolve(record) }
  async submit(selectedOptionId: string): Promise<WrongAnswerLibraryState> { const question = await this.currentQuestion(); if (!question) throw new VocabularyError('session-transition-invalid', 'No active wrong-answer review question.'); const now = this.now(); const state = this.require(); const next = submitWrongAnswerReviewAnswer(state, createVocabularyWrongAnswerEvidence({ identity: question.identity, source: 'wrong-answer-review', taskOrSessionId: state.activeRound!.roundId, questionId: question.questionId, submittedAt: now, correct: selectedOptionId === question.correctOptionId })); await this.options.state.save(next.state); this.state = next.state; return next.state }
  async advance(): Promise<WrongAnswerLibraryState> { const next = advanceWrongAnswerReviewRound(this.require(), this.now()); await this.options.state.save(next); this.state = next; return next }
}
