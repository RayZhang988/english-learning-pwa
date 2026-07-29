import { beforeEach, describe, expect, it } from 'vitest'
import type {
  PlatformEvent,
  PlatformEventSink,
} from '../../core/index.ts'
import {
  AssessmentProfileRepository,
  createTravelVocabularyAssessmentRuntimeR1,
  VersionedAssessmentProfileRepository,
} from '../../features/assessment/index.ts'
import {
  LearningEngineRepository,
  type LearningCandidate,
  type LearningTimingPhase,
  type LearningTimingSegmentReason,
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
} from './active-plan-repository.ts'
import type { LearningCandidateSource } from './course-candidate-source.ts'
import { LearningAppCoordinator } from './learning-app-coordinator.ts'
import {
  toDailyPlanViewModel,
  toPracticeModulesViewModel,
} from './view-model.ts'

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

function candidate(
  day: number,
  domain: TrainingModuleId,
  prerequisitesMet: boolean,
): LearningCandidate {
  return {
    schemaVersion: 1,
    learningUnitId: `st4w-w1d${day}-${domain}`,
    contentRef:
      `lesson://survival-travel-american-4w/1.0.0/w1d${day}/${domain}`,
    domain,
    difficultyLevel: 5,
    estimatedSeconds: 900,
    tags: [`day:${day}`],
    prerequisitesMet,
  }
}

class SequencedCandidateSource implements LearningCandidateSource {
  loadCount = 0

  async load(
    completedLearningUnitIds: ReadonlySet<string>,
    availableModuleIds: ReadonlySet<TrainingModuleId>,
  ): Promise<readonly LearningCandidate[]> {
    this.loadCount += 1
    return (['vocabulary', 'listening', 'speaking'] as const)
      .filter((domain) => availableModuleIds.has(domain))
      .flatMap((domain) =>
        [1, 2, 3, 4].map((day) =>
          candidate(
            day,
            domain,
            day === 1 ||
              completedLearningUnitIds.has(
                `st4w-w1d${day - 1}-${domain}`,
              ),
          ),
        ),
      )
  }
}

function completedEvent(
  task: LearningTask,
  localDate: string,
): PlatformEvent {
  return {
    id: `completed:${task.taskId}`,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: `${localDate}T08:15:00.000Z`,
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate,
      mode: task.mode,
      difficultyLevel: task.difficultyLevel,
      estimatedSeconds: task.estimatedSeconds,
      result: 'scored',
      performanceScore: 0.8,
      evidenceQuality: 0.9,
      assistanceLevel: 0,
      durationSeconds: 600,
      taskCompleted: true,
      errorTags: [],
      contentTags: task.tags,
      failureCategory: null,
    },
  }
}

function startedEvent(
  task: LearningTask,
  localDate: string,
): PlatformEvent {
  return {
    id: `started:${task.taskId}`,
    type: 'learning.task.started.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: `${localDate}T08:05:00.000Z`,
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate,
      mode: task.mode,
    },
  }
}

function timingEvent(
  task: LearningTask,
  localDate: string,
  input: {
    readonly id: string
    readonly elapsedSeconds: number
    readonly offsetSeconds?: number
    readonly phase: LearningTimingPhase
    readonly reason: LearningTimingSegmentReason
    readonly visibility?: 'foreground' | 'background'
  },
): PlatformEvent {
  const startedAtMs =
    Date.parse(`${localDate}T08:00:00.000Z`) +
    (input.offsetSeconds ?? 0) * 1_000
  const endedAtMs = startedAtMs + input.elapsedSeconds * 1_000
  return {
    id: input.id,
    type: 'learning.timing.segment.recorded.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: new Date(endedAtMs).toISOString(),
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate,
      mode: task.mode,
      phase: input.phase,
      reason: input.reason,
      visibility: input.visibility ?? 'foreground',
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      elapsedSeconds: input.elapsedSeconds,
      idleThresholdSeconds: 45,
    },
  }
}

