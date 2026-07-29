import { toAppError, type AppError } from '../../core/index.ts'
import {
  ASSESSMENT_STORAGE_NAMESPACE,
  VersionedAssessmentProfileRepository,
} from '../../features/assessment/index.ts'
import {
  createLearningEngineState,
  createPlanProgress,
  evaluatePlanTaskStart,
  generateDailyPlan,
  getPlanTaskAccess,
  getResumeDecision,
  LEARNING_ENGINE_STORAGE_NAMESPACE,
  LearningEngineRepository,
  recordDailyActivity,
  REQUIRED_TASK_EFFECTIVE_SECONDS,
  summarizePlanActivity,
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
  readonly #listeners = new Set<LearningAppStateListener>()
  readonly eventSink: ProductionLearningEventSink
  #state: LearningAppState = { status: 'loading' }
  #initializing: Promise<LearningAppState> | null = null

  constructor(options: LearningAppCoordinatorOptions) {
    this.#profiles = options.profiles
    this.#activePlans = options.activePlans
    this.#engineStates = options.engineStates
    this.#candidates = options.candidates
    this.#availableModuleIds = options.availableModuleIds
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? defaultId
    this.eventSink = new ProductionLearningEventSink(
      this.#activePlans,
      this.#engineStates,
    )
    this.eventSink.subscribe((update) => {
      this.#acceptRuntimeUpdate(update)
    })
  }

  get state(): LearningAppState {
    return this.#state
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
})
