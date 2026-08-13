import { toAppError, type AppError } from '../../core/index.ts'
import {
  ASSESSMENT_STORAGE_NAMESPACE,
  VersionedAssessmentProfileRepository,
} from '../../features/assessment/index.ts'
import {
  createLearningEngineState,
  acknowledgeSceneTrainingItem,
  createTrainingSupplyRound,
  buildLearningTaskSupplyRequest,
  createPlanProgress,
  evaluatePlanTaskStart,
  generateDailyPlan,
  getExtraTrainingEligibility,
  getPlanTaskAccess,
  getResumeDecision,
  LEARNING_ENGINE_STORAGE_NAMESPACE,
  LearningEngineRepository,
  recordDailyActivity,
  REQUIRED_TASK_EFFECTIVE_SECONDS,
  summarizePlanActivity,
  trainingRecentBucket,
  type ExtraTrainingSession,
  type LearningEngineState,
  type LearningAbilityProfile,
  type LearningTask,
  type PlanTaskAccess,
  type TrainingModuleId,
} from '../../learning-engine/index.ts'
import { localStorageService } from '../../storage/index.ts'
import {
  ActivePlanRepository,
  createActiveLearningRuntime,
  LEARNING_RUNTIME_STORAGE_NAMESPACE,
  type ActiveLearningRuntime,
} from './active-plan-repository.ts'
import {
  currentCourseCandidateSource,
  type LearningCandidateSource,
} from './course-candidate-source.ts'
import { formatLocalDate } from './local-date.ts'
import {
  ProductionLearningEventSink,
  type LearningRuntimeUpdate,
} from './production-event-sink.ts'
import {
  ProductionExtraTrainingCoordinator,
} from './extra-training-coordinator.ts'
import {
  emptyExtraTrainingPrioritySource,
  ProductionExtraTrainingPrioritySource,
  type ExtraTrainingPrioritySource,
} from './extra-training-priority-source.ts'
import {
  ProductionExtraTrainingEffectiveTimingSessionFactory,
} from './extra-training-effective-timing-production.ts'
import {
  createTrainingTimingClock,
  createTrainingTimingScheduler,
  trainingTestMode,
} from '../../config/training-test-mode.ts'
import {
  vocabularyContentSource,
  listeningContentSource,
  speakingContentSource,
} from './training-production-resources.ts'
import {
  trainingSupplyProviders,
} from './training-production-resources.ts'
import {
  collectEligibleSupplyItemIds,
  type ProductionTrainingSupplyProviders,
} from './training-supply-providers.ts'
import { GrowthProductionCoordinator } from './growth-production.ts'

export type LearningAppState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'assessment-required'
      readonly localDate: string
    }
  | {
      readonly status: 'empty'
      readonly localDate: string
      readonly runtime: ActiveLearningRuntime
      readonly engineState: LearningEngineState
      readonly assessmentProfileSchemaVersion: 1 | 2 | 3
      readonly reason: 'no-eligible-content'
    }
  | {
      readonly status: 'ready'
      readonly localDate: string
      readonly runtime: ActiveLearningRuntime
      readonly engineState: LearningEngineState
      readonly assessmentProfileSchemaVersion: 1 | 2 | 3
      readonly taskAccess: PlanTaskAccess
    }
  | {
      readonly status: 'error'
      readonly localDate: string
      readonly error: AppError
    }

export interface LearningAppCoordinatorOptions {
  readonly profiles: {
    loadLatest(): Promise<LearningAbilityProfile | undefined>
  }
  readonly activePlans: ActivePlanRepository
  readonly engineStates: LearningEngineRepository
  readonly candidates: LearningCandidateSource
  readonly availableModuleIds: ReadonlySet<TrainingModuleId>
  readonly extraTrainingPriorities?: ExtraTrainingPrioritySource
  /** Injectable only at the composition boundary; each module still owns eligibility. */
  readonly trainingSupplyProviders?: ProductionTrainingSupplyProviders
  readonly now?: () => Date
  readonly createId?: () => string
}

export type LearningAppStateListener = (
  state: LearningAppState,
) => void

function defaultId(): string {
  return globalThis.crypto.randomUUID()
}

