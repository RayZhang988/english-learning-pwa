import { describe, expect, it } from 'vitest'
import {
  ASSESSMENT_RUNTIME_SCHEMA_VERSION,
  ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
  createPlacementAssessmentRuntime,
} from '../../features/assessment/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import { AssessmentRuntimeSnapshotRepository } from './assessment-runtime-snapshot-repository.ts'

class MemoryNamespaceStore implements NamespaceStore {
  readonly namespace = 'feature.assessment'
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
      namespace: this.namespace,
      key,
      value,
      schemaVersion,
      updatedAt: '2026-07-25T01:00:00.000Z',
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

describe('AssessmentRuntimeSnapshotRepository', () => {
  it('round-trips the exact validated v1 runtime snapshot', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new AssessmentRuntimeSnapshotRepository(store)
    const runtime = createPlacementAssessmentRuntime({
      now: () => '2026-07-25T01:00:00.000Z',
      createId: () => 'assessment-runtime-1',
    })
    const snapshot = runtime.toSnapshot()

    await repository.save(snapshot)

    await expect(repository.load()).resolves.toEqual(snapshot)
    expect(
      store.records.get(ASSESSMENT_RUNTIME_SNAPSHOT_KEY),
    ).toMatchObject({
      namespace: 'feature.assessment',
      schemaVersion: ASSESSMENT_RUNTIME_SCHEMA_VERSION,
      value: snapshot,
    })
  })

  it('rejects a future record version without deleting it', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new AssessmentRuntimeSnapshotRepository(store)
    store.records.set(ASSESSMENT_RUNTIME_SNAPSHOT_KEY, {
      namespace: store.namespace,
      key: ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
      value: {},
      schemaVersion: 2,
      updatedAt: '2026-07-25T01:00:00.000Z',
    })

    await expect(repository.load()).rejects.toMatchObject({
      code: 'schema_incompatible',
      recoverable: false,
    })
    expect(
      store.records.has(ASSESSMENT_RUNTIME_SNAPSHOT_KEY),
    ).toBe(true)
  })

  it('reports a corrupt v1 snapshot without silently resetting it', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new AssessmentRuntimeSnapshotRepository(store)
    store.records.set(ASSESSMENT_RUNTIME_SNAPSHOT_KEY, {
      namespace: store.namespace,
      key: ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
      value: {
        schemaVersion: 1,
        lifecycle: 'active',
      },
      schemaVersion: 1,
      updatedAt: '2026-07-25T01:00:00.000Z',
    })

    await expect(repository.load()).rejects.toMatchObject({
      code: 'schema_incompatible',
      recoverable: false,
    })
    expect(
      store.records.has(ASSESSMENT_RUNTIME_SNAPSHOT_KEY),
    ).toBe(true)
  })
})
