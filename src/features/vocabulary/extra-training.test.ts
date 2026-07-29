import { describe, expect, it } from 'vitest'
import { ExtraVocabularyTrainingRuntime } from './extra-training.ts'
import { ExtraVocabularyTrainingRepository } from './extra-training-repository.ts'
import type { NamespaceStore, StoredRecord } from '../../storage/index.ts'

class Store implements NamespaceStore { records = new Map<string, StoredRecord<unknown>>(); async get<T>(key:string){ return this.records.get(key) as StoredRecord<T>|undefined }; async put<T>(key:string,value:T,schemaVersion=1){ this.records.set(key,{namespace:'test',key,value,schemaVersion,updatedAt:'2026-07-29T00:00:00.000Z'}) }; async delete(key:string){this.records.delete(key)}; async keys(){return [...this.records.keys()]}; async clear(){this.records.clear()} }

const session = { schemaVersion: 1, sessionId: 'extra-vocabulary', localDate: '2026-07-29', domain: 'vocabulary', targetModuleId: 'vocabulary', mode: 'learn', targetDifficulty: 1, targetEffectiveSeconds: 900, remainingEffectiveSeconds: 900, status: 'running', nextSupplyCursor: null, excludeItemIds: [], completedItemCount: 0, startedAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z', endedAt: null, endReason: null } as const
const item = { itemId: 'supply-vocabulary-1', learningUnitId: 'unit-1', contentRef: 'lesson://unit-1', difficultyLevel: 1, tags: [], source: { sourceType: 'vocabulary-item', sourceId: 'word', variantId: 'term-to-meaning-choice', distractorItemIds: [] } } as const

describe('extra vocabulary commands', () => {
  const question = { id: 'question', type: 'term-to-meaning' as const, instructionZh: '选择', prompt: 'word', promptLocale: 'en-US' as const, partOfSpeech: null, options: [{ id: 'right', label: '对' }, { id: 'wrong', label: '错' }], correctOptionId: 'right', exampleEn: null, explanationZh: null, errorTag: 'meaning-recall' as const }
  function options() { return { session, repository: new ExtraVocabularyTrainingRepository(new Store()), supplyRequest: () => ({ schemaVersion: 1 as const, requestId: 'supply', sessionId: session.sessionId, localDate: session.localDate, domain: 'vocabulary' as const, targetModuleId: 'vocabulary' as const, mode: 'learn' as const, targetDifficulty: 1, cursor: null, excludeItemIds: [], priority: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'] as const, priorityItemIds: { 'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] }, reason: 'initial' as const }), supplyProvider: { next: async (request: { requestId: string }) => ({ schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item, nextCursor: item.itemId }) }, questionForItem: async () => question, timingSessionFactory: { create: async () => ({ start: async () => {}, transition: async () => {}, activity: async () => {}, pause: async () => {}, resume: async () => {}, finish: async () => {}, dispose: async () => {} }) }, eventSink: { publishExtraTrainingEvent: async () => {} } } }
  it('marks 899→900 as finish-current-item without truncating answering', async () => {
    const runtime = new ExtraVocabularyTrainingRuntime({ session, supplyRequest: () => null, supplyProvider: { next: async () => { throw new Error('unused') } }, questionForItem: async () => { throw new Error('unused') }, timingSessionFactory: { create: async () => ({ start: async () => {}, transition: async () => {}, activity: async () => {}, pause: async () => {}, resume: async () => {}, finish: async () => {}, dispose: async () => {} }) }, eventSink: { publishExtraTrainingEvent: async () => {} } })
    await runtime.initialize(); await runtime.recordEffectiveSeconds(899); const snapshot = await runtime.recordEffectiveSeconds(1)
    expect(snapshot.session.status).toBe('finish-current-item')
    expect(snapshot.phase).toBe('answering')
  })
  it('finishes the current feedback item once after budget expiry', async () => {
    const runtime = new ExtraVocabularyTrainingRuntime(options())
    await runtime.initialize(); await runtime.next(); await runtime.select('right'); await runtime.submit(); await runtime.markBudgetReached()
    const completed = await runtime.completeCurrentItem()
    expect(completed.session.status).toBe('completed')
    expect(completed.pendingEvents.map((event) => event.type)).toEqual(expect.arrayContaining(['learning.extra-training.attempt.completed.v1', 'learning.extra-training.item.completed.v1', 'learning.extra-training.budget.completed.v1']))
    await expect(runtime.completeCurrentItem()).rejects.toThrow()
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
      supplyRequest: () => ({ ...(options().supplyRequest()!), priorityItemIds: { 'recent-error': [item.itemId], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] } }),
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

  it('rejects provider failures instead of disguising them as recoverable exhaustion', async () => {
    const runtime = new ExtraVocabularyTrainingRuntime({
      ...options(),
      supplyProvider: { next: async (request) => ({ schemaVersion: 1 as const, requestId: request.requestId, status: 'content-exhausted' as const, reason: 'provider-failure' as const }) },
    })
    await runtime.initialize(); await runtime.next()
    expect(runtime.currentSnapshot?.session.endReason).toBe('provider-failure')
    await expect(runtime.retryContent()).rejects.toThrow('Only content-exhausted')
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
})
