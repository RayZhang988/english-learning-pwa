import { describe, expect, it } from 'vitest'
import { ExtraVocabularyTrainingRuntime } from './extra-training.ts'
import { ExtraVocabularyTrainingRepository } from './extra-training-repository.ts'
import {
  ExtraVocabularyTrainingRuntime as BarrelRuntime,
  ExtraVocabularyTrainingRepository as BarrelRepository,
} from './index.ts'
import type { NamespaceStore, StoredRecord } from '../../storage/index.ts'
import type { ExtraTrainingSession } from '../../learning-engine/index.ts'
import { applyWrongAnswerEvidence, createWrongAnswerLibraryState, type WrongAnswerEvidence } from '../../learning-engine/index.ts'
import type { WrongAnswerEvidenceSink } from './wrong-answer-review.ts'

class Store implements NamespaceStore { records = new Map<string, StoredRecord<unknown>>(); async get<T>(key:string){ return this.records.get(key) as StoredRecord<T>|undefined }; async put<T>(key:string,value:T,schemaVersion=1){ this.records.set(key,{namespace:'test',key,value,schemaVersion,updatedAt:'2026-07-29T00:00:00.000Z'}) }; async delete(key:string){this.records.delete(key)}; async keys(){return [...this.records.keys()]}; async clear(){this.records.clear()} }

