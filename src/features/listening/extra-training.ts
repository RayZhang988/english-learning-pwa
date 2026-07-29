import type {
  ExtraTrainingEvent,
  ExtraTrainingSession,
  ExtraTrainingSupplyRequest,
  LearningTaskSupplyResult,
} from '../../learning-engine/index.ts'
import type {
  ExtraTrainingEffectiveTimingSessionFactoryPort,
  ExtraTrainingEventSink,
} from '../../platform/index.ts'
import { judgeListeningAnswer } from './answers.ts'
import { ExtraListeningTrainingRepository } from './extra-training-repository.ts'
import { ListeningError } from './errors.ts'
import {
  ListeningPlaybackController,
  type ListeningPlaybackLifecycleEvent,
} from './playback-controller.ts'
import { browserListeningSpeech, type ListeningSpeechPort } from './speech-synthesis.ts'
import type {
  ListeningAnswerRecord,
  ListeningPlaybackState,
  ListeningQuestion,
  ListeningRepeatMode,
  ListeningSupplyItem,
  ListeningTrainingUnit,
} from './types.ts'

export interface ExtraListeningTrainingSnapshot {
  readonly schemaVersion: 1
  readonly session: ExtraTrainingSession
  readonly unit: ListeningTrainingUnit | null
  readonly question: ListeningQuestion | null
  readonly activeItem: ListeningSupplyItem | null
  readonly activeRequestId: string | null
  readonly suppliedNextCursor: string | null
  readonly selectedOptionId: string | null
  readonly dictationInput: string
  readonly answer: ListeningAnswerRecord | null
  readonly playback: ListeningPlaybackState | null
  readonly phase: 'answering' | 'feedback' | 'paused' | 'completed' | 'error'
  readonly pendingEvents: readonly ExtraTrainingEvent[]
  readonly updatedAt: string
}

export interface ExtraListeningSupplyProvider {
  next(request: ExtraTrainingSupplyRequest): Promise<LearningTaskSupplyResult>
}

export interface ExtraListeningTrainingRuntimeOptions {
  readonly session: ExtraTrainingSession
  readonly supplyRequest: (session: ExtraTrainingSession) => ExtraTrainingSupplyRequest | null
  readonly supplyProvider: ExtraListeningSupplyProvider
  readonly questionForItem: (item: ListeningSupplyItem) => Promise<{
    readonly unit: ListeningTrainingUnit
    readonly question: ListeningQuestion
  }>
  readonly timingSessionFactory: ExtraTrainingEffectiveTimingSessionFactoryPort
  readonly eventSink: ExtraTrainingEventSink
  readonly speech?: ListeningSpeechPort
  readonly repository?: ExtraListeningTrainingRepository
  readonly now?: () => string
  readonly createId?: () => string
}

function initialPlayback(question: ListeningQuestion): ListeningPlaybackState {
  return {
    status: 'idle', currentSegmentId: question.primarySegmentId,
    rate: question.playbackPolicy.allowedRates.includes(1) ? 1 : question.playbackPolicy.allowedRates[0]!,
    repeatMode: 'none', playCounts: {}, errorMessage: null,
  }
}

