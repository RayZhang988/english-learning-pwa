import type {
  ExtraTrainingEvent,
  ExtraTrainingSession,
  ExtraTrainingSupplyRequest,
  LearningTaskSupplyResult,
} from '../../learning-engine/index.ts'
import { migrateExtraTrainingSessionToOpenEnded } from '../../learning-engine/index.ts'
import type {
  ExtraTrainingEffectiveTimingSessionFactoryPort,
  ExtraTrainingEventSink,
} from '../../platform/index.ts'
import type { VocabularyQuestion, VocabularySupplyItem } from './types.ts'
import { judgeVocabularyAnswer } from './questions.ts'
import { VocabularyError } from './errors.ts'
import { ExtraVocabularyTrainingRepository } from './extra-training-repository.ts'

/** Module-owned, JSON-portable checkpoint. It deliberately has no daily task identity. */
export interface ExtraVocabularyTrainingSnapshot {
  readonly schemaVersion: 1
  readonly session: ExtraTrainingSession
  readonly question: VocabularyQuestion | null
  readonly activeItem: VocabularySupplyItem | null
  readonly activeRequestId?: string | null
  readonly suppliedNextCursor?: string | null
  readonly selectedOptionId: string | null
  readonly phase: 'answering' | 'feedback' | 'paused' | 'completed' | 'error'
  readonly pendingEvents: readonly ExtraTrainingEvent[]
  readonly updatedAt: string
}

export interface ExtraVocabularySupplyProvider {
  next(request: ExtraTrainingSupplyRequest): Promise<LearningTaskSupplyResult>
}

export interface ExtraVocabularyTrainingRuntimeOptions {
  readonly session: ExtraTrainingSession
  /** Builds each request from the persisted session, never a stale closure. */
  readonly supplyRequest: (session: ExtraTrainingSession) => ExtraTrainingSupplyRequest | null
  readonly supplyProvider: ExtraVocabularySupplyProvider
  readonly timingSessionFactory: ExtraTrainingEffectiveTimingSessionFactoryPort
  readonly eventSink: ExtraTrainingEventSink
  readonly questionForItem: (item: VocabularySupplyItem) => Promise<VocabularyQuestion>
  readonly repository?: ExtraVocabularyTrainingRepository
  readonly now?: () => string
  readonly createId?: () => string
}

