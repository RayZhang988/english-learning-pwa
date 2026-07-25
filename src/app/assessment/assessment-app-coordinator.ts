import { toAppError, type AppError } from '../../core/index.ts'
import {
  ASSESSMENT_STORAGE_NAMESPACE,
  AssessmentProfileRepository,
  createPlacementAssessmentRuntime,
  restorePlacementAssessmentRuntime,
  type AbilityProfile,
  type AssessmentRuntimeState,
  type FailedSpeechObservation,
  type NonSpeechFailureReason,
  type PlacementAssessmentRuntime,
  type SpeechObservation,
} from '../../features/assessment/index.ts'
import { localStorageService } from '../../storage/index.ts'
import { learningAppCoordinator } from '../learning/learning-app-coordinator.ts'
import { AssessmentRuntimeSnapshotRepository } from './assessment-runtime-snapshot-repository.ts'

interface AbilityProfileRepositoryPort {
  saveLatest(profile: AbilityProfile): Promise<void>
  loadLatest(): Promise<AbilityProfile | undefined>
}

interface DailyPlanInitializer {
  initialize(): Promise<{
    readonly status: string
    readonly error?: unknown
  }>
}

export type AssessmentAppState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly runtime: AssessmentRuntimeState
    }
  | {
      readonly status: 'profile-ready'
      readonly profile: AbilityProfile
    }
  | {
      readonly status: 'error'
      readonly error: AppError
      readonly runtime: AssessmentRuntimeState | null
      readonly canRetryCompletion: boolean
    }

export interface AssessmentAppCoordinatorOptions {
  readonly snapshots: AssessmentRuntimeSnapshotRepository
  readonly profiles: AbilityProfileRepositoryPort
  readonly dailyPlans: DailyPlanInitializer
  readonly now?: () => string
  readonly createId?: () => string
}

export type AssessmentAppStateListener = (
  state: AssessmentAppState,
) => void

function sameProfile(
  left: AbilityProfile | undefined,
  right: AbilityProfile,
): boolean {
  return (
    left?.profileId === right.profileId &&
    left.assessmentId === right.assessmentId &&
    left.completedAt === right.completedAt
  )
}

