import { describe, expect, it } from 'vitest'
import type {
  LearningTimingSegmentRecordedEvent,
} from '../../learning-engine/index.ts'
import type {
  EffectiveTimingSessionSnapshot,
  EffectiveTimingTaskIdentity,
} from '../../platform/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import {
  EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION,
  EffectiveTimingSnapshotRepository,
  effectiveTimingSnapshotKey,
} from './effective-timing-snapshot-repository.ts'

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
      namespace: 'app.effective-timing',
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

function identity(
  overrides: Partial<EffectiveTimingTaskIdentity> = {},
): EffectiveTimingTaskIdentity {
  return {
    planId: 'plan/2026-07-27',
    taskId: 'task:vocabulary:1',
    learningUnitId: 'unit-vocabulary-1',
    contentRef: 'lesson://course/day-1/vocabulary',
    domain: 'vocabulary',
    targetModuleId: 'vocabulary',
    localDate: '2026-07-27',
    mode: 'learn',
    ...overrides,
  }
}

function timingEvent(
  taskIdentity: EffectiveTimingTaskIdentity,
  id = 'timing:stable-session:000001',
): LearningTimingSegmentRecordedEvent {
  return {
    id,
    type: 'learning.timing.segment.recorded.v1',
    sourceModuleId: taskIdentity.targetModuleId,
    occurredAt: '2026-07-27T08:00:05.000Z',
    schemaVersion: 1,
    payload: {
      ...taskIdentity,
      phase: 'answering',
      reason: 'active-answering',
      visibility: 'foreground',
      startedAt: '2026-07-27T08:00:00.000Z',
      endedAt: '2026-07-27T08:00:05.000Z',
      elapsedSeconds: 5,
      idleThresholdSeconds: 45,
    },
  }
}

function snapshot(
  taskIdentity = identity(),
): EffectiveTimingSessionSnapshot {
  return {
    schemaVersion: 1,
    sessionId: 'stable-session',
    identity: taskIdentity,
    declaration: {
      phase: 'answering',
      reason: 'active-answering',
    },
    openSegment: null,
    suspended: true,
    nextEventSequence: 2,
    pendingEvents: [timingEvent(taskIdentity)],
    updatedAt: '2026-07-27T08:00:05.000Z',
  }
}

describe('EffectiveTimingSnapshotRepository', () => {
  it('round-trips and deletes a versioned snapshot under an encoded task key', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new EffectiveTimingSnapshotRepository(store)
    const value = snapshot()

    await repository.save(value)

    const key = effectiveTimingSnapshotKey(value.identity)
    expect(key).toBe(
      'session:plan%2F2026-07-27:task%3Avocabulary%3A1',
    )
    expect(store.records.get(key)?.schemaVersion).toBe(
      EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION,
    )
    await expect(repository.load(value.identity)).resolves.toEqual(
      value,
    )

    await repository.delete(value.identity)
    await expect(repository.load(value.identity)).resolves.toBeUndefined()
  })

  it('preserves and rejects a snapshot whose identity does not match the active task', async () => {
    const store = new MemoryNamespaceStore()
    const requested = identity()
    const key = effectiveTimingSnapshotKey(requested)
    const wrong = snapshot(
      identity({
        taskId: 'task:listening:2',
        learningUnitId: 'unit-listening-2',
        contentRef: 'lesson://course/day-1/listening',
        domain: 'listening',
        targetModuleId: 'listening',
      }),
    )
    await store.put(
      key,
      wrong,
      EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION,
    )

    await expect(
      new EffectiveTimingSnapshotRepository(store).load(requested),
    ).rejects.toMatchObject({
      code: 'schema_incompatible',
      recoverable: true,
    })
    expect(store.records.get(key)?.value).toEqual(wrong)
  })

  it('preserves and rejects corrupt open state', async () => {
    const store = new MemoryNamespaceStore()
    const value = snapshot()
    const key = effectiveTimingSnapshotKey(value.identity)
    const corrupt = {
      ...value,
      openSegment: {
        phase: 'recording',
        reason: 'active-recording',
        visibility: 'foreground',
        startedAt: '2026-07-27T08:00:05.000Z',
      },
    }
    await store.put(
      key,
      corrupt,
      EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION,
    )

    await expect(
      new EffectiveTimingSnapshotRepository(store).load(
        value.identity,
      ),
    ).rejects.toMatchObject({
      code: 'schema_incompatible',
      recoverable: true,
    })
    expect(store.records.has(key)).toBe(true)
  })

  it('preserves and rejects pending event IDs from another session', async () => {
    const store = new MemoryNamespaceStore()
    const value = snapshot()
    const key = effectiveTimingSnapshotKey(value.identity)
    const corrupt = {
      ...value,
      pendingEvents: [
        timingEvent(value.identity, 'timing:another-session:000001'),
      ],
    }
    await store.put(
      key,
      corrupt,
      EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION,
    )

    await expect(
      new EffectiveTimingSnapshotRepository(store).load(
        value.identity,
      ),
    ).rejects.toMatchObject({
      code: 'schema_incompatible',
      recoverable: true,
    })
    expect(store.records.get(key)?.value).toEqual(corrupt)
  })

  it('preserves and rejects a future storage record version', async () => {
    const store = new MemoryNamespaceStore()
    const value = snapshot()
    const key = effectiveTimingSnapshotKey(value.identity)
    await store.put(key, value, 2)

    await expect(
      new EffectiveTimingSnapshotRepository(store).load(
        value.identity,
      ),
    ).rejects.toMatchObject({
      code: 'schema_incompatible',
      recoverable: true,
    })
    expect(store.records.get(key)?.schemaVersion).toBe(2)
  })
})