export class ExtraVocabularyTrainingRuntime {
  private snapshot: ExtraVocabularyTrainingSnapshot | null = null
  private tail: Promise<void> = Promise.resolve()
  private readonly repository: ExtraVocabularyTrainingRepository
  private readonly now: () => string
  private readonly createId: () => string
  private readonly options: ExtraVocabularyTrainingRuntimeOptions
  private timing: Awaited<ReturnType<ExtraTrainingEffectiveTimingSessionFactoryPort['create']>> | null = null
  constructor(options: ExtraVocabularyTrainingRuntimeOptions) {
    this.options = options
    this.repository = options.repository ?? new ExtraVocabularyTrainingRepository()
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? (() => crypto.randomUUID())
  }
  get currentSnapshot() { return this.snapshot }
  private queue<T>(operation: () => Promise<T>): Promise<T> { const result = this.tail.then(operation, operation); this.tail = result.then(() => undefined, () => undefined); return result }
  private base(type: ExtraTrainingEvent['type']): ExtraTrainingEvent {
    const session = this.options.session
    return { id: `extra-vocabulary:${session.sessionId}:${this.createId()}`, type, sourceModuleId: 'vocabulary', occurredAt: this.now(), schemaVersion: 1, payload: { sessionId: session.sessionId, localDate: session.localDate, domain: 'vocabulary', targetModuleId: 'vocabulary', mode: 'learn' } } as ExtraTrainingEvent
  }
  private async save(snapshot: ExtraVocabularyTrainingSnapshot) { this.snapshot = snapshot; await this.repository.save(snapshot); return snapshot }
  async initialize(): Promise<ExtraVocabularyTrainingSnapshot> { return this.queue(async () => {
    this.timing ??= await this.options.timingSessionFactory.create(this.options.session)
    const restored = await this.repository.load(this.options.session.sessionId)
    if (restored) {
      return this.save({
        ...restored,
        session: migrateExtraTrainingSessionToOpenEnded(
          restored.session,
          this.now(),
        ),
        updatedAt: this.now(),
      })
    }
    const started = this.base('learning.extra-training.started.v1')
    const snapshot: ExtraVocabularyTrainingSnapshot = { schemaVersion: 1, session: this.options.session, question: null, activeItem: null, selectedOptionId: null, phase: 'answering', pendingEvents: [started], updatedAt: this.now() }
    return this.save(snapshot)
  }) }
  async startTiming() { return this.queue(async () => { this.timing ??= await this.options.timingSessionFactory.create(this.options.session); await this.timing.start({ phase: 'answering', reason: 'active-answering' }); return this.require() }) }
  async feedbackTiming() { return this.queue(async () => { await this.timing?.transition({ phase: 'feedback', reason: 'active-feedback' }); return this.require() }) }
  async pauseTiming() { return this.queue(async () => { await this.timing?.pause(); return this.require() }) }
  async finishTiming() { return this.queue(async () => { await this.timing?.finish(); return this.require() }) }
  async flush(): Promise<ExtraVocabularyTrainingSnapshot> { return this.queue(async () => {
    let snapshot = this.require()
    for (const event of snapshot.pendingEvents) { await this.options.eventSink.publishExtraTrainingEvent(event); snapshot = { ...snapshot, pendingEvents: snapshot.pendingEvents.filter((candidate) => candidate.id !== event.id), updatedAt: this.now() }; await this.save(snapshot) }
    return snapshot
  }) }
  private require() { if (!this.snapshot) throw new VocabularyError('session-transition-invalid', 'Extra vocabulary runtime is not initialized.'); return this.snapshot }
  select(optionId: string) { return this.queue(async () => { const snapshot = this.require(); if (!snapshot.question || !snapshot.question.options.some((option) => option.id === optionId)) throw new VocabularyError('session-transition-invalid', 'Option does not belong to extra vocabulary question.'); return this.save({ ...snapshot, selectedOptionId: optionId, updatedAt: this.now() }) }) }
  submit() { return this.queue(async () => { const snapshot = this.require(); if (!snapshot.question || snapshot.selectedOptionId === null) throw new VocabularyError('session-transition-invalid', 'Select an answer before submitting.'); await this.timing?.transition({ phase: 'feedback', reason: 'active-feedback' }); return this.save({ ...snapshot, phase: 'feedback', updatedAt: this.now() }) }) }
  answerIsCorrect() { const snapshot = this.require(); return snapshot.question !== null && snapshot.selectedOptionId !== null && judgeVocabularyAnswer(snapshot.question, snapshot.selectedOptionId) }
  /** @deprecated R6.1 extra practice has no time budget to reach. */
  markBudgetReached() { return Promise.resolve(this.require()) }
  recordEffectiveSeconds(seconds: number) { return this.queue(async () => { const snapshot = this.require(); if (!Number.isFinite(seconds) || seconds < 0) throw new VocabularyError('session-transition-invalid', 'Effective seconds must be non-negative.'); return this.save({ ...snapshot, session: { ...snapshot.session, effectiveSeconds: (snapshot.session.effectiveSeconds ?? 0) + Math.floor(seconds), updatedAt: this.now() }, updatedAt: this.now() }) }) }
  private async retryNow(snapshot: ExtraVocabularyTrainingSnapshot): Promise<ExtraVocabularyTrainingSnapshot> {
    if (snapshot.session.endReason !== 'content-exhausted' && snapshot.session.endReason !== 'provider-failure' && snapshot.session.endReason !== 'device-failure') {
      throw new VocabularyError('session-transition-invalid', 'Only a failed extra vocabulary session can retry.')
    }
    const resumableSession: ExtraTrainingSession = { ...snapshot.session, status: 'running', endReason: null, endedAt: null, updatedAt: this.now() }
    const request = this.options.supplyRequest(resumableSession)
    if (!request) throw new VocabularyError('session-transition-invalid', 'Extra vocabulary session cannot retry content.')
    const result = await this.options.supplyProvider.next(request)
    if (result.status !== 'item') return snapshot
    const item = result.item as VocabularySupplyItem
    const question = await this.options.questionForItem(item)
    const started = this.base('learning.extra-training.started.v1')
    return this.save({ ...snapshot, question, activeItem: item, activeRequestId: result.requestId, suppliedNextCursor: result.nextCursor, selectedOptionId: null, phase: 'answering', pendingEvents: [...snapshot.pendingEvents, started], session: { ...resumableSession, updatedAt: started.occurredAt }, updatedAt: started.occurredAt })
  }
  /** Retries a failed extra session without replacing its cursor, exclusions or outbox. */
  retry() { return this.queue(async () => this.retryNow(this.require())) }
  /** @deprecated Use retry(), which also supports provider/device failures. */
  retryContent() { return this.retry() }
  private async completeCurrentItemNow(snapshot: ExtraVocabularyTrainingSnapshot): Promise<ExtraVocabularyTrainingSnapshot> {
    if (snapshot.phase !== 'feedback' || !snapshot.activeItem) throw new VocabularyError('session-transition-invalid', 'Extra vocabulary item must be in feedback before completion.')
    const base = this.base('learning.extra-training.item.completed.v1')
    const question = snapshot.question
    const correct = this.answerIsCorrect()
    const attempt = { ...this.base('learning.extra-training.attempt.completed.v1'), payload: { ...base.payload, learningUnitId: snapshot.activeItem.learningUnitId, contentRef: snapshot.activeItem.contentRef, difficultyLevel: snapshot.activeItem.difficultyLevel, estimatedSeconds: 1, result: 'scored', performanceScore: correct ? 1 : 0, evidenceQuality: 1, assistanceLevel: 0, durationSeconds: 0, errorTags: correct ? [] : [question!.errorTag], contentTags: snapshot.activeItem.tags, failureCategory: null, scoreDelta: { schemaVersion: 1, correctCount: correct ? 1 : 0, incorrectCount: correct ? 0 : 1, unscorableCount: 0 } } } as ExtraTrainingEvent
    const event = { ...base, payload: { ...base.payload, item: snapshot.activeItem, requestId: snapshot.activeRequestId ?? `${snapshot.session.sessionId}:supply`, nextSupplyCursor: snapshot.suppliedNextCursor ?? snapshot.activeItem.itemId } } as ExtraTrainingEvent
    const count = snapshot.session.completedItemCount + 1
    return this.save({ ...snapshot, phase: 'answering', pendingEvents: [...snapshot.pendingEvents, attempt, event], session: { ...snapshot.session, excludeItemIds: [...snapshot.session.excludeItemIds, snapshot.activeItem.itemId], completedItemCount: count, nextSupplyCursor: snapshot.suppliedNextCursor ?? snapshot.activeItem.itemId, status: 'running', endReason: null, endedAt: null, updatedAt: event.occurredAt }, updatedAt: event.occurredAt })
  }
  completeCurrentItem() { return this.queue(async () => this.completeCurrentItemNow(this.require())) }
  private async nextNow(snapshot: ExtraVocabularyTrainingSnapshot): Promise<ExtraVocabularyTrainingSnapshot> {
    const request = this.options.supplyRequest(snapshot.session)
    if (!request) throw new VocabularyError('session-transition-invalid', 'Extra vocabulary session cannot request content.')
    const result = await this.options.supplyProvider.next(request)
    if (result.status !== 'item') {
      const endReason: 'content-exhausted' | 'provider-failure' = result.reason === 'no-eligible-content' || result.reason === 'all-eligible-content-recently-used' ? 'content-exhausted' : 'provider-failure'
      const eventBase = this.base('learning.extra-training.failed.v1')
      const event = { ...eventBase, payload: { ...eventBase.payload, reason: endReason } } as ExtraTrainingEvent
      const failed = { ...snapshot, phase: 'error' as const, pendingEvents: [...snapshot.pendingEvents, event], updatedAt: event.occurredAt, session: { ...snapshot.session, status: 'failed' as const, endReason, endedAt: event.occurredAt, updatedAt: event.occurredAt } }
      return this.save(failed)
    }
    const item = result.item as VocabularySupplyItem
    const question = await this.options.questionForItem(item)
    return this.save({ ...snapshot, question, activeItem: item, activeRequestId: result.requestId, suppliedNextCursor: result.nextCursor, selectedOptionId: null, phase: 'answering', updatedAt: this.now() })
  }
  next() { return this.queue(async () => {
    const snapshot = this.require()
    if (snapshot.session.status === 'completed' || snapshot.session.status === 'failed' || snapshot.session.status === 'expired') return snapshot
    if (snapshot.phase === 'feedback') throw new VocabularyError('session-transition-invalid', 'Complete the current extra vocabulary item before requesting another.')
    return this.nextNow(snapshot)
  }) }
  /** Atomically persists feedback evidence before asking 05 for the next item. */
  advanceAfterFeedback() { return this.queue(async () => {
    const completed = await this.completeCurrentItemNow(this.require())
    return completed.session.status === 'completed' ? completed : this.nextNow(completed)
  }) }
  exit() { return this.queue(async () => { const snapshot = this.require(); if (snapshot.session.status === 'paused' || snapshot.session.status === 'completed') return snapshot; await this.timing?.pause(); const event = this.base('learning.extra-training.exited.v1'); return this.save({ ...snapshot, phase: 'paused', pendingEvents: [...snapshot.pendingEvents, event], session: { ...snapshot.session, status: 'paused', endReason: 'user-exited', endedAt: event.occurredAt, updatedAt: event.occurredAt }, updatedAt: event.occurredAt }) }) }
  resume() { return this.queue(async () => { const snapshot = this.require(); if (snapshot.session.status === 'running') return snapshot; if (snapshot.session.status !== 'paused') throw new VocabularyError('session-transition-invalid', 'Only paused extra vocabulary training can resume.'); const isFeedback = snapshot.question !== null && snapshot.selectedOptionId !== null; await this.timing?.resume(isFeedback ? { phase: 'feedback', reason: 'active-feedback' } : { phase: 'answering', reason: 'active-answering' }); const event = this.base('learning.extra-training.started.v1'); return this.save({ ...snapshot, phase: isFeedback ? 'feedback' : 'answering', pendingEvents: [...snapshot.pendingEvents, event], session: { ...snapshot.session, status: 'running', endReason: null, endedAt: null, updatedAt: event.occurredAt }, updatedAt: event.occurredAt }) }) }
}
