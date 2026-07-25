import { describe, expect, it } from 'vitest'
import {
  ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
  AssessmentProfileRepository,
  LATEST_PROFILE_KEY,
} from '../../features/assessment/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import { AssessmentAppCoordinator } from './assessment-app-coordinator.ts'
import { AssessmentRuntimeSnapshotRepository } from './assessment-runtime-snapshot-repository.ts'

class MemoryNamespaceStore implements NamespaceStore {
  readonly namespace = 'feature.assessment'
  readonly records = new Map<string, StoredRecord<unknown>>()
  readonly operations: string[] = []
  failNextProfileSave = false

  async get<T>(key: string): Promise<StoredRecord<T> | undefined> {
    this.operations.push(`get:${key}`)
    return this.records.get(key) as StoredRecord<T> | undefined
  }

  async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    this.operations.push(`put:${key}`)
    if (key === LATEST_PROFILE_KEY && this.failNextProfileSave) {
      this.failNextProfileSave = false
      throw new Error('transient profile write failure')
    }
    this.records.set(key, {
      namespace: this.namespace,
      key,
      value,
      schemaVersion,
      updatedAt: '2026-07-25T01:00:00.000Z',
    })
  }

  async delete(key: string): Promise<void> {
    this.operations.push(`delete:${key}`)
    this.records.delete(key)
  }

  async keys(): Promise<readonly string[]> {
    return [...this.records.keys()]
  }

  async clear(): Promise<void> {
    this.records.clear()
  }
}

function createHarness(input?: {
  readonly store?: MemoryNamespaceStore
  readonly now?: () => string
  readonly initializePlan?: () => Promise<{
    readonly status: string
    readonly error?: unknown
  }>
}) {
  const store = input?.store ?? new MemoryNamespaceStore()
  const plans =
    input?.initializePlan ??
    (async () => {
      store.operations.push('plan:initialize')
      return { status: 'ready' }
    })
  const coordinator = new AssessmentAppCoordinator({
    snapshots: new AssessmentRuntimeSnapshotRepository(store),
    profiles: new AssessmentProfileRepository(store),
    dailyPlans: {
      initialize: plans,
    },
    now: input?.now ?? (() => '2026-07-25T01:00:00.000Z'),
    createId: () => 'assessment-runtime-1',
  })
  return { coordinator, store }
}

async function startAssessment(
  coordinator: AssessmentAppCoordinator,
) {
  const initialized = await coordinator.initialize()
  expect(initialized.status).toBe('ready')
  const active = await coordinator.start()
  expect(active.status).toBe('ready')
  if (active.status !== 'ready') {
    throw new Error('Expected an active assessment.')
  }
  expect(active.runtime.lifecycle).toBe('active')
  return active.runtime
}

