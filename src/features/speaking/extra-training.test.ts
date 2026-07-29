import { describe, expect, it } from 'vitest'
import type { NamespaceStore, StoredRecord } from '../../storage/index.ts'
import { ExtraSpeakingTrainingRuntime } from './extra-training.ts'
import { ExtraSpeakingTrainingRepository } from './extra-training-repository.ts'
import type { SpeakingRecognitionPort, SpeakingRecordingPort, SpeakingSupplyItem } from './types.ts'

class Store implements NamespaceStore {
  records = new Map<string, StoredRecord<unknown>>()
  async get<T>(key: string) { return this.records.get(key) as StoredRecord<T> | undefined }
  async put<T>(key: string, value: T, schemaVersion = 1) { this.records.set(key, { namespace: 'test', key, value, schemaVersion, updatedAt: '2026-07-29T00:00:00.000Z' }) }
  async delete(key: string) { this.records.delete(key) }
  async keys() { return [...this.records.keys()] }
  async clear() { this.records.clear() }
}

const session = { schemaVersion: 1 as const, sessionId: 'extra-speaking', localDate: '2026-07-29', domain: 'speaking' as const, targetModuleId: 'speaking' as const, mode: 'learn' as const, targetDifficulty: 1, targetEffectiveSeconds: 900, remainingEffectiveSeconds: 900, status: 'running' as const, nextSupplyCursor: null, excludeItemIds: [], completedItemCount: 0, startedAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z', endedAt: null, endReason: null }
const item = { itemId: 'speaking-supply-1', learningUnitId: 'unit-1', contentRef: 'lesson://unit-1', difficultyLevel: 1, tags: ['travel'], source: { sourceType: 'speaking-prompt' as const, sourceId: 'prompt', variantId: 'activity-prompt' as const } }
const sceneItem = { ...item, itemId: 'scene-supply-1', source: { sourceType: 'speaking-scene-quiz' as const, sourceId: 'scene', variantId: 'scene-fixed-response' as const } }
const prompt = { id: 'prompt', cueZh: '说你好', partnerLine: 'Hello.', modelAnswer: 'Hello.', acceptedAnswers: ['hello'], requiredConcepts: ['hello'] }
const unit = { learningUnitId: 'unit-1', contentRef: 'lesson://unit-1', difficultyLevel: 1, estimatedSeconds: 12, tags: ['travel'], activityType: 'fixed-response' as const, instructionsZh: '说英语', prompts: [prompt], scenePrompts: [prompt] }

class Recorder implements SpeakingRecordingPort {
  lifecycle: Parameters<SpeakingRecordingPort['start']>[1]
  playback: Parameters<SpeakingRecordingPort['play']>[1]
  capabilities() { return { supported: true, supportedMimeTypes: ['audio/webm'] } }
  start(_stream: MediaStream, lifecycle?: Parameters<SpeakingRecordingPort['start']>[1]) { this.lifecycle = lifecycle; lifecycle?.onStarted() }
  async stop() { this.lifecycle?.onStopped(); return { id: 'recording', blob: new Blob(), mimeType: 'audio/webm', durationMs: 1000 } }
  cancel() {}
  async play(_recording: Awaited<ReturnType<SpeakingRecordingPort['stop']>>, lifecycle?: Parameters<SpeakingRecordingPort['play']>[1]) { this.playback = lifecycle; lifecycle?.onStarted(); lifecycle?.onEnded() }
  stopPlayback() {}
  discard() {}
  dispose() {}
}

function recognition(outcome: 'recognized' | 'network'): SpeakingRecognitionPort {
  return { capabilities: () => ({ supported: true, requiresSiri: true }), start: () => ({ result: Promise.resolve(outcome === 'recognized' ? { status: 'recognized', transcript: 'hello', alternatives: [] } : { status: 'failed', code: 'network', message: 'offline' }), stop() {}, abort() {} }) }
}
function request() { return { schemaVersion: 1 as const, requestId: 'request-1', sessionId: session.sessionId, localDate: session.localDate, domain: 'speaking' as const, targetModuleId: 'speaking' as const, mode: 'learn' as const, targetDifficulty: 1, cursor: null, excludeItemIds: [], priority: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'] as const, priorityItemIds: { 'recent-error': ['error'], 'due-review': ['due'], 'same-day-variant': ['same'], 'new-optional-content': ['new'] }, reason: 'initial' as const } }
function options(suppliedItem: SpeakingSupplyItem = item, outcome: 'recognized' | 'network' = 'recognized') {
  const timing: string[] = []
  return { session, repository: new ExtraSpeakingTrainingRepository(new Store()), recorder: new Recorder(), recognition: recognition(outcome), requestMicrophone: async () => ({} as MediaStream), supplyRequest: () => request(), supplyProvider: { next: async (value: { requestId: string }) => ({ schemaVersion: 1 as const, requestId: value.requestId, status: 'item' as const, item: suppliedItem, nextCursor: suppliedItem.itemId }) }, promptForItem: async () => ({ unit, prompt }), timingSessionFactory: { create: async () => ({ start: async (value: { phase: string }) => { timing.push(`start:${value.phase}`) }, transition: async (value: { phase: string }) => { timing.push(`transition:${value.phase}`) }, activity: async () => {}, pause: async () => { timing.push('pause') }, resume: async (value: { phase: string }) => { timing.push(`resume:${value.phase}`) }, finish: async () => { timing.push('finish') }, dispose: async () => {} }) }, eventSink: { publishExtraTrainingEvent: async () => {} }, timing }
}

describe('extra speaking training', () => {
  it('requests all four priorities and resolves both released prompt and scene-quiz items without daily identities', async () => {
    for (const suppliedItem of [item, sceneItem]) {
      let supplied: unknown
      const configured = options(suppliedItem)
      const runtime = new ExtraSpeakingTrainingRuntime({ ...configured, supplyProvider: { next: async (value) => { supplied = value; return { schemaVersion: 1 as const, requestId: value.requestId, status: 'item' as const, item: suppliedItem, nextCursor: suppliedItem.itemId } } } })
      await runtime.initialize(); await runtime.next()
      expect(supplied).toEqual(request())
      expect(runtime.currentSnapshot?.prompt?.acceptedAnswers).toEqual(['hello'])
      expect(JSON.stringify(runtime.currentSnapshot)).not.toMatch(/planId|taskId/)
    }
  })

  it('keeps recording through budget expiry, then publishes attempt, item, budget after feedback', async () => {
    const configured = options()
    const published: string[] = []
    const runtime = new ExtraSpeakingTrainingRuntime({ ...configured, eventSink: { publishExtraTrainingEvent: async (event) => { published.push(event.type) } } })
    await runtime.initialize(); await runtime.next(); await runtime.startRecording(); await runtime.recordEffectiveSeconds(900)
    expect(runtime.currentSnapshot?.session.status).toBe('finish-current-item')
    await runtime.stopRecording(); await runtime.playRecording(); await runtime.completeCurrentItem(); await runtime.flush()
    expect(runtime.currentSnapshot?.session.status).toBe('completed')
    expect(published.slice(-3)).toEqual(['learning.extra-training.attempt.completed.v1', 'learning.extra-training.item.completed.v1', 'learning.extra-training.budget.completed.v1'])
    expect(configured.timing).toContain('start:recording')
    expect(configured.timing).toContain('finish')
  })

  it('records an unscorable network fallback without inventing a score and can exit then restore', async () => {
    const configured = options(item, 'network')
    const first = new ExtraSpeakingTrainingRuntime(configured)
    await first.initialize(); await first.next(); await first.startRecording(); await first.stopRecording()
    expect(first.currentSnapshot?.answer).toMatchObject({ transcript: null, failureCategory: 'network', fallbackReason: 'recognition-network' })
    await first.exit()
    const restored = new ExtraSpeakingTrainingRuntime({ ...configured, repository: configured.repository })
    await restored.initialize()
    expect(restored.currentSnapshot?.session.status).toBe('paused')
    expect(restored.currentSnapshot?.session.completedItemCount).toBe(0)
  })

  it('retries content exhaustion through refresh without changing cursor, exclusions, or the original failed event', async () => {
    let available = false
    const repository = new ExtraSpeakingTrainingRepository(new Store())
    const configured = { ...options(), repository, session: { ...session, completedItemCount: 2, nextSupplyCursor: 'previous-item', excludeItemIds: ['previous-item'] }, supplyProvider: { next: async (value: { requestId: string }) => available ? { schemaVersion: 1 as const, requestId: value.requestId, status: 'item' as const, item, nextCursor: item.itemId } : { schemaVersion: 1 as const, requestId: value.requestId, status: 'content-exhausted' as const, reason: 'no-eligible-content' as const } } }
    const runtime = new ExtraSpeakingTrainingRuntime(configured)
    await runtime.initialize(); const exhausted = await runtime.next()
    const failedId = exhausted.pendingEvents.at(-1)!.id
    const refreshed = new ExtraSpeakingTrainingRuntime(configured)
    await refreshed.initialize()
    expect(refreshed.currentSnapshot?.session.endReason).toBe('content-exhausted')
    available = true
    const [recovered, repeated] = await Promise.all([refreshed.retryFailure(), refreshed.retryFailure()])
    expect(recovered.activeItem?.itemId).toBe(item.itemId)
    expect(repeated.pendingEvents.filter((event) => event.type === 'learning.extra-training.started.v1')).toHaveLength(2)
    expect(recovered.session.excludeItemIds).toEqual(['previous-item'])
    expect(recovered.session.nextSupplyCursor).toBe('previous-item')
    expect(recovered.pendingEvents.map((event) => event.id)).toContain(failedId)
    expect(recovered.pendingEvents.map((event) => event.type)).toEqual([
      'learning.extra-training.started.v1',
      'learning.extra-training.failed.v1',
      'learning.extra-training.started.v1',
    ])
  })

  it('retries provider failure with a released scene-quiz, but preserves failure when the provider still fails', async () => {
    let recovered = false
    const runtime = new ExtraSpeakingTrainingRuntime({ ...options(sceneItem), supplyProvider: { next: async (value) => recovered ? { schemaVersion: 1 as const, requestId: value.requestId, status: 'item' as const, item: sceneItem, nextCursor: sceneItem.itemId } : { schemaVersion: 1 as const, requestId: value.requestId, status: 'content-exhausted' as const, reason: 'provider-failure' as const } } })
    await runtime.initialize(); const failed = await runtime.next(); const failedEventId = failed.pendingEvents.at(-1)!.id
    const stillFailed = await runtime.retryFailure()
    expect(stillFailed.session.endReason).toBe('provider-failure')
    expect(stillFailed.pendingEvents.at(-1)?.id).toBe(failedEventId)
    recovered = true
    const next = await runtime.retryFailure()
    expect(next.activeItem?.source.sourceType).toBe('speaking-scene-quiz')
    expect(next.pendingEvents.filter((event) => event.type === 'learning.extra-training.started.v1')).toHaveLength(2)
  })

  it('replays a failed outbox event with its stable identity and leaves a daily 3/3 record unchanged', async () => {
    const repository = new ExtraSpeakingTrainingRepository(new Store())
    let failed = false; const delivered: string[] = []
    const first = new ExtraSpeakingTrainingRuntime({ ...options(), repository, eventSink: { publishExtraTrainingEvent: async (event) => { if (!failed) { failed = true; throw new Error('fail once') }; delivered.push(event.id) } } })
    await first.initialize(); await first.next(); const exited = await first.exit(); const exitId = exited.pendingEvents.at(-1)!.id
    await expect(first.flush()).rejects.toThrow('fail once')
    const dailyPlan = { planId: 'daily-3-of-3', completedUnitIds: ['vocabulary', 'listening', 'speaking'], status: 'completed' }
    const before = structuredClone(dailyPlan)
    const restored = new ExtraSpeakingTrainingRuntime({ ...options(), repository, eventSink: { publishExtraTrainingEvent: async (event) => { delivered.push(event.id) } } })
    await restored.initialize(); await restored.flush(); await restored.flush()
    expect(delivered.filter((id) => id === exitId)).toEqual([exitId])
    expect(dailyPlan).toEqual(before)
    expect(JSON.stringify(restored.currentSnapshot)).not.toMatch(/planId|taskId/)
  })
})
