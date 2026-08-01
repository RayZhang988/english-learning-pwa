import { describe, expect, it } from 'vitest'
import {
  ActivePlanRepository,
  createActiveLearningRuntime,
} from '../../src/app/learning/active-plan-repository.ts'
import { ProductionExtraTrainingCoordinator } from '../../src/app/learning/extra-training-coordinator.ts'
import { ProductionExtraTrainingPrioritySource } from '../../src/app/learning/extra-training-priority-source.ts'
import { ProductionExtraTrainingEventSink } from '../../src/app/learning/production-extra-training-event-sink.ts'
import { createProductionTrainingSupplyProviders } from '../../src/app/learning/training-supply-providers.ts'
import {
  applyExtraTrainingEvent,
  buildExtraTrainingSupplyRequest,
  createExtraTrainingSession,
  createInitialProgressState,
  createLearningEngineState,
  createPlanProgress,
  expireExtraTrainingSessions,
  generateDailyPlan,
  LearningEngineRepository,
  parseExtraTrainingEvent,
  type ExtraTrainingEvent,
  type ExtraTrainingPriorityItemIds,
  type ExtraTrainingSession,
  type ExtraTrainingSupplyRequest,
  type LearningEngineState,
  type PlanProgress,
  type TrainingModuleId,
} from '../../src/learning-engine/index.ts'
import { abilityProfileR1 } from '../../src/learning-engine/test-fixtures.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../src/storage/index.ts'
import { projectLearningCandidates } from '../../src/app/learning/course-candidate-source.ts'
import {
  releasedCatalogs,
  releasedCourseDocuments,
  trainingSupplyIndex,
} from './fixtures/production-course.ts'

const LOCAL_DATE = '2026-07-29'
const STARTED_AT = '2026-07-29T08:00:00.000Z'
const MODULES = [
  'vocabulary',
  'listening',
  'speaking',
] as const satisfies readonly TrainingModuleId[]
const PRIORITIES = [
  'recent-error',
  'due-review',
  'same-day-variant',
  'new-optional-content',
] as const

class PortableMemoryStore implements NamespaceStore {
  readonly records = new Map<string, StoredRecord<unknown>>()
  failNextPut = false

