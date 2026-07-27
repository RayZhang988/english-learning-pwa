import { describe, expect, it } from 'vitest'
import type {
  NamespaceStore,
  StoredRecord,
} from '../storage/index.ts'
import { createLearningEngineState } from './engine.ts'
import {
  LEARNING_ENGINE_STATE_KEY,
  LearningEngineRepository,
} from './repository.ts'
import { abilityProfile, abilityProfileR1 } from './test-fixtures.ts'

class MemoryNamespaceStore implements NamespaceStore {
  readonly records = new Map<string, StoredRecord<unknown>>()

  async get<T>(key: string): Promise<StoredRecord<T> | undefined> {
    return this.records.get(key) as StoredRecord<T> | undefined
  }

  async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    this.records.set(key, {
      namespace: 'learning.engine',
      key,
      value,
      schemaVersion,
      updatedAt: '2026-07-02T00:00:00.000Z',
    })
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }

  async keys(): Promise<readonly string[]> {
    return [...this.records.keys()]
  }

  async clear(): Promise<void> {
    this.records.clear()
  }
}

describe('LearningEngineRepository', () => {
  it('round-trips the current engine state', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new LearningEngineRepository(store)
    const state = createLearningEngineState(
      abilityProfile(),
      '2026-07-02T00:00:00.000Z',
    )

    await repository.save(state)
    await expect(repository.load()).resolves.toEqual(state)
    await repository.clear()
    await expect(repository.load()).resolves.toBeUndefined()
  })

  it('rejects a future business record version', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new LearningEngineRepository(store)
    await store.put(LEARNING_ENGINE_STATE_KEY, {}, 2)

    await expect(repository.load()).rejects.toThrow(
      'Unsupported learning engine state version: 2',
    )
  })

  it('round-trips additive R1 placement metadata without changing the storage schema', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new LearningEngineRepository(store)
    const state = createLearningEngineState(
      abilityProfileR1(),
      '2026-07-02T00:00:00.000Z',
    )

    await repository.save(state)

    const stored = store.records.get(LEARNING_ENGINE_STATE_KEY)
    expect(stored?.schemaVersion).toBe(1)
    await expect(repository.load()).resolves.toEqual(state)
    expect(
      (await repository.load())?.progress.r1VocabularyStartPlacement,
    ).toMatchObject({
      mappingVersion: 'learning-r1-first-day-start-v1',
      selectedStartLevel: 4.5,
    })
  })
})
