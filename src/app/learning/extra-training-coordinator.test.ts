import { describe, expect, it, vi } from 'vitest'
import {
  createExtraTrainingSession,
  createPlanProgress,
  LearningEngineRepository,
  parseExtraTrainingEvent,
  type ExtraTrainingEvent,
  type TrainingModuleId,
} from '../../learning-engine/index.ts'
import { ActivePlanRepository } from './active-plan-repository.ts'
import { ProductionExtraTrainingCoordinator } from './extra-training-coordinator.ts'
import type { ProductionTrainingSupplyProviders } from './training-supply-providers.ts'
import {
  completedExtraTrainingPlan,
  completedExtraTrainingRuntime,
  extraTrainingDailyPlan,
  extraTrainingEngineState,
  MemoryNamespaceStore,
} from './extra-training-test-fixtures.ts'

function setup() {
  const planStore = new MemoryNamespaceStore('plans')
  const engineStore = new MemoryNamespaceStore('engine')
  const activePlans = new ActivePlanRepository(planStore)
  const engineStates = new LearningEngineRepository(engineStore)
  const priorities = {
    load: vi.fn(async () => ({
      'recent-error': ['released-error'],
      'due-review': ['released-due'],
      'same-day-variant': ['released-used'],
      'new-optional-content': [],
    })),
  }
  const providerFor = (moduleId: TrainingModuleId) => ({
    async next(request: {
      readonly requestId: string
      readonly excludeItemIds: readonly string[]
    }) {
      const itemIds = [`${moduleId}:candidate:1`, `${moduleId}:candidate:2`]
      const itemId = itemIds.find(
        (candidate) => !request.excludeItemIds.includes(candidate),
      )
      return itemId === undefined
        ? {
            schemaVersion: 1 as const,
            requestId: request.requestId,
            status: 'content-exhausted' as const,
            reason: 'all-eligible-content-recently-used' as const,
          }
        : {
            schemaVersion: 1 as const,
            requestId: request.requestId,
            status: 'item' as const,
            item: {
              itemId,
              learningUnitId: `unit:${moduleId}`,
              contentRef: `lesson://test/${moduleId}`,
              difficultyLevel: 2,
              tags: [],
            },
            nextCursor: itemId,
          }
    },
  })
  const trainingSupplyProviders: ProductionTrainingSupplyProviders = {
    vocabulary: providerFor('vocabulary'),
    listening: providerFor('listening'),
    speaking: providerFor('speaking'),
  }
  const coordinator = new ProductionExtraTrainingCoordinator({
    activePlans,
    engineStates,
    priorities,
    now: () => new Date('2026-07-29T09:00:00.000Z'),
    createId: () => 'stable-id',
    trainingSupplyProviders,
  })
  return {
    activePlans,
    engineStates,
    priorities,
    coordinator,
    engineStore,
  }
}

