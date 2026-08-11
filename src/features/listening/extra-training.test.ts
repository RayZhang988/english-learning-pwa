import { describe, expect, it } from 'vitest'
import type { NamespaceStore, StoredRecord } from '../../storage/index.ts'
import { ExtraListeningTrainingRuntime } from './extra-training.ts'
import { ExtraListeningTrainingRepository } from './extra-training-repository.ts'
import type { ListeningSpeechCallbacks, ListeningSpeechPort } from './speech-synthesis.ts'
import type { ListeningQuestion } from './types.ts'
import {
  applyWrongAnswerEvidence,
  createTrainingSupplyRound,
  createWrongAnswerLibraryState,
} from '../../learning-engine/index.ts'

class Store implements NamespaceStore {
  records = new Map<string, StoredRecord<unknown>>()
  async get<T>(key: string) { return this.records.get(key) as StoredRecord<T> | undefined }
  async put<T>(key: string, value: T, schemaVersion = 1) { this.records.set(key, { namespace: 'test', key, value, schemaVersion, updatedAt: '2026-07-29T00:00:00.000Z' }) }
  async delete(key: string) { this.records.delete(key) }
  async keys() { return [...this.records.keys()] }
  async clear() { this.records.clear() }
}

class ClearEvidenceFailingStore extends Store {
  armed = true
  override async put<T>(key: string, value: T, schemaVersion = 1) {
    const candidate = value as { phase?: string; pendingWrongAnswerEvidence?: unknown[] }
    if (this.armed && candidate.phase === 'feedback' && Array.isArray(candidate.pendingWrongAnswerEvidence) && candidate.pendingWrongAnswerEvidence.length === 0) {
      this.armed = false
      throw new Error('clear evidence checkpoint failed')
    }
    await super.put(key, value, schemaVersion)
  }
}

const session = {
  schemaVersion: 1, sessionId: 'extra-listening', localDate: '2026-07-29',
  domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1,
  completionMode: 'open-ended', effectiveSeconds: 0, status: 'running',
  nextSupplyCursor: null, excludeItemIds: [], completedItemCount: 0,
  startedAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z',
  endedAt: null, endReason: null,
} as const
const item = {
  itemId: 'listening-supply-1', learningUnitId: 'unit-1', contentRef: 'lesson://unit-1',
  difficultyLevel: 1, tags: ['travel'],
  source: { sourceType: 'listening-extension', sourceId: 'exercise', variantId: 'word' },
} as const
const baseQuestion = {
  id: 'word', promptZh: '选择', primarySegmentId: 'line-1',
  segments: [{ id: 'line-1', locale: 'en-US' as const, text: 'Maya says hello.', label: 'Maya', speaker: 'Maya' }],
  playbackPolicy: { allowSegmentSelection: true, allowRepeat: true, allowedRates: [0.75, 1, 1.25] as const, sequenceMode: 'all-segments' as const },
  rationaleZh: '提示', errorTag: 'sound-discrimination' as const,
}
const wordQuestion = { ...baseQuestion, type: 'word-discrimination' as const, options: [{ id: 'right', label: '对' }, { id: 'wrong', label: '错' }], correctOptionId: 'right' }
const sentenceQuestion = { ...baseQuestion, id: 'sentence', type: 'short-sentence-choice' as const, options: [{ id: 'right', label: '对' }, { id: 'wrong', label: '错' }], correctOptionId: 'right', errorTag: 'detail-missed' as const }
const dictationQuestion = { ...baseQuestion, id: 'dictation', type: 'keyword-dictation' as const, targetKeywords: ['hello'], standardAnswer: 'hello', acceptedAnswers: ['hello'], normalizationHints: { trim: true, caseFoldLocale: 'en-US' as const, collapseWhitespace: true, normalizeApostrophes: true, stripTerminalPunctuation: true } as const, answerGuidance: { answerType: 'manner-or-short-phrase' as const, guidanceZh: '填写听到的英文短语。', acceptedInputFormats: ['english-words'] as const } }
const unit = { learningUnitId: 'unit-1', contentRef: 'lesson://unit-1', difficultyLevel: 1, estimatedSeconds: 12, tags: ['travel'], activityType: 'listening-dialogue' as const, titleZh: '对话', transcript: [{ id: 'line-1', speaker: 'Maya', text: 'Maya says hello.', translationZh: '你好' }], questions: [wordQuestion] }

