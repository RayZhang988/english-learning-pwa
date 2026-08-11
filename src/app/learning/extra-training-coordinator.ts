import {
  createTrainingSupplyRound,
  buildExtraTrainingSupplyRequest,
  createExtraTrainingSession,
  expireExtraTrainingSessions,
  getExtraTrainingEligibility,
  migrateExtraTrainingSessionsToOpenEnded,
  type ExtraTrainingSession,
  type LearningEngineRepository,
  type LearningEngineState,
  type TrainingModuleId,
  trainingRecentBucket,
} from '../../learning-engine/index.ts'
import type { ActivePlanRepository } from './active-plan-repository.ts'
import type {
  ExtraTrainingPrioritySource,
} from './extra-training-priority-source.ts'
import {
  ProductionExtraTrainingEventSink,
  type ExtraTrainingEngineUpdateListener,
} from './production-extra-training-event-sink.ts'
import { formatLocalDate } from './local-date.ts'
import { trainingSupplyProviders } from './training-production-resources.ts'
import {
  collectEligibleSupplyItemIds,
  type ProductionTrainingSupplyProviders,
} from './training-supply-providers.ts'

export interface ProductionExtraTrainingCoordinatorOptions {
  readonly activePlans: ActivePlanRepository
  readonly engineStates: LearningEngineRepository
  readonly priorities: ExtraTrainingPrioritySource
  readonly trainingSupplyProviders?: ProductionTrainingSupplyProviders
  readonly now?: () => Date
  readonly createId?: () => string
}

function defaultId(): string {
  return globalThis.crypto.randomUUID()
}

function sameExtraTrainingState(
  left: LearningEngineState['extraTraining'],
  right: LearningEngineState['extraTraining'],
): boolean {
  return left === right
}

/**
 * Application coordinator for R6 optional sessions.
 *
 * Its only durable source of truth is LearningEngineState.extraTraining.
 * Daily PlanProgress is read solely as a per-module admission gate and is never
 * written by this coordinator or its event sink.
 */
export class ProductionExtraTrainingCoordinator {
  readonly #activePlans: ActivePlanRepository
  readonly #engineStates: LearningEngineRepository
  readonly #priorities: ExtraTrainingPrioritySource
  readonly #now: () => Date
  readonly #createId: () => string
  readonly #trainingSupplyProviders: ProductionTrainingSupplyProviders
  readonly #listeners =
    new Set<ExtraTrainingEngineUpdateListener>()
  readonly #starts = new Map<
    string,
    Promise<ExtraTrainingSession>
  >()
  readonly eventSink: ProductionExtraTrainingEventSink
  #queue: Promise<void> = Promise.resolve()
  readonly #roundWrites = new Map<
    string,
    Promise<ExtraTrainingSession>
  >()

  constructor(options: ProductionExtraTrainingCoordinatorOptions) {
    this.#activePlans = options.activePlans
    this.#engineStates = options.engineStates
    this.#priorities = options.priorities
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? defaultId
    this.#trainingSupplyProviders =
      options.trainingSupplyProviders ?? trainingSupplyProviders
    this.eventSink = new ProductionExtraTrainingEventSink(
      this.#engineStates,
    )
    this.eventSink.subscribe((update) => {
      this.#notify(update)
    })
  }

