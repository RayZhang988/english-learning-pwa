import { AppError, toAppError } from '../../core/index.ts'
import {
  ASSESSMENT_STORAGE_NAMESPACE,
  createTravelVocabularyAssessmentRuntimeR1,
  restoreTravelVocabularyAssessmentRuntimeR1,
  VersionedAssessmentProfileRepository,
  type AbilityProfileR1,
  type AnyAbilityProfile,
  type TravelVocabularyAssessmentRuntimeR1,
  type TravelVocabularyAssessmentRuntimeStateR1,
} from '../../features/assessment/index.ts'
import { localStorageService } from '../../storage/index.ts'
import { learningAppCoordinator } from '../learning/learning-app-coordinator.ts'
import {
  TravelVocabularyR1SnapshotRepository,
  type TravelVocabularyAssessmentSnapshotSourceR1,
} from './travel-vocabulary-r1-snapshot-repository.ts'

interface VersionedAssessmentProfileRepositoryPort {
  saveLatest(profile: AnyAbilityProfile): Promise<void>
  loadLatest(): Promise<AnyAbilityProfile | undefined>
}

interface DailyPlanInitializer {
  initialize(): Promise<{
    readonly status: string
    readonly error?: unknown
  }>
}

export type TravelVocabularyR1MigrationSource =
  | 'legacy-v1-runtime'
  | 'legacy-v2-runtime'
  | 'legacy-v1-profile'
  | 'legacy-v2-profile'

export type TravelVocabularyR1AppState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly runtime: TravelVocabularyAssessmentRuntimeStateR1
      readonly migrationSource: TravelVocabularyR1MigrationSource | null
    }
  | {
      readonly status: 'profile-ready'
      readonly profile: AbilityProfileR1
    }
  | {
      readonly status: 'error'
      readonly error: AppError
      readonly runtime: TravelVocabularyAssessmentRuntimeStateR1 | null
      readonly recovery:
        | 'retry-initialize'
        | 'retry-completion'
        | 'preserve-and-start-fresh'
    }

export interface TravelVocabularyR1AppCoordinatorOptions {
  readonly snapshots: TravelVocabularyR1SnapshotRepository
  readonly profiles: VersionedAssessmentProfileRepositoryPort
  readonly dailyPlans: DailyPlanInitializer
  readonly now?: () => string
  readonly createId?: () => string
  readonly random?: () => number
}

export type TravelVocabularyR1AppStateListener = (
  state: TravelVocabularyR1AppState,
) => void

function defaultId(): string {
  return globalThis.crypto.randomUUID()
}

function sameProfile(
  left: AnyAbilityProfile | undefined,
  right: AbilityProfileR1,
): boolean {
  return (
    left?.profileId === right.profileId &&
    left.assessmentId === right.assessmentId &&
    left.completedAt === right.completedAt &&
    left.schemaVersion === right.schemaVersion
  )
}

function profileMigrationSource(
  profile: AnyAbilityProfile | undefined,
): TravelVocabularyR1MigrationSource | null {
  if (profile?.schemaVersion === 1) {
    return 'legacy-v1-profile'
  }
  if (profile?.schemaVersion === 2) {
    return 'legacy-v2-profile'
  }
  return null
}

function snapshotMigrationSource(
  source: TravelVocabularyAssessmentSnapshotSourceR1,
): TravelVocabularyR1MigrationSource | null {
  if (source.kind === 'legacy-v1') {
    return 'legacy-v1-runtime'
  }
  if (source.kind === 'legacy-v2') {
    return 'legacy-v2-runtime'
  }
  if (
    typeof source.snapshot === 'object' &&
    source.snapshot !== null &&
    'legacySource' in source.snapshot
  ) {
    const legacySource = source.snapshot.legacySource
    if (
      typeof legacySource === 'object' &&
      legacySource !== null &&
      'kind' in legacySource
    ) {
      if (legacySource.kind === 'assessment-runtime-v1') {
        return 'legacy-v1-runtime'
      }
      if (legacySource.kind === 'adaptive-vocabulary-runtime-v2') {
        return 'legacy-v2-runtime'
      }
    }
  }
  return null
}