async function publishActiveTiming(
  sink: PlatformEventSink,
  task: LearningTask,
  localDate: string,
  input: {
    readonly totalSeconds: number
    readonly phase: LearningTimingPhase
    readonly reason: LearningTimingSegmentReason
  },
): Promise<number> {
  const maximumSegmentSeconds =
    input.phase === 'answering' || input.phase === 'feedback'
      ? 45
      : 900
  let remainingSeconds = input.totalSeconds
  let offsetSeconds = 0
  let segment = 0
  while (remainingSeconds > 0) {
    const elapsedSeconds = Math.min(
      remainingSeconds,
      maximumSegmentSeconds,
    )
    await sink.publish(
      timingEvent(task, localDate, {
        id: `timing:${task.taskId}:active:${segment}`,
        elapsedSeconds,
        offsetSeconds,
        phase: input.phase,
        reason: input.reason,
      }),
    )
    remainingSeconds -= elapsedSeconds
    offsetSeconds += elapsedSeconds
    segment += 1
  }
  return segment
}

function streamItemCompletedEvent(
  task: LearningTask,
  localDate: string,
): PlatformEvent {
  const itemId = `${task.taskId}:stream-item`
  return {
    id: `item-completed:${task.taskId}`,
    type: 'learning.training.item.completed.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: `${localDate}T08:15:01.000Z`,
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate,
      mode: task.mode,
      item: {
        itemId,
        learningUnitId: task.learningUnitId,
        contentRef: task.contentRef,
        difficultyLevel: task.difficultyLevel,
        tags: task.tags,
      },
      requestId: `${task.taskId}:supply:1:initial`,
      nextSupplyCursor: itemId,
      outcome: 'scored',
    },
  }
}

function budgetCompletedEvent(
  task: LearningTask,
  localDate: string,
): PlatformEvent {
  return {
    id: `budget-completed:${task.taskId}`,
    type: 'learning.training.budget.completed.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: `${localDate}T08:15:02.000Z`,
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate,
      mode: task.mode,
      lastCompletedItemId: `${task.taskId}:stream-item`,
      completedItemCount: 1,
    },
  }
}

async function publishBudgetTerminalEvents(
  sink: PlatformEventSink,
  task: LearningTask,
  localDate: string,
): Promise<void> {
  await sink.publish(completedEvent(task, localDate))
  await sink.publish(streamItemCompletedEvent(task, localDate))
  await sink.publish(budgetCompletedEvent(task, localDate))
}

async function completeBudgetTask(
  sink: PlatformEventSink,
  task: LearningTask,
  localDate: string,
): Promise<void> {
  if (!task.trainingBudget) {
    await sink.publish(completedEvent(task, localDate))
    return
  }
  await publishActiveTiming(sink, task, localDate, {
    totalSeconds: task.trainingBudget.targetEffectiveSeconds,
    phase: 'audio-listening',
    reason: 'active-audio-listening',
  })
  await publishBudgetTerminalEvents(sink, task, localDate)
}

async function completedR1Profile() {
  const runtime = createTravelVocabularyAssessmentRuntimeR1({
    now: () => '2026-07-27T08:00:00.000Z',
    createId: () => 'learning-r1-profile',
    random: () => 0.44,
  })
  let state = runtime.start()
  for (let stage = 0; stage < 5; stage += 1) {
    for (const question of state.questions) {
      state = runtime.markUncertain(question.id)
    }
    state = await runtime.submitStage()
    if (stage < 4) {
      state = runtime.continueToNextStage()
    }
  }
  if (!state.profile) {
    throw new Error('Expected a completed schema 3 profile.')
  }
  return state.profile
}

