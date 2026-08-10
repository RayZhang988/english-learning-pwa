import { SpeakingWrongAnswerContentResolver, type SpeakingWrongAnswerEvidenceSink, type SpeakingWrongAnswerIdentityResolver } from '../features/speaking/index.ts'
import type { ListeningSupplyItem } from '../features/listening/index.ts'
import type { ReviewContentIndex, WrongAnswerEvidenceSink } from '../features/vocabulary/index.ts'
import type { ReviewContentIdentity, WrongAnswerEvidence } from '../learning-engine/index.ts'
import { reviewContentSource } from './review-content-source.ts'
import type { ProductionReviewContentIndex } from './review-content-source.ts'
import { wrongAnswerLibraryStore } from './wrong-answer-library-store.ts'

export class ProductionWrongAnswerEvidencePorts {
  readonly #source: { load(): Promise<ProductionReviewContentIndex> }
  readonly #store: { publish(evidence: WrongAnswerEvidence): Promise<unknown> }
  #index: ProductionReviewContentIndex | null = null
  #speaking: SpeakingWrongAnswerContentResolver | null = null
  #vocabularyPort: { readonly index: ReviewContentIndex; readonly sink: WrongAnswerEvidenceSink } | null = null
  #speakingPort: { readonly resolver: SpeakingWrongAnswerIdentityResolver; readonly sink: SpeakingWrongAnswerEvidenceSink } | null = null
  #loading: Promise<void> | null = null
  constructor(
    source: { load(): Promise<ProductionReviewContentIndex> } = reviewContentSource,
    store: { publish(evidence: WrongAnswerEvidence): Promise<unknown> } = wrongAnswerLibraryStore,
  ) {
    this.#source = source
    this.#store = store
  }
  initialize(): Promise<void> {
    if (this.#index) return Promise.resolve()
    if (!this.#loading) this.#loading = this.#source.load().then((index) => {
      this.#index = index
      this.#speaking = new SpeakingWrongAnswerContentResolver(index)
      this.#vocabularyPort = { index: index as unknown as ReviewContentIndex, sink: { publish: async (evidence) => { await this.#store.publish(evidence) } } }
      this.#speakingPort = { resolver: this.#speaking, sink: { publishWrongAnswerEvidence: async (evidence) => { await this.#store.publish(evidence) } } }
    }).finally(() => { this.#loading = null })
    return this.#loading
  }
  get vocabulary(): { readonly index: ReviewContentIndex; readonly sink: WrongAnswerEvidenceSink } { if (!this.#vocabularyPort) throw new TypeError('Wrong-answer evidence index is not initialized.'); return this.#vocabularyPort }
  listeningIdentity(item: ListeningSupplyItem): ReviewContentIdentity | null { if (!this.#index) throw new TypeError('Wrong-answer evidence index is not initialized.'); const alias = this.#index.aliases[`daily:${item.itemId}`]; if (!alias || alias.domain !== 'listening' || alias.source.itemId !== item.itemId) return null; return { reviewContentId: alias.reviewContentId, originalQuestionType: alias.originalQuestionType } }
  publishListening(evidence: WrongAnswerEvidence): Promise<void> { return this.#store.publish(evidence).then(() => undefined) }
  get speaking(): { readonly resolver: SpeakingWrongAnswerIdentityResolver; readonly sink: SpeakingWrongAnswerEvidenceSink } { if (!this.#speakingPort) throw new TypeError('Wrong-answer evidence index is not initialized.'); return this.#speakingPort }
}

export const productionWrongAnswerEvidencePorts = new ProductionWrongAnswerEvidencePorts()
