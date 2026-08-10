import {
  resolveListeningWrongAnswerReviewItem,
  type ListeningCatalog,
  type ListeningQuestion,
  type ListeningSupplyItem,
  type ListeningTrainingUnit,
} from '../features/listening/index.ts'
import {
  resolveSpeakingSupplyPrompt,
  SpeakingWrongAnswerContentResolver,
  type SpeakingCatalog,
  type SpeakingPrompt,
  type SpeakingSupplyItem,
} from '../features/speaking/index.ts'
import {
  resolveDailyVocabularyReviewContent,
  resolveSceneVocabularyReviewQuestion,
  type ReviewContentIndex,
  type SceneVocabularyQuestionBank,
  type VocabularyCatalog,
  type VocabularyReviewQuestion,
  type VocabularySupplyItem,
} from '../features/vocabulary/index.ts'
import type { WrongAnswerRecord } from '../learning-engine/index.ts'
import { sceneVocabularyContentSource } from './scene-vocabulary-content-source.ts'
import { listeningContentSource, speakingContentSource, vocabularyContentSource } from './learning/training-production-resources.ts'
import { reviewContentSource } from './review-content-source.ts'
import type { ProductionReviewContentIndex } from './review-content-source.ts'

interface Loadable<T> { load(): Promise<T> }
export type ResolvedWrongAnswerReviewContent =
  | { readonly kind: 'vocabulary'; readonly question: VocabularyReviewQuestion }
  | { readonly kind: 'listening'; readonly identity: { readonly reviewContentId: string; readonly originalQuestionType: string }; readonly unit: ListeningTrainingUnit; readonly question: ListeningQuestion }
  | { readonly kind: 'speaking'; readonly prompt: SpeakingPrompt }

export interface WrongAnswerReviewContentResolverSources {
  readonly index: Loadable<ProductionReviewContentIndex>
  readonly vocabulary: Loadable<VocabularyCatalog>
  readonly sceneVocabulary: Loadable<SceneVocabularyQuestionBank>
  readonly listening: Loadable<ListeningCatalog>
  readonly speaking: Loadable<SpeakingCatalog>
}

function alias(index: ProductionReviewContentIndex, record: WrongAnswerRecord) {
  const matches = Object.values(index.aliases).filter((value) => value.reviewContentId === record.reviewContentId && value.originalQuestionType === record.originalQuestionType && value.domain === record.domain)
  if (matches.length !== 1) throw new TypeError('Wrong-answer record has no unique released alias.')
  return matches[0]!
}

function supplyItem<T>(value: unknown, itemId: string, domain: string): T {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { candidates?: unknown }).candidates)) throw new TypeError(`${domain} training supply index is unavailable.`)
  const matches = (value as { candidates: readonly unknown[] }).candidates.filter((candidate) => candidate && typeof candidate === 'object' && (candidate as { itemId?: unknown }).itemId === itemId && (candidate as { domain?: unknown }).domain === domain)
  if (matches.length !== 1) throw new TypeError(`${domain} review item is unavailable.`)
  return matches[0] as T
}

const productionSources: WrongAnswerReviewContentResolverSources = { index: reviewContentSource, vocabulary: vocabularyContentSource, sceneVocabulary: sceneVocabularyContentSource, listening: listeningContentSource, speaking: speakingContentSource }

export class ProductionWrongAnswerReviewContentResolver {
  readonly #sources: WrongAnswerReviewContentResolverSources
  constructor(sources: WrongAnswerReviewContentResolverSources = productionSources) { this.#sources = sources }
  async resolve(record: WrongAnswerRecord): Promise<ResolvedWrongAnswerReviewContent> {
    const index = await this.#sources.index.load(); const released = alias(index, record)
    if (record.domain === 'vocabulary') {
      if (released.source.kind === 'scene-vocabulary-bank') return { kind: 'vocabulary', question: resolveSceneVocabularyReviewQuestion(index as unknown as ReviewContentIndex, await this.#sources.sceneVocabulary.load(), record) }
      if (released.source.kind !== 'daily-supply' || typeof released.source.itemId !== 'string') throw new TypeError('Vocabulary review alias source is unsupported.')
      const catalog = await this.#sources.vocabulary.load(); const item = supplyItem<VocabularySupplyItem>(catalog.trainingSupplyIndex, released.source.itemId, 'vocabulary')
      const resolved = resolveDailyVocabularyReviewContent(index as unknown as ReviewContentIndex, item, catalog)
      return { kind: 'vocabulary', question: { identity: resolved.identity, questionId: resolved.question.id, correctOptionId: resolved.question.correctOptionId, prompt: resolved.question.prompt, options: resolved.question.options } }
    }
    if (released.source.kind !== 'daily-supply' || typeof released.source.itemId !== 'string') throw new TypeError('Review alias source is unsupported.')
    if (record.domain === 'listening') {
      const catalog = await this.#sources.listening.load(); const item = supplyItem<ListeningSupplyItem>(catalog.trainingSupplyIndex, released.source.itemId, 'listening')
      return { kind: 'listening', ...resolveListeningWrongAnswerReviewItem(catalog, item, released) }
    }
    const catalog = await this.#sources.speaking.load(); const item = supplyItem<SpeakingSupplyItem>(catalog.trainingSupplyIndex, released.source.itemId, 'speaking')
    const identity = new SpeakingWrongAnswerContentResolver(index).resolveItem(item)
    if (identity.reviewContentId !== record.reviewContentId || identity.originalQuestionType !== record.originalQuestionType) throw new TypeError('Speaking review identity drift.')
    return { kind: 'speaking', prompt: resolveSpeakingSupplyPrompt(catalog, item).prompt }
  }
}

export const wrongAnswerReviewContentResolver = new ProductionWrongAnswerReviewContentResolver()
