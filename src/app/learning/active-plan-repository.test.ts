import { describe, expect, it } from 'vitest'
import {
  createPlanProgress,
  type DailyPlan,
} from '../../learning-engine/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import {
  ACTIVE_LEARNING_RUNTIME_KEY,
  ActivePlanRepository,
  createActiveLearningRuntime,
  LEARNING_RUNTIME_STORAGE_SCHEMA_VERSION,
} from './active-plan-repository.ts'

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
      namespace: 'app.learning-runtime',
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

function dailyPlan(): DailyPlan {
  return {
    schemaVersion: 1,
    planId: 'plan-2026-07-24',
    localDate: '2026-07-24',
    generatedAt: '2026-07-24T08:00:00.000Z',
    targetSeconds: 2_700,
    plannedSeconds: 900,
    unfilledSeconds: 1_800,
    status: 'partial',
    tasks: [
      {
        schemaVersion: 1,
        taskId: 'plan-2026-07-24:task:1',
        planId: 'plan-2026-07-24',
        sequence: 1,
        learningUnitId: 'unit-vocabulary-1',
        contentRef: 'lesson://course/1/day-1/vocabulary',
        domain: 'vocabulary',
        targetModuleId: 'vocabulary',
        mode: 'learn',
        origin: 'new',
        difficultyLevel: 1,
        estimatedSeconds: 900,
        required: true,
        dueAt: null,
        skipLimit: 2,
        tags: ['week:1'],
      },
    ],
    allocations: {
      vocabulary: {
        domain: 'vocabulary',
        weaknessWeight: 1,
        targetDifficulty: 1,
        targetSeconds: 900,
        plannedSeconds: 900,
      },
      listening: {
        domain: 'listening',
        weaknessWeight: 1,
        targetDifficulty: 1,
        targetSeconds: 900,
        plannedSeconds: 0,
      },
      speaking: {
        domain: 'speaking',
        weaknessWeight: 1,
        targetDifficulty: 1,
        targetSeconds: 900,
        plannedSeconds: 0,
      },
    },
    warnings: ['insufficient-eligible-content'],
  }
}

describe('ActivePlanRepository', () => {
  it('round-trips the active plan and durable event/completion ledgers', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new ActivePlanRepository(store)
    const progress = createPlanProgress(
      dailyPlan(),
      '2026-07-24T08:00:00.000Z',
    )
    const runtime = createActiveLearningRuntime(progress, {
      completedLearningUnitIds: ['unit-vocabulary-0'],
      processedEventIds: ['event-1'],
      skipHistory: [
        {
          learningUnitId: 'unit-vocabulary-0',
          localDate: '2026-07-23',
          reason: 'user-skipped',
        },
      ],
    })

    await repository.save(runtime)

    await expect(repository.load()).resolves.toEqual(runtime)
    expect(
      store.records.get(ACTIVE_LEARNING_RUNTIME_KEY)?.schemaVersion,
    ).toBe(LEARNING_RUNTIME_STORAGE_SCHEMA_VERSION)
  })

  it('round-trips additive R3 duration estimates and timing totals', async () => {
    const store = new MemoryNamespaceStore()
    const repository = new ActivePlanRepository(store)
    const basePlan = dailyPlan()
    const timedPlan = {
      ...basePlan,
      tasks: [
        {
          ...basePlan.tasks[0],
          durationEstimate: {
            schemaVersion: 1 as const,
            estimateSeconds: 900,
            sampleCount: 3,
            basis: 'personal-history' as const,
            confidence: 'medium' as const,
            reasonableRangeSeconds: {
              lower: 600,
              upper: 1_200,
            },
            contentType: 'multiple-choice-set',
            profileKey:
              'vocabulary:learn:multiple-choice-set',
            baselineSource: 'structured-content' as const,
          },
        },
      ],
    }
    const progress = createPlanProgress(
      timedPlan,
      '2026-07-24T08:00:00.000Z',
    )
    const timedProgress = {
      ...progress,
      tasks: [
        {
          ...progress.tasks[0],
          task: timedPlan.tasks[0],
          spentSeconds: 15,
          effectiveSeconds: 10,
          timingSegmentCount: 2,
          excludedSeconds: 5,
          effectiveTimeSource: 'timing-segments' as const,
        },
      ],
    }
    const runtime = createActiveLearningRuntime(timedProgress)

    await repository.save(runtime)

    await expect(repository.load()).resolves.toEqual(runtime)
  })

  it('rejects a future runtime record version', async () => {
    const store = new MemoryNamespaceStore()
    await store.put(ACTIVE_LEARNING_RUNTIME_KEY, {}, 2)

    await expect(
      new ActivePlanRepository(store).load(),
    ).rejects.toMatchObject({
      code: 'schema_incompatible',
    })
  })

  it('rejects corrupted task identities instead of silently resetting data', async () => {
    const store = new MemoryNamespaceStore()
    const progress = createPlanProgress(
      dailyPlan(),
      '2026-07-24T08:00:00.000Z',
    )
    const corrupted = {
      ...createActiveLearningRuntime(progress),
      activePlan: {
        ...progress,
        tasks: [
          {
            ...progress.tasks[0],
            task: {
              ...progress.tasks[0].task,
              planId: 'another-plan',
            },
          },
        ],
      },
    }
    await store.put(
      ACTIVE_LEARNING_RUNTIME_KEY,
      corrupted,
      LEARNING_RUNTIME_STORAGE_SCHEMA_VERSION,
    )

    await expect(
      new ActivePlanRepository(store).load(),
    ).rejects.toMatchObject({
      code: 'schema_incompatible',
      recoverable: false,
    })
  })

  it('rejects inconsistent R3 timing totals instead of silently repairing them', async () => {
    const store = new MemoryNamespaceStore()
    const progress = createPlanProgress(
      dailyPlan(),
      '2026-07-24T08:00:00.000Z',
    )
    const corrupted = {
      ...createActiveLearningRuntime(progress),
      activePlan: {
        ...progress,
        tasks: [
          {
            ...progress.tasks[0],
            spentSeconds: 14,
            effectiveSeconds: 10,
            timingSegmentCount: 2,
            excludedSeconds: 5,
            effectiveTimeSource: 'timing-segments',
          },
        ],
      },
    }
    await store.put(
      ACTIVE_LEARNING_RUNTIME_KEY,
      corrupted,
      LEARNING_RUNTIME_STORAGE_SCHEMA_VERSION,
    )

    await expect(
      new ActivePlanRepository(store).load(),
    ).rejects.toMatchObject({
      code: 'schema_incompatible',
      recoverable: false,
    })
    expect(
      store.records.has(ACTIVE_LEARNING_RUNTIME_KEY),
    ).toBe(true)
  })
})