class Speech implements ListeningSpeechPort {
  calls: { text: string; rate: number; pitch?: number }[] = []
  callbacks: ListeningSpeechCallbacks | null = null
  paused = false
  capabilities() { return { supported: true, voicesKnown: true, enUsVoiceAvailable: true, localEnUsVoiceCount: 1, pauseResumeAvailable: true, supportedRates: [0.75, 1, 1.25] as const } }
  voices() { return [{ id: 'neutral', locale: 'en-US' as const, localService: true as const }] }
  speak(request: { text: string; locale: 'en-US'; rate: 0.75 | 1 | 1.25 }, callbacks: ListeningSpeechCallbacks) { this.calls.push(request); this.callbacks = callbacks; callbacks.onStart?.() }
  cancel() { this.callbacks?.onEnd?.(); this.callbacks = null }
  pause() { this.paused = true; this.callbacks?.onPause?.() }
  resume() { this.paused = false; this.callbacks?.onResume?.() }
  isPaused() { return this.paused }
  isSpeaking() { return this.callbacks !== null && !this.paused }
}

function request() {
  return { schemaVersion: 1 as const, requestId: 'request-1', sessionId: session.sessionId, localDate: session.localDate, domain: 'listening' as const, targetModuleId: 'listening' as const, mode: 'learn' as const, targetDifficulty: 1, cursor: null, excludeItemIds: [], priority: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'] as const, priorityItemIds: { 'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] }, reason: 'initial' as const }
}
function options(question: ListeningQuestion = wordQuestion) {
  const timing: string[] = []
  return {
    session, repository: new ExtraListeningTrainingRepository(new Store()), speech: new Speech(),
    supplyRequest: () => request(),
    supplyProvider: { next: async (value: { requestId: string }) => ({ schemaVersion: 1 as const, requestId: value.requestId, status: 'item' as const, item, nextCursor: item.itemId }) },
    questionForItem: async () => ({ unit, question }),
    timingSessionFactory: { create: async () => ({ start: async () => { timing.push('start') }, transition: async (value: { phase: string }) => { timing.push(`transition:${value.phase}`) }, activity: async () => { timing.push('activity') }, pause: async () => { timing.push('pause') }, resume: async (value: { phase: string }) => { timing.push(`resume:${value.phase}`) }, finish: async () => { timing.push('finish') }, dispose: async () => {} }) },
    eventSink: { publishExtraTrainingEvent: async () => {} }, timing,
  }
}

async function completePlayback(
  runtime: ExtraListeningTrainingRuntime,
  speech: Speech,
) {
  await runtime.toggleAudio()
  speech.callbacks?.onEnd?.()
  await runtime.setPlaybackRate(1)
}