  subscribe(
    listener: ExtraTrainingEngineUpdateListener,
  ): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  restoreForCurrentDate(): Promise<LearningEngineState> {
    return this.#enqueue(async () => {
      const engineState = await this.#requireEngineState()
      if (!engineState.extraTraining) {
        return engineState
      }
      const now = this.#now()
      const occurredAt = now.toISOString()
      const extraTraining = migrateExtraTrainingSessionsToOpenEnded(
        expireExtraTrainingSessions(
          engineState.extraTraining,
          formatLocalDate(now),
          occurredAt,
        ),
        occurredAt,
      )
      if (
        sameExtraTrainingState(
          engineState.extraTraining,
          extraTraining,
        )
      ) {
        return engineState
      }
      const next = { ...engineState, extraTraining }
      await this.#engineStates.save(next)
      return next
    })
  }

  start(
    moduleId: TrainingModuleId,
  ): Promise<ExtraTrainingSession> {
    return this.#scheduleStart(moduleId, false)
  }

  startFresh(
    moduleId: TrainingModuleId,
  ): Promise<ExtraTrainingSession> {
    return this.#scheduleStart(moduleId, true)
  }

  /**
   * Materializes one durable R11 round for an existing optional session.
   * This runs through the same coordinator queue as session creation and
   * event writes, so different modules cannot overwrite each other's state.
   */
  ensureExtraTrainingRound(
    sessionId: string,
    expectedModuleId?: TrainingModuleId,
  ): Promise<ExtraTrainingSession> {
    const existing = this.#roundWrites.get(sessionId)
    if (existing) return existing
    const operation = this.#enqueue(() =>
      this.#ensureExtraTrainingRound(sessionId, expectedModuleId),
    )
    this.#roundWrites.set(sessionId, operation)
    void operation
      .finally(() => {
        if (this.#roundWrites.get(sessionId) === operation) {
          this.#roundWrites.delete(sessionId)
        }
      })
      .catch(() => undefined)
    return operation
  }

  async #ensureExtraTrainingRound(
    sessionId: string,
    expectedModuleId?: TrainingModuleId,
  ): Promise<ExtraTrainingSession> {
    const engineState = await this.#requireEngineState()
    const session = engineState.extraTraining?.sessions[sessionId]
    if (!session) {
      throw new TypeError('Extra-training sessionId does not exist.')
    }
    if (
      expectedModuleId !== undefined &&
      session.targetModuleId !== expectedModuleId
    ) {
      throw new TypeError('Extra-training session does not belong to the requested module.')
    }
    if (session.status !== 'running' && session.status !== 'paused') {
      throw new TypeError('Extra-training session cannot create a training round.')
    }
    if (session.supplyRound !== undefined) {
      return session
    }
    const request = buildExtraTrainingSupplyRequest(session)
    if (!request) {
      throw new TypeError('Extra-training session cannot request training content.')
    }
    const bucket = trainingRecentBucket(
      session.domain,
      session.mode,
      session.targetDifficulty,
    )
    const candidateItemIds = await collectEligibleSupplyItemIds(
      this.#trainingSupplyProviders[session.targetModuleId],
      request,
    )
    const candidateSet = new Set(candidateItemIds)
    const priorityItemIds = Object.values(
      session.priorityItemIds ?? {},
    )
      .flat()
      .filter((itemId) => candidateSet.has(itemId))
    const round = createTrainingSupplyRound({
      seed: this.#createId(),
      candidateItemIds,
      shortTermExcludedItemIds:
        engineState.recentTrainingItemIds?.[bucket] ?? [],
      priorityItemIds,
    })
    const updatedSession: ExtraTrainingSession = {
      ...session,
      supplyRound: round,
      updatedAt: this.#now().toISOString(),
    }
    const nextEngineState: LearningEngineState = {
      ...engineState,
      extraTraining: {
        ...engineState.extraTraining!,
        sessions: {
          ...engineState.extraTraining!.sessions,
          [sessionId]: updatedSession,
        },
      },
    }
    await this.#engineStates.save(nextEngineState)
    this.#notify({ engineState: nextEngineState, session: updatedSession })
    return updatedSession
  }

  #scheduleStart(
    moduleId: TrainingModuleId,
    fresh: boolean,
  ): Promise<ExtraTrainingSession> {
    const operationKey = fresh ? `fresh:${moduleId}` : moduleId
    const current = this.#starts.get(operationKey)
    if (current) {
      return current
    }
    const operation = this.#enqueue(() =>
      this.#start(moduleId, fresh),
    )
    this.#starts.set(operationKey, operation)
    const clear = () => {
      if (this.#starts.get(operationKey) === operation) {
        this.#starts.delete(operationKey)
      }
    }
    void operation.then(clear, clear)
    return operation
  }

  async #start(
    moduleId: TrainingModuleId,
    fresh: boolean,
  ): Promise<ExtraTrainingSession> {
    const now = this.#now()
    const localDate = formatLocalDate(now)
    const occurredAt = now.toISOString()
    const runtime = await this.#activePlans.load()
    if (!runtime) {
      throw new TypeError(
        'Extra training requires an active daily plan.',
      )
    }
    const progress = runtime.activePlan
    const eligibility = getExtraTrainingEligibility(
      progress,
      moduleId,
      localDate,
    )
    if (!eligibility.eligible) {
      throw new TypeError(
        `Extra training requires the current ${moduleId} daily task completed.`,
      )
    }

    let engineState = await this.#requireEngineState()
    const expired = engineState.extraTraining
      ? migrateExtraTrainingSessionsToOpenEnded(
          expireExtraTrainingSessions(
            engineState.extraTraining,
            localDate,
            occurredAt,
          ),
          occurredAt,
        )
      : undefined
    if (expired !== engineState.extraTraining) {
      engineState = { ...engineState, extraTraining: expired }
    }
    if (fresh && engineState.extraTraining) {
      const sessions = { ...engineState.extraTraining.sessions }
      let changed = false
      for (const [sessionId, session] of Object.entries(sessions)) {
        if (
          session.localDate === localDate &&
          session.targetModuleId === moduleId &&
          session.status !== 'completed' &&
          session.status !== 'expired'
        ) {
          sessions[sessionId] = {
            ...session,
            status: 'expired',
            endedAt: occurredAt,
            endReason: 'user-restarted',
            updatedAt: occurredAt,
          }
          changed = true
        }
      }
      if (changed) {
        engineState = {
          ...engineState,
          extraTraining: {
            ...engineState.extraTraining,
            sessions,
          },
        }
      }
    }
    const existing = Object.values(
      engineState.extraTraining?.sessions ?? {},
    )
      .filter(
        (session) =>
          session.localDate === localDate &&
          session.targetModuleId === moduleId &&
          session.status !== 'completed' &&
          session.status !== 'expired',
      )
      .sort((left, right) =>
        right.startedAt.localeCompare(left.startedAt),
      )[0]
    if (existing) {
      if (expired !== undefined) {
        await this.#engineStates.save(engineState)
      }
      return existing
    }

    const priorityItemIds = await this.#priorities.load({
      moduleId,
      localDate,
      asOf: occurredAt,
      runtime,
      engineState,
    })
    const sessionId =
      `extra:${localDate}:${moduleId}:${this.#createId()}`
    const extraTraining = createExtraTrainingSession(
      engineState.extraTraining,
      progress,
      {
        sessionId,
        localDate,
        domain: moduleId,
        targetModuleId: moduleId,
        targetDifficulty:
          engineState.progress.domains[moduleId].currentLevel,
        priorityItemIds,
        startedAt: occurredAt,
      },
    )
    const nextEngineState = {
      ...engineState,
      extraTraining,
    }
    await this.#engineStates.save(nextEngineState)
    const session = extraTraining.sessions[sessionId]
    if (!session) {
      throw new TypeError(
        'Created extra-training state lost its session.',
      )
    }
    this.#notify({ engineState: nextEngineState, session })
    return session
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation)
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async #requireEngineState(): Promise<LearningEngineState> {
    const engineState = await this.#engineStates.load()
    if (!engineState) {
      throw new TypeError(
        'Learning engine is not initialized for extra training.',
      )
    }
    return engineState
  }

  #notify(update: Parameters<ExtraTrainingEngineUpdateListener>[0]) {
    for (const listener of this.#listeners) {
      listener(update)
    }
  }
}
