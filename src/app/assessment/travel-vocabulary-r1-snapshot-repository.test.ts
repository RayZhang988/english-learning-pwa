import { describe, expect, it } from 'vitest'
import {
  ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
  createTravelVocabularyAssessmentRuntimeR1,
  TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
  VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
} from '../../features/assessment/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import {
  TRAVEL_VOCABULARY_CORRUPT_BACKUP_PREFIX_R1,
  TravelVocabularyR1SnapshotRepository,
} from './travel-vocabulary-r1-snapshot-repository.ts'

class MemoryNamespaceStore implements NamespaceStore {
  readonly records = new Map<string, StoredRecord<unknown>>()
  readonly namespace = 'feature.assessment'

  async get<T>(key: string): Promise<StoredRecord<T> | undefined> {
    return this.records.get(key) as StoredRecord<T> | undefined
  }

  async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    this.records.set(key, {
      namespace: this.namespace,
      key,
      value,
      schemaVersion,
      updatedAt: '2026-07-27T08:00:00.000Z',
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

describe('TravelVocabularyR1SnapshotRepository', () => {
  it('reads in the strict R1 -> v2 -> v1 order', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new TravelVocabularyR1SnapshotRepository(store)
    const r1 = createTravelVocabularyAssessmentRuntimeR1({
      now: () => '2026-07-27T08:00:00.000Z',
      createId: () => 'r1-session',
      random: () => 0.25,
    }).toSnapshot()

    await store.put(
      ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
      { schemaVersion: 1, source: 'v1' },
      1,
    )
    await store.put(
      VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
      { schemaVersion: 2, source: 'v2' },
      2,
    )
    await store.put(
      TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
      r1,
      3,
    )

    expect((await repository.load())?.kind).toBe('r1')
    await store.delete(TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1)
    expect((await repository.load())?.kind).toBe('legacy-v2')
    await store.delete(VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY)
    expect((await repository.load())?.kind).toBe('legacy-v1')
  })

  it('archives a corrupt R1 value before replacing the active key', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new TravelVocabularyR1SnapshotRepository(store)
    const corrupt = { schemaVersion: 3, broken: true }
    await store.put(
      TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
      corrupt,
      3,
    )
    const fresh = createTravelVocabularyAssessmentRuntimeR1({
      now: () => '2026-07-27T08:00:00.000Z',
      createId: () => 'fresh-r1-session',
      random: () => 0.75,
    }).toSnapshot()

    await repository.preserveSourceAndSaveFresh(
      fresh,
      TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
      'archive-1',
    )

    expect(
      store.records.get(
        `${TRAVEL_VOCABULARY_CORRUPT_BACKUP_PREFIX_R1}:archive-1`,
      )?.value,
    ).toEqual(corrupt)
    expect(
      store.records.get(TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1)
        ?.value,
    ).toEqual(fresh)
  })
})