export class AssessmentAppCoordinator {
  readonly #snapshots: AssessmentRuntimeSnapshotRepository
  readonly #profiles: AbilityProfileRepositoryPort
  readonly #dailyPlans: DailyPlanInitializer
  readonly #now?: () => string
  readonly #createId?: () => string
  readonly #listeners = new Set<AssessmentAppStateListener>()
  #runtime: PlacementAssessmentRuntime | null = null
  #state: AssessmentAppState = { status: 'loading' }
  #initializing: Promise<AssessmentAppState> | null = null
  #completion: {
    readonly profileId: string
    readonly promise: Promise<void>
  } | null = null
  #completedProfileId: string | null = null

  constructor(options: AssessmentAppCoordinatorOptions) {
    this.#snapshots = options.snapshots
    this.#profiles = options.profiles
    this.#dailyPlans = options.dailyPlans
    this.#now = options.now
    this.#createId = options.createId
  }

  get state(): AssessmentAppState {
    return this.#state
  }

  subscribe(listener: AssessmentAppStateListener): () => void {
    this.#listeners.add(listener)
    listener(this.#state)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  initialize(): Promise<AssessmentAppState> {
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

  start(): Promise<AssessmentAppState> {
    return this.#run((runtime) => runtime.start())
  }

  selectChoice(
    itemId: string,
    optionId: string,
  ): Promise<AssessmentAppState> {
    return this.#run((runtime) =>
      runtime.selectChoice(itemId, optionId),
    )
  }

  submitChoice(itemId: string): Promise<AssessmentAppState> {
    return this.#run((runtime) => runtime.submitChoice(itemId))
  }

  submitSpeech(
    itemId: string,
    observation: SpeechObservation,
  ): Promise<AssessmentAppState> {
    return this.#run((runtime) =>
      runtime.submitSpeech(itemId, observation),
    )
  }

  reportRecognitionFailure(
    itemId: string,
    observation: FailedSpeechObservation,
  ): Promise<AssessmentAppState> {
    return this.#run((runtime) =>
      runtime.reportRecognitionFailure(itemId, observation),
    )
  }

  reportItemFailure(
    itemId: string,
    reason: Exclude<NonSpeechFailureReason, 'user-skipped'>,
  ): Promise<AssessmentAppState> {
    return this.#run((runtime) =>
      runtime.reportItemFailure(itemId, reason),
    )
  }

  skip(itemId: string): Promise<AssessmentAppState> {
    return this.#run((runtime) => runtime.skip(itemId))
  }

  continue(): Promise<AssessmentAppState> {
    return this.#run((runtime) => runtime.continue())
  }

  pause(): Promise<AssessmentAppState> {
    return this.#run((runtime) => runtime.pause())
  }

  resume(): Promise<AssessmentAppState> {
    return this.#run((runtime) => runtime.resume())
  }

  stop(): Promise<AssessmentAppState> {
    return this.#run((runtime) => runtime.stop())
  }

  async retryCompletion(): Promise<AssessmentAppState> {
    const runtime = this.#runtime
    const profile = runtime?.profile
    if (!runtime || !profile) {
      return this.#setState({
        status: 'error',
        error: toAppError(
          new TypeError('没有可重试保存的水平测试结果。'),
        ),
        runtime: runtime?.state ?? null,
        canRetryCompletion: false,
      })
    }
    try {
      await this.#commitCompletedProfile(profile)
      return this.#setState({
        status: 'ready',
        runtime: runtime.state,
      })
    } catch (error) {
      return this.#setState({
        status: 'error',
        error: toAppError(error),
        runtime: runtime.state,
        canRetryCompletion: true,
      })
    }
  }

  async #initialize(): Promise<AssessmentAppState> {
    try {
      const [snapshot, existingProfile] = await Promise.all([
        this.#snapshots.load(),
        this.#profiles.loadLatest(),
      ])
      if (!snapshot) {
        if (existingProfile) {
          return this.#setState({
            status: 'profile-ready',
            profile: existingProfile,
          })
        }
        const runtime = this.#createRuntime()
        this.#runtime = runtime
        await this.#snapshots.save(runtime.toSnapshot())
        return this.#setState({
          status: 'ready',
          runtime: runtime.state,
        })
      }

      const runtime = this.#restoreRuntime(snapshot)
      this.#runtime = runtime
      if (runtime.profile) {
        await this.#commitCompletedProfile(runtime.profile)
      }
      return this.#setState({
        status: 'ready',
        runtime: runtime.state,
      })
    } catch (error) {
      const runtime = this.#runtime
      return this.#setState({
        status: 'error',
        error: toAppError(error),
        runtime: runtime?.state ?? null,
        canRetryCompletion: runtime?.profile != null,
      })
    }
  }

  #createRuntime(): PlacementAssessmentRuntime {
    return createPlacementAssessmentRuntime({
      now: this.#now,
      createId: this.#createId,
      onCompleted: (profile) =>
        this.#commitCompletedProfile(profile),
    })
  }

  #restoreRuntime(snapshot: unknown): PlacementAssessmentRuntime {
    return restorePlacementAssessmentRuntime({
      snapshot,
      now: this.#now,
      createId: this.#createId,
      onCompleted: (profile) =>
        this.#commitCompletedProfile(profile),
    })
  }

  async #run(
    operation: (
      runtime: PlacementAssessmentRuntime,
    ) => AssessmentRuntimeState | Promise<AssessmentRuntimeState>,
  ): Promise<AssessmentAppState> {
    const runtime = this.#runtime
    if (!runtime) {
      return this.#setState({
        status: 'error',
        error: toAppError(
          new TypeError('水平测试运行时尚未初始化。'),
        ),
        runtime: null,
        canRetryCompletion: false,
      })
    }

    try {
      const runtimeState = await operation(runtime)
      if (runtimeState.lifecycle !== 'completed') {
        await this.#snapshots.save(runtime.toSnapshot())
      }
      return this.#setState({
        status: 'ready',
        runtime: runtimeState,
      })
    } catch (error) {
      const runtimeState = runtime.state
      if (runtimeState.lifecycle === 'completed' && runtime.profile) {
        try {
          await this.#snapshots.save(runtime.toSnapshot())
        } catch {
          // Preserve the original completion failure for the retry surface.
        }
      }
      return this.#setState({
        status: 'error',
        error: toAppError(error),
        runtime: runtimeState,
        canRetryCompletion:
          runtimeState.lifecycle === 'completed' &&
          runtime.profile !== null,
      })
    }
  }

  #commitCompletedProfile(profile: AbilityProfile): Promise<void> {
    if (this.#completedProfileId === profile.profileId) {
      return Promise.resolve()
    }
    if (this.#completion?.profileId === profile.profileId) {
      return this.#completion.promise
    }

    const promise = this.#persistCompletedProfile(profile)
    this.#completion = {
      profileId: profile.profileId,
      promise,
    }
    void promise.then(
      () => {
        this.#completedProfileId = profile.profileId
        if (this.#completion?.promise === promise) {
          this.#completion = null
        }
      },
      () => {
        if (this.#completion?.promise === promise) {
          this.#completion = null
        }
      },
    )
    return promise
  }

  async #persistCompletedProfile(
    profile: AbilityProfile,
  ): Promise<void> {
    const storedProfile = await this.#profiles.loadLatest()
    if (!sameProfile(storedProfile, profile)) {
      await this.#profiles.saveLatest(profile)
    }
    const runtime = this.#runtime
    if (!runtime || runtime.profile?.profileId !== profile.profileId) {
      throw new TypeError(
        '完成档案与当前水平测试运行时不一致。',
      )
    }
    await this.#snapshots.save(runtime.toSnapshot())
    const dailyPlanState = await this.#dailyPlans.initialize()
    if (dailyPlanState.status === 'error') {
      throw dailyPlanState.error instanceof Error
        ? dailyPlanState.error
        : new TypeError('能力档案已保存，但首日计划初始化失败。')
    }
    if (dailyPlanState.status === 'assessment-required') {
      throw new TypeError(
        '能力档案已保存，但学习协调器仍未读取到该档案。',
      )
    }
  }

  #setState(state: AssessmentAppState): AssessmentAppState {
    this.#state = state
    for (const listener of this.#listeners) {
      listener(state)
    }
    return state
  }
}

const assessmentStore = localStorageService.namespace(
  ASSESSMENT_STORAGE_NAMESPACE,
)

export const assessmentAppCoordinator = new AssessmentAppCoordinator({
  snapshots: new AssessmentRuntimeSnapshotRepository(assessmentStore),
  profiles: new AssessmentProfileRepository(assessmentStore),
  dailyPlans: learningAppCoordinator,
})
