import { describe, expect, it } from 'vitest'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import { SpeakingSessionRepository } from './repository.ts'
import { createSpeakingSession } from './session.ts'
import {
  createSpeakingTask,
  createSpeakingUnit,
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
      namespace: 'feature.speaking',
      key,
      value,
      schemaVersion,
      updatedAt: '2026-07-24T00:00:00.000Z',
    })
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }

  async keys(): Promise<string[]> {
    return [...this.records.keys()]
  }

  async clear(): Promise<void> {
    this.records.clear()
  }
}

describe('speaking session repository', () => {
  it('restores portable state without claiming an old Blob is playable', async () => {
    const task = createSpeakingTask()
    const repository = new SpeakingSessionRepository(new MemoryStore())
    const session = {
      ...createSpeakingSession(
        task,
        createSpeakingUnit(),
        'granted',
        'online',
        {
          supported: true,
          supportedMimeTypes: ['audio/mp4'],
        },
        { supported: true, requiresSiri: true },
        '2026-07-24T12:00:00.000Z',
      ),
      recorder: {
        status: 'review' as const,
        durationMs: 1_000,
        playbackAvailable: true,
        message: '录音可回放',
      },
    }
    await repository.save(session)

    const restored = await repository.load(task)

    expect(restored?.recorder.playbackAvailable).toBe(false)
  })

  it('rejects a stored session for a different learning task', async () => {
    const store = new MemoryStore()
    const repository = new SpeakingSessionRepository(store)
    const task = createSpeakingTask()
    await repository.save(
      createSpeakingSession(
        task,
        createSpeakingUnit(),
        'granted',
        'online',
        {
          supported: true,
          supportedMimeTypes: ['audio/mp4'],
        },
        { supported: true, requiresSiri: true },
        '2026-07-24T12:00:00.000Z',
      ),
    )

    await expect(
      repository.load(
        createSpeakingTask({
          planId: 'another-plan',
          taskId: task.taskId,
        }),
      ),
    ).rejects.toThrow(/invalid identity/i)
  })
})