describe('extra listening commands', () => {
  it.each([wordQuestion, sentenceQuestion])('answers choice exercise %s without a daily task identity', async (question) => {
    const configured = options(question)
    const runtime = new ExtraListeningTrainingRuntime(configured)
    await runtime.initialize(); await runtime.next(); await completePlayback(runtime, configured.speech); await runtime.select('right'); await runtime.submit(); await runtime.completeCurrentItem()
    expect(runtime.currentSnapshot?.session.completedItemCount).toBe(1)
    expect(JSON.stringify(runtime.currentSnapshot)).not.toMatch(/planId|taskId/)
  })

  it.each([wordQuestion, dictationQuestion])(
    'publishes the acknowledged randomized round after completing %s',
    async (question) => {
      const configured = options(question)
      const events: import('../../learning-engine/index.ts').ExtraTrainingEvent[] = []
      const runtime = new ExtraListeningTrainingRuntime({
        ...configured,
        session: {
          ...session,
          supplyRound: createTrainingSupplyRound({
            seed: 'extra-listening-round',
            candidateItemIds: [item.itemId],
            shortTermExcludedItemIds: [],
          }),
        },
        eventSink: { publishExtraTrainingEvent: async (event) => { events.push(event) } },
      })

      await runtime.initialize()
      await runtime.next()
      await completePlayback(runtime, configured.speech)
      if (question.type === 'keyword-dictation') {
        await runtime.changeDictation('hello')
      } else {
        await runtime.select('right')
      }
      await runtime.submit()
      await runtime.completeCurrentItem()

      const completion = events.find(
        (event) => event.type === 'learning.extra-training.item.completed.v1',
      )
      expect(completion?.payload.supplyRound).toMatchObject({
        seed: 'extra-listening-round',
        cursor: 1,
        order: [item.itemId],
      })
    },
  )

  it('persists the latest dictation input across restore and submits it', async () => {
    const configured = options(dictationQuestion)
    const first = new ExtraListeningTrainingRuntime(configured)
    await first.initialize(); await first.next(); await first.changeDictation('a'); await first.changeDictation('ab'); await first.changeDictation('hello')
    const restored = new ExtraListeningTrainingRuntime({ ...configured, repository: configured.repository })
    await restored.initialize(); expect(restored.currentSnapshot?.dictationInput).toBe('hello'); await completePlayback(restored, configured.speech)
    await restored.submit(); expect(restored.currentSnapshot?.answer?.response).toBe('hello')
  })

  it('writes one formally-scored incorrect evidence through the unified host sink', async () => {
    const configured = options(wordQuestion)
    const evidence: unknown[] = []
    const runtime = new ExtraListeningTrainingRuntime({
      ...configured,
      reviewIdentityForItem: () => ({ reviewContentId: 'review-listening-word', originalQuestionType: 'listening-word-discrimination' }),
      publishWrongAnswerEvidence: async (value) => { evidence.push(value) },
    })
    await runtime.initialize(); await runtime.next(); await completePlayback(runtime, configured.speech)
    await runtime.select('wrong'); await runtime.submit()
    expect(evidence).toEqual([expect.objectContaining({ domain: 'listening', source: 'extra-training', outcome: 'incorrect', formallyScored: true, reviewContentId: 'review-listening-word' })])
  })

  it('replays a rejected extra wrong-answer outbox with the same evidence id after restore', async () => {
    const configured = options(wordQuestion); const evidence: { eventId: string }[] = []; let reject = true
    const shared = { ...configured, reviewIdentityForItem: () => ({ reviewContentId: 'review-extra', originalQuestionType: 'listening-word-discrimination' }), publishWrongAnswerEvidence: async (value: { eventId: string }) => { evidence.push(value); if (reject) throw new Error('reject') } }
    const first = new ExtraListeningTrainingRuntime(shared)
    await first.initialize(); await first.next(); await completePlayback(first, configured.speech); await first.select('wrong')
    await expect(first.submit()).rejects.toThrow('reject')
    expect(first.currentSnapshot?.pendingWrongAnswerEvidence).toHaveLength(1)
    const id = first.currentSnapshot?.pendingWrongAnswerEvidence?.[0]?.eventId
    reject = false
    const restored = new ExtraListeningTrainingRuntime({ ...shared, repository: shared.repository, speech: new Speech() })
    await restored.initialize()
    expect(evidence.map((entry) => entry.eventId)).toEqual([id, id])
    expect(restored.currentSnapshot?.pendingWrongAnswerEvidence).toEqual([])
  })

  it('retains extra evidence when its acknowledgement checkpoint fails, then replays one library fact', async () => {
    const store = new ClearEvidenceFailingStore(); const repository = new ExtraListeningTrainingRepository(store); const configured = options(wordQuestion); const evidence: import('../../learning-engine/index.ts').WrongAnswerEvidence[] = []
    const shared = { ...configured, repository, reviewIdentityForItem: () => ({ reviewContentId: 'review-extra-clear', originalQuestionType: 'listening-word-discrimination' }), publishWrongAnswerEvidence: async (value: import('../../learning-engine/index.ts').WrongAnswerEvidence) => { evidence.push(value) } }
    const first = new ExtraListeningTrainingRuntime(shared)
    await first.initialize(); await first.next(); await completePlayback(first, shared.speech); await first.select('wrong')
    await expect(first.submit()).rejects.toThrow('clear evidence checkpoint failed')
    const eventId = evidence[0]?.eventId
    expect(first.currentSnapshot?.pendingWrongAnswerEvidence).toHaveLength(1)
    expect((await repository.load(session.sessionId))?.pendingWrongAnswerEvidence).toHaveLength(1)
    const restored = new ExtraListeningTrainingRuntime({ ...shared, speech: new Speech() })
    await restored.initialize()
    expect(evidence.map((value) => value.eventId)).toEqual([eventId, eventId])
    expect(restored.currentSnapshot?.pendingWrongAnswerEvidence).toEqual([])
    const library = evidence.reduce((state, value) => applyWrongAnswerEvidence(state, value).state, createWrongAnswerLibraryState())
    expect(Object.values(library.records)).toHaveLength(1); expect(Object.values(library.records)[0]?.incorrectCount).toBe(1)
  })

  it('keeps one extra wrong-answer outbox entry across a double submit', async () => {
    const configured = options(wordQuestion)
    const runtime = new ExtraListeningTrainingRuntime({ ...configured, reviewIdentityForItem: () => ({ reviewContentId: 'review-double', originalQuestionType: 'listening-word-discrimination' }), publishWrongAnswerEvidence: async () => { throw new Error('offline') } })
    await runtime.initialize(); await runtime.next(); await completePlayback(runtime, configured.speech); await runtime.select('wrong')
    await Promise.allSettled([runtime.submit(), runtime.submit()])
    expect(runtime.currentSnapshot?.pendingWrongAnswerEvidence).toHaveLength(1)
  })
  it('does not emit extra wrong-answer evidence for a correct answer or an unanswered exit', async () => {
    const configured = options(wordQuestion); const evidence: unknown[] = []
    const shared = { ...configured, reviewIdentityForItem: () => ({ reviewContentId: 'review-exclusion', originalQuestionType: 'listening-word-discrimination' }), publishWrongAnswerEvidence: async (value: unknown) => { evidence.push(value) } }
    const correct = new ExtraListeningTrainingRuntime(shared)
    await correct.initialize(); await correct.next(); await completePlayback(correct, configured.speech); await correct.select('right'); await correct.submit(); await correct.completeCurrentItem()
    expect(correct.currentSnapshot?.pendingWrongAnswerEvidence).toEqual([]); expect(evidence).toEqual([])
    const exit = new ExtraListeningTrainingRuntime({ ...shared, session: { ...session, sessionId: 'extra-exit' }, repository: new ExtraListeningTrainingRepository(new Store()), speech: new Speech() })
    await exit.initialize(); await exit.next(); await exit.exit()
    expect(exit.currentSnapshot?.pendingWrongAnswerEvidence).toEqual([]); expect(evidence).toEqual([])
  })

  it('uses the exact four-level priority request and natural single-voice speech parameters', async () => {
    let supplied: unknown
    const configured = options(wordQuestion)
    const priority = { ...request(), priorityItemIds: { 'recent-error': [item.itemId], 'due-review': ['due'], 'same-day-variant': ['same'], 'new-optional-content': ['new'] } }
    const runtime = new ExtraListeningTrainingRuntime({ ...configured, supplyRequest: () => priority, supplyProvider: { next: async (value) => { supplied = value; return { schemaVersion: 1 as const, requestId: value.requestId, status: 'item' as const, item, nextCursor: item.itemId } } } })
    await runtime.initialize(); await runtime.next(); await runtime.toggleAudio()
    expect(supplied).toEqual(priority)
    expect(configured.speech.calls).toEqual([{ text: 'Maya says hello.', locale: 'en-US', rate: 1, usePreferredDeviceVoice: true }])
  })

  it('notifies the route when browser speech ends outside a command', async () => {
    const configured = options(wordQuestion)
    const runtime = new ExtraListeningTrainingRuntime(configured)
    const observed: string[] = []
    const unsubscribe = runtime.subscribe((snapshot) => {
      observed.push(snapshot.playback?.status ?? 'none')
    })
    await runtime.initialize()
    await runtime.next()
    await runtime.toggleAudio()
    configured.speech.callbacks?.onEnd?.()
    expect(observed).toContain('playing')
    expect(observed.at(-1)).toBe('ended')
    unsubscribe()
  })

  it('does not truncate or finish active playback after 900 effective seconds', async () => {
    const configured = options(wordQuestion)
    const published: string[] = []
    const runtime = new ExtraListeningTrainingRuntime({ ...configured, eventSink: { publishExtraTrainingEvent: async (event) => { published.push(event.type) } } })
    await runtime.initialize(); await runtime.next(); await runtime.toggleAudio(); await runtime.recordEffectiveSeconds(900)
    expect(runtime.currentSnapshot?.session).toMatchObject({ status: 'running', effectiveSeconds: 900 })
    expect(runtime.currentSnapshot?.playback?.status).toBe('playing')
    configured.speech.callbacks?.onEnd?.()
    await runtime.setPlaybackRate(1)
    await runtime.select('right'); await runtime.submit(); await runtime.completeCurrentItem()
    expect(runtime.currentSnapshot?.session.status).toBe('running')
    expect(published.slice(-2)).toEqual(['learning.extra-training.attempt.completed.v1', 'learning.extra-training.item.completed.v1'])
    expect(published).not.toContain('learning.extra-training.budget.completed.v1')
  })

  it('starts timing only from speech start and pauses it for pause, resume, and cancellation', async () => {
    const configured = options(wordQuestion)
    const runtime = new ExtraListeningTrainingRuntime(configured)
    await runtime.initialize(); await runtime.next(); await runtime.toggleAudio()
    expect(configured.timing).toEqual(expect.arrayContaining(['transition:loading', 'start']))
    await runtime.toggleAudio(); await runtime.toggleAudio(); await runtime.setPlaybackRate(1.25)
    expect(configured.timing.filter((entry) => entry === 'pause').length).toBeGreaterThanOrEqual(2)
    expect(configured.timing).toContain('resume:audio-listening')
    expect(configured.timing).toContain('transition:answering')
  })

  it('persists exit and retries the same extra outbox id after a publish failure', async () => {
    const configured = options(wordQuestion)
    let fail = true
    const delivered: string[] = []
    const first = new ExtraListeningTrainingRuntime({ ...configured, eventSink: { publishExtraTrainingEvent: async (event) => { if (fail) { fail = false; throw new Error('offline') }; delivered.push(event.id) } } })
    await first.initialize(); await first.next(); const paused = await first.exit(); const exitId = paused.pendingEvents.at(-1)!.id
    await expect(first.flush()).rejects.toThrow('offline')
    const second = new ExtraListeningTrainingRuntime({ ...configured, repository: configured.repository, eventSink: { publishExtraTrainingEvent: async (event) => { delivered.push(event.id) } } })
    await second.initialize(); await second.flush(); await second.flush()
    expect(delivered.filter((id) => id === exitId)).toEqual([exitId])
  })

  it('preserves cursor/exclude on acknowledged exhaustion and isolates provider failure', async () => {
    let available = false
    const configured = options(wordQuestion)
    const initial = { ...session, completedItemCount: 3, nextSupplyCursor: 'old', excludeItemIds: ['old'] }
    const runtime = new ExtraListeningTrainingRuntime({ ...configured, session: initial, supplyProvider: { next: async (value) => available ? { schemaVersion: 1 as const, requestId: value.requestId, status: 'item' as const, item, nextCursor: item.itemId } : { schemaVersion: 1 as const, requestId: value.requestId, status: 'content-exhausted' as const, reason: 'no-eligible-content' as const } } })
    await runtime.initialize(); await runtime.next(); available = true; await runtime.retryContent()
    expect(runtime.currentSnapshot?.session.excludeItemIds).toEqual(['old'])
    expect(runtime.currentSnapshot?.session.nextSupplyCursor).toBe('old')
    const failed = new ExtraListeningTrainingRuntime({ ...options(), supplyProvider: { next: async (value) => ({ schemaVersion: 1 as const, requestId: value.requestId, status: 'content-exhausted' as const, reason: 'provider-failure' as const }) } })
    await failed.initialize(); await failed.next(); expect(failed.currentSnapshot?.session.endReason).toBe('provider-failure')
    await expect(failed.retryFailure()).resolves.toMatchObject({ session: { endReason: 'provider-failure' } })
  })

  it('retries content/provider failures from the durable cursor exactly once after refresh', async () => {
    const configured = options(wordQuestion)
    let attempts = 0
    const provider = { next: async (value: { requestId: string }) => {
      attempts += 1
      return attempts === 1
        ? { schemaVersion: 1 as const, requestId: value.requestId, status: 'content-exhausted' as const, reason: 'provider-failure' as const }
        : attempts === 2
          ? { schemaVersion: 1 as const, requestId: value.requestId, status: 'content-exhausted' as const, reason: 'provider-failure' as const }
          : { schemaVersion: 1 as const, requestId: value.requestId, status: 'item' as const, item, nextCursor: item.itemId }
    } }
    const first = new ExtraListeningTrainingRuntime({ ...configured, supplyProvider: provider })
    await first.initialize(); await first.flush(); await first.next()
    const failedId = first.currentSnapshot!.pendingEvents.at(-1)!.id
    const restored = new ExtraListeningTrainingRuntime({ ...configured, repository: configured.repository, supplyProvider: provider })
    await restored.initialize(); await restored.retryFailure()
    expect(restored.currentSnapshot?.pendingEvents.map((event) => event.id)).toContain(failedId)
    expect(restored.currentSnapshot?.session.endReason).toBe('provider-failure')
    await restored.retryFailure()
    expect(restored.currentSnapshot?.activeItem?.itemId).toBe(item.itemId)
    expect(restored.currentSnapshot?.pendingEvents.filter((event) => event.type === 'learning.extra-training.started.v1')).toHaveLength(1)
    await expect(restored.retryFailure()).rejects.toThrow('Only failed')
  })

  it('rebuilds the same item after device failure without resupplying or changing neutral speech', async () => {
    const configured = options(wordQuestion)
    let supplied = 0
    const runtime = new ExtraListeningTrainingRuntime({ ...configured, supplyProvider: { next: async (value) => { supplied += 1; return { schemaVersion: 1 as const, requestId: value.requestId, status: 'item' as const, item, nextCursor: item.itemId } } } })
    await runtime.initialize(); await runtime.flush(); await runtime.next(); await runtime.toggleAudio()
    configured.speech.callbacks?.onError?.('audio-hardware')
    await runtime.retryFailure()
    expect(runtime.currentSnapshot?.activeItem?.itemId).toBe(item.itemId)
    expect(runtime.currentSnapshot?.session.status).toBe('running')
    expect(supplied).toBe(1)
    await runtime.toggleAudio()
    expect(configured.speech.calls.at(-1)).toEqual({ text: 'Maya says hello.', locale: 'en-US', rate: 1, usePreferredDeviceVoice: true })
    expect(runtime.currentSnapshot?.pendingEvents.filter((event) => event.type === 'learning.extra-training.started.v1')).toHaveLength(1)
  })

  it('does not mutate an already completed daily 3/3 record', async () => {
    const daily = { planId: 'daily', completedUnitIds: ['vocabulary', 'listening', 'speaking'], status: 'completed' }
    const before = structuredClone(daily)
    const events: unknown[] = []
    const configured = options()
    const runtime = new ExtraListeningTrainingRuntime({ ...configured, eventSink: { publishExtraTrainingEvent: async (event) => { events.push(event) } } })
    await runtime.initialize(); await runtime.next(); await completePlayback(runtime, configured.speech); await runtime.select('right'); await runtime.submit(); await runtime.completeCurrentItem()
    expect(daily).toEqual(before)
    expect(JSON.stringify(runtime.currentSnapshot)).not.toMatch(/planId|taskId/)
    expect(JSON.stringify(events)).not.toMatch(/planId|taskId/)
  })
})