describe('AssessmentAppCoordinator', () => {
  it('creates and persists one real assessment session on a clean device', async () => {
    const { coordinator, store } = createHarness()

    const state = await coordinator.initialize()

    expect(state.status).toBe('ready')
    if (state.status !== 'ready') {
      throw new Error('Expected assessment runtime state.')
    }
    expect(state.runtime.lifecycle).toBe('intro')
    expect(state.runtime.sessionId).toBe('assessment-runtime-1')
    expect(
      store.records.get(ASSESSMENT_RUNTIME_SNAPSHOT_KEY)?.value,
    ).toMatchObject({
      schemaVersion: 1,
      lifecycle: 'intro',
    })
  })

  it('restores an active session as paused after 24 hours', async () => {
    const store = new MemoryNamespaceStore()
    let now = Date.parse('2026-07-25T01:00:00.000Z')
    const first = createHarness({
      store,
      now: () => new Date(now).toISOString(),
    })
    const active = await startAssessment(first.coordinator)
    const currentItem = active.item
    if (!currentItem || currentItem.kind !== 'choice') {
      throw new Error('Expected a choice item.')
    }
    now += 25_000
    await first.coordinator.selectChoice(
      currentItem.id,
      currentItem.options[0].id,
    )

    now += 24 * 60 * 60_000
    const refreshed = createHarness({
      store,
      now: () => new Date(now).toISOString(),
    })
    const restored = await refreshed.coordinator.initialize()

    expect(restored.status).toBe('ready')
    if (restored.status !== 'ready') {
      throw new Error('Expected a restored assessment.')
    }
    expect(restored.runtime.lifecycle).toBe('paused')
    expect(restored.runtime.selectedOptionId).toBe(
      currentItem.options[0].id,
    )
    expect(restored.runtime.progress.elapsedSeconds).toBe(25)

    const resumed = await refreshed.coordinator.resume()
    expect(resumed.status).toBe('ready')
    if (resumed.status === 'ready') {
      expect(resumed.runtime.lifecycle).toBe('active')
      expect(resumed.runtime.progress.elapsedSeconds).toBe(25)
    }
  })

  it('surfaces a corrupt snapshot and preserves it for diagnosis', async () => {
    const store = new MemoryNamespaceStore()
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
    const { coordinator } = createHarness({ store })

    const state = await coordinator.initialize()

    expect(state.status).toBe('error')
    if (state.status !== 'error') {
      throw new Error('Expected a corrupt snapshot error.')
    }
    expect(state.error.code).toBe('schema_incompatible')
    expect(state.canRetryCompletion).toBe(false)
    expect(
      store.records.has(ASSESSMENT_RUNTIME_SNAPSHOT_KEY),
    ).toBe(true)
  })

  it('persists profile, completed snapshot, then initializes the daily plan', async () => {
    const { coordinator, store } = createHarness()
    await startAssessment(coordinator)
    store.operations.length = 0

    const completed = await coordinator.stop()

    expect(completed.status).toBe('ready')
    if (completed.status !== 'ready') {
      throw new Error('Expected completed assessment state.')
    }
    expect(completed.runtime.lifecycle).toBe('completed')
    expect(completed.runtime.profile?.profileId).toBeTruthy()
    expect(store.operations).toEqual([
      `get:${LATEST_PROFILE_KEY}`,
      `put:${LATEST_PROFILE_KEY}`,
      `put:${ASSESSMENT_RUNTIME_SNAPSHOT_KEY}`,
      'plan:initialize',
    ])
  })

  it('retries a failed profile save without duplicating a completed workflow', async () => {
    const { coordinator, store } = createHarness()
    await startAssessment(coordinator)
    store.failNextProfileSave = true

    const failed = await coordinator.stop()

    expect(failed.status).toBe('error')
    if (failed.status !== 'error') {
      throw new Error('Expected a retryable completion error.')
    }
    expect(failed.canRetryCompletion).toBe(true)
    expect(
      store.records.has(ASSESSMENT_RUNTIME_SNAPSHOT_KEY),
    ).toBe(true)
    expect(store.records.has(LATEST_PROFILE_KEY)).toBe(false)

    const recovered = await coordinator.retryCompletion()
    expect(recovered.status).toBe('ready')
    expect(store.records.has(LATEST_PROFILE_KEY)).toBe(true)
    expect(
      store.operations.filter(
        (operation) => operation === 'plan:initialize',
      ),
    ).toHaveLength(1)

    await coordinator.retryCompletion()
    expect(
      store.operations.filter(
        (operation) => operation === 'plan:initialize',
      ),
    ).toHaveLength(1)

    const locked = await coordinator.start()
    expect(locked.status).toBe('error')
  })

  it('keeps completion retryable when the learning coordinator resolves to an error state', async () => {
    let planAttempts = 0
    const { coordinator, store } = createHarness({
      initializePlan: async () => {
        planAttempts += 1
        if (planAttempts === 1) {
          return {
            status: 'error',
            error: new Error('course package unavailable'),
          }
        }
        return { status: 'ready' }
      },
    })
    await startAssessment(coordinator)

    const failed = await coordinator.stop()

    expect(failed.status).toBe('error')
    if (failed.status === 'error') {
      expect(failed.canRetryCompletion).toBe(true)
    }
    expect(store.records.has(LATEST_PROFILE_KEY)).toBe(true)
    expect(
      store.records.has(ASSESSMENT_RUNTIME_SNAPSHOT_KEY),
    ).toBe(true)

    const recovered = await coordinator.retryCompletion()
    expect(recovered.status).toBe('ready')
    expect(planAttempts).toBe(2)
  })

  it('finishes an interrupted completed snapshot after refresh', async () => {
    const store = new MemoryNamespaceStore()
    const first = createHarness({ store })
    await startAssessment(first.coordinator)
    store.failNextProfileSave = true
    const failed = await first.coordinator.stop()
    expect(failed.status).toBe('error')

    const refreshed = createHarness({ store })
    const restored = await refreshed.coordinator.initialize()

    expect(restored.status).toBe('ready')
    if (restored.status !== 'ready') {
      throw new Error('Expected recovered completed assessment.')
    }
    expect(restored.runtime.lifecycle).toBe('completed')
    expect(store.records.has(LATEST_PROFILE_KEY)).toBe(true)
    expect(
      store.operations.filter(
        (operation) => operation === 'plan:initialize',
      ),
    ).toHaveLength(1)
  })
})