describe('ProductionExtraTrainingCoordinator', () => {
  it('rejects optional training until its own persisted daily task is completed', async () => {
    const { activePlans, engineStates, coordinator } = setup()
    await activePlans.save({
      schemaVersion: 1,
      activePlan: createPlanProgress(
        extraTrainingDailyPlan(),
        '2026-07-29T08:00:00.000Z',
      ),
      completedLearningUnitIds: [],
      processedEventIds: [],
      skipHistory: [],
    })
    await engineStates.save(extraTrainingEngineState())

    await expect(
      coordinator.start('vocabulary'),
    ).rejects.toThrow('vocabulary daily task completed')
    expect(
      (await engineStates.load())?.extraTraining,
    ).toBeUndefined()
  })

  it('creates one stable, portable session for simultaneous double starts and leaves 3/3 untouched', async () => {
    const {
      activePlans,
      engineStates,
      priorities,
      coordinator,
    } = setup()
    const runtime = completedExtraTrainingRuntime()
    const engine = extraTrainingEngineState()
    await activePlans.save(runtime)
    await engineStates.save(engine)

    const [first, second] = await Promise.all([
      coordinator.start('listening'),
      coordinator.start('listening'),
    ])

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      sessionId:
        'extra:2026-07-29:listening:stable-id',
      targetModuleId: 'listening',
      targetDifficulty:
        engine.progress.domains.listening.currentLevel,
      completionMode: 'open-ended',
      effectiveSeconds: 0,
      status: 'running',
      priorityItemIds: {
        'recent-error': ['released-error'],
        'due-review': ['released-due'],
        'same-day-variant': ['released-used'],
        'new-optional-content': [],
      },
    })
    expect(priorities.load).toHaveBeenCalledOnce()
    expect(
      (await engineStates.load())?.extraTraining &&
        Object.keys(
          (await engineStates.load())!.extraTraining!.sessions,
        ),
    ).toEqual([first.sessionId])
    expect(
      (await activePlans.load())?.activePlan,
    ).toEqual(runtime.activePlan)
    const portableState = (await engineStates.load())?.extraTraining
    expect(() =>
      JSON.parse(JSON.stringify(portableState)),
    ).not.toThrow()
  })

  it.each<TrainingModuleId>([
    'vocabulary',
    'listening',
    'speaking',
  ])(
    'starts the real %s optional route identity without creating a fourth daily task',
    async (moduleId) => {
      const { activePlans, engineStates, coordinator } = setup()
      const runtime = completedExtraTrainingRuntime()
      await activePlans.save(runtime)
      await engineStates.save(extraTrainingEngineState())

      const session = await coordinator.start(moduleId)

      expect(session).toMatchObject({
        domain: moduleId,
        targetModuleId: moduleId,
        localDate: runtime.activePlan.plan.localDate,
        status: 'running',
        completionMode: 'open-ended',
        effectiveSeconds: 0,
      })
      expect(
        (await activePlans.load())?.activePlan.tasks,
      ).toHaveLength(3)
      expect(
        (await activePlans.load())?.activePlan.status,
      ).toBe('completed')
    },
  )

  it('creates, serializes, persists, and refresh-restores module-owned extra rounds', async () => {
    const { activePlans, engineStates, coordinator } = setup()
    await activePlans.save(completedExtraTrainingRuntime())
    await engineStates.save(extraTrainingEngineState())

    const sessions = await Promise.all([
      coordinator.start('vocabulary'),
      coordinator.start('listening'),
      coordinator.start('speaking'),
    ])
    const [vocabulary, listening, speaking] = await Promise.all(
      sessions.map((session) =>
        coordinator.ensureExtraTrainingRound(
          session.sessionId,
          session.targetModuleId,
        ),
      ),
    )
    for (const session of [vocabulary, listening, speaking]) {
      expect(session.supplyRound?.order).toHaveLength(2)
      expect(session.supplyRound?.order.every((itemId) =>
        itemId.startsWith(`${session.targetModuleId}:candidate:`),
      )).toBe(true)
    }

    const first = coordinator.ensureExtraTrainingRound(vocabulary.sessionId)
    const second = coordinator.ensureExtraTrainingRound(vocabulary.sessionId)
    expect(second).toBe(first)
    await expect(first).resolves.toEqual(vocabulary)

    const restored = new ProductionExtraTrainingCoordinator({
      activePlans,
      engineStates,
      priorities: { async load() { return vocabulary.priorityItemIds! } },
      trainingSupplyProviders: {
        vocabulary: { async next() { throw new Error('must restore, not enumerate') } },
        listening: { async next() { throw new Error('must restore, not enumerate') } },
        speaking: { async next() { throw new Error('must restore, not enumerate') } },
      },
      now: () => new Date('2026-07-29T09:00:00.000Z'),
      createId: () => 'unexpected',
    })
    await expect(
      restored.ensureExtraTrainingRound(vocabulary.sessionId, 'vocabulary'),
    ).resolves.toEqual(vocabulary)
  })

  it('does not mutate a session when extra round persistence fails and permits retry', async () => {
    const { activePlans, engineStates, engineStore, coordinator } = setup()
    await activePlans.save(completedExtraTrainingRuntime())
    await engineStates.save(extraTrainingEngineState())
    const session = await coordinator.start('vocabulary')
    engineStore.failNextPut = true

    await expect(
      coordinator.ensureExtraTrainingRound(session.sessionId),
    ).rejects.toThrow('simulated storage failure')
    expect(
      (await engineStates.load())?.extraTraining?.sessions[session.sessionId]
        ?.supplyRound,
    ).toBeUndefined()

    await expect(
      coordinator.ensureExtraTrainingRound(session.sessionId),
    ).resolves.toEqual(expect.objectContaining({
      sessionId: session.sessionId,
      supplyRound: expect.any(Object),
    }))
  })

  it('expires a previous-day open session without changing either daily plan', async () => {
    const { activePlans, engineStates, coordinator } = setup()
    const previousPlan = completedExtraTrainingPlan('2026-07-28')
    const base = extraTrainingEngineState(
      '2026-07-28T08:00:00.000Z',
    )
    const extraTraining = createExtraTrainingSession(
      undefined,
      previousPlan,
      {
        sessionId: 'extra:2026-07-28:vocabulary:old',
        localDate: '2026-07-28',
        domain: 'vocabulary',
        targetModuleId: 'vocabulary',
        targetDifficulty: 1,
        priorityItemIds: {
          'recent-error': [],
          'due-review': [],
          'same-day-variant': [],
          'new-optional-content': [],
        },
        startedAt: '2026-07-28T09:00:00.000Z',
      },
    )
    await engineStates.save({ ...base, extraTraining })
    const currentRuntime = completedExtraTrainingRuntime()
    await activePlans.save(currentRuntime)

    const restored = await coordinator.restoreForCurrentDate()

    expect(
      restored.extraTraining?.sessions[
        'extra:2026-07-28:vocabulary:old'
      ],
    ).toMatchObject({
      status: 'expired',
      endReason: 'cross-day-expired',
    })
    expect(
      (await activePlans.load())?.activePlan,
    ).toEqual(currentRuntime.activePlan)
  })

  it('resumes the same paused session or explicitly starts a fresh round', async () => {
    const planStore = new MemoryNamespaceStore('plans')
    const engineStore = new MemoryNamespaceStore('engine')
    const activePlans = new ActivePlanRepository(planStore)
    const engineStates = new LearningEngineRepository(engineStore)
    const ids = ['first', 'second']
    const coordinator = new ProductionExtraTrainingCoordinator({
      activePlans,
      engineStates,
      priorities: {
        async load() {
          return {
            'recent-error': [],
            'due-review': [],
            'same-day-variant': [],
            'new-optional-content': [],
          }
        },
      },
      now: () => new Date('2026-07-29T09:00:00.000Z'),
      createId: () => ids.shift() ?? 'unexpected',
    })
    await activePlans.save(completedExtraTrainingRuntime())
    await engineStates.save(extraTrainingEngineState())

    const first = await coordinator.start('speaking')
    const saved = await engineStates.load()
    await engineStates.save({
      ...saved!,
      extraTraining: {
        ...saved!.extraTraining!,
        sessions: {
          ...saved!.extraTraining!.sessions,
          [first.sessionId]: {
            ...first,
            status: 'paused',
            endReason: 'user-exited',
            endedAt: '2026-07-29T09:05:00.000Z',
          },
        },
      },
    })

    const resumed = await coordinator.start('speaking')
    expect(resumed.sessionId).toBe(first.sessionId)

    const second = await coordinator.startFresh('speaking')
    expect(second.sessionId).toBe(
      'extra:2026-07-29:speaking:second',
    )
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(
      (await engineStates.load())?.extraTraining?.sessions[
        first.sessionId
      ],
    ).toMatchObject({
      status: 'expired',
      endReason: 'user-restarted',
    })
    expect(
      (await activePlans.load())?.activePlan.status,
    ).toBe('completed')
  })

  it('persists exit, resume and open-ended timing as one isolated lifecycle', async () => {
    const planStore = new MemoryNamespaceStore('plans')
    const engineStore = new MemoryNamespaceStore('engine')
    const activePlans = new ActivePlanRepository(planStore)
    const engineStates = new LearningEngineRepository(engineStore)
    const ids = ['first', 'second']
    const coordinator = new ProductionExtraTrainingCoordinator({
      activePlans,
      engineStates,
      priorities: {
        async load() {
          return {
            'recent-error': [],
            'due-review': [],
            'same-day-variant': [],
            'new-optional-content': [],
          }
        },
      },
      now: () => new Date('2026-07-29T09:00:00.000Z'),
      createId: () => ids.shift() ?? 'unexpected',
    })
    const runtime = completedExtraTrainingRuntime()
    await activePlans.save(runtime)
    await engineStates.save(extraTrainingEngineState())
    const first = await coordinator.start('vocabulary')
    let eventSequence = 0
    const event = (
      type: ExtraTrainingEvent['type'],
      payload: Record<string, unknown> = {},
    ) =>
      parseExtraTrainingEvent({
        id: `lifecycle:${++eventSequence}:${type}`,
        type,
        sourceModuleId: 'vocabulary',
        schemaVersion: 1,
        occurredAt: `2026-07-29T09:${String(eventSequence).padStart(2, '0')}:00.000Z`,
        payload: {
          sessionId: first.sessionId,
          localDate: first.localDate,
          domain: 'vocabulary',
          targetModuleId: 'vocabulary',
          mode: 'learn',
          ...payload,
        },
      })

    const exited = event('learning.extra-training.exited.v1')
    await coordinator.eventSink.publishExtraTrainingEvent(exited)
    expect((await coordinator.start('vocabulary')).sessionId).toBe(
      first.sessionId,
    )
    await coordinator.eventSink.publishExtraTrainingEvent(
      event('learning.extra-training.started.v1'),
    )
    for (let segmentIndex = 0; segmentIndex < 20; segmentIndex += 1) {
      const startedAt = new Date(
        Date.parse('2026-07-29T09:02:00.000Z') +
          segmentIndex * 45_000,
      )
      await coordinator.eventSink.publishExtraTrainingEvent(
        event('learning.extra-training.timing.segment.recorded.v1', {
          phase: 'answering',
          reason: 'active-answering',
          visibility: 'foreground',
          startedAt: startedAt.toISOString(),
          endedAt: new Date(
            startedAt.getTime() + 45_000,
          ).toISOString(),
          elapsedSeconds: 45,
          idleThresholdSeconds: 45,
        }),
      )
    }
    await coordinator.eventSink.publishExtraTrainingEvent(
      event('learning.extra-training.item.completed.v1', {
        requestId: `${first.sessionId}:supply:1:initial`,
        nextSupplyCursor: 'cursor:1',
        item: {
          itemId: 'released-item-1',
          learningUnitId: 'unit-vocabulary',
          contentRef: 'lesson://course/1/day-1/vocabulary',
          difficultyLevel: 1,
          tags: ['day:1'],
        },
      }),
    )
    const next = await coordinator.start('vocabulary')
    const saved = await engineStates.load()
    expect(
      saved?.extraTraining?.sessions[first.sessionId],
    ).toMatchObject({
      status: 'running',
      effectiveSeconds: 900,
      completedItemCount: 1,
    })
    expect(next.sessionId).toBe(first.sessionId)
    expect((await activePlans.load())?.activePlan).toEqual(
      runtime.activePlan,
    )
    expect(() =>
      JSON.parse(JSON.stringify(saved)),
    ).not.toThrow()
  })

  it('accepts a legacy engine state with no extraTraining field without clearing daily data', async () => {
    const { activePlans, engineStates, coordinator } = setup()
    const runtime = completedExtraTrainingRuntime()
    const legacy = extraTrainingEngineState()
    await activePlans.save(runtime)
    await engineStates.save(legacy)

    const restored = await coordinator.restoreForCurrentDate()

    expect(restored.extraTraining).toBeUndefined()
    expect(await activePlans.load()).toEqual(runtime)
  })
})