function runtimeState(
  runtime: ActiveLearningRuntime,
  engineState: LearningEngineState,
  localDate: string,
  assessmentProfileSchemaVersion: 1 | 2 | 3,
): LearningAppState {
  if (runtime.activePlan.plan.status === 'empty') {
    return {
      status: 'empty',
      localDate,
      runtime,
      engineState,
      assessmentProfileSchemaVersion,
      reason: 'no-eligible-content',
    }
  }
  return {
    status: 'ready',
    localDate,
    runtime,
    engineState,
    assessmentProfileSchemaVersion,
    taskAccess: getPlanTaskAccess(runtime.activePlan),
  }
}

function hasCurrentTrainingBudgets(
  runtime: ActiveLearningRuntime,
): boolean {
  if (runtime.activePlan.plan.status === 'empty') {
    return true
  }
  return (
    runtime.activePlan.plan.tasks.length > 0 &&
    runtime.activePlan.plan.tasks.every(
      (task) =>
        task.trainingBudget?.targetEffectiveSeconds ===
        REQUIRED_TASK_EFFECTIVE_SECONDS,
    ) &&
    runtime.activePlan.tasks.every(
      (execution) =>
        execution.training?.targetEffectiveSeconds ===
        REQUIRED_TASK_EFFECTIVE_SECONDS,
    )
  )
}

export class LearningAppCoordinator {
  readonly #profiles: LearningAppCoordinatorOptions['profiles']
  readonly #activePlans: ActivePlanRepository
  readonly #engineStates: LearningEngineRepository
  readonly #candidates: LearningCandidateSource
  readonly #availableModuleIds: ReadonlySet<TrainingModuleId>
  readonly #now: () => Date
  readonly #createId: () => string
  readonly #trainingSupplyProviders: ProductionTrainingSupplyProviders
  readonly #listeners = new Set<LearningAppStateListener>()
  readonly eventSink: ProductionLearningEventSink
  readonly extraTraining: ProductionExtraTrainingCoordinator
  readonly extraTrainingTimingSessions:
    ProductionExtraTrainingEffectiveTimingSessionFactory
  /** Public production facade consumed by the future 02 growth screens. */
  readonly growth: GrowthProductionCoordinator
  #state: LearningAppState = { status: 'loading' }
  #initializing: Promise<LearningAppState> | null = null
  #dailyRoundWrites = new Map<string, Promise<ReturnType<typeof createTrainingSupplyRound>>>()
  #dailyRoundWriteTail: Promise<void> = Promise.resolve()

  constructor(options: LearningAppCoordinatorOptions) {
    this.#profiles = options.profiles
    this.#activePlans = options.activePlans
    this.#engineStates = options.engineStates
    this.#candidates = options.candidates
    this.#availableModuleIds = options.availableModuleIds
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? defaultId
    this.#trainingSupplyProviders =
      options.trainingSupplyProviders ?? trainingSupplyProviders
    this.eventSink = new ProductionLearningEventSink(
      this.#activePlans,
      this.#engineStates,
    )
    this.growth = new GrowthProductionCoordinator({
      engineStates: this.#engineStates,
      sources: {
        vocabulary: vocabularyContentSource,
        listening: listeningContentSource,
        speaking: speakingContentSource,
      },
    })
    this.extraTraining = new ProductionExtraTrainingCoordinator({
      activePlans: this.#activePlans,
      engineStates: this.#engineStates,
      priorities:
        options.extraTrainingPriorities ??
        emptyExtraTrainingPrioritySource,
      now: this.#now,
      createId: this.#createId,
      trainingSupplyProviders: this.#trainingSupplyProviders,
    })
    this.extraTrainingTimingSessions =
      new ProductionExtraTrainingEffectiveTimingSessionFactory({
        eventSink: this.extraTraining.eventSink,
        clock: createTrainingTimingClock(),
        scheduler: createTrainingTimingScheduler(),
        interactionIdleClockSeconds:
          trainingTestMode.enabled
            ? 45 * trainingTestMode.timeScale
            : undefined,
        maximumActiveClockSeconds:
          trainingTestMode.enabled ? 900 : undefined,
      })
    this.eventSink.subscribe((update) => {
      this.#acceptRuntimeUpdate(update)
    })
    this.extraTraining.subscribe((update) => {
      this.#acceptExtraTrainingUpdate(update.engineState)
    })
  }

  get state(): LearningAppState {
    return this.#state
  }

