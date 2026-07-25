import { describe, expect, it } from 'vitest'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import { ListeningSessionRepository } from './repository.ts'
import { createListeningSession } from './session.ts'
import {
  createListeningTask,
  createListeningUnit,
} from './test-fixtures.ts'

class MemoryStore implements NamespaceStore {
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
      namespace: 'feature.listening',
      key,
      value,
      schemaVersion,
      updatedAt: '2026-07-24T00:00:00.000Z',
    })
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }

  async list<T>(): Promise<StoredRecord<T>[]> {
    return [...this.records.values()] as StoredRecord<T>[]
  }

  async keys(): Promise<string[]> {
    return [...this.records.keys()]
  }

  async clear(): Promise<void> {
    this.records.clear()
  }
}

describe('listening session repository', () => {
  it('saves and restores only the matching listening task', async () => {
    const store = new MemoryStore()
    const repository = new ListeningSessionRepository(store)
    const task = createListeningTask()
    const session = createListeningSession(
      task,
      createListeningUnit(),
      '2026-07-24T12:00:00.000Z',
    )
    await repository.save(session)
    await expect(repository.load(task)).resolves.toEqual(session)
    await expect(
      repository.load(
        createListeningTask({ planId: 'different-plan' }),
      ),
    ).rejects.toThrow(/different learning task/i)
  })

  it('rejects future storage schema versions', async () => {
    const store = new MemoryStore()
    const repository = new ListeningSessionRepository(store)
    await store.put('session:task-listening-1', {}, 2)
    await expect(
      repository.load(createListeningTask()),
    ).rejects.toThrow(/unsupported schema version/i)
  })
})
