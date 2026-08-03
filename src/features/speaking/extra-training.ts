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
import { matchSpeakingText } from './matching.ts'
import { ExtraSpeakingTrainingRepository } from './extra-training-repository.ts'
import { SpeakingError, toSpeakingError } from './errors.ts'
import { browserSpeakingRecognition } from './recognition.ts'
import { browserSpeakingRecorder } from './recording.ts'
import type {
  SpeakingFallbackReason,
  SpeakingPrompt,
  SpeakingRecognitionPort,
  SpeakingRecording,
  SpeakingRecordingPort,
  SpeakingSupplyItem,
  SpeakingTrainingUnit,
} from './types.ts'
import {
  createSpeakingWrongAnswerEvidence,
  SpeakingWrongAnswerContentResolver,
  type SpeakingWrongAnswerEvidenceSink,
} from './wrong-answer.ts'

type Phase = 'practicing' | 'feedback' | 'paused' | 'completed' | 'error'
type FailureCategory = 'device' | 'permission' | 'network' | 'interrupted'

export interface ExtraSpeakingAnswer {
  readonly recorded: boolean
  readonly transcript: string | null
  readonly match: ReturnType<typeof matchSpeakingText> | null
  readonly failureCategory: FailureCategory | null
  readonly fallbackReason: SpeakingFallbackReason | null
}

export interface ExtraSpeakingTrainingSnapshot {
  readonly schemaVersion: 1
  readonly session: ExtraTrainingSession
  readonly unit: SpeakingTrainingUnit | null
  readonly prompt: SpeakingPrompt | null
  readonly activeItem: SpeakingSupplyItem | null
  readonly activeRequestId: string | null
  readonly suppliedNextCursor: string | null
  readonly phase: Phase
  readonly recordingAvailable: boolean
  readonly answer: ExtraSpeakingAnswer | null
  readonly pendingEvents: readonly ExtraTrainingEvent[]
  readonly updatedAt: string
}

export interface ExtraSpeakingSupplyProvider {
  next(request: ExtraTrainingSupplyRequest): Promise<LearningTaskSupplyResult>
}

export interface ExtraSpeakingTrainingRuntimeOptions {
  readonly session: ExtraTrainingSession
  readonly supplyRequest: (session: ExtraTrainingSession) => ExtraTrainingSupplyRequest | null
  readonly supplyProvider: ExtraSpeakingSupplyProvider
  readonly promptForItem: (item: SpeakingSupplyItem) => Promise<{
    readonly unit: SpeakingTrainingUnit
    readonly prompt: SpeakingPrompt
  }>
  readonly timingSessionFactory: ExtraTrainingEffectiveTimingSessionFactoryPort
  readonly eventSink: ExtraTrainingEventSink
  readonly repository?: ExtraSpeakingTrainingRepository
  readonly recorder?: SpeakingRecordingPort
  readonly recognition?: SpeakingRecognitionPort
  readonly requestMicrophone?: () => Promise<MediaStream>
  readonly now?: () => string
  readonly createId?: () => string
  /** Injected by 01; absent ports preserve the completed R6 runtime. */
  readonly wrongAnswerEvidence?: {
    readonly resolver: SpeakingWrongAnswerContentResolver
    readonly sink: SpeakingWrongAnswerEvidenceSink
  }
}