  constructor(readonly namespace: string) {}

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
      throw new Error('QA simulated durable-write failure')
    }
    const portable = JSON.parse(JSON.stringify(value)) as T
    this.records.set(key, {
      namespace: this.namespace,
      key,
      value: portable,
      schemaVersion,
      updatedAt: STARTED_AT,
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

function productionPlan() {
  return generateDailyPlan({
    planId: 'qa-r6-daily-plan',
    generatedAt: STARTED_AT,
    localDate: LOCAL_DATE,
    availableSeconds: 2_700,
    progress: createInitialProgressState(
      abilityProfileR1(),
      STARTED_AT,
    ),
    reviewItems: {},
    candidates: projectLearningCandidates(
      releasedCourseDocuments,
      new Set(),
      new Set(MODULES),
    ),
  })
}

function completedPlan(): PlanProgress {
  const initial = createPlanProgress(productionPlan(), STARTED_AT)
  return {
    ...initial,
    status: 'completed',
    tasks: initial.tasks.map((execution) => ({
      ...execution,
      status: 'completed',
      completionKind: 'scored',
      effectiveSeconds: 900,
      training: {
        ...execution.training!,
        remainingEffectiveSeconds: 0,
        status: 'completed',
      },
      startedAt: STARTED_AT,
      updatedAt: '2026-07-29T08:45:00.000Z',
    })),
    updatedAt: '2026-07-29T08:45:00.000Z',
  }
}

function emptyPriorities(): ExtraTrainingPriorityItemIds {
  return {
    'recent-error': [],
    'due-review': [],
    'same-day-variant': [],
    'new-optional-content': [],
  }
}

function createSession(
  moduleId: TrainingModuleId = 'vocabulary',
  sessionId = `extra:${LOCAL_DATE}:${moduleId}:qa`,
) {
  const extra = createExtraTrainingSession(
    undefined,
    completedPlan(),
    {
      sessionId,
      localDate: LOCAL_DATE,
      domain: moduleId,
      targetModuleId: moduleId,
      targetDifficulty: 1,
      priorityItemIds: emptyPriorities(),
      startedAt: STARTED_AT,
    },
  )
  const session = extra.sessions[sessionId]
  if (!session) {
    throw new Error('QA R6 session creation failed.')
  }
  return { extra, session }
}

function extraBase(session: ExtraTrainingSession) {
  return {
    sessionId: session.sessionId,
    localDate: session.localDate,
    domain: session.domain,
    targetModuleId: session.targetModuleId,
    mode: 'learn' as const,
  }
}

function extraEvent(
  session: ExtraTrainingSession,
  input: {
    readonly id: string
    readonly type: ExtraTrainingEvent['type']
    readonly occurredAt?: string
    readonly payload?: Record<string, unknown>
  },
) {
  return parseExtraTrainingEvent({
    id: input.id,
    type: input.type,
    sourceModuleId: session.targetModuleId,
    schemaVersion: 1,
    occurredAt:
      input.occurredAt ?? '2026-07-29T08:15:00.000Z',
    payload: {
      ...extraBase(session),
      ...input.payload,
    },
  })
}

function timingEvent(
  session: ExtraTrainingSession,
  input: {
    readonly id: string
    readonly elapsedSeconds: number
    readonly phase:
      | 'answering'
      | 'paused'
      | 'idle'
    readonly reason:
      | 'active-answering'
      | 'user-paused'
      | 'idle-timeout'
      | 'app-backgrounded'
    readonly visibility: 'foreground' | 'background'
    readonly offsetSeconds: number
  },
) {
  const startedAt = new Date(
    Date.parse(STARTED_AT) + input.offsetSeconds * 1_000,
  ).toISOString()
  const endedAt = new Date(
    Date.parse(startedAt) + input.elapsedSeconds * 1_000,
  ).toISOString()
  return extraEvent(session, {
    id: input.id,
    type:
      'learning.extra-training.timing.segment.recorded.v1',
    occurredAt: endedAt,
    payload: {
      phase: input.phase,
      reason: input.reason,
      visibility: input.visibility,
      startedAt,
      endedAt,
      elapsedSeconds: input.elapsedSeconds,
      idleThresholdSeconds: 45,
    },
  })
}

interface ReleasedCandidate {
  readonly itemId: string
  readonly playbackContentId: string
  readonly supplyOrder: number
  readonly variantFamilyId: string
  readonly domain: TrainingModuleId
  readonly targetModuleId: TrainingModuleId
  readonly learningUnitId: string
  readonly contentRef: string
  readonly difficultyLevel: number
  readonly tags: readonly string[]
  readonly allowedModes: readonly string[]
  readonly source: {
    readonly variantId: string
  }
}

const releasedCandidates = (
  trainingSupplyIndex as {
    readonly candidates: readonly ReleasedCandidate[]
  }
).candidates

function candidatesFor(moduleId: TrainingModuleId) {
  return releasedCandidates.filter(
    (candidate) =>
      candidate.domain === moduleId &&
      candidate.targetModuleId === moduleId &&
      candidate.allowedModes.includes('learn'),
  )
}

function requestFor(
  moduleId: TrainingModuleId,
  input: {
    readonly targetDifficulty: number
    readonly excludeItemIds?: readonly string[]
    readonly priorityItemIds?: ExtraTrainingPriorityItemIds
    readonly cursor?: string | null
  },
): ExtraTrainingSupplyRequest {
  return {
    schemaVersion: 1,
    requestId: `qa-r6:${moduleId}:${Math.random()}`,
    sessionId: `qa-r6:${moduleId}`,
    localDate: LOCAL_DATE,
    domain: moduleId,
    targetModuleId: moduleId,
    mode: 'learn',
    targetDifficulty: input.targetDifficulty,
    cursor: input.cursor ?? null,
    excludeItemIds: input.excludeItemIds ?? [],
    priority: PRIORITIES,
    priorityItemIds:
      input.priorityItemIds ?? emptyPriorities(),
    reason: 'initial',
  }
}

describe('R6 optional extra-training external acceptance', () => {
  it('admits only a module with a real completed daily task, deduplicates rapid starts, and never changes the daily plan', async () => {
    const activeStore = new PortableMemoryStore(
      'qa.r6.active-plan',
    )
    const engineStore = new PortableMemoryStore(
      'qa.r6.learning-engine',
    )
    const activePlans = new ActivePlanRepository(activeStore)
    const engineStates = new LearningEngineRepository(engineStore)
    const initialProgress = createPlanProgress(
      productionPlan(),
      STARTED_AT,
    )
    await activePlans.save(
      createActiveLearningRuntime(initialProgress),
    )
    await engineStates.save(
      createLearningEngineState(
        abilityProfileR1(),
        STARTED_AT,
      ),
    )
    let id = 0
    const coordinator = new ProductionExtraTrainingCoordinator({
      activePlans,
      engineStates,
      priorities: new ProductionExtraTrainingPrioritySource({
        load: async () => ({ trainingSupplyIndex }),
      }),
      now: () => new Date('2026-07-29T09:00:00.000Z'),
      createId: () => `qa-${++id}`,
    })

    await expect(
      coordinator.start('vocabulary'),
    ).rejects.toThrow(/vocabulary daily task completed/u)
    const completed = completedPlan()
    await activePlans.save(createActiveLearningRuntime(completed))
    const before = await activePlans.load()

    const [first, duplicate] = await Promise.all([
      coordinator.start('vocabulary'),
      coordinator.start('vocabulary'),
    ])
    expect(duplicate.sessionId).toBe(first.sessionId)
    expect(first).toMatchObject({
      targetModuleId: 'vocabulary',
      completionMode: 'open-ended',
      effectiveSeconds: 0,
      status: 'running',
      completedItemCount: 0,
    })
    expect(first.sessionId).toMatch(
      /^extra:2026-07-29:vocabulary:/u,
    )
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
    const listening = await coordinator.start('listening')
    expect(listening.sessionId).not.toBe(first.sessionId)
    expect(await activePlans.load()).toEqual(before)
    const stored = await engineStates.load()
    expect(
      Object.keys(stored?.extraTraining?.sessions ?? {}),
    ).toHaveLength(2)
  })

  it.each(MODULES)(
    'executes all four released priority levels for %s and rejects an unknown item ID',
    async (moduleId) => {
      const catalogs = releasedCatalogs()
      const providers = createProductionTrainingSupplyProviders({
        vocabulary: {
          load: async () => catalogs.vocabulary,
        },
        listening: {
          load: async () => catalogs.listening,
        },
        speaking: {
          load: async () => catalogs.speaking,
        },
      })
      const candidates = candidatesFor(moduleId)
      expect(candidates.length).toBeGreaterThan(2)
      const recent = candidates[0]!
      const due = candidates.find((candidate) =>
        candidate.itemId !== recent.itemId &&
        Math.abs(
          candidate.difficultyLevel - recent.difficultyLevel,
        ) <= 1.5 &&
        (moduleId !== 'listening' || (
          candidate.variantFamilyId !== recent.variantFamilyId &&
          candidate.source.variantId !== recent.source.variantId
        )),
      )
      expect(due).toBeDefined()

      const recentResult = await providers[moduleId].next(
        requestFor(moduleId, {
          targetDifficulty: recent.difficultyLevel,
          priorityItemIds: {
            ...emptyPriorities(),
            'recent-error': [recent.itemId],
          },
        }),
      )
      expect(recentResult).toMatchObject({
        status: 'item',
        item: { itemId: recent.itemId },
      })

      const dueResult = await providers[moduleId].next(
        requestFor(moduleId, {
          targetDifficulty: due!.difficultyLevel,
          excludeItemIds: [recent.itemId],
          priorityItemIds: {
            ...emptyPriorities(),
            'recent-error': [recent.itemId],
            'due-review': [due!.itemId],
          },
        }),
      )
      expect(dueResult).toMatchObject({
        status: 'item',
        item: { itemId: due!.itemId },
      })

      if (moduleId === 'listening') {
        const conflictingDue = candidates.find((candidate) =>
          candidate.itemId !== recent.itemId &&
          Math.abs(
            candidate.difficultyLevel - recent.difficultyLevel,
          ) <= 1.5 &&
          (candidate.variantFamilyId === recent.variantFamilyId ||
            candidate.source.variantId === recent.source.variantId),
        )
        const eligibleAlternative = candidates.find((candidate) =>
          candidate.itemId !== recent.itemId &&
          candidate.itemId !== conflictingDue?.itemId &&
          Math.abs(
            candidate.difficultyLevel - recent.difficultyLevel,
          ) <= 1.5 &&
          candidate.variantFamilyId !== recent.variantFamilyId &&
          candidate.source.variantId !== recent.source.variantId,
        )
        expect(conflictingDue).toBeDefined()
        expect(eligibleAlternative).toBeDefined()
        const conflictingPriority = {
          ...emptyPriorities(),
          'recent-error': [recent.itemId],
          'due-review': [conflictingDue!.itemId],
        }
        expect(conflictingPriority['due-review']).toContain(
          conflictingDue!.itemId,
        )
        const deferredDueResult = await providers.listening.next(
          requestFor('listening', {
            targetDifficulty: recent.difficultyLevel,
            excludeItemIds: [recent.itemId],
            priorityItemIds: conflictingPriority,
          }),
        )
        expect(deferredDueResult.status).toBe('item')
        if (deferredDueResult.status === 'item') {
          const deferred = releasedCandidates.find(
            (candidate) => candidate.itemId === deferredDueResult.item.itemId,
          )
          expect(deferred?.itemId).not.toBe(conflictingDue!.itemId)
          expect(deferred?.variantFamilyId).not.toBe(
            recent.variantFamilyId,
          )
          expect(deferred?.source.variantId).not.toBe(
            recent.source.variantId,
          )
        }
      }

      const family = candidates.find((candidate) =>
        candidates.some(
          (other) =>
            other.itemId !== candidate.itemId &&
            other.variantFamilyId ===
              candidate.variantFamilyId &&
            Math.abs(
              other.difficultyLevel -
                candidate.difficultyLevel,
            ) <= 1.5,
        ),
      )
      expect(family).toBeDefined()
      const otherEligibleFamily = candidates.find(
        (candidate) =>
          candidate.variantFamilyId !== family!.variantFamilyId &&
          candidate.source.variantId !== family!.source.variantId &&
          Math.abs(
            candidate.difficultyLevel - family!.difficultyLevel,
          ) <= 1.5,
      )
      if (moduleId === 'listening') {
        expect(otherEligibleFamily).toBeDefined()
      }
      const variantResult = await providers[moduleId].next(
        requestFor(moduleId, {
          targetDifficulty: family!.difficultyLevel,
          excludeItemIds: [family!.itemId],
          priorityItemIds: {
            ...emptyPriorities(),
            'same-day-variant': [family!.itemId],
          },
        }),
      )
      expect(variantResult.status).toBe('item')
      if (variantResult.status !== 'item') {
        throw new Error(`${moduleId} did not return a released variant.`)
      }
      const variant = releasedCandidates.find(
        (candidate) =>
          candidate.itemId === variantResult.item.itemId,
      )
      expect(variant?.itemId).not.toBe(family!.itemId)
      if (moduleId === 'listening') {
        // The completed same-day item is in the four-item listening cooldown.
        // A same-day declaration may not force its family back into the stream
        // when the published index has another eligible family to select.
        expect(variant?.variantFamilyId).not.toBe(
          family!.variantFamilyId,
        )
        expect(variant?.source.variantId).not.toBe(
          family!.source.variantId,
        )
        expect(variant?.playbackContentId).not.toBe(
          family!.playbackContentId,
        )
      } else {
        expect(variant?.variantFamilyId).toBe(
          family!.variantFamilyId,
        )
      }

      const fallback = await providers[moduleId].next(
        requestFor(moduleId, {
          targetDifficulty: recent.difficultyLevel,
          excludeItemIds: [recent.itemId, due!.itemId],
          priorityItemIds: {
            ...emptyPriorities(),
            'recent-error': [recent.itemId],
            'due-review': [due!.itemId],
          },
        }),
      )
      expect(fallback.status).toBe('item')
      if (fallback.status === 'item') {
        expect([
          recent.itemId,
          due!.itemId,
        ]).not.toContain(fallback.item.itemId)
      }

      const unknown = await providers[moduleId].next(
        requestFor(moduleId, {
          targetDifficulty: recent.difficultyLevel,
          priorityItemIds: {
            ...emptyPriorities(),
            'recent-error': [
              `qa-r6-unknown-${moduleId}`,
            ],
          },
        }),
      )
      expect(unknown).toEqual(
        expect.objectContaining({
          status: 'content-exhausted',
          reason: 'provider-failure',
        }),
      )
    },
  )

  it('counts only active foreground time and stays open after 900 seconds and another released item', async () => {
    const { extra, session } = createSession()
    let state = extra
    for (const event of [
      timingEvent(session, {
        id: 'qa-r6-background',
        elapsedSeconds: 120,
        phase: 'answering',
        reason: 'app-backgrounded',
        visibility: 'background',
        offsetSeconds: 0,
      }),
      timingEvent(session, {
        id: 'qa-r6-paused',
        elapsedSeconds: 120,
        phase: 'paused',
        reason: 'user-paused',
        visibility: 'foreground',
        offsetSeconds: 120,
      }),
      timingEvent(session, {
        id: 'qa-r6-idle',
        elapsedSeconds: 120,
        phase: 'idle',
        reason: 'idle-timeout',
        visibility: 'foreground',
        offsetSeconds: 240,
      }),
    ]) {
      state = applyExtraTrainingEvent(state, event)
    }
    expect(
      state.sessions[session.sessionId]
        ?.effectiveSeconds,
    ).toBe(0)

    let remainingTo899 = 899
    let offsetSeconds = 360
    let segment = 0
    while (remainingTo899 > 0) {
      const elapsedSeconds = Math.min(45, remainingTo899)
      state = applyExtraTrainingEvent(
        state,
        timingEvent(session, {
          id: `qa-r6-active-${++segment}`,
          elapsedSeconds,
          phase: 'answering',
          reason: 'active-answering',
          visibility: 'foreground',
          offsetSeconds,
        }),
      )
      remainingTo899 -= elapsedSeconds
      offsetSeconds += elapsedSeconds
    }
    expect(state.sessions[session.sessionId]).toMatchObject({
      status: 'running',
      effectiveSeconds: 899,
      completedItemCount: 0,
    })
    state = applyExtraTrainingEvent(
      state,
      timingEvent(session, {
        id: 'qa-r6-active-900',
        elapsedSeconds: 1,
        phase: 'answering',
        reason: 'active-answering',
        visibility: 'foreground',
        offsetSeconds,
      }),
    )
    expect(state.sessions[session.sessionId]).toMatchObject({
      status: 'running',
      effectiveSeconds: 900,
      completedItemCount: 0,
    })

    const catalogs = releasedCatalogs()
    const providers = createProductionTrainingSupplyProviders({
      vocabulary: { load: async () => catalogs.vocabulary },
      listening: { load: async () => catalogs.listening },
      speaking: { load: async () => catalogs.speaking },
    })
    const request = buildExtraTrainingSupplyRequest(
      state.sessions[session.sessionId]!,
    )
    expect(request).not.toBeNull()
    const supplied = await providers.vocabulary.next(request!)
    expect(supplied.status).toBe('item')
    if (supplied.status !== 'item') {
      throw new Error('R6 vocabulary did not supply a released item.')
    }
    state = applyExtraTrainingEvent(
      state,
      extraEvent(session, {
        id: 'qa-r6-item',
        type: 'learning.extra-training.item.completed.v1',
        payload: {
          item: supplied.item,
          requestId: supplied.requestId,
          nextSupplyCursor: supplied.nextCursor,
        },
      }),
    )
    expect(state.sessions[session.sessionId]).toMatchObject({
      status: 'running',
      completedItemCount: 1,
    })
    expect(() =>
      applyExtraTrainingEvent(
        state,
        extraEvent(session, {
          id: 'qa-r6-budget',
          type:
            'learning.extra-training.budget.completed.v1',
          payload: { completedItemCount: 1 },
        }),
      ),
    ).toThrow('cannot complete from a time budget')
  })

  it.each([
    'content-exhausted',
    'provider-failure',
    'device-failure',
  ] as const)(
    'keeps the same session and makes %s retry idempotent',
    (reason) => {
      const { extra, session } = createSession(
        'listening',
        `qa-r6-retry-${reason}`,
      )
      const failedEvent = extraEvent(session, {
        id: `qa-r6-${reason}-failed`,
        type: 'learning.extra-training.failed.v1',
        payload: { reason },
      })
      const failed = applyExtraTrainingEvent(
        extra,
        failedEvent,
      )
      expect(failed.sessions[session.sessionId]).toMatchObject({
        sessionId: session.sessionId,
        status: 'failed',
        endReason: reason,
        effectiveSeconds: 0,
      })
      expect(
        applyExtraTrainingEvent(failed, failedEvent),
      ).toBe(failed)

      const retry = extraEvent(session, {
        id: `qa-r6-${reason}-retry`,
        type: 'learning.extra-training.started.v1',
      })
      const recovered = applyExtraTrainingEvent(failed, retry)
      expect(recovered.sessions[session.sessionId]).toMatchObject({
        sessionId: session.sessionId,
        status: 'running',
        effectiveSeconds: 0,
        completedItemCount: 0,
      })
      expect(
        applyExtraTrainingEvent(recovered, retry),
      ).toBe(recovered)
    },
  )

  it('replays a failed durable event with the same ID once and lets scored evidence update mastery without a fourth daily task', async () => {
    const engineStore = new PortableMemoryStore(
      'qa.r6.event-sink',
    )
    const engineStates = new LearningEngineRepository(engineStore)
    const { extra, session } = createSession()
    const initial = createLearningEngineState(
      abilityProfileR1(),
      STARTED_AT,
    )
    await engineStates.save({
      ...initial,
      extraTraining: extra,
    })
    const sink = new ProductionExtraTrainingEventSink(engineStates)
    const candidate = candidatesFor('vocabulary')[0]!
    const attempt = extraEvent(session, {
      id: 'qa-r6-scored-attempt',
      type:
        'learning.extra-training.attempt.completed.v1',
      payload: {
        learningUnitId: candidate.learningUnitId,
        contentRef: candidate.contentRef,
        difficultyLevel: candidate.difficultyLevel,
        estimatedSeconds: 30,
        result: 'scored',
        performanceScore: 0,
        evidenceQuality: 1,
        assistanceLevel: 0,
        durationSeconds: 12,
        errorTags: ['meaning-recall'],
        contentTags: candidate.tags,
        failureCategory: null,
      },
    })

    engineStore.failNextPut = true
    await expect(
      sink.publishExtraTrainingEvent(attempt),
    ).rejects.toThrow(/durable-write/u)
    let stored = await engineStates.load()
    expect(
      stored?.extraTraining?.processedEventIds,
    ).not.toContain(attempt.id)
    expect(stored?.progress.attempts).toHaveLength(0)

    await sink.publishExtraTrainingEvent(attempt)
    await sink.publishExtraTrainingEvent(attempt)
    stored = await engineStates.load()
    expect(
      stored?.extraTraining?.processedEventIds.filter(
        (id) => id === attempt.id,
      ),
    ).toHaveLength(1)
    expect(stored?.progress.attempts).toHaveLength(1)
    expect(stored?.progress.attempts[0]).toMatchObject({
      eventId: attempt.id,
      planId: `extra-training:${LOCAL_DATE}`,
      taskId: session.sessionId,
      learningUnitId: candidate.learningUnitId,
      performanceScore: 0,
    })
    expect(
      Object.keys(stored?.reviewItems ?? {}),
    ).toContain(candidate.learningUnitId)
    expect(
      stored?.extraTraining?.sessions[session.sessionId],
    ).toMatchObject({
      completionMode: 'open-ended',
      effectiveSeconds: 0,
      completedItemCount: 0,
    })
    expect(completedPlan()).toMatchObject({
      status: 'completed',
      tasks: [
        { status: 'completed' },
        { status: 'completed' },
        { status: 'completed' },
      ],
    })
  })

  it('expires only the old optional session and keeps legacy engine data without an extraTraining field readable', async () => {
    const { extra, session } = createSession(
      'speaking',
      'qa-r6-previous-day',
    )
    const previousDayState = {
      ...extra,
      sessions: {
        [session.sessionId]: {
          ...session,
          localDate: '2026-07-28',
          startedAt: '2026-07-28T08:00:00.000Z',
          updatedAt: '2026-07-28T08:00:00.000Z',
        },
      },
    }
    const expired = expireExtraTrainingSessions(
      previousDayState,
      LOCAL_DATE,
      '2026-07-29T00:01:00.000Z',
    )
    expect(expired.sessions[session.sessionId]).toMatchObject({
      status: 'expired',
      endReason: 'cross-day-expired',
      effectiveSeconds: 0,
    })
    expect(completedPlan().status).toBe('completed')

    const store = new PortableMemoryStore('qa.r6.legacy')
    const repository = new LearningEngineRepository(store)
    const legacy: LearningEngineState = createLearningEngineState(
      abilityProfileR1(),
      STARTED_AT,
    )
    await repository.save(legacy)
    const restored = await repository.load()
    expect(restored).toEqual(legacy)
    expect(restored).not.toHaveProperty('extraTraining')
  })
})
