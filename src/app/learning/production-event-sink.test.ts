import { beforeEach, describe, expect, it } from 'vitest'
import type { PlatformEvent } from '../../core/index.ts'
import {
  createLearningEngineState,
  createPlanProgress,
  getResumeDecision,
  LearningEngineRepository,
  type DailyPlan,
  type LearningTask,
  type TrainingModuleId,
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

class FailingNamespaceStore extends MemoryNamespaceStore {
  failNextPut = false

  override async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    if (this.failNextPut) {
      this.failNextPut = false
      throw new Error('simulated local write failure')
    }
    await super.put(key, value, schemaVersion)
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

function budgetPlan(): DailyPlan {
  const base = plan()
  return {
    ...base,
    tasks: [
      {
        ...base.tasks[0],
        trainingBudget: {
          schemaVersion: 1,
          targetEffectiveSeconds: 900,
        },
      },
    ],
  }
}

function streamItemCompletedEvent(
  task: LearningTask,
): PlatformEvent {
  return {
    id: 'stream-item-completed-1',
    type: 'learning.training.item.completed.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: '2026-07-24T08:15:02.000Z',
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-24',
      mode: task.mode,
      item: {
        itemId: 'vocabulary:item-1:term-to-meaning-choice',
        learningUnitId: task.learningUnitId,
        contentRef: task.contentRef,
        difficultyLevel: task.difficultyLevel,
        tags: task.tags,
      },
      requestId: `${task.taskId}:supply:1:initial`,
      nextSupplyCursor:
        'vocabulary:item-1:term-to-meaning-choice',
      outcome: 'scored',
    },
  }
}

function budgetCompletedEvent(
  task: LearningTask,
): PlatformEvent {
  return {
    id: 'training-budget-completed-1',
    type: 'learning.training.budget.completed.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: '2026-07-24T08:15:03.000Z',
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-24',
      mode: task.mode,
      lastCompletedItemId:
        'vocabulary:item-1:term-to-meaning-choice',
      completedItemCount: 1,
    },
  }
}

function contentExhaustedEvent(
  task: LearningTask,
): PlatformEvent {
  return {
    id: 'training-content-exhausted-2',
    type: 'learning.training.content.exhausted.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: '2026-07-24T08:05:00.000Z',
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-24',
      mode: task.mode,
      requestId: `${task.taskId}:supply:2:vocabulary:item-1`,
      cursor: 'vocabulary:item-1:term-to-meaning-choice',
      reason: 'all-eligible-content-recently-used',
    },
  }
}

const trainingModules = [
  'vocabulary',
  'listening',
  'speaking',
] as const satisfies readonly TrainingModuleId[]

function recoveryBudgetPlan(
  moduleId: TrainingModuleId,
): DailyPlan {
  const base = budgetPlan()
  const scheduled = base.tasks[0]
  const task: LearningTask = {
    ...scheduled,
    taskId: `${base.planId}:${moduleId}:recovery`,
    learningUnitId: `st4w-w1d1-${moduleId}`,
    contentRef:
      `lesson://survival-travel-american-4w/1.0.0/w1d1/${moduleId}`,
    domain: moduleId,
    targetModuleId: moduleId,
  }
  return {
    ...base,
    tasks: [task],
    allocations: {
      vocabulary: {
        ...base.allocations.vocabulary,
        plannedSeconds: moduleId === 'vocabulary' ? 900 : 0,
      },
      listening: {
        ...base.allocations.listening,
        plannedSeconds: moduleId === 'listening' ? 900 : 0,
      },
      speaking: {
        ...base.allocations.speaking,
        plannedSeconds: moduleId === 'speaking' ? 900 : 0,
      },
    },
  }
}

function recoveryItemCompletedEvent(
  task: LearningTask,
  index: number,
): PlatformEvent {
  const itemId = `${task.targetModuleId}:recovery-item-${index}`
  return {
    id: `${task.targetModuleId}:item-completed:${index}`,
    type: 'learning.training.item.completed.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: `2026-07-24T08:0${index}:00.000Z`,
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-24',
      mode: task.mode,
      item: {
        itemId,
        learningUnitId: task.learningUnitId,
        contentRef: task.contentRef,
        difficultyLevel: task.difficultyLevel,
        tags: task.tags,
      },
      requestId: `${task.taskId}:supply:${index}:recovery`,
      nextSupplyCursor: itemId,
      outcome: 'scored',
    },
  }
}

