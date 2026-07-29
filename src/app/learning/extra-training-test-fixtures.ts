import {
  createLearningEngineState,
  createPlanProgress,
  type DailyPlan,
  type LearningTask,
  type PlanProgress,
  type TrainingModuleId,
} from '../../learning-engine/index.ts'
import { abilityProfile } from '../../learning-engine/test-fixtures.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import {
  createActiveLearningRuntime,
  type ActiveLearningRuntime,
} from './active-plan-repository.ts'

export class MemoryNamespaceStore implements NamespaceStore {
  readonly records = new Map<string, StoredRecord<unknown>>()
  readonly namespace: string
  failNextPut = false

  constructor(namespace: string) {
    this.namespace = namespace
  }

  async get<T>(
    key: string,
  ): Promise<StoredRecord<T> | undefined> {
    return this.records.get(key) as StoredRecord<T> | undefined
  }

  async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    if (this.failNextPut) {
      this.failNextPut = false
      throw new Error('simulated storage failure')
    }
    const portable = JSON.parse(JSON.stringify(value)) as T
    this.records.set(key, {
      namespace: this.namespace,
      key,
      value: portable,
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

export function extraTrainingTask(
  moduleId: TrainingModuleId,
  localDate = '2026-07-29',
): LearningTask {
  const sequence =
    moduleId === 'vocabulary'
      ? 1
      : moduleId === 'listening'
        ? 2
        : 3
  return {
    schemaVersion: 1,
    taskId: `daily:${localDate}:${moduleId}`,
    planId: `daily:${localDate}`,
    sequence,
    learningUnitId: `unit-${moduleId}`,
    contentRef: `lesson://course/1/day-1/${moduleId}`,
    domain: moduleId,
    targetModuleId: moduleId,
    mode: 'learn',
    origin: 'new',
    difficultyLevel: sequence,
    estimatedSeconds: 120 + sequence,
    trainingBudget: {
      schemaVersion: 1,
      targetEffectiveSeconds: 900,
    },
    required: true,
    dueAt: null,
    skipLimit: 2,
    tags: ['day:1'],
  }
}

export function extraTrainingDailyPlan(
  localDate = '2026-07-29',
): DailyPlan {
  const tasks = (
    ['vocabulary', 'listening', 'speaking'] as const
  ).map((moduleId) => extraTrainingTask(moduleId, localDate))
  return {
    schemaVersion: 1,
    planId: `daily:${localDate}`,
    localDate,
    generatedAt: `${localDate}T08:00:00.000Z`,
    targetSeconds: 2_700,
    plannedSeconds: tasks.reduce(
      (total, task) => total + task.estimatedSeconds,
      0,
    ),
    unfilledSeconds: 0,
    status: 'ready',
    tasks,
    allocations: {
      vocabulary: {
        domain: 'vocabulary',
        weaknessWeight: 1 / 3,
        targetDifficulty: 1,
        targetSeconds: 900,
        plannedSeconds: tasks[0].estimatedSeconds,
      },
      listening: {
        domain: 'listening',
        weaknessWeight: 1 / 3,
        targetDifficulty: 2,
        targetSeconds: 900,
        plannedSeconds: tasks[1].estimatedSeconds,
      },
      speaking: {
        domain: 'speaking',
        weaknessWeight: 1 / 3,
        targetDifficulty: 3,
        targetSeconds: 900,
        plannedSeconds: tasks[2].estimatedSeconds,
      },
    },
    warnings: [],
  }
}

export function completedExtraTrainingPlan(
  localDate = '2026-07-29',
): PlanProgress {
  const initial = createPlanProgress(
    extraTrainingDailyPlan(localDate),
    `${localDate}T08:00:00.000Z`,
  )
  return {
    ...initial,
    status: 'completed',
    tasks: initial.tasks.map((execution) => ({
      ...execution,
      status: 'completed',
      completionKind: 'scored',
      training: {
        ...execution.training!,
        remainingEffectiveSeconds: 0,
        status: 'completed',
      },
      updatedAt: `${localDate}T08:30:00.000Z`,
    })),
    updatedAt: `${localDate}T08:30:00.000Z`,
  }
}

export function completedExtraTrainingRuntime(
  localDate = '2026-07-29',
): ActiveLearningRuntime {
  return createActiveLearningRuntime(
    completedExtraTrainingPlan(localDate),
  )
}

export function extraTrainingEngineState(
  at = '2026-07-29T08:00:00.000Z',
) {
  return createLearningEngineState(abilityProfile(), at)
}