/** Optional speaking has its own durable state and event namespace; it never receives a daily task. */
export class ExtraSpeakingTrainingRuntime {
  private readonly options: ExtraSpeakingTrainingRuntimeOptions
  private snapshot: ExtraSpeakingTrainingSnapshot | null = null
  private tail: Promise<void> = Promise.resolve()
  private timing: Awaited<ReturnType<ExtraTrainingEffectiveTimingSessionFactoryPort['create']>> | null = null
  private readonly repository: ExtraSpeakingTrainingRepository
  private readonly recorder: SpeakingRecordingPort
  private readonly recognition: SpeakingRecognitionPort
  private readonly now: () => string
  private readonly createId: () => string
  private recording: SpeakingRecording | null = null
  private recognitionResult: Promise<import('./types.ts').SpeakingRecognitionOutcome> | null = null
  private recognitionHandle: ReturnType<SpeakingRecognitionPort['start']> | null = null
  private timingStarted = false
  constructor(options: ExtraSpeakingTrainingRuntimeOptions) {
    this.options = options
    this.repository = options.repository ?? new ExtraSpeakingTrainingRepository()
    this.recorder = options.recorder ?? browserSpeakingRecorder
    this.recognition = options.recognition ?? browserSpeakingRecognition
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? (() => crypto.randomUUID())
  }
  get currentSnapshot() { return this.snapshot }
  private queue<T>(operation: () => Promise<T>): Promise<T> { const result = this.tail.then(operation, operation); this.tail = result.then(() => undefined, () => undefined); return result }
  private require() { if (!this.snapshot) throw new SpeakingError('session-transition-invalid', 'Extra speaking runtime is not initialized.'); return this.snapshot }
  private base(type: ExtraTrainingEvent['type']): ExtraTrainingEvent {
    const s = this.options.session
    return { id: `extra-speaking:${s.sessionId}:${this.createId()}`, type, sourceModuleId: 'speaking', occurredAt: this.now(), schemaVersion: 1, payload: { sessionId: s.sessionId, localDate: s.localDate, domain: 'speaking', targetModuleId: 'speaking', mode: 'learn' } } as ExtraTrainingEvent
  }
  private async save(snapshot: ExtraSpeakingTrainingSnapshot) { this.snapshot = snapshot; await this.repository.save(snapshot); return snapshot }
  async initialize() { return this.queue(async () => {
    this.timing ??= await this.options.timingSessionFactory.create(this.options.session)
    const restored = await this.repository.load(this.options.session.sessionId)
    if (restored) {
      return this.save({
        ...restored,
        session: migrateExtraTrainingSessionToOpenEnded(
          restored.session,
          this.now(),
        ),
        recordingAvailable: false,
        updatedAt: this.now(),
      })
    }
    const event = this.base('learning.extra-training.started.v1')
    return this.save({ schemaVersion: 1, session: this.options.session, unit: null, prompt: null, activeItem: null, activeRequestId: null, suppliedNextCursor: null, phase: 'practicing', recordingAvailable: false, answer: null, pendingEvents: [event], updatedAt: event.occurredAt })
  }) }
  async flush() { return this.queue(async () => {
    let snapshot = this.require()
    for (const event of snapshot.pendingEvents) {
      if (event.type === 'learning.extra-training.budget.completed.v1') await this.timing?.finish()
      await this.options.eventSink.publishExtraTrainingEvent(event)
      snapshot = { ...snapshot, pendingEvents: snapshot.pendingEvents.filter((candidate) => candidate.id !== event.id), updatedAt: this.now() }
      await this.save(snapshot)
    }
    return snapshot
  }) }
  async next() { return this.queue(async () => {
    const snapshot = this.require()
    if (snapshot.activeItem || snapshot.phase === 'feedback') throw new SpeakingError('session-transition-invalid', 'Complete the current extra speaking item before requesting another.')
    if (snapshot.session.status === 'completed' || snapshot.session.status === 'expired' || snapshot.session.status === 'failed') return snapshot
    const request = this.options.supplyRequest(snapshot.session)
    if (!request) throw new SpeakingError('session-transition-invalid', 'Extra speaking session cannot request content.')
    await this.timing?.transition({ phase: 'loading', reason: 'content-loading' })
    const result = await this.options.supplyProvider.next(request)
    if (result.status !== 'item') return this.failSupply(snapshot, result)
    try {
      const item = result.item as SpeakingSupplyItem
      const resolved = await this.options.promptForItem(item)
      const next = await this.save({ ...snapshot, unit: resolved.unit, prompt: resolved.prompt, activeItem: item, activeRequestId: result.requestId, suppliedNextCursor: result.nextCursor, phase: 'practicing', recordingAvailable: false, answer: null, updatedAt: this.now() })
      await this.timing?.transition({ phase: 'answering', reason: 'active-answering' })
      return next
    } catch (error) { return this.fail(snapshot, 'provider-failure', toSpeakingError(error).message) }
  }) }
  private async failSupply(snapshot: ExtraSpeakingTrainingSnapshot, result: Exclude<LearningTaskSupplyResult, { status: 'item' }>) {
    return this.fail(snapshot, result.reason === 'provider-failure' ? 'provider-failure' : 'content-exhausted')
  }
  private async fail(snapshot: ExtraSpeakingTrainingSnapshot, reason: 'content-exhausted' | 'provider-failure', _message?: string) {
    const base = this.base('learning.extra-training.failed.v1')
    const event = { ...base, payload: { ...base.payload, reason } } as ExtraTrainingEvent
    return this.save({ ...snapshot, phase: 'error', pendingEvents: [...snapshot.pendingEvents, event], session: { ...snapshot.session, status: 'failed', endReason: reason, endedAt: event.occurredAt, updatedAt: event.occurredAt }, updatedAt: event.occurredAt })
  }
  /** Retry a recoverable supply failure without treating recording/recognition fallback as a failed session. */
  async retryFailure() { return this.queue(async () => {
    const snapshot = this.require()
    if (snapshot.session.status === 'completed' || snapshot.session.status === 'expired') throw new SpeakingError('session-transition-invalid', 'Completed or expired extra speaking cannot retry content.')
    if (snapshot.session.status !== 'failed' || (snapshot.session.endReason !== 'content-exhausted' && snapshot.session.endReason !== 'provider-failure')) return snapshot
    const request = this.options.supplyRequest({ ...snapshot.session, status: 'paused', endReason: 'user-exited', endedAt: null })
    if (!request) throw new SpeakingError('session-transition-invalid', 'Extra speaking session cannot retry content.')
    const result = await this.options.supplyProvider.next(request)
    if (result.status !== 'item') return snapshot
    const item = result.item as SpeakingSupplyItem
    let resolved: { readonly unit: SpeakingTrainingUnit; readonly prompt: SpeakingPrompt }
    try { resolved = await this.options.promptForItem(item) } catch { return snapshot }
    const event = this.base('learning.extra-training.started.v1')
    return this.save({ ...snapshot, unit: resolved.unit, prompt: resolved.prompt, activeItem: item, activeRequestId: result.requestId, suppliedNextCursor: result.nextCursor, phase: 'practicing', answer: null, recordingAvailable: false, pendingEvents: [...snapshot.pendingEvents, event], session: { ...snapshot.session, status: 'running', endReason: null, endedAt: null, updatedAt: event.occurredAt }, updatedAt: event.occurredAt })
  }) }
  /** @deprecated Use retryFailure so provider failures can recover through the same durable request. */
  retryContent() { return this.retryFailure() }
  async recordEffectiveSeconds(seconds: number) { return this.queue(async () => { const s = this.require(); if (!Number.isFinite(seconds) || seconds < 0) throw new SpeakingError('session-transition-invalid', 'Effective seconds must be non-negative.'); return this.save({ ...s, session: { ...s.session, effectiveSeconds: (s.session.effectiveSeconds ?? 0) + Math.floor(seconds), updatedAt: this.now() }, updatedAt: this.now() }) }) }
  async startRecording() { return this.queue(async () => {
    const s = this.require(); if (!s.prompt || s.phase !== 'practicing') throw new SpeakingError('session-transition-invalid', 'Extra speaking prompt is not ready to record.')
    await this.timing?.transition({ phase: 'permission-wait', reason: 'permission-wait' })
    try {
      const stream = await this.options.requestMicrophone?.()
      if (!stream) throw new Error('Microphone request port is unavailable.')
      await this.timing?.transition({ phase: 'loading', reason: 'media-loading' })
      this.recorder.start(stream, { onStarted: () => {
        if (this.timingStarted) void this.timing?.resume({ phase: 'recording', reason: 'active-recording' })
        else { this.timingStarted = true; void this.timing?.start({ phase: 'recording', reason: 'active-recording' }) }
      }, onPaused: () => void this.timing?.pause(), onResumed: () => void this.timing?.resume({ phase: 'recording', reason: 'active-recording' }), onStopped: () => void this.timing?.transition({ phase: 'loading', reason: 'media-loading' }), onError: () => void this.timing?.pause() })
      this.recognitionHandle = this.recognition.capabilities().supported ? this.recognition.start('en-US') : null
      this.recognitionResult = this.recognitionHandle?.result ?? null
      return this.save({ ...s, recordingAvailable: true, updatedAt: this.now() })
    } catch { return this.save({ ...s, recordingAvailable: false, updatedAt: this.now() }) }
  }) }
  async stopRecording() { return this.queue(async () => {
    const s = this.require(); if (!s.prompt || !s.recordingAvailable) return this.continueWithoutRecordingInternal(s, 'recording-failed', 'device')
    this.recognitionHandle?.stop(); let recording: SpeakingRecording
    try { recording = await this.recorder.stop(); this.recording = recording } catch { return this.continueWithoutRecordingInternal(s, 'recording-failed', 'device') }
    await this.timing?.transition({ phase: 'network-wait', reason: 'network-wait' })
    const outcome = this.recognitionResult ? await this.recognitionResult : { status: 'failed' as const, code: 'unavailable' as const, message: '识别不可用。' }
    if (outcome.status === 'recognized') return this.save({ ...s, phase: 'feedback', answer: { recorded: true, transcript: outcome.transcript, match: matchSpeakingText(outcome.transcript, s.prompt.acceptedAnswers), failureCategory: null, fallbackReason: null }, updatedAt: this.now() })
    const category: FailureCategory = outcome.code === 'network' ? 'network' : outcome.code === 'not-allowed' ? 'permission' : 'device'
    return this.save({ ...s, phase: 'feedback', answer: { recorded: true, transcript: null, match: null, failureCategory: category, fallbackReason: category === 'network' ? 'recognition-network' : 'recognition-failed' }, updatedAt: this.now() })
  }) }
  private async continueWithoutRecordingInternal(s: ExtraSpeakingTrainingSnapshot, reason: SpeakingFallbackReason, category: FailureCategory) { return this.save({ ...s, phase: 'feedback', answer: { recorded: false, transcript: null, match: null, failureCategory: category, fallbackReason: reason }, updatedAt: this.now() }) }
  continueWithoutRecording() { return this.queue(() => this.continueWithoutRecordingInternal(this.require(), 'recording-failed', 'device')) }
  async playRecording() { return this.queue(async () => { const s = this.require(); if (!this.recording || s.phase !== 'feedback') throw new SpeakingError('playback-failed', 'No extra speaking recording is available.'); await this.timing?.transition({ phase: 'loading', reason: 'media-loading' }); await this.recorder.play(this.recording, { onStarted: () => {
    if (this.timingStarted) void this.timing?.resume({ phase: 'playback', reason: 'active-playback' })
    else { this.timingStarted = true; void this.timing?.start({ phase: 'playback', reason: 'active-playback' }) }
  }, onPaused: () => void this.timing?.pause(), onWaiting: () => void this.timing?.transition({ phase: 'loading', reason: 'media-loading' }), onEnded: () => void this.timing?.transition({ phase: 'feedback', reason: 'active-feedback' }), onError: () => void this.timing?.transition({ phase: 'feedback', reason: 'active-feedback' }) }); return this.require() }) }
  async completeCurrentItem() { return this.queue(async () => {
    const s = this.require(); if (s.phase !== 'feedback' || !s.activeItem || !s.answer) throw new SpeakingError('session-transition-invalid', 'Extra speaking item needs feedback before completion.')
    const count = s.session.completedItemCount + 1
    const attempt = this.base('learning.extra-training.attempt.completed.v1')
    const correct = s.answer.match?.level === 'match' || s.answer.match?.level === 'close'
    if (this.options.wrongAnswerEvidence && s.answer.match && !correct) {
      const identity = this.options.wrongAnswerEvidence.resolver.resolveItem(s.activeItem)
      await this.options.wrongAnswerEvidence.sink.publishWrongAnswerEvidence(
        createSpeakingWrongAnswerEvidence({
          eventId: `extra-speaking-wrong-answer:${s.session.sessionId}:${s.activeItem.itemId}`,
          occurredAt: this.now(), source: 'extra-training', identity, match: s.answer.match,
        }),
      )
    }
    const attemptEvent = { ...attempt, payload: { ...attempt.payload, learningUnitId: s.activeItem.learningUnitId, contentRef: s.activeItem.contentRef, difficultyLevel: s.activeItem.difficultyLevel, estimatedSeconds: 1, result: s.answer.match ? 'scored' : 'unscorable', performanceScore: s.answer.match?.similarity ?? null, evidenceQuality: s.answer.match ? 1 : 0, assistanceLevel: 0, durationSeconds: 0, errorTags: [], contentTags: s.activeItem.tags, failureCategory: s.answer.failureCategory, scoreDelta: { schemaVersion: 1, correctCount: s.answer.match && correct ? 1 : 0, incorrectCount: s.answer.match && !correct ? 1 : 0, unscorableCount: s.answer.match ? 0 : 1 } } } as ExtraTrainingEvent
    const item = this.base('learning.extra-training.item.completed.v1')
    const itemEvent = { ...item, payload: { ...item.payload, item: s.activeItem, requestId: s.activeRequestId ?? `${s.session.sessionId}:supply`, nextSupplyCursor: s.suppliedNextCursor } } as ExtraTrainingEvent
    const saved = await this.save({ ...s, unit: null, prompt: null, activeItem: null, activeRequestId: null, suppliedNextCursor: null, phase: 'practicing', recordingAvailable: false, answer: null, pendingEvents: [...s.pendingEvents, attemptEvent, itemEvent], session: { ...s.session, excludeItemIds: [...s.session.excludeItemIds, s.activeItem.itemId], completedItemCount: count, nextSupplyCursor: s.suppliedNextCursor, status: 'running', endReason: null, endedAt: null, updatedAt: item.occurredAt }, updatedAt: item.occurredAt })
    return this.flushFromQueued(saved)
  }) }
  private async flushFromQueued(snapshot: ExtraSpeakingTrainingSnapshot) {
    let current = snapshot
    for (const event of current.pendingEvents) {
      if (event.type === 'learning.extra-training.budget.completed.v1') await this.timing?.finish()
      await this.options.eventSink.publishExtraTrainingEvent(event)
      current = { ...current, pendingEvents: current.pendingEvents.filter((candidate) => candidate.id !== event.id), updatedAt: this.now() }
      await this.save(current)
    }
    return current
  }
  exit() { return this.queue(async () => { const s = this.require(); if (s.session.status === 'paused' || s.session.status === 'completed') return s; this.recorder.cancel(); this.recognitionHandle?.abort(); await this.timing?.pause(); const event = this.base('learning.extra-training.exited.v1'); return this.save({ ...s, phase: 'paused', pendingEvents: [...s.pendingEvents, event], session: { ...s.session, status: 'paused', endReason: 'user-exited', endedAt: event.occurredAt, updatedAt: event.occurredAt }, updatedAt: event.occurredAt }) }) }
  resume() { return this.queue(async () => { const s = this.require(); if (s.session.status === 'running') return s; if (s.session.status !== 'paused') throw new SpeakingError('session-transition-invalid', 'Only paused extra speaking can resume.'); const phase = s.phase === 'feedback' ? { phase: 'feedback' as const, reason: 'active-feedback' as const } : { phase: 'answering' as const, reason: 'active-answering' as const }; await this.timing?.resume(phase); const event = this.base('learning.extra-training.started.v1'); return this.save({ ...s, phase: s.phase === 'feedback' ? 'feedback' : 'practicing', pendingEvents: [...s.pendingEvents, event], session: { ...s.session, status: 'running', endReason: null, endedAt: null, updatedAt: event.occurredAt }, updatedAt: event.occurredAt }) }) }
  async dispose() { this.recorder.cancel(); this.recorder.stopPlayback(); this.recognitionHandle?.abort(); await this.timing?.dispose() }
}
