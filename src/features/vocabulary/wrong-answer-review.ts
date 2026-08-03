import type { WrongAnswerEvidence, WrongAnswerSource } from '../../learning-engine/index.ts'
import { VocabularyError } from './errors.ts'
import { buildVocabularySupplyQuestion } from './questions.ts'
import type { VocabularyCatalog, VocabularyQuestion, VocabularySupplyItem } from './types.ts'
import type { SceneVocabularyQuestion } from './scene-vocabulary-practice.ts'

export interface WrongAnswerEvidenceSink { publish(evidence: WrongAnswerEvidence): Promise<void> }

export interface ReviewContentAlias {
  readonly reviewContentId: string
  readonly originalQuestionType: string
  readonly domain: 'vocabulary'
  readonly source: Readonly<Record<string, string>>
}
export interface ReviewContentIndex { readonly schemaVersion: 1; readonly documentType: 'review-content-index'; readonly contentVersion: '1.0.0'; readonly aliases: Readonly<Record<string, ReviewContentAlias>> }

function aliasForDaily(itemId: string): string { return `daily:${itemId}` }
function aliasForScene(bankId: string, contentVersion: string, questionId: string): string { return `scene:${bankId}@${contentVersion}:${questionId}` }
function requireAlias(index: ReviewContentIndex, alias: string): ReviewContentAlias {
  const value = index.aliases[alias]
  if (!value || value.domain !== 'vocabulary' || !value.reviewContentId || !value.originalQuestionType) throw new VocabularyError('content-invalid', `Review content alias is missing or invalid: ${alias}.`)
  return value
}

/** Strictly resolves a released 05 alias; it never derives identity from display text. */
export function resolveDailyVocabularyReviewContent(index: ReviewContentIndex, item: VocabularySupplyItem, catalog: VocabularyCatalog): { readonly identity: ReviewContentAlias; readonly question: VocabularyQuestion } {
  const identity = requireAlias(index, aliasForDaily(item.itemId))
  if (identity.source.kind !== 'daily-supply' || identity.source.itemId !== item.itemId || identity.source.variantId !== item.source.variantId) throw new VocabularyError('content-invalid', 'Daily review alias does not match the supplied item.')
  const source = catalog.getItem(item.source.sourceId)
  const distractors = item.source.distractorItemIds.map((id) => catalog.getItem(id))
  if (!source || distractors.some((candidate) => !candidate)) throw new VocabularyError('content-reference-missing', 'Daily review content cannot resolve its released source.')
  return { identity, question: buildVocabularySupplyQuestion(item.itemId, source, distractors as never, item.source.variantId) }
}

export function resolveSceneVocabularyReviewContent(index: ReviewContentIndex, bankId: string, contentVersion: string, question: SceneVocabularyQuestion): ReviewContentAlias {
  const identity = requireAlias(index, aliasForScene(bankId, contentVersion, question.questionId))
  if (identity.source.kind !== 'scene-vocabulary-bank' || identity.source.questionId !== question.questionId || identity.originalQuestionType !== 'scene-vocabulary-meaning-choice') throw new VocabularyError('content-invalid', 'Scene review alias does not match the released question.')
  return identity
}

/** Event IDs are answer-attempt identities, so publishing them again after a failed handoff is safe. */
export function createVocabularyWrongAnswerEvidence(input: { readonly identity: ReviewContentAlias; readonly source: WrongAnswerSource; readonly taskOrSessionId: string; readonly questionId: string; readonly submittedAt: string; readonly correct: boolean }): WrongAnswerEvidence {
  return { schemaVersion: 1, eventId: `wrong-answer:vocabulary:${input.source}:${input.taskOrSessionId}:${input.questionId}:${input.submittedAt}`, reviewContentId: input.identity.reviewContentId, originalQuestionType: input.identity.originalQuestionType, domain: 'vocabulary', source: input.source, outcome: input.correct ? 'correct' : 'incorrect', formallyScored: true, occurredAt: input.submittedAt }
}