function snapshotError(
  source: TravelVocabularyAssessmentSnapshotSourceR1,
  cause: unknown,
): AppError {
  const versionLabel =
    source.kind === 'r1'
      ? 'R1'
      : source.kind === 'legacy-v2'
        ? '旧 v2'
        : '旧 v1'
  return new AppError(
    'schema_incompatible',
    `${versionLabel} 水平测试记录已损坏，原始数据仍保留在本机。`,
    {
      cause,
      recoverable: true,
      details: {
        namespace: ASSESSMENT_STORAGE_NAMESPACE,
        key: source.key,
        recovery: 'preserve-and-start-r1',
      },
    },
  )
}

export class TravelVocabularyR1AppCoordinator {
  readonly #snapshots: TravelVocabularyR1SnapshotRepository
  readonly #profiles: VersionedAssessmentProfileRepositoryPort
  readonly #dailyPlans: DailyPlanInitializer
  readonly #now?: () => string
  readonly #createId: () => string
  readonly #random?: () => number
  readonly #listeners = new Set<TravelVocabularyR1AppStateListener>()
  readonly #inFlight = new Map<
    string,
    Promise<TravelVocabularyR1AppState>
  >()
  #runtime: TravelVocabularyAssessmentRuntimeR1 | null = null
  #state: TravelVocabularyR1AppState = { status: 'loading' }
  #initializing: Promise<TravelVocabularyR1AppState> | null = null
  #operationQueue: Promise<void> = Promise.resolve()
  #completion: {
    readonly profileId: string
    readonly promise: Promise<void>
  } | null = null
  #completedProfileId: string | null = null
  #corruptSourceKey: string | null = null
  #migrationSource: TravelVocabularyR1MigrationSource | null = null

  constructor(options: TravelVocabularyR1AppCoordinatorOptions) {
    this.#snapshots = options.snapshots
    this.#profiles = options.profiles
    this.#dailyPlans = options.dailyPlans
    this.#now = options.now
    this.#createId = options.createId ?? defaultId
    this.#random = options.random
  }

  get state(): TravelVocabularyR1AppState {
    return this.#state
  }

  subscribe(listener: TravelVocabularyR1AppStateListener): () => void {
    this.#listeners.add(listener)
    listener(this.#state)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  initialize(): Promise<TravelVocabularyR1AppState> {
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

  start(): Promise<TravelVocabularyR1AppState> {
    return this.#dedupe('start', (runtime) => runtime.start())
  }

  selectChoice(
    questionId: string,
    optionId: string,
  ): Promise<TravelVocabularyR1AppState> {
    return this.#dedupe(
      `select:${questionId}:${optionId}`,
      (runtime) => runtime.selectChoice(questionId, optionId),
    )
  }

  markUncertain(
    questionId: string,
  ): Promise<TravelVocabularyR1AppState> {
    return this.#dedupe(
      `uncertain:${questionId}`,
      (runtime) => runtime.markUncertain(questionId),
    )
  }

  clearAnswer(
    questionId: string,
  ): Promise<TravelVocabularyR1AppState> {
    return this.#dedupe(
      `clear:${questionId}`,
      (runtime) => runtime.clearAnswer(questionId),
    )
  }

  navigate(
    questionIndex: number,
  ): Promise<TravelVocabularyR1AppState> {
    return this.#dedupe(
      `navigate:${questionIndex}`,
      (runtime) => runtime.navigate(questionIndex),
    )
  }

  submitStage(): Promise<TravelVocabularyR1AppState> {
    return this.#dedupe('submit-stage', (runtime) =>
      runtime.submitStage(),
    )
  }

  continueToNextStage(): Promise<TravelVocabularyR1AppState> {
    return this.#dedupe('continue-stage', (runtime) =>
      runtime.continueToNextStage(),
    )
  }

  pause(): Promise<TravelVocabularyR1AppState> {
    return this.#dedupe('pause', (runtime) => runtime.pause())
  }

  resume(): Promise<TravelVocabularyR1AppState> {
    return this.#dedupe('resume', (runtime) => runtime.resume())
  }

  retryCompletion(): Promise<TravelVocabularyR1AppState> {
    const runtime = this.#runtime
    const profile = runtime?.profile
    if (!runtime || !profile) {
      return Promise.resolve(
        this.#setState({
          status: 'error',
          error: toAppError(
            new TypeError('没有可重新保存的 R1 水平测试结果。'),
          ),
          runtime: runtime?.state ?? null,
          recovery: 'retry-initialize',
        }),
      )
    }
    return this.#enqueue(async () => {
      try {
        await this.#commitCompletedProfile(profile)
        return this.#readyState(runtime.state)
      } catch (error) {
        return this.#setState({
          status: 'error',
          error: toAppError(error),
          runtime: runtime.state,
          recovery: 'retry-completion',
        })
      }
    })
  }

  recoverWithFreshSample(): Promise<TravelVocabularyR1AppState> {
    return this.#enqueue(async () => {
      const sourceKey = this.#corruptSourceKey
      if (!sourceKey) {
        return this.initialize()
      }
      try {
        const existingProfile = await this.#profiles.loadLatest()
        const runtime = this.#createRuntime(
          existingProfile?.schemaVersion === 3
            ? existingProfile.sampledWordIds
            : undefined,
        )
        await this.#snapshots.preserveSourceAndSaveFresh(
          runtime.toSnapshot(),
          sourceKey,
          this.#createId(),
        )
        this.#runtime = runtime
        this.#corruptSourceKey = null
        this.#migrationSource = profileMigrationSource(existingProfile)
        return this.#readyState(runtime.state)
      } catch (error) {
        return this.#setState({
          status: 'error',
          error: toAppError(error),
          runtime: null,
          recovery: 'retry-initialize',
        })
      }
    })
  }

  async #initialize(): Promise<TravelVocabularyR1AppState> {
    this.#corruptSourceKey = null
    try {
      const [source, existingProfile] = await Promise.all([
        this.#snapshots.load(),
        this.#profiles.loadLatest(),
      ])

      if (!source) {
        if (existingProfile?.schemaVersion === 3) {
          return this.#setState({
            status: 'profile-ready',
            profile: existingProfile,
          })
        }
        const runtime = this.#createRuntime()
        this.#runtime = runtime
        this.#migrationSource = profileMigrationSource(existingProfile)
        await this.#snapshots.save(runtime.toSnapshot())
        return this.#readyState(runtime.state)
      }

      let runtime: TravelVocabularyAssessmentRuntimeR1
      try {
        runtime = this.#restoreRuntime(source, existingProfile)
      } catch (error) {
        this.#corruptSourceKey = source.key
        throw snapshotError(source, error)
      }
      this.#runtime = runtime
      this.#migrationSource =
        snapshotMigrationSource(source) ??
        profileMigrationSource(existingProfile)

      if (source.kind !== 'r1') {
        await this.#snapshots.save(runtime.toSnapshot())
      }
      if (runtime.profile) {
        await this.#commitCompletedProfile(runtime.profile)
      }
      return this.#readyState(runtime.state)
    } catch (error) {
      const appError = toAppError(error)
      const sourceKey =
        typeof appError.details?.key === 'string'
          ? appError.details.key
          : null
      if (appError.details?.recovery === 'preserve-and-start-r1') {
        this.#corruptSourceKey = sourceKey
      }
      return this.#setState({
        status: 'error',
        error: appError,
        runtime: this.#runtime?.state ?? null,
        recovery:
          this.#corruptSourceKey === null
            ? 'retry-initialize'
            : 'preserve-and-start-fresh',
      })
    }
  }

  #createRuntime(
    recentWordIds?: readonly string[],
  ): TravelVocabularyAssessmentRuntimeR1 {
    return createTravelVocabularyAssessmentRuntimeR1({
      now: this.#now,
      createId: this.#createId,
      random: this.#random,
      recentWordIds,
      onCompleted: (profile) =>
        this.#commitCompletedProfile(profile),
    })
  }

  #restoreRuntime(
    source: TravelVocabularyAssessmentSnapshotSourceR1,
    existingProfile: AnyAbilityProfile | undefined,
  ): TravelVocabularyAssessmentRuntimeR1 {
    return restoreTravelVocabularyAssessmentRuntimeR1({
      snapshot: source.snapshot,
      now: this.#now,
      createId: this.#createId,
      random: this.#random,
      recentWordIds:
        existingProfile?.schemaVersion === 3
          ? existingProfile.sampledWordIds
          : undefined,
      onCompleted: (profile) =>
        this.#commitCompletedProfile(profile),
    })
  }

  #dedupe(
    key: string,
    operation: (
      runtime: TravelVocabularyAssessmentRuntimeR1,
    ) =>
      | TravelVocabularyAssessmentRuntimeStateR1
      | Promise<TravelVocabularyAssessmentRuntimeStateR1>,
  ): Promise<TravelVocabularyR1AppState> {
    const existing = this.#inFlight.get(key)
    if (existing) {
      return existing
    }
    const pending = this.#run(operation)
    this.#inFlight.set(key, pending)
    void pending.finally(() => {
      if (this.#inFlight.get(key) === pending) {
        this.#inFlight.delete(key)
      }
    })
    return pending
  }

  #run(
    operation: (
      runtime: TravelVocabularyAssessmentRuntimeR1,
    ) =>
      | TravelVocabularyAssessmentRuntimeStateR1
      | Promise<TravelVocabularyAssessmentRuntimeStateR1>,
  ): Promise<TravelVocabularyR1AppState> {
    return this.#enqueue(async () => {
      const runtime = this.#runtime
      if (!runtime) {
        return this.#setState({
          status: 'error',
          error: toAppError(
            new TypeError('R1 水平测试运行时尚未初始化。'),
          ),
          runtime: null,
          recovery: 'retry-initialize',
        })
      }
      try {
        const runtimeState = await operation(runtime)
        await this.#snapshots.save(runtime.toSnapshot())
        return this.#readyState(runtimeState)
      } catch (error) {
        const runtimeState = runtime.state
        if (runtimeState.lifecycle === 'completed' && runtime.profile) {
          try {
            await this.#snapshots.save(runtime.toSnapshot())
          } catch {
            // Keep the completion error as the primary failure.
          }
        }
        return this.#setState({
          status: 'error',
          error: toAppError(error),
          runtime: runtimeState,
          recovery:
            runtimeState.lifecycle === 'completed' && runtime.profile
              ? 'retry-completion'
              : 'retry-initialize',
        })
      }
    })
  }

  #enqueue(
    operation: () => Promise<TravelVocabularyR1AppState>,
  ): Promise<TravelVocabularyR1AppState> {
    const pending = this.#operationQueue.then(operation, operation)
    this.#operationQueue = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }

  #commitCompletedProfile(profile: AbilityProfileR1): Promise<void> {
    if (this.#completedProfileId === profile.profileId) {
      return Promise.resolve()
    }
    if (this.#completion?.profileId === profile.profileId) {
      return this.#completion.promise
    }
    const promise = this.#persistCompletedProfile(profile)
    this.#completion = { profileId: profile.profileId, promise }
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
    profile: AbilityProfileR1,
  ): Promise<void> {
    const storedProfile = await this.#profiles.loadLatest()
    if (!sameProfile(storedProfile, profile)) {
      await this.#profiles.saveLatest(profile)
    }
    const runtime = this.#runtime
    if (!runtime || runtime.profile?.profileId !== profile.profileId) {
      throw new TypeError('R1 档案与当前运行时不一致。')
    }
    await this.#snapshots.save(runtime.toSnapshot())
    const dailyPlanState = await this.#dailyPlans.initialize()
    if (dailyPlanState.status === 'error') {
      throw dailyPlanState.error instanceof Error
        ? dailyPlanState.error
        : new TypeError('R1 档案已保存，但首日计划初始化失败。')
    }
    if (dailyPlanState.status === 'assessment-required') {
      throw new TypeError(
        'R1 档案已保存，但学习协调器仍未读取到 schema 3 档案。',
      )
    }
  }

  #readyState(
    runtime: TravelVocabularyAssessmentRuntimeStateR1,
  ): TravelVocabularyR1AppState {
    return this.#setState({
      status: 'ready',
      runtime,
      migrationSource: this.#migrationSource,
    })
  }

  #setState(
    state: TravelVocabularyR1AppState,
  ): TravelVocabularyR1AppState {
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

export const travelVocabularyR1AppCoordinator =
  new TravelVocabularyR1AppCoordinator({
    snapshots: new TravelVocabularyR1SnapshotRepository(assessmentStore),
    profiles: new VersionedAssessmentProfileRepository(assessmentStore),
    dailyPlans: learningAppCoordinator,
  })