describe('LearningAppCoordinator', () => {
  let profiles: AssessmentProfileRepository
  let activePlans: ActivePlanRepository
  let engineStates: LearningEngineRepository
  let candidates: SequencedCandidateSource
  let currentDate: Date
  let idSequence: number

  beforeEach(() => {
    profiles = new AssessmentProfileRepository(
      new MemoryNamespaceStore('feature.assessment'),
    )
    activePlans = new ActivePlanRepository(
      new MemoryNamespaceStore('app.learning-runtime'),
    )
    engineStates = new LearningEngineRepository(
      new MemoryNamespaceStore('learning.engine'),
    )
    candidates = new SequencedCandidateSource()
    currentDate = new Date(2026, 6, 24, 8, 0, 0)
    idSequence = 0
  })

  function coordinator() {
    return new LearningAppCoordinator({
      profiles,
      activePlans,
      engineStates,
      candidates,
      availableModuleIds: new Set([
        'vocabulary',
        'listening',
        'speaking',
      ]),
      now: () => currentDate,
      createId: () => `id-${++idSequence}`,
    })
  }

  it('uses an honest assessment-required state when no profile exists', async () => {
    const state = await coordinator().initialize()

    expect(state.status).toBe('assessment-required')
    expect(candidates.loadCount).toBe(0)
    await expect(activePlans.load()).resolves.toBeUndefined()
  })

  it('generates and refresh-restores one real active daily plan', async () => {
    await profiles.saveLatest(abilityProfile())
    const first = coordinator()
    const firstState = await first.initialize()
    expect(firstState.status).toBe('ready')
    if (firstState.status !== 'ready') {
      throw new Error('Expected a ready plan.')
    }
    expect(firstState.runtime.activePlan.plan.tasks).toHaveLength(3)
    expect(
      firstState.runtime.activePlan.plan.tasks.map(
        (task) => task.trainingBudget,
      ),
    ).toEqual([
      { schemaVersion: 1, targetEffectiveSeconds: 900 },
      { schemaVersion: 1, targetEffectiveSeconds: 900 },
      { schemaVersion: 1, targetEffectiveSeconds: 900 },
    ])
    expect(
      firstState.runtime.activePlan.tasks.map(
        (execution) => execution.training,
      ),
    ).toEqual([
      expect.objectContaining({
        remainingEffectiveSeconds: 900,
        status: 'running',
        completedItemIds: [],
        nextSupplyCursor: null,
      }),
      expect.objectContaining({
        remainingEffectiveSeconds: 900,
        status: 'running',
        completedItemIds: [],
        nextSupplyCursor: null,
      }),
      expect.objectContaining({
        remainingEffectiveSeconds: 900,
        status: 'running',
        completedItemIds: [],
        nextSupplyCursor: null,
      }),
    ])
    expect(firstState.runtime.schemaVersion).toBe(1)
    expect(firstState.runtime.activePlan.schemaVersion).toBe(1)
    expect(firstState.taskAccess.schemaVersion).toBe(1)
    expect(firstState.taskAccess.startableTaskIds).toEqual(
      firstState.runtime.activePlan.plan.tasks.map(
        (task) => task.taskId,
      ),
    )
    const planId = firstState.runtime.activePlan.plan.planId

    const refreshed = coordinator()
    const refreshedState = await refreshed.initialize()
    expect(refreshedState.status).toBe('ready')
    if (refreshedState.status !== 'ready') {
      throw new Error('Expected a restored plan.')
    }
    expect(refreshedState.runtime.activePlan.plan.planId).toBe(planId)
    expect(refreshedState.taskAccess.startableTaskIds).toEqual(
      firstState.taskAccess.startableTaskIds,
    )
    expect(candidates.loadCount).toBe(1)
  })

  it('routes every unfinished task from the current plan by exact taskId', async () => {
    await profiles.saveLatest(abilityProfile())
    const app = coordinator()
    const state = await app.initialize()
    if (state.status !== 'ready') {
      throw new Error('Expected a ready plan.')
    }

    for (const task of state.runtime.activePlan.plan.tasks) {
      expect(app.routeForTask(task.taskId)).toBe(
        `/${task.targetModuleId}?taskId=${encodeURIComponent(task.taskId)}`,
      )
    }
    expect(state.taskAccess.startableTaskIds).toEqual(
      state.runtime.activePlan.plan.tasks.map((task) => task.taskId),
    )
    expect(() => app.resolveTask('unknown-task')).toThrow('taskId')
    expect(() =>
      app.resolveTask(
        state.runtime.activePlan.plan.tasks[0].taskId,
        'speaking',
      ),
    ).toThrow('requested training module')
  })

  it('restores the exact budget status used by a production training route', async () => {
    await profiles.saveLatest(abilityProfile())
    const app = coordinator()
    const state = await app.initialize()
    if (state.status !== 'ready') {
      throw new Error('Expected a ready plan.')
    }
    const listening = state.runtime.activePlan.plan.tasks.find(
      (task) => task.targetModuleId === 'listening',
    )
    if (!listening) {
      throw new Error('Expected a listening task.')
    }

    expect(
      app.trainingBudgetStatus(listening.taskId, 'listening'),
    ).toBe('running')
    await publishActiveTiming(
      app.eventSink,
      listening,
      state.localDate,
      {
        totalSeconds: 900,
        phase: 'audio-listening',
        reason: 'active-audio-listening',
      },
    )
    expect(
      app.trainingBudgetStatus(listening.taskId, 'listening'),
    ).toBe('finish-current-item')
    expect(() =>
      app.trainingBudgetStatus(listening.taskId, 'vocabulary'),
    ).toThrow('requested training module')
  })

  it('takes an arbitrary UI task ID through routing, persistence, and partial refresh recovery', async () => {
    await profiles.saveLatest(abilityProfile())
    let app = coordinator()
    let state = await app.initialize()
    if (state.status !== 'ready') {
      throw new Error('Expected a ready plan.')
    }
    const completionOrder = [
      state.runtime.activePlan.plan.tasks.find(
        (task) => task.targetModuleId === 'speaking',
      ),
      state.runtime.activePlan.plan.tasks.find(
        (task) => task.targetModuleId === 'vocabulary',
      ),
    ]
    if (completionOrder.some((task) => task === undefined)) {
      throw new Error('Expected speaking and vocabulary tasks.')
    }

    for (const task of completionOrder) {
      if (!task) {
        throw new Error('Expected a task.')
      }
      expect(app.routeForTask(task.taskId)).toBe(
        `/${task.targetModuleId}?taskId=${encodeURIComponent(task.taskId)}`,
      )
      await completeBudgetTask(
        app.eventSink,
        task,
        '2026-07-24',
      )

      app = coordinator()
      state = await app.initialize()
      if (state.status !== 'ready') {
        throw new Error('Expected a restored plan.')
      }
      expect(
        state.runtime.activePlan.tasks.find(
          (entry) => entry.task.taskId === task.taskId,
        )?.status,
      ).toBe('completed')
      expect(() => app.resolveTask(task.taskId)).toThrow(
        'already finished',
      )
      const unfinished = state.taskAccess.tasks.filter(
        (access) => access.availability === 'startable',
      )
      const startableTaskIds = state.taskAccess.startableTaskIds
      expect(
        unfinished.every((access) =>
          startableTaskIds.includes(access.taskId),
        ),
      ).toBe(true)
    }

    expect(state.taskAccess.startableTaskIds).toEqual([
      state.runtime.activePlan.plan.tasks.find(
        (task) => task.targetModuleId === 'listening',
      )?.taskId,
    ])
  })

  it('routes all three Practice cards with the same exact task ids as Today', async () => {
    await profiles.saveLatest(abilityProfile())
    const app = coordinator()
    const initialized = await app.initialize()
    if (initialized.status !== 'ready') {
      throw new Error('Expected a ready plan.')
    }

    const practiceModules = toPracticeModulesViewModel(
      initialized.runtime.activePlan,
      initialized.taskAccess,
    )
    const today = toDailyPlanViewModel(
      initialized.runtime.activePlan,
      initialized.engineState,
      initialized.taskAccess,
      '2026-07-24T08:00:00.000Z',
    )

    for (const plannedTask of initialized.runtime.activePlan.plan.tasks) {
      const module = practiceModules.find(
        (candidate) =>
          candidate.moduleId === plannedTask.targetModuleId,
      )
      const todayTask = today.tasks.find(
        (candidate) =>
          candidate.moduleId === plannedTask.targetModuleId,
      )

      expect(module).toMatchObject({
        availability: 'startable',
        taskId: plannedTask.taskId,
      })
      expect(todayTask).toMatchObject({
        availability: 'startable',
        taskId: plannedTask.taskId,
      })
      if (
        !module ||
        module.moduleId === 'assessment' ||
        module.availability !== 'startable'
      ) {
        throw new Error('Expected an enabled specialty practice card.')
      }
      expect(app.routeForTask(module.taskId)).toBe(
        `/${plannedTask.targetModuleId}?taskId=${encodeURIComponent(plannedTask.taskId)}`,
      )
    }
  })

  it('keeps recommendation non-binding when another task is active', async () => {
    await profiles.saveLatest(abilityProfile())
    const app = coordinator()
    const initialized = await app.initialize()
    if (initialized.status !== 'ready') {
      throw new Error('Expected a ready plan.')
    }
    const speaking = initialized.runtime.activePlan.plan.tasks.find(
      (task) => task.targetModuleId === 'speaking',
    )
    if (!speaking) {
      throw new Error('Expected a speaking task.')
    }

    await app.eventSink.publish(
      startedEvent(speaking, '2026-07-24'),
    )
    if (app.state.status !== 'ready') {
      throw new Error('Expected an updated ready plan.')
    }
    expect(app.state.taskAccess.recommendedTaskId).toBe(
      speaking.taskId,
    )
    expect(app.state.taskAccess.startableTaskIds).toEqual(
      expect.arrayContaining(
        app.state.runtime.activePlan.plan.tasks.map(
          (task) => task.taskId,
        ),
      ),
    )
    for (const task of app.state.runtime.activePlan.plan.tasks) {
      expect(() => app.routeForTask(task.taskId)).not.toThrow()
    }
  })

  it('persists the same 3/3 completion for all six task orders', async () => {
    const orders = [
      ['vocabulary', 'listening', 'speaking'],
      ['vocabulary', 'speaking', 'listening'],
      ['listening', 'vocabulary', 'speaking'],
      ['listening', 'speaking', 'vocabulary'],
      ['speaking', 'vocabulary', 'listening'],
      ['speaking', 'listening', 'vocabulary'],
    ] as const

    for (const order of orders) {
      profiles = new AssessmentProfileRepository(
        new MemoryNamespaceStore('feature.assessment'),
      )
      activePlans = new ActivePlanRepository(
        new MemoryNamespaceStore('app.learning-runtime'),
      )
      engineStates = new LearningEngineRepository(
        new MemoryNamespaceStore('learning.engine'),
      )
      candidates = new SequencedCandidateSource()
      idSequence = 0
      await profiles.saveLatest(abilityProfile())
      const app = coordinator()
      const initialized = await app.initialize()
      if (initialized.status !== 'ready') {
        throw new Error('Expected a ready plan.')
      }

      for (const moduleId of order) {
        const current = app.state
        if (current.status !== 'ready') {
          throw new Error('Expected an active ready plan.')
        }
        const task = current.runtime.activePlan.plan.tasks.find(
          (candidate) =>
            candidate.targetModuleId === moduleId,
        )
        if (!task) {
          throw new Error(`Expected a ${moduleId} task.`)
        }
        expect(current.taskAccess.startableTaskIds).toContain(
          task.taskId,
        )
        await completeBudgetTask(
          app.eventSink,
          task,
          '2026-07-24',
        )
        await completeBudgetTask(
          app.eventSink,
          task,
          '2026-07-24',
        )
      }

      if (app.state.status !== 'ready') {
        throw new Error('Expected a completed ready plan.')
      }
      expect(app.state.runtime.activePlan.status).toBe('completed')
      expect(
        app.state.runtime.activePlan.tasks.filter(
          (task) => task.status === 'completed',
        ),
      ).toHaveLength(3)
      expect(app.state.taskAccess.startableTaskIds).toEqual([])
      expect(
        (await engineStates.load())?.progress.attempts,
      ).toHaveLength(3)
      const refreshed = coordinator()
      const restored = await refreshed.initialize()
      if (restored.status !== 'ready') {
        throw new Error('Expected a restored completed plan.')
      }
      expect(restored.runtime.activePlan.status).toBe('completed')
      expect(restored.taskAccess.startableTaskIds).toEqual([])
    }
  })

  it('carries completion state across midnight and unlocks next units', async () => {
    await profiles.saveLatest(abilityProfile())
    const firstDay = coordinator()
    const firstState = await firstDay.initialize()
    if (firstState.status !== 'ready') {
      throw new Error('Expected a ready plan.')
    }
    const tasks = firstState.runtime.activePlan.plan.tasks
    for (const task of tasks) {
      await completeBudgetTask(
        firstDay.eventSink,
        task,
        '2026-07-24',
      )
    }
    expect(firstDay.state.status).toBe('ready')
    if (firstDay.state.status !== 'ready') {
      throw new Error('Expected a completed ready plan.')
    }
    expect(firstDay.state.runtime.activePlan.status).toBe('completed')

    currentDate = new Date(2026, 6, 25, 8, 0, 0)
    const secondDay = coordinator()
    const secondState = await secondDay.initialize()
    if (secondState.status !== 'ready') {
      throw new Error('Expected a next-day ready plan.')
    }
    expect(
      secondState.runtime.activePlan.plan.tasks.map(
        (task) => task.learningUnitId,
      ).sort(),
    ).toEqual([
      'st4w-w1d2-listening',
      'st4w-w1d2-speaking',
      'st4w-w1d2-vocabulary',
    ])
    expect(
      (await engineStates.load())?.progress.dailyActivity.some(
        (activity) => activity.localDate === '2026-07-24',
      ),
    ).toBe(true)
  })

  it('refreshes the same foreground app instance after midnight and creates budget tasks', async () => {
    await profiles.saveLatest(abilityProfile())
    const app = coordinator()
    const firstState = await app.initialize()
    if (firstState.status !== 'ready') {
      throw new Error('Expected a ready first-day plan.')
    }
    expect(
      firstState.runtime.activePlan.plan.tasks.every(
        (task) =>
          task.trainingBudget?.targetEffectiveSeconds === 900,
      ),
    ).toBe(true)
    const firstPlanId = firstState.runtime.activePlan.plan.planId
    const firstLoadCount = candidates.loadCount

    await expect(app.refreshForCurrentDate()).resolves.toBe(
      firstState,
    )
    expect(candidates.loadCount).toBe(firstLoadCount)

    currentDate = new Date(2026, 6, 25, 8, 0, 0)
    const secondState = await app.refreshForCurrentDate()
    if (secondState.status !== 'ready') {
      throw new Error('Expected a ready next-day plan.')
    }
    expect(secondState.localDate).toBe('2026-07-25')
    expect(secondState.runtime.activePlan.plan.planId).not.toBe(
      firstPlanId,
    )
    expect(
      secondState.runtime.activePlan.plan.tasks.every(
        (task) =>
          task.trainingBudget?.targetEffectiveSeconds === 900,
      ),
    ).toBe(true)
    expect(candidates.loadCount).toBe(firstLoadCount + 1)
  })

  it('upgrades a same-day legacy fixed-item plan without clearing learning history', async () => {
    await profiles.saveLatest(abilityProfile())
    const firstState = await coordinator().initialize()
    if (firstState.status !== 'ready') {
      throw new Error('Expected a ready budget plan.')
    }
    const legacyRuntime = structuredClone(firstState.runtime)
    for (const task of legacyRuntime.activePlan.plan.tasks) {
      delete (
        task as LearningTask & {
          trainingBudget?: LearningTask['trainingBudget']
        }
      ).trainingBudget
    }
    for (const execution of legacyRuntime.activePlan.tasks) {
      delete (
        execution.task as LearningTask & {
          trainingBudget?: LearningTask['trainingBudget']
        }
      ).trainingBudget
      delete (
        execution as typeof execution & {
          training?: typeof execution.training
        }
      ).training
    }
    await activePlans.save(legacyRuntime)

    const upgraded = await coordinator().initialize()
    if (upgraded.status !== 'ready') {
      throw new Error('Expected an upgraded ready plan.')
    }
    expect(upgraded.localDate).toBe('2026-07-24')
    expect(upgraded.runtime.activePlan.plan.planId).not.toBe(
      legacyRuntime.activePlan.plan.planId,
    )
    expect(
      upgraded.runtime.activePlan.plan.tasks.every(
        (task) =>
          task.trainingBudget?.targetEffectiveSeconds === 900,
      ),
    ).toBe(true)
    expect(
      upgraded.runtime.activePlan.tasks.every(
        (execution) =>
          execution.training?.targetEffectiveSeconds === 900 &&
          execution.training.status === 'running',
      ),
    ).toBe(true)
    expect(upgraded.runtime.completedLearningUnitIds).toEqual(
      legacyRuntime.completedLearningUnitIds,
    )
  })

  it('records only completed 900-second budget sessions and never lets personalization shorten the target', async () => {
    await profiles.saveLatest(abilityProfile())
    const excludedSegments: Readonly<
      Record<
        TrainingModuleId,
        {
          readonly phase: LearningTimingPhase
          readonly reason: LearningTimingSegmentReason
          readonly visibility: 'foreground' | 'background'
        }
      >
    > = {
      vocabulary: {
        phase: 'idle',
        reason: 'idle-timeout',
        visibility: 'foreground',
      },
      listening: {
        phase: 'answering',
        reason: 'app-backgrounded',
        visibility: 'background',
      },
      speaking: {
        phase: 'paused',
        reason: 'user-paused',
        visibility: 'foreground',
      },
    }
    const activePhases: Readonly<
      Record<
        TrainingModuleId,
        {
          readonly phase: LearningTimingPhase
          readonly reason: LearningTimingSegmentReason
        }
      >
    > = {
      vocabulary: {
        phase: 'answering',
        reason: 'active-answering',
      },
      listening: {
        phase: 'audio-listening',
        reason: 'active-audio-listening',
      },
      speaking: {
        phase: 'recording',
        reason: 'active-recording',
      },
    }

    for (let dayIndex = 0; dayIndex < 3; dayIndex += 1) {
      const app = coordinator()
      const initialized = await app.initialize()
      if (initialized.status !== 'ready') {
        throw new Error('Expected a ready timed plan.')
      }
      for (const task of initialized.runtime.activePlan.plan.tasks) {
        expect(task.durationEstimate).toMatchObject({
          basis: 'content-baseline',
          sampleCount: dayIndex,
        })
        expect(task.trainingBudget).toEqual({
          schemaVersion: 1,
          targetEffectiveSeconds: 900,
        })
        const active = activePhases[task.targetModuleId]
        const activeSegmentCount = await publishActiveTiming(
          app.eventSink,
          task,
          initialized.localDate,
          {
            totalSeconds: 900,
            phase: active.phase,
            reason: active.reason,
          },
        )
        if (dayIndex === 0) {
          const excluded = excludedSegments[task.targetModuleId]
          await app.eventSink.publish(
            timingEvent(task, initialized.localDate, {
              id: `timing:${task.taskId}:excluded`,
              elapsedSeconds: 60,
              offsetSeconds: 900,
              phase: excluded.phase,
              reason: excluded.reason,
              visibility: excluded.visibility,
            }),
          )
        }
        await publishBudgetTerminalEvents(
          app.eventSink,
          task,
          initialized.localDate,
        )
        if (app.state.status !== 'ready') {
          throw new Error('Expected the timed plan to remain ready.')
        }
        const execution = app.state.runtime.activePlan.tasks.find(
          (candidate) => candidate.task.taskId === task.taskId,
        )
        expect(execution).toMatchObject({
          status: 'completed',
          effectiveSeconds: 900,
          effectiveTimeSource: 'timing-segments',
          training: {
            remainingEffectiveSeconds: 0,
            status: 'completed',
          },
        })
        if (dayIndex === 0) {
          expect(execution).toMatchObject({
            spentSeconds: 960,
            excludedSeconds: 60,
            timingSegmentCount: activeSegmentCount + 1,
          })
        }
      }
      currentDate = new Date(2026, 6, 25 + dayIndex, 8, 0, 0)
    }

    const sampledEngineState = await engineStates.load()
    if (!sampledEngineState) {
      throw new Error('Expected the sampled learning engine state.')
    }
    await engineStates.save({
      ...sampledEngineState,
      reviewItems: {},
    })
    const personalized = await coordinator().initialize()
    if (personalized.status !== 'ready') {
      throw new Error('Expected a personalized fourth-day plan.')
    }
    for (const task of personalized.runtime.activePlan.plan.tasks) {
      expect(task.durationEstimate).toMatchObject({
        basis: 'personal-history',
        sampleCount: 3,
        estimateSeconds: 900,
      })
      expect(task.trainingBudget).toEqual({
        schemaVersion: 1,
        targetEffectiveSeconds: 900,
      })
    }
    expect(
      personalized.engineState.progress.durationSamples,
    ).toHaveLength(9)
    expect(
      personalized.engineState.progress.durationSamples?.every(
        (sample) =>
          sample.source === 'timing-segments' && sample.reliable,
      ),
    ).toBe(true)
  })

  it('replaces an old-profile engine and same-day plan after an R1 schema 3 profile is saved', async () => {
    const assessmentStore = new MemoryNamespaceStore(
      'feature.assessment',
    )
    const planStore = new MemoryNamespaceStore(
      'app.learning-runtime',
    )
    const engineStore = new MemoryNamespaceStore('learning.engine')
    const versionedProfiles =
      new VersionedAssessmentProfileRepository(assessmentStore)
    const versionedPlans = new ActivePlanRepository(planStore)
    const versionedEngine = new LearningEngineRepository(engineStore)
    const versionedCandidates = new SequencedCandidateSource()
    let nextId = 0
    const createVersionedCoordinator = () =>
      new LearningAppCoordinator({
        profiles: versionedProfiles,
        activePlans: versionedPlans,
        engineStates: versionedEngine,
        candidates: versionedCandidates,
        availableModuleIds: new Set([
          'vocabulary',
          'listening',
          'speaking',
        ]),
        now: () => new Date(2026, 6, 27, 8, 0, 0),
        createId: () => `profile-switch-${++nextId}`,
      })

    await versionedProfiles.saveLatest(abilityProfile())
    const legacyState =
      await createVersionedCoordinator().initialize()
    if (legacyState.status !== 'ready') {
      throw new Error('Expected the legacy-profile plan.')
    }
    const legacyPlanId = legacyState.runtime.activePlan.plan.planId
    const r1Profile = await completedR1Profile()
    await versionedProfiles.saveLatest(r1Profile)

    const r1State = await createVersionedCoordinator().initialize()
    if (r1State.status !== 'ready') {
      throw new Error('Expected the R1 first-day plan.')
    }
    expect(r1State.assessmentProfileSchemaVersion).toBe(3)
    expect(r1State.engineState.progress.profileId).toBe(
      r1Profile.profileId,
    )
    expect(r1State.runtime.activePlan.plan.planId).not.toBe(
      legacyPlanId,
    )
    expect(
      r1State.runtime.activePlan.plan.tasks.some(
        (task) => task.mode === 'calibration',
      ),
    ).toBe(false)
  })
})