function recoveryContentExhaustedEvent(
  task: LearningTask,
  exhaustionRequestId: string,
): PlatformEvent {
  return {
    id: `${task.targetModuleId}:content-exhausted`,
    type: 'learning.training.content.exhausted.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: '2026-07-24T08:05:00.000Z',
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-24',
      mode: task.mode,
      requestId: exhaustionRequestId,
      cursor: `${task.targetModuleId}:recovery-item-1`,
      reason: 'all-eligible-content-recently-used',
    },
  }
}

function recoveryContentRecoveredEvent(
  task: LearningTask,
  exhaustionRequestId: string,
): PlatformEvent {
  return {
    id: `${task.targetModuleId}:content-recovered:${exhaustionRequestId}`,
    type: 'learning.training.content.recovered.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: '2026-07-24T08:06:00.000Z',
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-24',
      mode: task.mode,
      exhaustionRequestId,
    },
  }
}

function recoveryAttemptCompletedEvent(
  task: LearningTask,
): PlatformEvent {
  return {
    id: `${task.targetModuleId}:recovery-attempt`,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: '2026-07-24T08:15:01.000Z',
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-24',
      mode: task.mode,
      difficultyLevel: task.difficultyLevel,
      estimatedSeconds: task.estimatedSeconds,
      result: 'scored',
      performanceScore: 0.8,
      evidenceQuality: 0.9,
      assistanceLevel: 0,
      durationSeconds: 900,
      taskCompleted: false,
      errorTags: [],
      contentTags: task.tags,
      failureCategory: null,
    },
  }
}

function recoveryBudgetCompletedEvent(
  task: LearningTask,
  completedItemCount: number,
): PlatformEvent {
  return {
    id: `${task.targetModuleId}:recovery-budget-completed`,
    type: 'learning.training.budget.completed.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: '2026-07-24T08:15:03.000Z',
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-24',
      mode: task.mode,
      lastCompletedItemId:
        `${task.targetModuleId}:recovery-item-${completedItemCount}`,
      completedItemCount,
    },
  }
}

