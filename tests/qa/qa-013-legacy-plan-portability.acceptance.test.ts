import { describe, expect, it } from 'vitest'
import type { PlatformEvent } from '../../src/core/index.ts'
import {
  createLearningEngineState,
  createPlanProgress,
  LearningEngineRepository,
  type DailyPlan,
  type LearningTask,
  type TrainingModuleId,
} from '../../src/learning-engine/index.ts'
import { abilityProfile } from '../../src/learning-engine/test-fixtures.ts'
import { assertPortableValue } from '../../src/storage/portable-value.ts'
import {
  ActivePlanRepository,
  createActiveLearningRuntime,
} from '../../src/app/learning/active-plan-repository.ts'
import { ProductionLearningEventSink } from '../../src/app/learning/production-event-sink.ts'
import {
  MemoryNamespaceStore,
  productionTaskFor,
} from './fixtures/production-course.ts'

class PortableMemoryNamespaceStore extends MemoryNamespaceStore {
  override async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    assertPortableValue(value)
    await super.put(key, value, schemaVersion)
  }
}

function legacyTask(
  moduleId: TrainingModuleId,
  sequence: number,
  estimatedSeconds: number,
): LearningTask {
  const production = productionTaskFor(moduleId)
  const {
    trainingBudget: _trainingBudget,
    durationEstimate: _durationEstimate,
    ...legacy
  } = production
  return {
    ...legacy,
    taskId: `qa-013-legacy-plan:${moduleId}`,
    planId: 'qa-013-legacy-plan',
    sequence,
    estimatedSeconds,
  }
}

function legacyIphonePlan(): DailyPlan {
  const vocabulary = legacyTask('vocabulary', 1, 123)
  const listening = legacyTask('listening', 2, 211)
  const speaking = legacyTask('speaking', 3, 181)
  return {
    schemaVersion: 1,
    planId: 'qa-013-legacy-plan',
    localDate: '2026-07-24',
    generatedAt: '2026-07-24T08:00:00.000Z',
    targetSeconds: 2_700,
    plannedSeconds: 515,
    unfilledSeconds: 2_185,
    status: 'partial',
    tasks: [vocabulary, listening, speaking],
    allocations: {
      vocabulary: {
        domain: 'vocabulary',
        weaknessWeight: 1,
        targetDifficulty: vocabulary.difficultyLevel,
        targetSeconds: 900,
        plannedSeconds: 123,
      },
      listening: {
        domain: 'listening',
        weaknessWeight: 1,
        targetDifficulty: listening.difficultyLevel,
        targetSeconds: 900,
        plannedSeconds: 211,
      },
      speaking: {
        domain: 'speaking',
        weaknessWeight: 1,
        targetDifficulty: speaking.difficultyLevel,
        targetSeconds: 900,
        plannedSeconds: 181,
      },
    },
    warnings: ['insufficient-eligible-content'],
  }
}

function startedEvent(
  task: LearningTask,
  minute: number,
): PlatformEvent {
  return {
    id: `qa-013:${task.targetModuleId}:started`,
    type: 'learning.task.started.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: `2026-07-24T08:${minute}:00.000Z`,
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
    },
  }
}

function timingEvent(
  task: LearningTask,
  input: {
    readonly elapsedSeconds: number
    readonly minute: number
    readonly phase: 'audio-listening' | 'recording'
    readonly reason:
      | 'active-audio-listening'
      | 'active-recording'
  },
): PlatformEvent {
  const startedAt =
    `2026-07-24T08:${input.minute}:00.000Z`
  const endedAt =
    `2026-07-24T08:${input.minute}:${String(
      input.elapsedSeconds,
    ).padStart(2, '0')}.000Z`
  return {
    id: `qa-013:${task.targetModuleId}:timing`,
    type: 'learning.timing.segment.recorded.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: endedAt,
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
      phase: input.phase,
      reason: input.reason,
      visibility: 'foreground',
      startedAt,
      endedAt,
      elapsedSeconds: input.elapsedSeconds,
      idleThresholdSeconds: 45,
    },
  }
}

function attemptEvent(
  task: LearningTask,
  minute: number,
): PlatformEvent {
  return {
    id: `qa-013:${task.targetModuleId}:attempt`,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: `2026-07-24T08:${minute}:20.000Z`,
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
      durationSeconds: 10,
      taskCompleted: true,
      errorTags: [],
      contentTags: task.tags,
      failureCategory: null,
    },
  }
}

