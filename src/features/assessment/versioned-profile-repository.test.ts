import { describe, expect, it } from 'vitest'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import { LATEST_PROFILE_KEY } from './repository.ts'
import {
  createTravelVocabularyAssessmentRuntimeR1,
} from './travel-vocabulary-runtime.ts'
import { createVocabularyPlacementRuntime } from './vocabulary-runtime.ts'
import {
  VersionedAssessmentProfileRepository,
} from './versioned-profile-repository.ts'
import type { AbilityProfileV1 } from './types.ts'

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
      updatedAt: '2026-07-27T03:00:00.000Z',
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

const v1Profile = {
  schemaVersion: 1,
  profileId: 'legacy-profile',
  assessmentId: 'legacy-assessment',
  bankId: 'placement-en-us-v1',
  completedAt: '2026-07-25T08:15:00.000Z',
  durationSeconds: 900,
  outcome: 'partial',
  disclaimer: '不是官方认证',
  abilities: {},
} as unknown as AbilityProfileV1

async function completeR1Profile() {
  const runtime = createTravelVocabularyAssessmentRuntimeR1({
    now: () => '2026-07-27T03:00:00.000Z',
    createId: () => 'r1-profile',
    random: () => 0.25,
  })
  let state = runtime.start()
  for (let stageIndex = 0; stageIndex < 5; stageIndex += 1) {
    for (const question of state.questions) {
      state = runtime.markUncertain(question.id)
    }
    state = await runtime.submitStage()
    if (stageIndex < 4) {
      state = runtime.continueToNextStage()
    }
  }
  if (!state.profile) {
    throw new Error('Expected a real R1 profile')
  }
  return state.profile
}

describe('VersionedAssessmentProfileRepository', () => {
  it('reads a v1 record without silently rewriting it', async () => {
    const store = new MemoryNamespaceStore()
    await store.put(LATEST_PROFILE_KEY, v1Profile, 1)
    const before = structuredClone(
      store.records.get(LATEST_PROFILE_KEY),
    )

    const loaded =
      await new VersionedAssessmentProfileRepository(
        store,
      ).loadLatest()

    expect(loaded).toEqual(v1Profile)
    expect(store.records.get(LATEST_PROFILE_KEY)).toEqual(before)
  })

  it('writes and reloads a real v2 profile under record schema 2', async () => {
    const store = new MemoryNamespaceStore()
    const runtime = createVocabularyPlacementRuntime({
      now: () => '2026-07-27T03:00:00.000Z',
      createId: () => 'v2-profile',
    })
    await runtime.start()
    const completed = await runtime.stop()
    if (!completed.profile) {
      throw new Error('Expected v2 profile')
    }
    const repository = new VersionedAssessmentProfileRepository(
      store,
    )

    await repository.saveLatest(completed.profile)
    await expect(repository.loadLatest()).resolves.toEqual(
      completed.profile,
    )
    expect(store.records.get(LATEST_PROFILE_KEY)?.schemaVersion).toBe(
      2,
    )
  })

  it('writes and reloads a real R1 profile under record schema 3', async () => {
    const store = new MemoryNamespaceStore()
    const profile = await completeR1Profile()
    const repository = new VersionedAssessmentProfileRepository(
      store,
    )

    await repository.saveLatest(profile)
    await expect(repository.loadLatest()).resolves.toEqual(profile)
    expect(store.records.get(LATEST_PROFILE_KEY)?.schemaVersion).toBe(
      3,
    )
  })

  it('rejects a record whose wrapper and profile versions disagree', async () => {
    const store = new MemoryNamespaceStore()
    await store.put(LATEST_PROFILE_KEY, v1Profile, 2)

    await expect(
      new VersionedAssessmentProfileRepository(store).loadLatest(),
    ).rejects.toThrow(
      'Assessment profile record version does not match its value',
    )
  })
})
