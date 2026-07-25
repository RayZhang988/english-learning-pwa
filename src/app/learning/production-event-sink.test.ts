import { beforeEach, describe, expect, it } from 'vitest'
import type { PlatformEvent } from '../../core/index.ts'
import {
  createLearningEngineState,
  createPlanProgress,
  getResumeDecision,
  LearningEngineRepository,
  type DailyPlan,
  type LearningTask,
} from '../../learning-engine/index.ts'
import { abilityProfile } from '../../learning-engine/test-fixtures.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import {
  ActivePlanRepository,
  createActiveLearningRuntime,
} from './active-plan-repository.ts'
import { ProductionLearningEventSink } from './production-event-sink.ts'

class MemoryNamespaceStore implements NamespaceStore {
  readonly records = new Map<string, StoredRecord<unknown>>()
  readonly namespace: string

  constructor(namespace: string) {
    this.namespace = namespace
  }

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

function plan(): DailyPlan {
  return {
    schemaVersion: 1,
    planId: 'plan-2026-07-24',
    localDate: '2026-07-24',
    generatedAt: '2026-07-24T08:00:00.000Z',
    targetSeconds: 900,
    plannedSeconds: 900,
    unfilledSeconds: 0,
    status: 'ready',
    tasks: [
      {
        schemaVersion: 1,
        taskId: 'plan-2026-07-24:task:1',
        planId: 'plan-2026-07-24',
        sequence: 1,
        learningUnitId: 'st4w-w1d1-vocabulary',
        contentRef:
          'lesson://survival-travel-american-4w/1.0.0/w1d1/vocabulary',
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
        targetSeconds: 0,
        plannedSeconds: 0,
      },
      speaking: {
        domain: 'speaking',
        weaknessWeight: 1,
        targetDifficulty: 1,
        targetSeconds: 0,
        plannedSeconds: 0,
      },
    },
    warnings: [],
  }
}

function completedEvent(
  overrides: Partial<{
    id: string
    planId: string
    taskId: string
  }> = {},
): PlatformEvent {
  return {
    id: overrides.id ?? 'event-completed-1',
    type: 'learning.attempt.completed.v1',
    sourceModuleId: 'vocabulary',
    occurredAt: '2026-07-24T08:15:00.000Z',
    schemaVersion: 1,
    payload: {
      planId: overrides.planId ?? 'plan-2026-07-24',
      taskId: overrides.taskId ?? 'plan-2026-07-24:task:1',
      learningUnitId: 'st4w-w1d1-vocabulary',
      contentRef:
        'lesson://survival-travel-american-4w/1.0.0/w1d1/vocabulary',
      domain: 'vocabulary',
      targetModuleId: 'vocabulary',
      localDate: '2026-07-24',
      mode: 'learn',
      difficultyLevel: 1,
      estimatedSeconds: 900,
      result: 'scored',
      performanceScore: 0.8,
      evidenceQuality: 0.9,
      assistanceLevel: 0,
      durationSeconds: 600,
      taskCompleted: true,
      errorTags: [],
      contentTags: ['week:1'],
      failureCategory: null,
    },
  }
}

function speakingFallbackPlan(): DailyPlan {
  const base = plan()
  const speakingTask: LearningTask = {
    ...base.tasks[0],
    taskId: 'plan-2026-07-24:speaking:1',
    sequence: 1,
    learningUnitId: 'st4w-w1d1-speaking',
    contentRef:
      'lesson://survival-travel-american-4w/1.0.0/w1d1/speaking',
    domain: 'speaking',
    targetModuleId: 'speaking',
    estimatedSeconds: 300,
  }
  const listeningTask: LearningTask = {
    ...base.tasks[0],
    taskId: 'plan-2026-07-24:listening:2',
    sequence: 2,
    learningUnitId: 'st4w-w1d1-listening',
    contentRef:
      'lesson://survival-travel-american-4w/1.0.0/w1d1/listening',
    domain: 'listening',
    targetModuleId: 'listening',
    estimatedSeconds: 300,
  }
  return {
    ...base,
    targetSeconds: 600,
    plannedSeconds: 600,
    tasks: [speakingTask, listeningTask],
  }
}

function unscorableSpeakingEvent(task: LearningTask): PlatformEvent {
  return {
    id: 'speaking-fallback-completed',
    type: 'learning.attempt.completed.v1',
    sourceModuleId: 'speaking',
    occurredAt: '2026-07-24T08:05:00.000Z',
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: 'speaking',
      targetModuleId: 'speaking',
      localDate: '2026-07-24',
      mode: task.mode,
      difficultyLevel: task.difficultyLevel,
      estimatedSeconds: task.estimatedSeconds,
      result: 'unscorable',
      performanceScore: null,
      evidenceQuality: 0,
      assistanceLevel: 0,
      durationSeconds: 240,
      taskCompleted: false,
      errorTags: [],
      contentTags: task.tags,
      failureCategory: 'network',
    },
  }
}