const session = { schemaVersion: 1, sessionId: 'extra-vocabulary', localDate: '2026-07-29', domain: 'vocabulary', targetModuleId: 'vocabulary', mode: 'learn', targetDifficulty: 1, completionMode: 'open-ended', effectiveSeconds: 0, status: 'running', nextSupplyCursor: null, excludeItemIds: [], completedItemCount: 0, startedAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z', endedAt: null, endReason: null } as const
const item = { itemId: 'supply-vocabulary-1', learningUnitId: 'unit-1', contentRef: 'lesson://unit-1', difficultyLevel: 1, tags: [], source: { sourceType: 'vocabulary-item', sourceId: 'word', variantId: 'term-to-meaning-choice', distractorItemIds: [] } } as const

describe('extra vocabulary commands', () => {
  const question = { id: 'question', type: 'term-to-meaning' as const, instructionZh: '选择', prompt: 'word', promptLocale: 'en-US' as const, partOfSpeech: null, options: [{ id: 'right', label: '对' }, { id: 'wrong', label: '错' }], correctOptionId: 'right', exampleEn: null, explanationZh: null, errorTag: 'meaning-recall' as const }
  function options() { return { session, repository: new ExtraVocabularyTrainingRepository(new Store()), supplyRequest: (current: ExtraTrainingSession) => ({ schemaVersion: 1 as const, requestId: 'supply', sessionId: current.sessionId, localDate: current.localDate, domain: 'vocabulary' as const, targetModuleId: 'vocabulary' as const, mode: 'learn' as const, targetDifficulty: current.targetDifficulty, cursor: current.nextSupplyCursor, excludeItemIds: current.excludeItemIds, priority: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'] as const, priorityItemIds: { 'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] }, reason: 'initial' as const }), supplyProvider: { next: async (request: { requestId: string }) => ({ schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item, nextCursor: item.itemId }) }, questionForItem: async () => question, timingSessionFactory: { create: async () => ({ start: async () => {}, transition: async () => {}, activity: async () => {}, pause: async () => {}, resume: async () => {}, finish: async () => {}, dispose: async () => {} }) }, eventSink: { publishExtraTrainingEvent: async () => {} } } }
  it('continues after 900 effective seconds without truncating answering', async () => {
    const runtime = new ExtraVocabularyTrainingRuntime({ session, supplyRequest: () => null, supplyProvider: { next: async () => { throw new Error('unused') } }, questionForItem: async () => { throw new Error('unused') }, timingSessionFactory: { create: async () => ({ start: async () => {}, transition: async () => {}, activity: async () => {}, pause: async () => {}, resume: async () => {}, finish: async () => {}, dispose: async () => {} }) }, eventSink: { publishExtraTrainingEvent: async () => {} } })
    await runtime.initialize(); await runtime.recordEffectiveSeconds(899); const snapshot = await runtime.recordEffectiveSeconds(1)
    expect(snapshot.session).toMatchObject({ status: 'running', effectiveSeconds: 900 })
    expect(snapshot.phase).toBe('answering')
  })
  it('records the current feedback item once and keeps the session open', async () => {
    const runtime = new ExtraVocabularyTrainingRuntime(options())
    await runtime.initialize(); await runtime.next(); await runtime.select('right'); await runtime.submit(); await runtime.markBudgetReached()
    const completed = await runtime.completeCurrentItem()
    expect(completed.session.status).toBe('running')
    expect(completed.pendingEvents.map((event) => event.type)).toEqual(['learning.extra-training.started.v1', 'learning.extra-training.attempt.completed.v1', 'learning.extra-training.item.completed.v1'])
    expect(completed.pendingEvents.map((event) => event.type)).not.toContain('learning.extra-training.budget.completed.v1')
    await expect(runtime.completeCurrentItem()).rejects.toThrow()
  })
  it('atomically advances ordinary feedback once without asking the host to alter a snapshot', async () => {
    const runtime = new ExtraVocabularyTrainingRuntime(options())
    await runtime.initialize(); await runtime.next(); await runtime.select('right'); await runtime.submit()
    const advanced = await runtime.advanceAfterFeedback()
    expect(advanced.phase).toBe('answering')
    expect(advanced.session.completedItemCount).toBe(1)
    expect(advanced.pendingEvents.filter((event) => event.type === 'learning.extra-training.attempt.completed.v1')).toHaveLength(1)
    await expect(runtime.advanceAfterFeedback()).rejects.toThrow('feedback')
  })
  it('persists exit and replays a failed outbox event with the same identity', async () => {
    const repository = new ExtraVocabularyTrainingRepository(new Store())
    let failed = false; const events: string[] = []
    const first = new ExtraVocabularyTrainingRuntime({ ...options(), repository, eventSink: { publishExtraTrainingEvent: async (event) => { if (!failed) { failed = true; throw new Error('fail once') }; events.push(event.id) } } })
    await first.initialize(); await first.next(); const exited = await first.exit(); const id = exited.pendingEvents.at(-1)!.id
    await expect(first.flush()).rejects.toThrow('fail once')
    const second = new ExtraVocabularyTrainingRuntime({ ...options(), repository, eventSink: { publishExtraTrainingEvent: async (event) => { events.push(event.id) } } })
    const restored = await second.initialize(); expect(restored.activeItem?.itemId).toBe(item.itemId); expect(restored.session.status).toBe('paused')
    await second.flush(); await second.flush(); expect(events.filter((eventId) => eventId === id)).toEqual([id])
  })
  it('forwards exact priority ids and never emits a daily task identity', async () => {
    let request: unknown
    const runtime = new ExtraVocabularyTrainingRuntime({
      ...options(),
      supplyRequest: (current) => ({ ...(options().supplyRequest(current)!), priorityItemIds: { 'recent-error': [item.itemId], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] } }),
      supplyProvider: { next: async (value) => { request = value; return { schemaVersion: 1 as const, requestId: value.requestId, status: 'item' as const, item, nextCursor: item.itemId } } },
    })
    await runtime.initialize(); await runtime.next()
    expect(request).toMatchObject({ priorityItemIds: { 'recent-error': [item.itemId] } })
    expect(JSON.stringify(runtime.currentSnapshot)).not.toContain('planId')
    expect(JSON.stringify(runtime.currentSnapshot)).not.toContain('taskId')
  })

  it('keeps progress when content is exhausted and only retries acknowledged exhaustion', async () => {
    let available = false
    const runtime = new ExtraVocabularyTrainingRuntime({
      ...options(),
      session: { ...session, completedItemCount: 2, nextSupplyCursor: 'previous-item', excludeItemIds: ['previous-item'] },
      supplyProvider: { next: async (request) => available
        ? { schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item, nextCursor: item.itemId }
        : { schemaVersion: 1 as const, requestId: request.requestId, status: 'content-exhausted' as const, reason: 'no-eligible-content' as const },
      },
    })
    await runtime.initialize()
    const exhausted = await runtime.next()
    expect(exhausted.session.endReason).toBe('content-exhausted')
    expect(exhausted.session.completedItemCount).toBe(2)
    available = true
    const recovered = await runtime.retryContent()
    expect(recovered.phase).toBe('answering')
    expect(recovered.activeItem?.itemId).toBe(item.itemId)
    expect(recovered.session.excludeItemIds).toEqual(['previous-item'])
    expect(recovered.session.nextSupplyCursor).toBe('previous-item')
  })

  it('retries a provider failure with the same cursor/exclusions and preserves prior failure delivery', async () => {
    let available = false
    const runtime = new ExtraVocabularyTrainingRuntime({
      ...options(),
      session: { ...session, nextSupplyCursor: 'cursor-1', excludeItemIds: ['done-1'] },
      supplyProvider: { next: async (request) => {
        expect(request.cursor).toBe('cursor-1')
        expect(request.excludeItemIds).toEqual(['done-1'])
        return available
          ? { schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item, nextCursor: item.itemId }
          : { schemaVersion: 1 as const, requestId: request.requestId, status: 'content-exhausted' as const, reason: 'provider-failure' as const }
      } },
    })
    await runtime.initialize(); await runtime.next()
    expect(runtime.currentSnapshot?.session.endReason).toBe('provider-failure')
    const failedEventId = runtime.currentSnapshot!.pendingEvents.at(-1)!.id
    available = true
    const recovered = await runtime.retry()
    expect(recovered.session.status).toBe('running')
    expect(recovered.pendingEvents.map((event) => event.id)).toContain(failedEventId)
    expect(recovered.pendingEvents.map((event) => event.type).slice(-1)).toEqual(['learning.extra-training.started.v1'])
  })

  it('keeps the same failed checkpoint when a retry fails again', async () => {
    const runtime = new ExtraVocabularyTrainingRuntime({ ...options(), supplyProvider: { next: async (request) => ({ schemaVersion: 1 as const, requestId: request.requestId, status: 'content-exhausted' as const, reason: 'provider-failure' as const }) } })
    await runtime.initialize(); const failed = await runtime.next(); const ids = failed.pendingEvents.map((event) => event.id)
    const retried = await runtime.retry()
    expect(retried).toEqual(failed)
    expect(retried.pendingEvents.map((event) => event.id)).toEqual(ids)
  })

  it('exports runtime and repository through the vocabulary barrel', () => {
    expect(BarrelRuntime).toBe(ExtraVocabularyTrainingRuntime)
    expect(BarrelRepository).toBe(ExtraVocabularyTrainingRepository)
  })

  it('never mutates a completed daily plan snapshot', async () => {
    const completedPlan = { planId: 'daily-3-of-3', completedUnitIds: ['vocabulary', 'listening', 'speaking'], status: 'completed' }
    const before = structuredClone(completedPlan)
    const events: unknown[] = []
    const runtime = new ExtraVocabularyTrainingRuntime({ ...options(), eventSink: { publishExtraTrainingEvent: async (event) => { events.push(event) } } })
    await runtime.initialize(); await runtime.next(); await runtime.select('right'); await runtime.submit(); await runtime.completeCurrentItem(); await runtime.flush()
    expect(completedPlan).toEqual(before)
    expect(JSON.stringify(events)).not.toMatch(/planId|taskId/)
  })
  it('persists and replays one failed extra wrong-answer evidence without changing ordinary feedback', async () => {
    const repository = new ExtraVocabularyTrainingRepository(new Store()); let state = createWrongAnswerLibraryState(); let failed = true; const ids: string[] = []
    const sink: WrongAnswerEvidenceSink = { async publish(evidence: WrongAnswerEvidence) { ids.push(evidence.eventId); if (failed) { failed = false; throw new Error('sink failed') }; state = applyWrongAnswerEvidence(state, evidence).state } }
    const review = { identityForItem: async () => ({ reviewContentId: 'extra-content', originalQuestionType: 'vocabulary-term-to-meaning-choice', domain: 'vocabulary' as const, source: {} }), sink }
    const first = new ExtraVocabularyTrainingRuntime({ ...options(), repository, wrongAnswerReview: review }); await first.initialize(); await first.next(); await first.select('wrong'); await expect(first.submit()).rejects.toThrow('sink failed'); expect(first.currentSnapshot?.phase).toBe('feedback'); expect(first.currentSnapshot?.pendingWrongAnswerEvidence).toHaveLength(1)
    const second = new ExtraVocabularyTrainingRuntime({ ...options(), repository, wrongAnswerReview: review }); const restored = await second.initialize(); expect(restored.pendingWrongAnswerEvidence).toEqual([]); expect(ids[0]).toBe(ids[1]); expect(Object.values(state.records)[0]?.incorrectCount).toBe(1)
  })
})
