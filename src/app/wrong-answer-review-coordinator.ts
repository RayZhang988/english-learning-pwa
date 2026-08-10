import { browserListeningSpeech, ListeningWrongAnswerReviewRuntime, type ListeningSpeechPort, type ListeningWrongAnswerReviewSnapshot } from '../features/listening/index.ts'
import { SpeakingWrongAnswerReviewRuntime, type SpeakingRecognitionPort, type SpeakingRecordingPort, type SpeakingWrongAnswerReviewView } from '../features/speaking/index.ts'
import { VocabularyWrongAnswerReviewRuntime, type VocabularyReviewQuestion } from '../features/vocabulary/index.ts'
import { assertRecoverableWrongAnswerReviewRound, startWrongAnswerReviewRound, updateWrongAnswerReviewRoundSnapshot, type WrongAnswerLibraryState, type WrongAnswerLibraryStatePort, type WrongAnswerRecord } from '../learning-engine/index.ts'
import type { ResolvedWrongAnswerReviewContent } from './wrong-answer-review-content-resolver.ts'

const VOCABULARY_DRAFT_PREFIX = 'vocabulary-wrong-answer-review:v1:'
function vocabularyDraft(value: string | readonly string[] | null): string | null { return typeof value === 'string' && value.startsWith(VOCABULARY_DRAFT_PREFIX) ? value.slice(VOCABULARY_DRAFT_PREFIX.length) || null : null }
function activeRecord(state: WrongAnswerLibraryState): WrongAnswerRecord | null { const round = assertRecoverableWrongAnswerReviewRound(state); return round?.status === 'active' ? state.records[round.order[round.index]!] ?? null : null }

export type WrongAnswerReviewActive =
  | { readonly kind: 'vocabulary'; readonly record: WrongAnswerRecord; readonly question: VocabularyReviewQuestion; readonly selectedOptionId: string | null }
  | { readonly kind: 'listening'; readonly record: WrongAnswerRecord; readonly snapshot: ListeningWrongAnswerReviewSnapshot }
  | { readonly kind: 'speaking'; readonly record: WrongAnswerRecord; readonly view: SpeakingWrongAnswerReviewView }
export interface WrongAnswerReviewCoordinatorSnapshot { readonly status: 'loading' | 'ready' | 'error'; readonly library: WrongAnswerLibraryState | null; readonly active: WrongAnswerReviewActive | null; readonly busy: boolean; readonly error: Error | null }

export interface WrongAnswerReviewCoordinatorOptions {
  readonly state: WrongAnswerLibraryStatePort
  readonly resolver: { resolve(record: WrongAnswerRecord): Promise<ResolvedWrongAnswerReviewContent> }
  readonly listeningSpeech?: ListeningSpeechPort
  readonly speaking?: { readonly recorder?: SpeakingRecordingPort; readonly recognition?: SpeakingRecognitionPort; readonly requestMicrophone?: () => Promise<MediaStream> }
  readonly now?: () => string
}

type Runtime =
  | { readonly kind: 'vocabulary'; readonly value: VocabularyWrongAnswerReviewRuntime }
  | { readonly kind: 'listening'; readonly value: ListeningWrongAnswerReviewRuntime }
  | { readonly kind: 'speaking'; readonly value: SpeakingWrongAnswerReviewRuntime }

