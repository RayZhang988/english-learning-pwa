import { describe, expect, it } from 'vitest'
import type {
  ExtraTrainingTimingSegmentRecordedEvent,
} from '../../learning-engine/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import {
  EXTRA_TRAINING_EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION,
  ExtraTrainingEffectiveTimingSnapshotRepository,
  extraTrainingEffectiveTimingSnapshotKey,
  type ExtraTrainingEffectiveTimingIdentity,
  type ExtraTrainingEffectiveTimingSnapshot,
} from './extra-training-effective-timing-snapshot-repository.ts'

class MemoryNamespaceStore implements NamespaceStore {
  readonly records = new Map<string, StoredRecord<unknown>>()

  async get<T>(key: string): Promise<StoredRecord<T> | undefined> {
    return this.records.get(key) as
      | StoredRecord<T>
      | undefined
  }

  async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    this.records.set(key, {
      namespace: 'app.extra-training-effective-timing',
      key,
      value,
      schemaVersion,
      updatedAt: '2026-07-29T08:00:00.000Z',
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

function identity(
  overrides: Partial<ExtraTrainingEffectiveTimingIdentity> = {},
): ExtraTrainingEffectiveTimingIdentity {
  return {
    sessionId: 'extra/session:vocabulary',
    localDate: '2026-07-29',
    domain: 'vocabulary',
    targetModuleId: 'vocabulary',
    mode: 'learn',
    ...overrides,
  }
}

function timingEvent(
  sessionIdentity: ExtraTrainingEffectiveTimingIdentity,
  id = 'extra-timing:stable-session:000001',
): ExtraTrainingTimingSegmentRecordedEvent {
  return {
    id,
    type: 'learning.extra-training.timing.segment.recorded.v1',
    sourceModuleId: sessionIdentity.targetModuleId,
    occurredAt: '2026-07-29T08:00:05.000Z',
    schemaVersion: 1,
    payload: {
      ...sessionIdentity,
      phase: 'answering',
      reason: 'active-answering',
      visibility: 'foreground',
      startedAt: '2026-07-29T08:00:00.000Z',
      endedAt: '2026-07-29T08:00:05.000Z',
      elapsedSeconds: 5,
      idleThresholdSeconds: 45,
    },
  }
}

function snapshot(
  sessionIdentity = identity(),
): ExtraTrainingEffectiveTimingSnapshot {
  return {
    schemaVersion: 1,
    sessionId: 'stable-session',
    identity: sessionIdentity,
    declaration: {
      phase: 'answering',
      reason: 'active-answering',
    },
    openSegment: null,
    suspended: true,
    nextEventSequence: 2,
    pendingEvents: [timingEvent(sessionIdentity)],
    updatedAt: '2026-07-29T08:00:05.000Z',
  }
}

describe('ExtraTrainingEffectiveTimingSnapshotRepository', () => {
  it('round-trips portable state under an encoded session-only key', async () => {
    const store = new MemoryNamespaceStore()
    const repository =
      new ExtraTrainingEffectiveTimingSnapshotRepository(store)
    const value = snapshot()

    await repository.save(value)

    const key = extraTrainingEffectiveTimingSnapshotKey(
      value.identity,
    )
    expect(key).toBe(
      'session:extra%2Fsession%3Avocabulary',
    )
    expect(store.records.get(key)?.schemaVersion).toBe(
      EXTRA_TRAINING_EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION,
    )
    expect(
      JSON.parse(JSON.stringify(store.records.get(key)?.value)),
    ).toEqual(value)
    await expect(
      repository.load(value.identity),
    ).resolves.toEqual(value)

    await repository.delete(value.identity)
    await expect(
      repository.load(value.identity),
    ).resolves.toBeUndefined()
  })

  it('preserves and rejects a snapshot bound to another extra-training identity', async () => {
    const store = new MemoryNamespaceStore()
    const requested = identity()
    const key =
      extraTrainingEffectiveTimingSnapshotKey(requested)
    const wrong = snapshot(
      identity({
        localDate: '2026-07-30',
      }),
    )
    await store.put(
      key,
      wrong,
      EXTRA_TRAINING_EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION,
    )

    await expect(
      new ExtraTrainingEffectiveTimingSnapshotRepository(
        store,
      ).load(requested),
    ).rejects.toMatchObject({
      code: 'schema_incompatible',
      recoverable: true,
      details: {
        sessionId: requested.sessionId,
      },
    })
    expect(store.records.get(key)?.value).toEqual(wrong)
  })

  it('rejects daily identity fields and daily timing events instead of feeding PlanProgress', async () => {
    const store = new MemoryNamespaceStore()
    const value = snapshot()
    const key = extraTrainingEffectiveTimingSnapshotKey(
      value.identity,
    )
    const dailyEvent = {
      ...value.pendingEvents[0],
      type: 'learning.timing.segment.recorded.v1',
      payload: {
        ...value.pendingEvents[0].payload,
        planId: 'daily-plan',
        taskId: 'daily-task',
      },
    }
    const contaminated = {
      ...value,
      identity: {
        ...value.identity,
        planId: 'daily-plan',
        taskId: 'daily-task',
      },
      pendingEvents: [dailyEvent],
    }
    await store.put(
      key,
      contaminated,
      EXTRA_TRAINING_EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION,
    )

    await expect(
      new ExtraTrainingEffectiveTimingSnapshotRepository(
        store,
      ).load(value.identity),
    ).rejects.toMatchObject({
      code: 'schema_incompatible',
      recoverable: true,
    })
    expect(store.records.get(key)?.value).toEqual(contaminated)
  })

  it('preserves and rejects pending IDs from another timing session', async () => {
    const store = new MemoryNamespaceStore()
    const value = snapshot()
    const key = extraTrainingEffectiveTimingSnapshotKey(
      value.identity,
    )
    const corrupt = {
      ...value,
      pendingEvents: [
        timingEvent(
          value.identity,
          'extra-timing:another-session:000001',
        ),
      ],
    }
    await store.put(
      key,
      corrupt,
      EXTRA_TRAINING_EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION,
    )

    await expect(
      new ExtraTrainingEffectiveTimingSnapshotRepository(
        store,
      ).load(value.identity),
    ).rejects.toMatchObject({
      code: 'schema_incompatible',
      recoverable: true,
    })
    expect(store.records.get(key)?.value).toEqual(corrupt)
  })

  it('preserves and rejects a future storage version', async () => {
    const store = new MemoryNamespaceStore()
    const value = snapshot()
    const key = extraTrainingEffectiveTimingSnapshotKey(
      value.identity,
    )
    await store.put(key, value, 2)

    await expect(
      new ExtraTrainingEffectiveTimingSnapshotRepository(
        store,
      ).load(value.identity),
    ).rejects.toMatchObject({
      code: 'schema_incompatible',
      recoverable: true,
    })
    expect(store.records.get(key)?.schemaVersion).toBe(2)
  })
})
