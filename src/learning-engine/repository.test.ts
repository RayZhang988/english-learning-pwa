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

  it('reads a legacy schema 1 record without duration samples and preserves new timing history', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new LearningEngineRepository(store)
    const current = createLearningEngineState(
      abilityProfile(),
      '2026-07-02T00:00:00.000Z',
    )
    const { durationSamples: _durationSamples, ...legacyProgress } =
      current.progress
    const legacy = {
      ...current,
      progress: legacyProgress,
    }
    await store.put(LEARNING_ENGINE_STATE_KEY, legacy, 1)
    await expect(repository.load()).resolves.toEqual(legacy)

    const withTiming = {
      ...current,
      progress: {
        ...current.progress,
        durationSamples: [
          {
            sampleId: 'sample-1',
            taskId: 'task-1',
            learningUnitId: 'unit-1',
            domain: 'vocabulary' as const,
            mode: 'learn' as const,
            contentType: 'multiple-choice-set',
            profileKey:
              'vocabulary|learn|multiple-choice-set',
            effectiveSeconds: 120,
            source: 'timing-segments' as const,
            reliable: true,
            completedAt: '2026-07-02T00:02:00.000Z',
          },
        ],
      },
    }
    await repository.save(withTiming)
    await expect(repository.load()).resolves.toEqual(withTiming)
  })

  it('reads a legacy schema 1 record that predates the recent-training ledger', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new LearningEngineRepository(store)
    const current = createLearningEngineState(
      abilityProfile(),
      '2026-08-11T00:00:00.000Z',
    )
    const { recentTrainingItemIds: _recentTrainingItemIds, ...legacy } = current

    await store.put(LEARNING_ENGINE_STATE_KEY, legacy, 1)

    await expect(repository.load()).resolves.toEqual(legacy)
  })

  it('rejects malformed recent-training ledgers instead of silently accepting duplicate identities', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new LearningEngineRepository(store)
    const state = createLearningEngineState(
      abilityProfile(),
      '2026-08-11T00:00:00.000Z',
    )
    await store.put(LEARNING_ENGINE_STATE_KEY, {
      ...state,
      recentTrainingItemIds: { 'vocabulary:learn:3': ['same-item', 'same-item'] },
    }, 1)

    await expect(repository.load()).rejects.toThrow('recentTrainingItemIds is invalid')
  })

  it('rejects legacy scored attempts masquerading as trusted timing samples', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new LearningEngineRepository(store)
    const state = createLearningEngineState(
      abilityProfile(),
      '2026-07-02T00:00:00.000Z',
    )
    await store.put(
      LEARNING_ENGINE_STATE_KEY,
      {
        ...state,
        progress: {
          ...state.progress,
          durationSamples: [
            {
              sampleId: 'legacy-attempt',
              taskId: 'task-legacy',
              learningUnitId: 'unit-legacy',
              domain: 'vocabulary',
              mode: 'learn',
              contentType: 'general',
              profileKey: 'vocabulary|learn|general',
              effectiveSeconds: 120,
              source: 'legacy-scored-attempt',
              reliable: true,
              completedAt: '2026-07-02T00:00:00.000Z',
            },
          ],
        },
      },
      1,
    )

    await expect(repository.load()).rejects.toThrow(
      'Stored learning engine state is invalid',
    )
  })

  it('round-trips additive R6 extra-training state while legacy schema 1 records still omit it', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new LearningEngineRepository(store)
    const state = createLearningEngineState(abilityProfile(), '2026-07-29T00:00:00.000Z')
    const withExtraTraining = {
      ...state,
      extraTraining: {
        schemaVersion: 1 as const,
        processedEventIds: ['extra-event-1'],
        sessions: {
          'extra-1': {
            schemaVersion: 1 as const, sessionId: 'extra-1', localDate: '2026-07-29',
            domain: 'speaking' as const, targetModuleId: 'speaking' as const, mode: 'learn' as const,
            targetDifficulty: 3, targetEffectiveSeconds: 900 as const, remainingEffectiveSeconds: 600,
            status: 'paused' as const, nextSupplyCursor: 'cursor-1', excludeItemIds: ['item-1'], completedItemCount: 1,
            priorityItemIds: {
              'recent-error': ['published-error-1'], 'due-review': ['published-due-1'],
              'same-day-variant': ['published-variant-1'], 'new-optional-content': [],
            },
            startedAt: '2026-07-29T01:00:00.000Z', updatedAt: '2026-07-29T01:05:00.000Z', endedAt: '2026-07-29T01:05:00.000Z', endReason: 'user-exited' as const,
          },
        },
      },
    }
    await repository.save(withExtraTraining)
    await expect(repository.load()).resolves.toEqual(withExtraTraining)
    await repository.save(state)
    await expect(repository.load()).resolves.toEqual(state)
  })
})
