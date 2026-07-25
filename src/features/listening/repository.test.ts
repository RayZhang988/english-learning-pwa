import { describe, expect, it } from 'vitest'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import { ListeningSessionRepository } from './repository.ts'
import { createListeningSession } from './session.ts'
import {
  choiceQuestion,
  createListeningTask,
  createListeningUnit,
} from './test-fixtures.ts'
import type {
  ListeningQuestion,
  ListeningSession,
} from './types.ts'

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

  it('upgrades legacy speaker-prefixed passage sessions without losing playback evidence', async () => {
    const store = new MemoryStore()
    const repository = new ListeningSessionRepository(store)
    const task = createListeningTask()
    const base = createListeningSession(
      task,
      createListeningUnit(),
      '2026-07-24T12:00:00.000Z',
    )
    const legacySegmentId = `${task.learningUnitId}:passage`
    const legacyQuestion = {
      ...choiceQuestion,
      id: 'legacy-core-check',
      type: 'core-information',
      primarySegmentId: legacySegmentId,
      segments: [
        {
          id: legacySegmentId,
          locale: 'en-US',
          text: 'Alex: Good morning. Blair: Hello. Alex: One ticket.',
          label: '完整场景',
          speaker: null,
        },
      ],
      playbackPolicy: {
        allowSegmentSelection: false,
        allowRepeat: true,
        allowedRates: [0.75, 1, 1.25],
      },
    } as unknown as ListeningQuestion
    const legacySession = {
      ...base,
      transcript: [
        {
          id: 'line-1',
          speaker: 'Alex',
          text: 'Good morning.',
          translationZh: '早上好。',
        },
        {
          id: 'line-2',
          speaker: 'Blair',
          text: 'Hello.',
          translationZh: '你好。',
        },
        {
          id: 'line-3',
          speaker: 'Alex',
          text: 'One ticket.',
          translationZh: '一张票。',
        },
      ],
      questions: [legacyQuestion],
      playback: {
        ...base.playback,
        currentSegmentId: legacySegmentId,
        playCounts: { [legacySegmentId]: 1 },
      },
    } satisfies ListeningSession
    await repository.save(legacySession)

    const restored = await repository.load(task)

    expect(restored?.questions[0].playbackPolicy).toMatchObject({
      sequenceMode: 'all-segments',
      allowSegmentSelection: true,
    })
    expect(
      restored?.questions[0].segments.map(({ text, speaker }) => ({
        text,
        speaker,
      })),
    ).toEqual([
      { text: 'Good morning.', speaker: 'Alex' },
      { text: 'Hello.', speaker: 'Blair' },
      { text: 'One ticket.', speaker: 'Alex' },
    ])
    expect(restored?.playback).toMatchObject({
      currentSegmentId: `${task.learningUnitId}:passage:0`,
      playCounts: {
        [`${task.learningUnitId}:passage:0`]: 1,
      },
    })
  })
})