function timingEvent(
  task: LearningTask,
  input: {
    readonly id: string
    readonly startedAt: string
    readonly endedAt: string
    readonly elapsedSeconds: number
    readonly phase?: 'answering' | 'audio-listening' | 'idle'
    readonly reason?:
      | 'active-answering'
      | 'active-audio-listening'
      | 'idle-timeout'
  },
): PlatformEvent {
  return {
    id: input.id,
    type: 'learning.timing.segment.recorded.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: input.endedAt,
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: '2026-07-24',
      mode: task.mode,
      phase: input.phase ?? 'answering',
      reason: input.reason ?? 'active-answering',
      visibility: 'foreground',
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      elapsedSeconds: input.elapsedSeconds,
      idleThresholdSeconds: 45,
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

async function createRecoveryHarness(
  moduleId: TrainingModuleId,
  planStore: MemoryNamespaceStore = new MemoryNamespaceStore(
    'app.learning-runtime',
  ),
) {
  const engineStore = new MemoryNamespaceStore('learning.engine')
  const activePlans = new ActivePlanRepository(planStore)
  const engineStates = new LearningEngineRepository(engineStore)
  const dailyPlan = recoveryBudgetPlan(moduleId)
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
  return {
    activePlans,
    engineStates,
    planStore,
    engineStore,
    task: dailyPlan.tasks[0],
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
    expect(engine?.progress.durationSamples).toEqual([])
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

  it('serially persists timing segments before completion and records one trusted duration sample', async () => {
    const task = plan().tasks[0]
    const active = timingEvent(task, {
      id: 'timing-session-1',
      startedAt: '2026-07-24T08:00:00.000Z',
      endedAt: '2026-07-24T08:00:08.000Z',
      elapsedSeconds: 8,
    })
    const idle = timingEvent(task, {
      id: 'timing-session-2',
      startedAt: '2026-07-24T08:00:08.000Z',
      endedAt: '2026-07-24T08:00:11.000Z',
      elapsedSeconds: 3,
      phase: 'idle',
      reason: 'idle-timeout',
    })

    await Promise.all([
      sink.publish(active),
      sink.publish(idle),
      sink.publish(active),
      sink.publish(completedEvent()),
    ])

    const runtime = await plans.load()
    const engine = await engines.load()
    expect(runtime?.activePlan.tasks[0]).toMatchObject({
      status: 'completed',
      spentSeconds: 11,
      effectiveSeconds: 8,
      timingSegmentCount: 2,
      excludedSeconds: 3,
      effectiveTimeSource: 'timing-segments',
    })
    expect(runtime?.processedEventIds).toEqual([
      'timing-session-1',
      'timing-session-2',
      'event-completed-1',
    ])
    expect(engine?.progress.dailyActivity[0]).toMatchObject({
      effectiveSeconds: 8,
      completedTaskCount: 1,
    })
    expect(engine?.progress.durationSamples).toEqual([
      expect.objectContaining({
        sampleId: 'event-completed-1',
        taskId: task.taskId,
        effectiveSeconds: 8,
        source: 'timing-segments',
        reliable: true,
      }),
    ])
  })

  it('keeps a budget task active after one attempt and completes only after the budget event', async () => {
    const planStore = new MemoryNamespaceStore(
      'app.learning-runtime',
    )
    const engineStore = new MemoryNamespaceStore('learning.engine')
    const activePlans = new ActivePlanRepository(planStore)
    const engineStates = new LearningEngineRepository(engineStore)
    const dailyPlan = budgetPlan()
    const task = dailyPlan.tasks[0]
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
    const localSink = new ProductionLearningEventSink(
      activePlans,
      engineStates,
    )
    const finalTiming = timingEvent(task, {
      id: 'budget-timing-900',
      startedAt: '2026-07-24T08:00:00.000Z',
      endedAt: '2026-07-24T08:15:00.000Z',
      elapsedSeconds: 900,
      phase: 'audio-listening',
      reason: 'active-audio-listening',
    })
    const attempt = completedEvent()

    await localSink.publish(finalTiming)
    await localSink.publish(attempt)

    let runtime = await activePlans.load()
    expect(runtime?.activePlan.tasks[0]).toMatchObject({
      status: 'active',
      effectiveSeconds: 900,
      training: {
        remainingEffectiveSeconds: 0,
        status: 'finish-current-item',
        completedItemIds: [],
      },
    })
    expect(runtime?.pendingTrainingAttempts).toEqual([attempt])
    expect(runtime?.completedLearningUnitIds).toEqual([])
    expect(
      (await engineStates.load())?.progress.durationSamples,
    ).toEqual([])

    await localSink.publish(streamItemCompletedEvent(task))
    runtime = await activePlans.load()
    expect(runtime?.activePlan.tasks[0].training).toMatchObject({
      status: 'finish-current-item',
      completedItemIds: [
        'vocabulary:item-1:term-to-meaning-choice',
      ],
      nextSupplyCursor:
        'vocabulary:item-1:term-to-meaning-choice',
    })

    const completion = budgetCompletedEvent(task)
    await localSink.publish(completion)
    await localSink.publish(completion)

    runtime = await activePlans.load()
    expect(runtime?.activePlan).toMatchObject({
      status: 'completed',
      tasks: [
        {
          status: 'completed',
          training: {
            remainingEffectiveSeconds: 0,
            status: 'completed',
          },
        },
      ],
    })
    expect(runtime?.pendingTrainingAttempts).toEqual([])
    expect(runtime?.completedLearningUnitIds).toEqual([
      task.learningUnitId,
    ])
    expect(
      (await engineStates.load())?.progress.durationSamples,
    ).toEqual([
      expect.objectContaining({
        sampleId: attempt.id,
        taskId: task.taskId,
        effectiveSeconds: 900,
        source: 'timing-segments',
        reliable: true,
      }),
    ])
  })

  it('persists content exhaustion without completing or clearing the supply ledger', async () => {
    const planStore = new MemoryNamespaceStore(
      'app.learning-runtime',
    )
    const engineStore = new MemoryNamespaceStore('learning.engine')
    const activePlans = new ActivePlanRepository(planStore)
    const engineStates = new LearningEngineRepository(engineStore)
    const dailyPlan = budgetPlan()
    const task = dailyPlan.tasks[0]
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
    const localSink = new ProductionLearningEventSink(
      activePlans,
      engineStates,
    )

    await localSink.publish(streamItemCompletedEvent(task))
    const exhausted = contentExhaustedEvent(task)
    await localSink.publish(exhausted)
    await localSink.publish(exhausted)

    const restored = await activePlans.load()
    expect(restored?.activePlan).toMatchObject({
      status: 'in-progress',
      tasks: [
        {
          status: 'blocked',
          training: {
            status: 'content-exhausted',
            remainingEffectiveSeconds: 900,
            completedItemIds: [
              'vocabulary:item-1:term-to-meaning-choice',
            ],
            nextSupplyCursor:
              'vocabulary:item-1:term-to-meaning-choice',
            contentExhausted: {
              requestId:
                `${task.taskId}:supply:2:vocabulary:item-1`,
              cursor:
                'vocabulary:item-1:term-to-meaning-choice',
              reason:
                'all-eligible-content-recently-used',
            },
          },
        },
      ],
    })
    expect(restored?.completedLearningUnitIds).toEqual([])
  })

  it.each(trainingModules)(
    'restores, completes, and refresh-recovers the %s budget after content exhaustion',
    async (moduleId) => {
      const harness = await createRecoveryHarness(moduleId)
      const firstSink = new ProductionLearningEventSink(
        harness.activePlans,
        harness.engineStates,
      )
      const exhaustionRequestId =
        `${harness.task.taskId}:supply:2:recovery-item-1`
      await firstSink.publish(
        recoveryItemCompletedEvent(harness.task, 1),
      )
      await firstSink.publish(
        recoveryContentExhaustedEvent(
          harness.task,
          exhaustionRequestId,
        ),
      )

      const refreshedPlans = new ActivePlanRepository(
        harness.planStore,
      )
      const refreshedEngines = new LearningEngineRepository(
        harness.engineStore,
      )
      const refreshedSink = new ProductionLearningEventSink(
        refreshedPlans,
        refreshedEngines,
      )
      const updates: unknown[] = []
      refreshedSink.subscribe((update) => updates.push(update))
      const recovered = recoveryContentRecoveredEvent(
        harness.task,
        exhaustionRequestId,
      )

      await refreshedSink.publish(recovered)
      await refreshedSink.publish(recovered)

      expect(updates).toHaveLength(1)
      expect((await refreshedPlans.load())?.activePlan.tasks[0]).toMatchObject({
        status: 'active',
        training: {
          status: 'running',
          remainingEffectiveSeconds: 900,
          completedItemIds: [
            `${moduleId}:recovery-item-1`,
          ],
          nextSupplyCursor: `${moduleId}:recovery-item-1`,
          contentExhausted: null,
        },
      })

      await refreshedSink.publish(
        timingEvent(harness.task, {
          id: `${moduleId}:recovery-timing`,
          startedAt: '2026-07-24T08:00:00.000Z',
          endedAt: '2026-07-24T08:15:00.000Z',
          elapsedSeconds: 900,
          phase: 'audio-listening',
          reason: 'active-audio-listening',
        }),
      )
      await refreshedSink.publish(
        recoveryAttemptCompletedEvent(harness.task),
      )
      await refreshedSink.publish(
        recoveryItemCompletedEvent(harness.task, 2),
      )
      await refreshedSink.publish(
        recoveryBudgetCompletedEvent(harness.task, 2),
      )

      const afterRefresh = await new ActivePlanRepository(
        harness.planStore,
      ).load()
      expect(afterRefresh?.activePlan.tasks[0]).toMatchObject({
        status: 'completed',
        effectiveSeconds: 900,
        training: {
          status: 'completed',
          remainingEffectiveSeconds: 0,
          completedItemIds: [
            `${moduleId}:recovery-item-1`,
            `${moduleId}:recovery-item-2`,
          ],
          contentExhausted: null,
        },
      })
      expect(
        afterRefresh?.processedEventIds.filter(
          (eventId) => eventId === recovered.id,
        ),
      ).toEqual([recovered.id])
      expect(
        (await refreshedEngines.load())?.progress.durationSamples,
      ).toEqual([
        expect.objectContaining({
          sampleId: `${moduleId}:recovery-attempt`,
          taskId: harness.task.taskId,
          effectiveSeconds: 900,
          source: 'timing-segments',
          reliable: true,
        }),
      ])
    },
  )

  it.each(trainingModules)(
    'publishes the restored %s budget as finish-current-item when time already reached zero',
    async (moduleId) => {
      const harness = await createRecoveryHarness(moduleId)
      const localSink = new ProductionLearningEventSink(
        harness.activePlans,
        harness.engineStates,
      )
      const exhaustionRequestId =
        `${harness.task.taskId}:supply:2:recovery-item-1`
      await localSink.publish(
        recoveryItemCompletedEvent(harness.task, 1),
      )
      await localSink.publish(
        timingEvent(harness.task, {
          id: `${moduleId}:timing-before-exhaustion`,
          startedAt: '2026-07-24T08:00:00.000Z',
          endedAt: '2026-07-24T08:15:00.000Z',
          elapsedSeconds: 900,
          phase: 'audio-listening',
          reason: 'active-audio-listening',
        }),
      )
      await localSink.publish(
        recoveryContentExhaustedEvent(
          harness.task,
          exhaustionRequestId,
        ),
      )
      await localSink.publish(
        recoveryContentRecoveredEvent(
          harness.task,
          exhaustionRequestId,
        ),
      )

      expect(
        (await harness.activePlans.load())?.activePlan.tasks[0],
      ).toMatchObject({
        status: 'active',
        training: {
          status: 'finish-current-item',
          remainingEffectiveSeconds: 0,
          contentExhausted: null,
        },
      })
    },
  )

  it.each(trainingModules)(
    'replays the same %s recovery after a failed plan save without exposing or double-applying it',
    async (moduleId) => {
      const planStore = new FailingNamespaceStore(
        'app.learning-runtime',
      )
      const harness = await createRecoveryHarness(
        moduleId,
        planStore,
      )
      const localSink = new ProductionLearningEventSink(
        harness.activePlans,
        harness.engineStates,
      )
      const exhaustionRequestId =
        `${harness.task.taskId}:supply:1:initial`
      await localSink.publish(
        recoveryContentExhaustedEvent(
          harness.task,
          exhaustionRequestId,
        ),
      )
      const recovered = recoveryContentRecoveredEvent(
        harness.task,
        exhaustionRequestId,
      )
      const updates: unknown[] = []
      localSink.subscribe((update) => updates.push(update))

      planStore.failNextPut = true
      await expect(localSink.publish(recovered)).rejects.toThrow(
        'simulated local write failure',
      )
      expect(updates).toEqual([])
      expect(
        (await harness.activePlans.load())?.activePlan.tasks[0],
      ).toMatchObject({
        status: 'blocked',
        training: {
          status: 'content-exhausted',
          contentExhausted: {
            requestId: exhaustionRequestId,
          },
        },
      })

      await localSink.publish(recovered)
      await localSink.publish(recovered)

      const restored = await new ActivePlanRepository(
        harness.planStore,
      ).load()
      expect(updates).toHaveLength(1)
      expect(restored?.activePlan.tasks[0]).toMatchObject({
        status: 'active',
        training: {
          status: 'running',
          contentExhausted: null,
        },
      })
      expect(
        restored?.processedEventIds.filter(
          (eventId) => eventId === recovered.id,
        ),
      ).toEqual([recovered.id])
    },
  )

  it('rejects a recovery mode that does not match the scheduled task', async () => {
    const harness = await createRecoveryHarness('vocabulary')
    const localSink = new ProductionLearningEventSink(
      harness.activePlans,
      harness.engineStates,
    )
    const exhaustionRequestId =
      `${harness.task.taskId}:supply:1:initial`
    await localSink.publish(
      recoveryContentExhaustedEvent(
        harness.task,
        exhaustionRequestId,
      ),
    )
    const recovered = recoveryContentRecoveredEvent(
      harness.task,
      exhaustionRequestId,
    )
    if (
      recovered.payload === null ||
      typeof recovered.payload !== 'object' ||
      Array.isArray(recovered.payload)
    ) {
      throw new Error('Expected an object recovery payload.')
    }

    await expect(
      localSink.publish({
        ...recovered,
        payload: {
          ...recovered.payload,
          mode: 'review',
        },
      }),
    ).rejects.toThrow('mode')
  })

  it('notifies subscribers only after both local repositories save and retries without double counting', async () => {
    const planStore = new FailingNamespaceStore(
      'app.learning-runtime',
    )
    const engineStore = new MemoryNamespaceStore('learning.engine')
    const activePlans = new ActivePlanRepository(planStore)
    const engineStates = new LearningEngineRepository(engineStore)
    const dailyPlan = plan()
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
    const localSink = new ProductionLearningEventSink(
      activePlans,
      engineStates,
    )
    const updates: unknown[] = []
    localSink.subscribe((update) => updates.push(update))
    const event = timingEvent(dailyPlan.tasks[0], {
      id: 'timing-save-order',
      startedAt: '2026-07-24T08:00:00.000Z',
      endedAt: '2026-07-24T08:00:05.000Z',
      elapsedSeconds: 5,
    })

    planStore.failNextPut = true
    await expect(localSink.publish(event)).rejects.toThrow(
      'simulated local write failure',
    )
    expect(updates).toEqual([])
    expect(
      (await activePlans.load())?.activePlan.tasks[0]
        .effectiveSeconds,
    ).toBe(0)
    expect(
      (await engineStates.load())?.progress.dailyActivity[0]
        .effectiveSeconds,
    ).toBe(5)

    await localSink.publish(event)

    expect(updates).toHaveLength(1)
    expect(
      (await activePlans.load())?.activePlan.tasks[0],
    ).toMatchObject({
      effectiveSeconds: 5,
      timingSegmentCount: 1,
      excludedSeconds: 0,
    })
    expect(
      (await engineStates.load())?.progress.dailyActivity[0]
        .effectiveSeconds,
    ).toBe(5)
  })

  it('replays a failed budget completion without duplicating its pending duration sample', async () => {
    const planStore = new FailingNamespaceStore(
      'app.learning-runtime',
    )
    const engineStore = new MemoryNamespaceStore('learning.engine')
    const activePlans = new ActivePlanRepository(planStore)
    const engineStates = new LearningEngineRepository(engineStore)
    const dailyPlan = budgetPlan()
    const task = dailyPlan.tasks[0]
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
    const localSink = new ProductionLearningEventSink(
      activePlans,
      engineStates,
    )
    await localSink.publish(
      timingEvent(task, {
        id: 'budget-replay-timing',
        startedAt: '2026-07-24T08:00:00.000Z',
        endedAt: '2026-07-24T08:15:00.000Z',
        elapsedSeconds: 900,
        phase: 'audio-listening',
        reason: 'active-audio-listening',
      }),
    )
    await localSink.publish(completedEvent())
    await localSink.publish(streamItemCompletedEvent(task))
    const completion = budgetCompletedEvent(task)

    planStore.failNextPut = true
    await expect(localSink.publish(completion)).rejects.toThrow(
      'simulated local write failure',
    )
    expect(
      (await activePlans.load())?.activePlan.tasks[0].status,
    ).toBe('active')
    expect(
      (await activePlans.load())?.pendingTrainingAttempts,
    ).toHaveLength(1)
    expect(
      (await engineStates.load())?.progress.durationSamples,
    ).toHaveLength(1)

    await localSink.publish(completion)

    expect(
      (await activePlans.load())?.activePlan.tasks[0].status,
    ).toBe('completed')
    expect(
      (await activePlans.load())?.pendingTrainingAttempts,
    ).toEqual([])
    expect(
      (await engineStates.load())?.progress.durationSamples,
    ).toHaveLength(1)
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