describe('QA-013 legacy iPhone active-plan portability', () => {
  it('persists and restores listening and speaking without losing the completed 12-second vocabulary task', async () => {
    const planStore = new PortableMemoryNamespaceStore(
      'app.learning-runtime',
    )
    const engineStore = new PortableMemoryNamespaceStore(
      'learning.engine',
    )
    const plans = new ActivePlanRepository(planStore)
    const engines = new LearningEngineRepository(engineStore)
    const dailyPlan = legacyIphonePlan()
    const created = createPlanProgress(
      dailyPlan,
      dailyPlan.generatedAt,
    )
    expect(
      created.tasks.every(
        (execution) => !Object.hasOwn(execution, 'training'),
      ),
    ).toBe(true)

    const vocabulary = created.tasks[0]
    const progress = {
      ...created,
      status: 'in-progress' as const,
      tasks: [
        {
          ...vocabulary,
          status: 'completed' as const,
          completionKind: 'scored' as const,
          spentSeconds: 12,
          effectiveSeconds: 12,
          effectiveTimeSource:
            'legacy-event-duration' as const,
          startedAt: '2026-07-24T08:00:00.000Z',
          updatedAt: '2026-07-24T08:00:12.000Z',
        },
        created.tasks[1],
        created.tasks[2],
      ],
      processedEventIds: ['qa-013:vocabulary:attempt'],
      updatedAt: '2026-07-24T08:00:12.000Z',
    }
    await plans.save(
      createActiveLearningRuntime(progress, {
        completedLearningUnitIds: [
          vocabulary.task.learningUnitId,
        ],
        processedEventIds: ['qa-013:vocabulary:attempt'],
        skipHistory: [],
      }),
    )
    await engines.save(
      createLearningEngineState(
        abilityProfile(),
        dailyPlan.generatedAt,
      ),
    )

    const publishAndReload = async (
      event: PlatformEvent,
    ) => {
      const sink = new ProductionLearningEventSink(
        new ActivePlanRepository(planStore),
        new LearningEngineRepository(engineStore),
      )
      await sink.publish(event)
      const restored =
        await new ActivePlanRepository(planStore).load()
      expect(restored).toBeDefined()
      assertPortableValue(restored)
      expect(
        restored?.activePlan.tasks.every(
          (execution) =>
            !Object.hasOwn(execution, 'training'),
        ),
      ).toBe(true)
      expect(restored?.activePlan.tasks[0]).toMatchObject({
        status: 'completed',
        completionKind: 'scored',
        spentSeconds: 12,
        effectiveSeconds: 12,
      })
      expect(restored?.completedLearningUnitIds).toContain(
        vocabulary.task.learningUnitId,
      )
      return restored
    }

    const listening = dailyPlan.tasks[1]
    let restored = await publishAndReload(
      startedEvent(listening, 11),
    )
    expect(restored?.activePlan.tasks[1].status).toBe('active')
    restored = await publishAndReload(
      timingEvent(listening, {
        elapsedSeconds: 7,
        minute: 11,
        phase: 'audio-listening',
        reason: 'active-audio-listening',
      }),
    )
    expect(restored?.activePlan.tasks[1]).toMatchObject({
      status: 'active',
      effectiveSeconds: 7,
      effectiveTimeSource: 'timing-segments',
    })
    restored = await publishAndReload(
      attemptEvent(listening, 11),
    )
    expect(restored?.activePlan.tasks[1]).toMatchObject({
      status: 'completed',
      completionKind: 'scored',
      effectiveSeconds: 7,
    })

    const speaking = dailyPlan.tasks[2]
    restored = await publishAndReload(
      startedEvent(speaking, 12),
    )
    expect(restored?.activePlan.tasks[2].status).toBe('active')
    restored = await publishAndReload(
      timingEvent(speaking, {
        elapsedSeconds: 9,
        minute: 12,
        phase: 'recording',
        reason: 'active-recording',
      }),
    )
    expect(restored?.activePlan.tasks[2]).toMatchObject({
      status: 'active',
      effectiveSeconds: 9,
      effectiveTimeSource: 'timing-segments',
    })
    restored = await publishAndReload(
      attemptEvent(speaking, 12),
    )
    expect(
      restored?.activePlan.tasks.map(
        (execution) => execution.status,
      ),
    ).toEqual(['completed', 'completed', 'completed'])
    expect(
      restored?.activePlan.plan.tasks.every(
        (task) => !Object.hasOwn(task, 'trainingBudget'),
      ),
    ).toBe(true)
    expect(restored?.completedLearningUnitIds).toEqual(
      dailyPlan.tasks.map((task) => task.learningUnitId),
    )
    expect(
      (await new LearningEngineRepository(engineStore).load())
        ?.progress.attempts,
    ).toHaveLength(2)
  })
})