export class WrongAnswerReviewCoordinator {
  readonly #options: WrongAnswerReviewCoordinatorOptions
  readonly #listeners = new Set<() => void>()
  readonly #now: () => string
  #runtime: Runtime | null = null
  #generation = 0
  snapshot: WrongAnswerReviewCoordinatorSnapshot = { status: 'loading', library: null, active: null, busy: false, error: null }
  constructor(options: WrongAnswerReviewCoordinatorOptions) { this.#options = options; this.#now = options.now ?? (() => new Date().toISOString()) }
  subscribe(listener: () => void) { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  #set(snapshot: WrongAnswerReviewCoordinatorSnapshot) { this.snapshot = snapshot; for (const listener of this.#listeners) listener(); return snapshot }
  #disposeRuntime() { if (this.#runtime?.kind === 'listening') this.#runtime.value.dispose(); if (this.#runtime?.kind === 'speaking') this.#runtime.value.cancelRecording(); this.#runtime = null }
  async initialize(): Promise<WrongAnswerReviewCoordinatorSnapshot> {
    const generation = ++this.#generation; this.#disposeRuntime(); this.#set({ ...this.snapshot, status: 'loading', active: null, busy: false, error: null })
    try {
      const library = await this.#options.state.load()
      this.#set({ status: 'loading', library, active: null, busy: false, error: null })
      const record = activeRecord(library)
      if (!record) return this.#set({ status: 'ready', library, active: null, busy: false, error: null })
      const content = await this.#options.resolver.resolve(record); if (generation !== this.#generation) return this.snapshot
      if (content.kind !== record.domain) throw new TypeError('Wrong-answer content domain drift.')
      if (content.kind === 'vocabulary') {
        const runtime = new VocabularyWrongAnswerReviewRuntime({ state: this.#options.state, now: this.#now, resolve: async () => content.question })
        await runtime.initialize(); const question = await runtime.currentQuestion(); if (!question) throw new TypeError('Vocabulary review question is unavailable.')
        this.#runtime = { kind: 'vocabulary', value: runtime }
        return this.#set({ status: 'ready', library: await this.#options.state.load(), active: { kind: 'vocabulary', record, question, selectedOptionId: vocabularyDraft(library.activeRound?.answerDraft ?? null) }, busy: false, error: null })
      }
      if (content.kind === 'listening') {
        const runtime = new ListeningWrongAnswerReviewRuntime({ record, state: this.#options.state, speech: this.#options.listeningSpeech ?? browserListeningSpeech, now: this.#now, resolve: async () => content, onView: (view) => { if (this.#runtime?.kind === 'listening' && this.snapshot.active?.kind === 'listening') this.#set({ ...this.snapshot, active: { ...this.snapshot.active, snapshot: view } }) } })
        const view = await runtime.initialize(); this.#runtime = { kind: 'listening', value: runtime }
        return this.#set({ status: 'ready', library: await this.#options.state.load(), active: { kind: 'listening', record, snapshot: view }, busy: false, error: null })
      }
      const runtime = new SpeakingWrongAnswerReviewRuntime(this.#options.state, async () => content.prompt, { ...this.#options.speaking, onView: (view) => { if (this.#runtime?.kind === 'speaking' && this.snapshot.active?.kind === 'speaking') this.#set({ ...this.snapshot, library: view.library, active: { ...this.snapshot.active, view } }) } })
      const view = await runtime.initialize(); this.#runtime = { kind: 'speaking', value: runtime }
      return this.#set({ status: 'ready', library: view.library, active: { kind: 'speaking', record, view }, busy: false, error: null })
    } catch (error) { return this.#set({ status: 'error', library: this.snapshot.library, active: this.snapshot.active, busy: false, error: error instanceof Error ? error : new Error('错题复习发生未知错误。') }) }
  }
  async #operation(run: () => Promise<unknown>, reload = true) { if (this.snapshot.busy) return this.snapshot; this.#set({ ...this.snapshot, busy: true, error: null }); try { await run(); return reload ? this.initialize() : this.#set({ ...this.snapshot, library: await this.#options.state.load(), busy: false }) } catch (error) { return this.#set({ ...this.snapshot, status: 'error', busy: false, error: error instanceof Error ? error : new Error('保存失败。') }) } }
  #interactionError(error: unknown) { return this.#set({ ...this.snapshot, status: 'error', busy: false, error: error instanceof Error ? error : new Error('操作保存失败。') }) }
  async selectVocabulary(optionId: string) { const active = this.snapshot.active; if (active?.kind !== 'vocabulary' || !active.question.options.some((option) => option.id === optionId)) throw new TypeError('Vocabulary option is unavailable.'); try { const library = await this.#options.state.update((latest) => { const round = assertRecoverableWrongAnswerReviewRound(latest); if (!round || round.stage !== 'answering' || round.order[round.index] !== active.record.recordId) throw new TypeError('Stale vocabulary review interaction.'); return updateWrongAnswerReviewRoundSnapshot(latest, { ...round, answerDraft: `${VOCABULARY_DRAFT_PREFIX}${optionId}`, updatedAt: this.#now() }) }); return this.#set({ ...this.snapshot, library, active: { ...active, selectedOptionId: optionId } }) } catch (error) { return this.#interactionError(error) } }
  submit() { const active = this.snapshot.active; const runtime = this.#runtime; if (!active) return Promise.resolve(this.snapshot); if (active.kind === 'vocabulary' && runtime?.kind === 'vocabulary' && active.selectedOptionId) return this.#operation(() => runtime.value.submit(active.selectedOptionId!)); if (active.kind === 'listening' && runtime?.kind === 'listening') return this.#operation(() => runtime.value.submit(), false); throw new TypeError('The active review item cannot use submit.') }
  advance() { const runtime = this.#runtime; if (runtime?.kind === 'vocabulary') return this.#operation(() => runtime.value.advance()); if (runtime?.kind === 'listening') return this.#operation(() => runtime.value.advance()); if (runtime?.kind === 'speaking') return this.#operation(() => runtime.value.advance(this.#now())); throw new TypeError('Review runtime is unavailable.') }
  async listening(action: 'toggle' | 'retry') { if (this.#runtime?.kind !== 'listening') throw new TypeError('Listening review is unavailable.'); try { const runtime = this.#runtime.value; if (action === 'retry') await runtime.retryPlayback(); else await runtime.togglePlayback(); return this.#refreshActive() } catch (error) { return this.#interactionError(error) } }
  async setListeningRate(rate: number) { if (this.#runtime?.kind !== 'listening') throw new TypeError('Listening review is unavailable.'); try { await this.#runtime.value.setRate(rate); return this.#refreshActive() } catch (error) { return this.#interactionError(error) } }
  async setListeningRepeat(mode: ListeningWrongAnswerReviewSnapshot['playback']['repeatMode']) { if (this.#runtime?.kind !== 'listening') throw new TypeError('Listening review is unavailable.'); try { await this.#runtime.value.setRepeatMode(mode); return this.#refreshActive() } catch (error) { return this.#interactionError(error) } }
  async selectListeningSegment(segmentId: string) { if (this.#runtime?.kind !== 'listening') throw new TypeError('Listening review is unavailable.'); try { await this.#runtime.value.selectSegment(segmentId); return this.#refreshActive() } catch (error) { return this.#interactionError(error) } }
  async selectListening(optionId: string) { if (this.#runtime?.kind !== 'listening') throw new TypeError('Listening review is unavailable.'); try { await this.#runtime.value.select(optionId); return this.#refreshActive() } catch (error) { return this.#interactionError(error) } }
  async changeListening(value: string) { if (this.#runtime?.kind !== 'listening') throw new TypeError('Listening review is unavailable.'); try { await this.#runtime.value.changeDictation(value); return this.#refreshActive() } catch (error) { return this.#interactionError(error) } }
  async #refreshActive() { const active = this.snapshot.active; if (active?.kind === 'listening' && this.#runtime?.kind === 'listening') return this.#set({ ...this.snapshot, active: { ...active, snapshot: this.#runtime.value.currentSnapshot! } }); return this.snapshot }
  async startSpeaking() { if (this.#runtime?.kind !== 'speaking') throw new TypeError('Speaking review is unavailable.'); try { await this.#runtime.value.startRecording(); return this.snapshot } catch (error) { return this.#interactionError(error) } }
  async stopSpeaking() { const active = this.snapshot.active; if (active?.kind !== 'speaking' || this.#runtime?.kind !== 'speaking' || !this.snapshot.library?.activeRound) throw new TypeError('Speaking review is unavailable.'); try { await this.#runtime.value.stopRecording(`speaking-review:${this.snapshot.library.activeRound.roundId}:${active.record.recordId}`, this.#now()); return this.snapshot } catch (error) { return this.#interactionError(error) } }
  async playSpeaking() { if (this.#runtime?.kind !== 'speaking') throw new TypeError('Speaking review is unavailable.'); try { await this.#runtime.value.playRecording(); return this.snapshot } catch (error) { return this.#interactionError(error) } }
  retrySpeaking() { if (this.#runtime?.kind !== 'speaking') throw new TypeError('Speaking review is unavailable.'); this.#runtime.value.cancelRecording(); return this.snapshot }
  async startNewRound(input: { readonly roundId: string; readonly seed: string; readonly startedAt: string }) {
    if (this.snapshot.busy) return this.snapshot
    this.#set({ ...this.snapshot, busy: true, error: null })
    try {
      await this.#options.state.update((state) => startWrongAnswerReviewRound(state, input))
      return this.initialize()
    } catch (error) {
      return this.#set({ ...this.snapshot, status: 'error', busy: false, error: error instanceof Error ? error : new Error('无法开始新一轮复习。') })
    }
  }
  dispose() { this.#generation += 1; this.#disposeRuntime(); this.#listeners.clear() }
}