/** A listening-only, optional training block. It has no LearningTask, planId, or taskId. */
export class ExtraListeningTrainingRuntime {
  private snapshot: ExtraListeningTrainingSnapshot | null = null
  private tail: Promise<void> = Promise.resolve()
  private playbackWrites: Promise<void> = Promise.resolve()
  private timingWork: Promise<void> = Promise.resolve()
  private audioTimingStarted = false
  private timing: Awaited<ReturnType<ExtraTrainingEffectiveTimingSessionFactoryPort['create']>> | null = null
  private controller: ListeningPlaybackController | null = null
  private readonly repository: ExtraListeningTrainingRepository
  private readonly now: () => string
  private readonly createId: () => string
  private readonly speech: ListeningSpeechPort
  private readonly options: ExtraListeningTrainingRuntimeOptions
  constructor(options: ExtraListeningTrainingRuntimeOptions) {
    this.options = options
    this.repository = options.repository ?? new ExtraListeningTrainingRepository()
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? (() => crypto.randomUUID())
    this.speech = options.speech ?? browserListeningSpeech
  }
  get currentSnapshot() { return this.snapshot }
  private queue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
  private require(): ExtraListeningTrainingSnapshot {
    if (!this.snapshot) throw new ListeningError('session-transition-invalid', 'Extra listening runtime is not initialized.')
    return this.snapshot
  }
  private base(type: ExtraTrainingEvent['type']): ExtraTrainingEvent {
    const s = this.options.session
    return {
      id: `extra-listening:${s.sessionId}:${this.createId()}`, type,
      sourceModuleId: 'listening', occurredAt: this.now(), schemaVersion: 1,
      payload: { sessionId: s.sessionId, localDate: s.localDate, domain: 'listening', targetModuleId: 'listening', mode: 'learn' },
    } as ExtraTrainingEvent
  }
  private async save(snapshot: ExtraListeningTrainingSnapshot) {
    this.snapshot = snapshot
    await this.repository.save(snapshot)
    return snapshot
  }
  private stagePlayback(playback: ListeningPlaybackState) {
    const snapshot = this.snapshot
    if (!snapshot || !snapshot.question) return
    const next = { ...snapshot, playback, updatedAt: this.now() }
    this.snapshot = next
    this.playbackWrites = this.playbackWrites.catch(() => undefined).then(() => this.repository.save(next))
  }
  private stageTiming(event: ListeningPlaybackLifecycleEvent) {
    this.timingWork = this.timingWork.catch(() => undefined).then(async () => {
      if (!this.timing) return
      if (event === 'waiting') await this.timing.transition({ phase: 'loading', reason: 'media-loading' })
      if (event === 'started') {
        if (this.audioTimingStarted) await this.timing.resume({ phase: 'audio-listening', reason: 'active-audio-listening' })
        else { await this.timing.start({ phase: 'audio-listening', reason: 'active-audio-listening' }); this.audioTimingStarted = true }
      }
      if (event === 'resumed') await this.timing.resume({ phase: 'audio-listening', reason: 'active-audio-listening' })
      if (event === 'paused') await this.timing.pause()
      if (event === 'ended' || event === 'canceled' || event === 'error') {
        await this.timing.pause()
        await this.timing.transition({ phase: 'answering', reason: 'active-answering' })
      }
    })
  }
  private attachController(snapshot: ExtraListeningTrainingSnapshot) {
    this.controller?.dispose()
    this.controller = null
    if (!snapshot.question || !snapshot.playback || snapshot.phase === 'completed' || snapshot.phase === 'error') return
    this.controller = new ListeningPlaybackController({
      question: snapshot.question, initialState: snapshot.playback, speech: this.speech,
      onStateChange: (state) => this.stagePlayback(state),
      onPlaybackEvent: (event) => this.stageTiming(event),
      onFailure: () => { void this.failDevice() },
    })
  }
  async initialize(): Promise<ExtraListeningTrainingSnapshot> { return this.queue(async () => {
    this.timing ??= await this.options.timingSessionFactory.create(this.options.session)
    const restored = await this.repository.load(this.options.session.sessionId)
    if (restored) {
      // Browser synthesis cannot honestly resume a previous process after refresh.
      const recovered = restored.playback?.status === 'playing'
        ? { ...restored, playback: { ...restored.playback, status: 'paused' as const }, updatedAt: this.now() }
        : restored
      if (recovered !== restored) await this.save(recovered)
      else this.snapshot = recovered
      this.attachController(recovered)
      return recovered
    }
    const started = this.base('learning.extra-training.started.v1')
    return this.save({ schemaVersion: 1, session: this.options.session, unit: null, question: null, activeItem: null, activeRequestId: null, suppliedNextCursor: null, selectedOptionId: null, dictationInput: '', answer: null, playback: null, phase: 'answering', pendingEvents: [started], updatedAt: started.occurredAt })
  }) }
  async flush(): Promise<ExtraListeningTrainingSnapshot> { return this.queue(async () => {
    let snapshot = this.require()
    for (const event of snapshot.pendingEvents) {
      if (event.type === 'learning.extra-training.budget.completed.v1') await this.timing?.finish()
      await this.options.eventSink.publishExtraTrainingEvent(event)
      snapshot = { ...snapshot, pendingEvents: snapshot.pendingEvents.filter((candidate) => candidate.id !== event.id), updatedAt: this.now() }
      await this.save(snapshot)
    }
    return snapshot
  }) }
  async next(): Promise<ExtraListeningTrainingSnapshot> { return this.queue(async () => {
    const snapshot = this.require()
    if (snapshot.activeItem || snapshot.phase === 'feedback') throw new ListeningError('session-transition-invalid', 'Complete the current extra listening item before requesting another.')
    if (snapshot.session.status === 'completed' || snapshot.session.status === 'expired') return snapshot
    const request = this.options.supplyRequest(snapshot.session)
    if (!request) throw new ListeningError('session-transition-invalid', 'Extra listening session cannot request content.')
    const result = await this.options.supplyProvider.next(request)
    if (result.status !== 'item') return this.failSupply(snapshot, result)
    const item = result.item as ListeningSupplyItem
    const resolved = await this.options.questionForItem(item)
    const next = { ...snapshot, unit: resolved.unit, question: resolved.question, activeItem: item, activeRequestId: result.requestId, suppliedNextCursor: result.nextCursor, selectedOptionId: null, dictationInput: '', answer: null, playback: initialPlayback(resolved.question), phase: 'answering' as const, updatedAt: this.now() }
    const saved = await this.save(next)
    this.attachController(saved)
    return saved
  }) }
  private async failSupply(snapshot: ExtraListeningTrainingSnapshot, result: Exclude<LearningTaskSupplyResult, { status: 'item' }>) {
    const reason: 'content-exhausted' | 'provider-failure' = result.reason === 'no-eligible-content' || result.reason === 'all-eligible-content-recently-used' ? 'content-exhausted' : 'provider-failure'
    const base = this.base('learning.extra-training.failed.v1')
    const event = { ...base, payload: { ...base.payload, reason } } as ExtraTrainingEvent
    return this.save({ ...snapshot, phase: 'error', pendingEvents: [...snapshot.pendingEvents, event], session: { ...snapshot.session, status: 'failed', endReason: reason, endedAt: event.occurredAt, updatedAt: event.occurredAt }, updatedAt: event.occurredAt })
  }
  async retryContent(): Promise<ExtraListeningTrainingSnapshot> { return this.queue(async () => {
    const snapshot = this.require()
    if (snapshot.session.endReason !== 'content-exhausted') throw new ListeningError('session-transition-invalid', 'Only content-exhausted extra listening can retry content.')
    const request = this.options.supplyRequest({
      ...snapshot.session,
      // The engine deliberately makes failed sessions non-supplyable. Retrying an
      // acknowledged exhaustion is a new, paused request over the same durable cursor.
      status: 'paused', endReason: 'user-exited', endedAt: null,
    })
    if (!request) throw new ListeningError('session-transition-invalid', 'Extra listening session cannot retry content.')
    const result = await this.options.supplyProvider.next(request)
    if (result.status !== 'item') return snapshot
    const resolved = await this.options.questionForItem(result.item as ListeningSupplyItem)
    const started = this.base('learning.extra-training.started.v1')
    const next = await this.save({ ...snapshot, unit: resolved.unit, question: resolved.question, activeItem: result.item as ListeningSupplyItem, activeRequestId: result.requestId, suppliedNextCursor: result.nextCursor, selectedOptionId: null, dictationInput: '', answer: null, playback: initialPlayback(resolved.question), phase: 'answering', pendingEvents: [...snapshot.pendingEvents, started], session: { ...snapshot.session, status: snapshot.session.remainingEffectiveSeconds === 0 ? 'finish-current-item' : 'running', endReason: null, endedAt: null, updatedAt: started.occurredAt }, updatedAt: started.occurredAt })
    this.attachController(next)
    return next
  }) }
  toggleAudio() { return this.queue(async () => { const snapshot = this.require(); if (!this.controller) return snapshot; this.controller.toggle(); await this.playbackWrites; await this.timingWork; return this.require() }) }
  setPlaybackRate(rate: number) { return this.queue(async () => { if (!this.controller) return this.require(); this.controller.setRate(rate); await this.playbackWrites; return this.require() }) }
  selectSegment(segmentId: string) { return this.queue(async () => { if (!this.controller) return this.require(); this.controller.selectSegment(segmentId); await this.playbackWrites; return this.require() }) }
  setRepeatMode(mode: ListeningRepeatMode) { return this.queue(async () => { if (!this.controller) return this.require(); this.controller.setRepeatMode(mode); await this.playbackWrites; return this.require() }) }
  select(optionId: string) { return this.queue(async () => { const s = this.require(); if (!s.question || s.question.type === 'keyword-dictation' || !s.question.options.some((o) => o.id === optionId)) throw new ListeningError('session-transition-invalid', 'Option does not belong to extra listening question.'); await this.timing?.activity(); return this.save({ ...s, selectedOptionId: optionId, updatedAt: this.now() }) }) }
  changeDictation(value: string) { return this.queue(async () => { const s = this.require(); if (!s.question || s.question.type !== 'keyword-dictation') throw new ListeningError('session-transition-invalid', 'Current extra listening question is not dictation.'); await this.timing?.activity(); return this.save({ ...s, dictationInput: value, updatedAt: this.now() }) }) }
  submit() { return this.queue(async () => {
    const s = this.require(); if (!s.question || s.phase !== 'answering') throw new ListeningError('session-transition-invalid', 'Extra listening answer cannot be submitted.')
    const response = s.question.type === 'keyword-dictation' ? s.dictationInput : s.selectedOptionId
    if (!response) throw new ListeningError('session-transition-invalid', 'Enter an answer before submitting.')
    this.controller?.interrupt(); await this.playbackWrites; await this.timingWork
    const correct = judgeListeningAnswer(s.question, response)
    await this.timing?.transition({ phase: 'feedback', reason: 'active-feedback' }); await this.timing?.activity()
    const answer: ListeningAnswerRecord = { questionId: s.question.id, response, correct, submittedAt: this.now(), playCount: Object.values(this.controller?.snapshot.playCounts ?? s.playback?.playCounts ?? {}).reduce((sum, count) => sum + count, 0), rate: this.controller?.snapshot.rate ?? s.playback!.rate, repeatMode: this.controller?.snapshot.repeatMode ?? s.playback!.repeatMode }
    return this.save({ ...this.require(), answer, phase: 'feedback', playback: this.controller?.snapshot ?? s.playback, updatedAt: answer.submittedAt })
  }) }
  answerIsCorrect() { const s = this.require(); return Boolean(s.answer?.correct) }
  markBudgetReached() { return this.queue(async () => { const s = this.require(); if (s.session.status !== 'running') return s; return this.save({ ...s, session: { ...s.session, remainingEffectiveSeconds: 0, status: 'finish-current-item', updatedAt: this.now() }, updatedAt: this.now() }) }) }
  recordEffectiveSeconds(seconds: number) { return this.queue(async () => { const s = this.require(); if (!Number.isFinite(seconds) || seconds < 0) throw new ListeningError('session-transition-invalid', 'Effective seconds must be non-negative.'); const remaining = Math.max(0, s.session.remainingEffectiveSeconds - Math.floor(seconds)); return this.save({ ...s, session: { ...s.session, remainingEffectiveSeconds: remaining, status: s.session.status === 'running' && remaining === 0 ? 'finish-current-item' : s.session.status, updatedAt: this.now() }, updatedAt: this.now() }) }) }
  async completeCurrentItem() { return this.queue(async () => {
    const s = this.require(); if (s.phase !== 'feedback' || !s.activeItem || !s.answer || !s.question) throw new ListeningError('session-transition-invalid', 'Extra listening item must be in feedback before completion.')
    this.controller?.dispose(); this.controller = null
    const base = this.base('learning.extra-training.item.completed.v1')
    const attempt = { ...this.base('learning.extra-training.attempt.completed.v1'), payload: { ...base.payload, learningUnitId: s.activeItem.learningUnitId, contentRef: s.activeItem.contentRef, difficultyLevel: s.activeItem.difficultyLevel, estimatedSeconds: s.unit?.estimatedSeconds ?? 1, result: 'scored', performanceScore: s.answer.correct ? 1 : 0, evidenceQuality: 1, assistanceLevel: 0, durationSeconds: 0, errorTags: s.answer.correct ? [] : [s.question.type === 'keyword-dictation' ? 'detail-missed' : s.question.type === 'word-discrimination' ? 'sound-discrimination' : 'detail-missed'], contentTags: s.activeItem.tags, failureCategory: null } } as ExtraTrainingEvent
    const item = { ...base, payload: { ...base.payload, item: s.activeItem, requestId: s.activeRequestId ?? `${s.session.sessionId}:supply`, nextSupplyCursor: s.suppliedNextCursor ?? s.activeItem.itemId } } as ExtraTrainingEvent
    const count = s.session.completedItemCount + 1
    const budget = s.session.status === 'finish-current-item' ? { ...this.base('learning.extra-training.budget.completed.v1'), payload: { ...base.payload, completedItemCount: count } } as ExtraTrainingEvent : null
    const saved = await this.save({ ...s, unit: budget ? s.unit : null, question: budget ? s.question : null, activeItem: null, activeRequestId: null, suppliedNextCursor: budget ? s.suppliedNextCursor : null, selectedOptionId: null, dictationInput: '', answer: null, playback: null, phase: budget ? 'completed' : 'answering', pendingEvents: [...s.pendingEvents, attempt, item, ...(budget ? [budget] : [])], session: { ...s.session, excludeItemIds: [...s.session.excludeItemIds, s.activeItem.itemId], completedItemCount: count, nextSupplyCursor: s.suppliedNextCursor ?? s.activeItem.itemId, status: budget ? 'completed' : s.session.status, endReason: budget ? 'budget-reached' : null, endedAt: budget ? item.occurredAt : null, updatedAt: item.occurredAt }, updatedAt: item.occurredAt })
    return this.flushFromQueued(saved)
  }) }
  private async flushFromQueued(snapshot: ExtraListeningTrainingSnapshot) {
    let current = snapshot
    for (const event of current.pendingEvents) {
      if (event.type === 'learning.extra-training.budget.completed.v1') await this.timing?.finish()
      await this.options.eventSink.publishExtraTrainingEvent(event)
      current = { ...current, pendingEvents: current.pendingEvents.filter((entry) => entry.id !== event.id), updatedAt: this.now() }
      await this.save(current)
    }
    return current
  }
  exit() { return this.queue(async () => { const s = this.require(); if (s.session.status === 'paused' || s.session.status === 'completed') return s; this.controller?.interrupt(); await this.playbackWrites; await this.timing?.pause(); const event = this.base('learning.extra-training.exited.v1'); return this.save({ ...this.require(), phase: 'paused', pendingEvents: [...this.require().pendingEvents, event], session: { ...this.require().session, status: 'paused', endReason: 'user-exited', endedAt: event.occurredAt, updatedAt: event.occurredAt }, updatedAt: event.occurredAt }) }) }
  resume() { return this.queue(async () => { const s = this.require(); if (s.session.status === 'running') return s; if (s.session.status !== 'paused') throw new ListeningError('session-transition-invalid', 'Only paused extra listening can resume.'); const phase = s.phase === 'feedback' ? { phase: 'feedback' as const, reason: 'active-feedback' as const } : { phase: 'answering' as const, reason: 'active-answering' as const }; await this.timing?.resume(phase); const event = this.base('learning.extra-training.started.v1'); const next = await this.save({ ...s, phase: phase.phase, pendingEvents: [...s.pendingEvents, event], session: { ...s.session, status: 'running', endReason: null, endedAt: null, updatedAt: event.occurredAt }, updatedAt: event.occurredAt }); this.attachController(next); return next }) }
  private async failDevice() { return this.queue(async () => { const s = this.require(); if (s.phase === 'error') return s; const base = this.base('learning.extra-training.failed.v1'); const event = { ...base, payload: { ...base.payload, reason: 'device-failure' } } as ExtraTrainingEvent; await this.timing?.pause(); return this.save({ ...s, phase: 'error', pendingEvents: [...s.pendingEvents, event], session: { ...s.session, status: 'failed', endReason: 'device-failure', endedAt: event.occurredAt, updatedAt: event.occurredAt }, updatedAt: event.occurredAt }) }) }
  async dispose() { this.controller?.dispose(); this.controller = null; await this.playbackWrites; await this.timingWork; await this.timing?.dispose() }
}
