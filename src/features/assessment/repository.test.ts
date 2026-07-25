import { describe, expect, it } from 'vitest'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import {
  ASSESSMENT_STORAGE_SCHEMA_VERSION,
  AssessmentProfileRepository,
  LATEST_PROFILE_KEY,
} from './repository.ts'
import type { AbilityProfile } from './types.ts'

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
      namespace: 'feature.assessment',
      key,
      value,
      schemaVersion,
      updatedAt: '2026-07-24T08:00:00.000Z',
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

const profileFixture = {
  schemaVersion: 1,
  profileId: 'profile-1',
  assessmentId: 'assessment-1',
  bankId: 'placement-en-us-v1',
  completedAt: '2026-07-24T08:15:00.000Z',
  durationSeconds: 900,
  outcome: 'partial',
  disclaimer: '不是官方认证',
  abilities: {},
} as unknown as AbilityProfile

describe('AssessmentProfileRepository', () => {
  it('saves and reloads the latest profile in the owned schema', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new AssessmentProfileRepository(store)

    await repository.saveLatest(profileFixture)
    await expect(repository.loadLatest()).resolves.toEqual(profileFixture)
    expect(store.records.get(LATEST_PROFILE_KEY)?.schemaVersion).toBe(
      ASSESSMENT_STORAGE_SCHEMA_VERSION,
    )
  })

  it('rejects an unsupported stored schema', async () => {
    const store = new MemoryNamespaceStore()
    store.records.set(LATEST_PROFILE_KEY, {
      namespace: 'feature.assessment',
      key: LATEST_PROFILE_KEY,
      value: profileFixture,
      schemaVersion: 2,
      updatedAt: '2026-07-24T08:00:00.000Z',
    })

    await expect(
      new AssessmentProfileRepository(store).loadLatest(),
    ).rejects.toThrow('Unsupported assessment profile version')
  })
})
