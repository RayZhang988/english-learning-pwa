import { describe, expect, it } from 'vitest'
import type { NamespaceStore, StoredRecord } from '../../storage/index.ts'
import { ExtraVocabularyTrainingRepository } from './extra-training-repository.ts'
import type { ExtraVocabularyTrainingSnapshot } from './extra-training.ts'

class MemoryStore implements NamespaceStore {
  readonly records = new Map<string, StoredRecord<unknown>>()
  async get<T>(key: string) { return this.records.get(key) as StoredRecord<T> | undefined }
  async put<T>(key: string, value: T, schemaVersion = 1) { this.records.set(key, { namespace: 'test', key, value, schemaVersion, updatedAt: '2026-07-29T00:00:00.000Z' }) }
  async delete(key: string) { this.records.delete(key) }
  async keys() { return [...this.records.keys()] }
  async clear() { this.records.clear() }
}

describe('extra vocabulary repository', () => {
  it('round-trips a session-id scoped portable checkpoint without daily identity', async () => {
    const repository = new ExtraVocabularyTrainingRepository(new MemoryStore())
    const snapshot = { schemaVersion: 1, session: { schemaVersion: 1, sessionId: 'extra-vocabulary-1', localDate: '2026-07-29', domain: 'vocabulary', targetModuleId: 'vocabulary', mode: 'learn', targetDifficulty: 1, targetEffectiveSeconds: 900, remainingEffectiveSeconds: 900, status: 'running', nextSupplyCursor: null, excludeItemIds: [], completedItemCount: 0, startedAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z', endedAt: null, endReason: null }, question: null, activeItem: null, selectedOptionId: null, phase: 'answering', pendingEvents: [], updatedAt: '2026-07-29T00:00:00.000Z' } as ExtraVocabularyTrainingSnapshot
    await repository.save(snapshot)
    const restored = await repository.load('extra-vocabulary-1')
    expect(restored).toEqual(snapshot)
    expect(JSON.stringify(restored)).not.toContain('planId')
    expect(JSON.stringify(restored)).not.toContain('taskId')
  })

  it('discards corrupt checkpoints instead of restoring an unsafe session', async () => {
    const store = new MemoryStore()
    const repository = new ExtraVocabularyTrainingRepository(store)
    await store.put('session:extra-vocabulary-1', { schemaVersion: 1, session: { sessionId: 'other-session' } })
    await expect(repository.load('extra-vocabulary-1')).resolves.toBeUndefined()
    await expect(store.get('session:extra-vocabulary-1')).resolves.toBeUndefined()
  })
})