  /**
   * R11 scene practice has no daily-plan or extra-session identity.  Its
   * durable runtime emits this only after saving its own acknowledged round;
   * this bridge records that same item in the one shared recent-12 ledger.
   */
  async acknowledgeSceneTrainingItem(input: {
    readonly acknowledgementId: string
    readonly itemId: string
    readonly domain: 'vocabulary'
    readonly mode: 'learn'
    readonly difficultyLevel: number
  }): Promise<void> {
    const state = await this.#engineStates.load()
    if (!state) {
      throw new Error('Learning engine state is unavailable for scene progress.')
    }
    const next = acknowledgeSceneTrainingItem(
      state,
      input.acknowledgementId,
      trainingRecentBucket(input.domain, input.mode, input.difficultyLevel),
      input.itemId,
    )
    await this.#engineStates.save(next)
  }

  ensureDailyTrainingRound(taskId: string): Promise<ReturnType<typeof createTrainingSupplyRound>> {
    const existing = this.#dailyRoundWrites.get(taskId)
    if (existing) return existing
    // Different task cards can be opened almost simultaneously.  Serialize
    // their read-modify-write cycles as well as coalescing same-task clicks,
    // otherwise a later save can overwrite another module's new round.
    const operation = this.#dailyRoundWriteTail.then(() =>
      this.#ensureDailyTrainingRound(taskId),
    )
    this.#dailyRoundWriteTail = operation.then(
      () => undefined,
      () => undefined,
    )
    this.#dailyRoundWrites.set(taskId, operation)
    void operation
      .finally(() => {
        if (this.#dailyRoundWrites.get(taskId) === operation) this.#dailyRoundWrites.delete(taskId)
      })
      .catch(() => undefined)
    return operation
  }

  async #ensureDailyTrainingRound(taskId: string): Promise<ReturnType<typeof createTrainingSupplyRound>> {
    const state = this.#state
    if (state.status !== 'ready') throw new TypeError('The daily learning plan is not ready.')
    const runtime = await this.#activePlans.load()
    const engineState = await this.#engineStates.load()
    if (!runtime || !engineState || runtime.activePlan.plan.localDate !== state.localDate) throw new TypeError('The active daily plan is unavailable.')
    const execution = runtime.activePlan.tasks.find((entry) => entry.task.taskId === taskId)
    if (!execution?.training) throw new TypeError('taskId has no active training budget.')
    const access = evaluatePlanTaskStart(runtime.activePlan, taskId)
    if (access.availability !== 'startable') {
      throw new TypeError('The requested task cannot start a new training round.')
    }
    if (execution.training.supplyRound) return execution.training.supplyRound
    const request = buildLearningTaskSupplyRequest(execution)
    if (!request) throw new TypeError('taskId cannot request training content.')
    const bucket = trainingRecentBucket(execution.task.domain, execution.task.mode, execution.task.difficultyLevel)
    const round = createTrainingSupplyRound({ seed: this.#createId(), candidateItemIds: await collectEligibleSupplyItemIds(this.#trainingSupplyProviders[execution.task.targetModuleId], request), shortTermExcludedItemIds: engineState.recentTrainingItemIds?.[bucket] ?? [] })
    const progress = { ...runtime.activePlan, tasks: runtime.activePlan.tasks.map((entry) => entry.task.taskId === taskId ? { ...entry, training: { ...entry.training!, supplyRound: round } } : entry) }
    const nextRuntime = createActiveLearningRuntime(progress, { completedLearningUnitIds: runtime.completedLearningUnitIds, processedEventIds: runtime.processedEventIds, skipHistory: runtime.skipHistory, pendingTrainingAttempts: runtime.pendingTrainingAttempts })
    await this.#activePlans.save(nextRuntime)
    this.#setState(runtimeState(nextRuntime, engineState, state.localDate, state.assessmentProfileSchemaVersion))
    return round
  }

  subscribe(listener: LearningAppStateListener): () => void {
    this.#listeners.add(listener)
    listener(this.#state)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  initialize(): Promise<LearningAppState> {
    if (this.#initializing) {
      return this.#initializing
    }
    this.#setState({ status: 'loading' })
    const initialization = this.#initialize()
    this.#initializing = initialization
    const clear = () => {
      if (this.#initializing === initialization) {
        this.#initializing = null
      }
    }
    void initialization.then(clear, clear)
    return initialization
  }

  refreshForCurrentDate(): Promise<LearningAppState> {
    const state = this.#state
    const currentLocalDate = formatLocalDate(this.#now())
    if (
      state.status !== 'loading' &&
      state.localDate === currentLocalDate
    ) {
      return Promise.resolve(state)
    }
    return this.initialize()
  }

  resolveTask(
    taskId: string,
    expectedModuleId?: TrainingModuleId,
  ): LearningTask {
    const state = this.#state
    if (state.status !== 'ready') {
      throw new TypeError('The daily learning plan is not ready.')
    }
    if (state.runtime.activePlan.plan.localDate !== state.localDate) {
      throw new TypeError('The active plan is not for the current date.')
    }
    const access = evaluatePlanTaskStart(
      state.runtime.activePlan,
      taskId,
    )
    if (access.availability !== 'startable') {
      if (access.unavailableReason === 'not-in-active-plan') {
        throw new TypeError(
          'taskId is not part of the active daily plan.',
        )
      }
      if (access.unavailableReason === 'task-finished') {
        throw new TypeError(
          'The requested task is already finished.',
        )
      }
      throw new TypeError(
        'The requested task has invalid active-plan data.',
      )
    }
    const execution = state.runtime.activePlan.tasks.find(
      (entry) => entry.task.taskId === taskId,
    )
    if (!execution) {
      throw new TypeError('taskId is not part of the active daily plan.')
    }
    if (
      expectedModuleId !== undefined &&
      execution.task.targetModuleId !== expectedModuleId
    ) {
      throw new TypeError(
        'taskId does not belong to the requested training module.',
      )
    }
    return execution.task
  }

  routeForTask(taskId: string): string {
    const task = this.resolveTask(taskId)
    return `/${task.targetModuleId}?taskId=${encodeURIComponent(task.taskId)}`
  }

  trainingBudgetStatus(
    taskId: string,
    expectedModuleId: TrainingModuleId,
  ): 'running' | 'finish-current-item' {
    const task = this.resolveTask(taskId, expectedModuleId)
    const state = this.#state
    if (state.status !== 'ready' || !task.trainingBudget) {
      throw new TypeError(
        'The requested task has no active training budget.',
      )
    }
    const execution = state.runtime.activePlan.tasks.find(
      (candidate) => candidate.task.taskId === taskId,
    )
    if (!execution?.training) {
      throw new TypeError(
        'The requested task has no restored training budget progress.',
      )
    }
    return execution.training.status === 'finish-current-item' ||
      execution.training.status === 'completed'
      ? 'finish-current-item'
      : 'running'
  }

  startExtraTraining(
    moduleId: TrainingModuleId,
  ): Promise<ExtraTrainingSession> {
    return this.extraTraining.start(moduleId)
  }

  startFreshExtraTraining(
    moduleId: TrainingModuleId,
  ): Promise<ExtraTrainingSession> {
    return this.extraTraining.startFresh(moduleId)
  }

  ensureExtraTrainingRound(
    sessionId: string,
    expectedModuleId?: TrainingModuleId,
  ): Promise<ExtraTrainingSession> {
    return this.extraTraining.ensureExtraTrainingRound(
      sessionId,
      expectedModuleId,
    )
  }

  resolveExtraTrainingSession(
    sessionId: string,
    expectedModuleId?: TrainingModuleId,
  ): ExtraTrainingSession {
    const state = this.#state
    if (state.status !== 'ready') {
      throw new TypeError(
        'The daily learning plan is not ready for extra training.',
      )
    }
    const progress = state.runtime.activePlan
    const session =
      state.engineState.extraTraining?.sessions[sessionId]
    if (!session) {
      throw new TypeError(
        'Extra-training sessionId does not exist.',
      )
    }
    if (session.localDate !== state.localDate) {
      throw new TypeError(
        'Extra-training session is not for the current date.',
      )
    }
    if (
      expectedModuleId !== undefined &&
      session.targetModuleId !== expectedModuleId
    ) {
      throw new TypeError(
        'Extra-training session does not belong to the requested module.',
      )
    }
    const eligibility = getExtraTrainingEligibility(
      progress,
      session.targetModuleId,
      state.localDate,
    )
    if (!eligibility.eligible) {
      throw new TypeError(
        `Extra training requires the current ${session.targetModuleId} daily task completed.`,
      )
    }
    return session
  }

  routeForExtraTrainingSession(sessionId: string): string {
    const session = this.resolveExtraTrainingSession(sessionId)
    return `/extra-training/${session.targetModuleId}?sessionId=${encodeURIComponent(session.sessionId)}`
  }

  async #initialize(): Promise<LearningAppState> {
    const now = this.#now()
    const localDate = formatLocalDate(now)
    const generatedAt = now.toISOString()
    try {
      const profile = await this.#profiles.loadLatest()
      if (!profile) {
        return this.#setState({
          status: 'assessment-required',
          localDate,
        })
      }

      let engineState = await this.#engineStates.load()
      let profileChanged = false
      if (!engineState) {
        engineState = createLearningEngineState(profile, generatedAt)
        await this.#engineStates.save(engineState)
        profileChanged = true
      } else if (engineState.progress.profileId !== profile.profileId) {
        engineState = createLearningEngineState(profile, generatedAt)
        await this.#engineStates.save(engineState)
        profileChanged = true
      }
      if (!profileChanged) {
        engineState =
          await this.extraTraining.restoreForCurrentDate()
      }

      const previousRuntime = await this.#activePlans.load()
      if (
        !profileChanged &&
        previousRuntime?.activePlan.plan.localDate === localDate &&
        hasCurrentTrainingBudgets(previousRuntime)
      ) {
        return this.#setState(
          runtimeState(
            previousRuntime,
            engineState,
            localDate,
            profile.schemaVersion,
          ),
        )
      }

      let carryOverTasks: readonly LearningTask[] = []
      if (previousRuntime && !profileChanged) {
        const resume = getResumeDecision(
          previousRuntime.activePlan,
          localDate,
        )
        carryOverTasks = resume.carryOverTasks
        const activity = summarizePlanActivity(
          previousRuntime.activePlan,
        )
        engineState = {
          ...engineState,
          progress: recordDailyActivity(engineState.progress, {
            ...activity,
            recordedAt: generatedAt,
          }),
        }
        await this.#engineStates.save(engineState)
      }

      const completedLearningUnitIds = new Set(
        profileChanged
          ? []
          : previousRuntime?.completedLearningUnitIds ?? [],
      )
      const candidates = await this.#candidates.load(
        completedLearningUnitIds,
        this.#availableModuleIds,
      )
      const planId = `daily:${localDate}:${this.#createId()}`
      const plan = generateDailyPlan({
        planId,
        generatedAt,
        localDate,
        progress: engineState.progress,
        reviewItems: engineState.reviewItems,
        candidates,
        carryOverTasks,
      })
      const progress = createPlanProgress(plan, generatedAt)
      const runtime = createActiveLearningRuntime(
        progress,
        previousRuntime,
      )
      await this.#activePlans.save(runtime)
      return this.#setState(
        runtimeState(
          runtime,
          engineState,
          localDate,
          profile.schemaVersion,
        ),
      )
    } catch (error) {
      return this.#setState({
        status: 'error',
        localDate,
        error: toAppError(error),
      })
    }
  }

  #acceptRuntimeUpdate(update: LearningRuntimeUpdate): void {
    const current = this.#state
    if (
      current.status !== 'ready' &&
      current.status !== 'empty'
    ) {
      return
    }
    this.#setState(
      runtimeState(
        update.runtime,
        update.engineState,
        current.localDate,
        current.assessmentProfileSchemaVersion,
      ),
    )
  }

  #acceptExtraTrainingUpdate(
    engineState: LearningEngineState,
  ): void {
    const current = this.#state
    if (
      current.status !== 'ready' &&
      current.status !== 'empty'
    ) {
      return
    }
    this.#setState(
      runtimeState(
        current.runtime,
        engineState,
        current.localDate,
        current.assessmentProfileSchemaVersion,
      ),
    )
  }

  #setState(state: LearningAppState): LearningAppState {
    this.#state = state
    for (const listener of this.#listeners) {
      listener(state)
    }
    return state
  }
}

const assessmentProfiles = new VersionedAssessmentProfileRepository(
  localStorageService.namespace(ASSESSMENT_STORAGE_NAMESPACE),
)
const activePlans = new ActivePlanRepository(
  localStorageService.namespace(LEARNING_RUNTIME_STORAGE_NAMESPACE),
)
const engineStates = new LearningEngineRepository(
  localStorageService.namespace(LEARNING_ENGINE_STORAGE_NAMESPACE),
)
const extraTrainingPriorities =
  new ProductionExtraTrainingPrioritySource(
    vocabularyContentSource,
  )

export const learningAppCoordinator = new LearningAppCoordinator({
  profiles: assessmentProfiles,
  activePlans,
  engineStates,
  candidates: currentCourseCandidateSource,
  availableModuleIds: new Set([
    'vocabulary',
    'listening',
    'speaking',
  ]),
  extraTrainingPriorities,
})