describe('ProductionLearningEventSink', () => {
  let plans: ActivePlanRepository
  let engines: LearningEngineRepository
  let sink: ProductionLearningEventSink

  beforeEach(async () => {
    plans = new ActivePlanRepository(
      new MemoryNamespaceStore('app.learning-runtime'),
    )
    engines = new LearningEngineRepository(
      new MemoryNamespaceStore('learning.engine'),
    )
    await plans.save(
      createActiveLearningRuntime(
        createPlanProgress(plan(), '2026-07-24T08:00:00.000Z'),
      ),
    )
    await engines.save(
      createLearningEngineState(
        abilityProfile(),
        '2026-07-24T08:00:00.000Z',
      ),
    )
    sink = new ProductionLearningEventSink(plans, engines)
  })

  it('validates, applies, persists, and restores a completed attempt', async () => {
    await sink.publish(completedEvent())

    const runtime = await plans.load()
    const engine = await engines.load()
    expect(runtime?.activePlan.status).toBe('completed')
    expect(runtime?.activePlan.tasks[0].status).toBe('completed')
    expect(runtime?.processedEventIds).toEqual(['event-completed-1'])
    expect(runtime?.completedLearningUnitIds).toEqual([
      'st4w-w1d1-vocabulary',
    ])
    expect(engine?.progress.attempts).toHaveLength(1)
    expect(engine?.progress.dailyActivity[0]).toMatchObject({
      localDate: '2026-07-24',
      effectiveSeconds: 600,
      completedTaskCount: 1,
      planCompleted: true,
    })
  })

  it('is idempotent by event ID across both repositories', async () => {
    const event = completedEvent()
    await sink.publish(event)
    await sink.publish(event)

    expect((await engines.load())?.progress.attempts).toHaveLength(1)
    expect((await plans.load())?.processedEventIds).toEqual([
      'event-completed-1',
    ])
  })

  it('rejects an event for another plan', async () => {
    await expect(
      sink.publish(completedEvent({ planId: 'wrong-plan' })),
    ).rejects.toThrow('planId')
  })

  it('rejects a task ID outside the active plan', async () => {
    await expect(
      sink.publish(completedEvent({ taskId: 'unknown-task' })),
    ).rejects.toThrow('taskId')
  })

  it('persists completed unscorable speaking practice and restores the next task without mastery evidence', async () => {
    const planStore = new MemoryNamespaceStore(
      'app.learning-runtime',
    )
    const engineStore = new MemoryNamespaceStore('learning.engine')
    const dailyPlan = speakingFallbackPlan()
    const activePlans = new ActivePlanRepository(planStore)
    const engineStates = new LearningEngineRepository(engineStore)
    await activePlans.save(
      createActiveLearningRuntime(
        createPlanProgress(
          dailyPlan,
          '2026-07-24T08:00:00.000Z',
        ),
      ),
    )
    await engineStates.save(
      createLearningEngineState(
        abilityProfile(),
        '2026-07-24T08:00:00.000Z',
      ),
    )
    const event = unscorableSpeakingEvent(dailyPlan.tasks[0])

    await new ProductionLearningEventSink(
      activePlans,
      engineStates,
    ).publish(event)

    const restoredRuntime = await new ActivePlanRepository(
      planStore,
    ).load()
    const restoredEngine = await new LearningEngineRepository(
      engineStore,
    ).load()
    expect(restoredRuntime?.activePlan.tasks[0]).toMatchObject({
      status: 'completed',
      completionKind: 'unscorable-practice',
      effectiveSeconds: 0,
      skipCount: 0,
    })
    expect(restoredRuntime?.activePlan.tasks[1].status).toBe('pending')
    expect(restoredRuntime?.completedLearningUnitIds).toContain(
      dailyPlan.tasks[0].learningUnitId,
    )
    expect(restoredRuntime?.processedEventIds).toEqual([event.id])
    expect(
      restoredRuntime &&
        getResumeDecision(
          restoredRuntime.activePlan,
          dailyPlan.localDate,
        ),
    ).toMatchObject({
      action: 'resume-plan',
      nextTaskId: dailyPlan.tasks[1].taskId,
    })
    expect(restoredEngine?.progress.attempts).toEqual([])
    expect(restoredEngine?.reviewItems).toEqual({})
    expect(restoredEngine?.progress.dailyActivity[0]).toMatchObject({
      completedTaskCount: 1,
      effectiveSeconds: 0,
      planCompleted: false,
    })

    await new ProductionLearningEventSink(
      new ActivePlanRepository(planStore),
      new LearningEngineRepository(engineStore),
    ).publish(event)
    expect(
      (await new ActivePlanRepository(planStore).load())
        ?.processedEventIds,
    ).toEqual([event.id])
  })
})
