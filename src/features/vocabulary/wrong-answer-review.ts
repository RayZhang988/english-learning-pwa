import type { WrongAnswerEvidence, WrongAnswerSource } from '../../learning-engine/index.ts'
import { VocabularyError } from './errors.ts'
import { buildVocabularySupplyQuestion } from './questions.ts'
import type { VocabularyCatalog, VocabularyQuestion, VocabularySupplyItem } from './types.ts'
import type { SceneVocabularyQuestion, SceneVocabularyQuestionBank } from './scene-vocabulary-practice.ts'
import type { VocabularyReviewQuestion } from './wrong-answer-review-runtime.ts'

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

function sceneReviewQuestion(identity: ReviewContentAlias, question: SceneVocabularyQuestion): VocabularyReviewQuestion {
  const targetIndex = question.sentenceEn.toLocaleLowerCase('en-US').indexOf(question.targetText.toLocaleLowerCase('en-US'))
  const meanings = [question.correctMeaningZh, ...question.distractorMeaningsZh]
  let hash = 0
  for (const character of question.questionId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const offset = hash % meanings.length
  const ordered = [...meanings.slice(offset), ...meanings.slice(0, offset)]
  const options = ordered.map((label, index) => ({ id: `${question.questionId}:meaning:${index + 1}`, label }))
  const correctOption = options.find((option) => option.label === question.correctMeaningZh)
  if (!correctOption || targetIndex < 0) throw new VocabularyError('content-invalid', 'Scene review question cannot reproduce its released interaction.')
  return {
    identity,
    questionId: question.questionId,
    correctOptionId: correctOption.id,
    prompt: '这个词是什么意思？',
    options,
    scenePresentation: {
      sentenceEn: {
        beforeTarget: question.sentenceEn.slice(0, targetIndex),
        targetText: question.targetText,
        afterTarget: question.sentenceEn.slice(targetIndex + question.targetText.length),
      },
      targetPlayback: { intent: 'play-target-only', text: question.targetText, locale: 'en-US' },
    },
  }
}

/** Resolves a stable library identity directly to the released R13-B scene question and interaction. */
export function resolveSceneVocabularyReviewQuestion(
  index: ReviewContentIndex,
  bank: SceneVocabularyQuestionBank,
  requested: { readonly reviewContentId: string; readonly originalQuestionType: string },
): VocabularyReviewQuestion {
  const matches = Object.values(index.aliases).filter((alias) =>
    alias.domain === 'vocabulary' &&
    alias.reviewContentId === requested.reviewContentId &&
    alias.originalQuestionType === requested.originalQuestionType &&
    alias.source.kind === 'scene-vocabulary-bank',
  )
  if (matches.length !== 1) throw new VocabularyError('content-invalid', 'Scene review identity must resolve to exactly one released alias.')
  const identity = matches[0]!
  const questionId = identity.source.questionId
  const question = bank.scenes.flatMap((scene) => scene.questions).find((candidate) => candidate.questionId === questionId)
  if (!question) throw new VocabularyError('content-reference-missing', 'Scene review question is missing from the released bank.')
  const verified = resolveSceneVocabularyReviewContent(index, bank.bankId, bank.contentVersion, question)
  return sceneReviewQuestion(verified, question)
}

/** Event IDs are answer-attempt identities, so publishing them again after a failed handoff is safe. */
export function createVocabularyWrongAnswerEvidence(input: { readonly identity: ReviewContentAlias; readonly source: WrongAnswerSource; readonly taskOrSessionId: string; readonly questionId: string; readonly submittedAt: string; readonly correct: boolean }): WrongAnswerEvidence {
  return { schemaVersion: 1, eventId: `wrong-answer:vocabulary:${input.source}:${input.taskOrSessionId}:${input.questionId}:${input.submittedAt}`, reviewContentId: input.identity.reviewContentId, originalQuestionType: input.identity.originalQuestionType, domain: 'vocabulary', source: input.source, outcome: input.correct ? 'correct' : 'incorrect', formallyScored: true, occurredAt: input.submittedAt }
}
