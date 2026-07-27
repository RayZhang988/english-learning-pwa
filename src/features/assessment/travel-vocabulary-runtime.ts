import { travelVocabularyBankR1 } from '../../../content/assessment/travel-vocabulary-bank.r1.ts'
import { AssessmentRuntimeError } from './runtime.ts'
import {
  answerTravelVocabularyQuestionR1,
  canSubmitTravelVocabularyStageR1,
  clearTravelVocabularyAnswerR1,
  continueTravelVocabularyStageR1,
  createTravelVocabularyAssessmentSessionR1,
  navigateTravelVocabularyQuestionR1,
  submitTravelVocabularyStageR1,
} from './travel-vocabulary-engine.ts'
import { migrateLegacyAssessmentSnapshotToTravelR1 } from './travel-vocabulary-migration.ts'
import {
  TRAVEL_VOCABULARY_TOTAL_QUESTIONS_R1,
  TRAVEL_VOCABULARY_TOTAL_STAGES_R1,
} from './travel-vocabulary-model.ts'
import { buildTravelVocabularyAbilityProfileR1 } from './travel-vocabulary-profile.ts'
import { parseTravelVocabularyRuntimeSnapshotR1 } from './travel-vocabulary-snapshot.ts'
import {
  toPublicTravelVocabularyQuestionR1,
  validateTravelVocabularyBankR1,
} from './travel-vocabulary-bank.ts'
import type {
  AbilityProfileR1,
  RandomSourceR1,
  TravelVocabularyAssessmentLifecycleR1,
  TravelVocabularyAssessmentRuntimeSnapshotR1,
  TravelVocabularyAssessmentRuntimeStateR1,
  TravelVocabularyBankR1,
  TravelVocabularyProfileCompletionHandlerR1,
} from './travel-vocabulary-types.ts'

export const TRAVEL_VOCABULARY_RUNTIME_SCHEMA_VERSION_R1 = 3 as const
export const TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1 =
  'active-travel-vocabulary-assessment-r1-v1'

export interface TravelVocabularyRuntimeOptionsR1 {
  readonly bank?: TravelVocabularyBankR1
  readonly now?: () => string
  readonly createId?: () => string
  readonly random?: RandomSourceR1
  readonly recentWordIds?: readonly string[]
  readonly onCompleted?: TravelVocabularyProfileCompletionHandlerR1
}

export interface RestoreTravelVocabularyRuntimeOptionsR1
  extends TravelVocabularyRuntimeOptionsR1 {
  readonly snapshot: unknown
}

function defaultNow(): string {
  return new Date().toISOString()
}

function defaultId(): string {
  return globalThis.crypto.randomUUID()
}

function defaultRandom(): number {
  return Math.random()
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new AssessmentRuntimeError(
      'clock-invalid',
      'Travel vocabulary assessment clock returned an invalid timestamp.',
    )
  }
  return parsed
}

function snapshotVersion(value: unknown): number | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    typeof value.schemaVersion !== 'number'
  ) {
    return null
  }
  return value.schemaVersion
}

export class TravelVocabularyAssessmentRuntimeR1 {
  readonly #bank: TravelVocabularyBankR1
  readonly #now: () => string
  readonly #onCompleted?: TravelVocabularyProfileCompletionHandlerR1
  #snapshot: TravelVocabularyAssessmentRuntimeSnapshotR1
  #activeSinceMs: number | null = null
  #completionDelivered: boolean

  private constructor(
    options: TravelVocabularyRuntimeOptionsR1,
    restored?: TravelVocabularyAssessmentRuntimeSnapshotR1,
  ) {
    this.#bank = validateTravelVocabularyBankR1(
      options.bank ?? travelVocabularyBankR1,
    )
    this.#now = options.now ?? defaultNow
    this.#onCompleted = options.onCompleted
    const now = this.#readNow()

    if (restored) {
      const resumeTo =
        restored.lifecycle === 'active' ||
        restored.lifecycle === 'stage-summary'
          ? restored.lifecycle
          : restored.resumeTo
      const lifecycle =
        restored.lifecycle === 'active' ||
        restored.lifecycle === 'stage-summary'
          ? 'paused'
          : restored.lifecycle
      this.#snapshot = {
        ...restored,
        lifecycle,
        resumeTo,
        updatedAt: now.iso,
      }
      this.#completionDelivered = lifecycle === 'completed'
      return
    }

    const createId = options.createId ?? defaultId
    const session = createTravelVocabularyAssessmentSessionR1({
      id: createId(),
      startedAt: now.iso,
      bank: this.#bank,
      random: options.random ?? defaultRandom,
      recentWordIds: options.recentWordIds,
    })
    this.#snapshot = {
      schemaVersion: TRAVEL_VOCABULARY_RUNTIME_SCHEMA_VERSION_R1,
      assessmentKind: 'staged-travel-vocabulary',
      bankId: this.#bank.id,
      lifecycle: 'intro',
      resumeTo: null,
      session,
      activeElapsedMs: 0,
      profile: null,
      legacySource: null,
      migrationNotice: null,
      updatedAt: now.iso,
    }
    this.#completionDelivered = false
  }

  static create(
    options: TravelVocabularyRuntimeOptionsR1 = {},
  ): TravelVocabularyAssessmentRuntimeR1 {
    return new TravelVocabularyAssessmentRuntimeR1(options)
  }

  static restore(
    options: RestoreTravelVocabularyRuntimeOptionsR1,
  ): TravelVocabularyAssessmentRuntimeR1 {
    const bank = options.bank ?? travelVocabularyBankR1
    const nowProvider = options.now ?? defaultNow
    const now = nowProvider()
    const version = snapshotVersion(options.snapshot)
    const restored =
      version === 3
        ? parseTravelVocabularyRuntimeSnapshotR1(
            options.snapshot,
            bank,
          )
        : migrateLegacyAssessmentSnapshotToTravelR1({
            snapshot: options.snapshot,
            bank,
            random: options.random ?? defaultRandom,
            updatedAt: now,
            createId: options.createId ?? defaultId,
            recentWordIds: options.recentWordIds,
          })
    return new TravelVocabularyAssessmentRuntimeR1(
      { ...options, bank, now: nowProvider },
      restored,
    )
  }

  get state(): TravelVocabularyAssessmentRuntimeStateR1 {
    const now = this.#readNow()
    return this.#buildState(this.#activeElapsed(now.ms))
  }

  get profile(): AbilityProfileR1 | null {
    return this.#snapshot.profile
  }

  toSnapshot(): TravelVocabularyAssessmentRuntimeSnapshotR1 {
    const now = this.#readNow()
    return structuredClone({
      ...this.#snapshot,
      activeElapsedMs: this.#activeElapsed(now.ms),
      updatedAt: now.iso,
    })
  }

  start(): TravelVocabularyAssessmentRuntimeStateR1 {
    this.#requireLifecycle('intro')
    const now = this.#readNow()
    this.#snapshot = {
      ...this.#snapshot,
      lifecycle: 'active',
      session: {
        ...this.#snapshot.session,
        startedAt: now.iso,
      },
      activeElapsedMs: 0,
      updatedAt: now.iso,
    }
    this.#activeSinceMs = now.ms
    return this.#buildState(0)
  }

  navigate(questionIndex: number): TravelVocabularyAssessmentRuntimeStateR1 {
    this.#requireLifecycle('active')
    const now = this.#readNow()
    this.#snapshot = {
      ...this.#snapshot,
      session: navigateTravelVocabularyQuestionR1({
        session: this.#snapshot.session,
        questionIndex,
      }),
      updatedAt: now.iso,
    }
    return this.#buildState(this.#activeElapsed(now.ms))
  }

  selectChoice(
    questionId: string,
    optionId: string,
  ): TravelVocabularyAssessmentRuntimeStateR1 {
    this.#requireLifecycle('active')
    return this.#updateAnswer(questionId, {
      kind: 'choice',
      optionId,
    })
  }

  markUncertain(
    questionId: string,
  ): TravelVocabularyAssessmentRuntimeStateR1 {
    this.#requireLifecycle('active')
    return this.#updateAnswer(questionId, { kind: 'uncertain' })
  }

  clearAnswer(
    questionId: string,
  ): TravelVocabularyAssessmentRuntimeStateR1 {
    this.#requireLifecycle('active')
    const now = this.#readNow()
    this.#snapshot = {
      ...this.#snapshot,
      session: clearTravelVocabularyAnswerR1({
        session: this.#snapshot.session,
        questionId,
      }),
      updatedAt: now.iso,
    }
    return this.#buildState(this.#activeElapsed(now.ms))
  }

  async submitStage(): Promise<TravelVocabularyAssessmentRuntimeStateR1> {
    this.#requireLifecycle('active')
    const now = this.#readNow()
    const activeElapsedMs = this.#activeElapsed(now.ms)
    const submitted = submitTravelVocabularyStageR1({
      session: this.#snapshot.session,
      bank: this.#bank,
      submittedAt: now.iso,
    })
    if (submitted.session.status === 'completed') {
      return this.#complete(
        submitted.session,
        now,
        activeElapsedMs,
      )
    }
    this.#snapshot = {
      ...this.#snapshot,
      lifecycle: 'stage-summary',
      session: submitted.session,
      updatedAt: now.iso,
    }
    return this.#buildState(activeElapsedMs)
  }

  continueToNextStage(): TravelVocabularyAssessmentRuntimeStateR1 {
    this.#requireLifecycle('stage-summary')
    const now = this.#readNow()
    this.#snapshot = {
      ...this.#snapshot,
      lifecycle: 'active',
      session: continueTravelVocabularyStageR1(
        this.#snapshot.session,
      ),
      updatedAt: now.iso,
    }
    return this.#buildState(this.#activeElapsed(now.ms))
  }

  pause(): TravelVocabularyAssessmentRuntimeStateR1 {
    if (
      this.#snapshot.lifecycle !== 'active' &&
      this.#snapshot.lifecycle !== 'stage-summary'
    ) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        'Only an active R1 assessment can be paused.',
      )
    }
    const now = this.#readNow()
    const activeElapsedMs = this.#activeElapsed(now.ms)
    this.#snapshot = {
      ...this.#snapshot,
      lifecycle: 'paused',
      resumeTo: this.#snapshot.lifecycle,
      activeElapsedMs,
      updatedAt: now.iso,
    }
    this.#activeSinceMs = null
    return this.#buildState(activeElapsedMs)
  }

  resume(): TravelVocabularyAssessmentRuntimeStateR1 {
    this.#requireLifecycle('paused')
    const now = this.#readNow()
    const resumeTo = this.#snapshot.resumeTo
    if (!resumeTo) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        'Paused R1 assessment has no resumable state.',
      )
    }
    this.#snapshot = {
      ...this.#snapshot,
      lifecycle: resumeTo,
      resumeTo: null,
      updatedAt: now.iso,
    }
    this.#activeSinceMs = now.ms
    return this.#buildState(this.#snapshot.activeElapsedMs)
  }

  #updateAnswer(
    questionId: string,
    answer:
      | { readonly kind: 'choice'; readonly optionId: string }
      | { readonly kind: 'uncertain' },
  ): TravelVocabularyAssessmentRuntimeStateR1 {
    const now = this.#readNow()
    this.#snapshot = {
      ...this.#snapshot,
      session: answerTravelVocabularyQuestionR1({
        session: this.#snapshot.session,
        questionId,
        answer,
      }),
      updatedAt: now.iso,
    }
    return this.#buildState(this.#activeElapsed(now.ms))
  }

  async #complete(
    session: TravelVocabularyAssessmentRuntimeSnapshotR1['session'],
    now: { readonly iso: string; readonly ms: number },
    activeElapsedMs: number,
  ): Promise<TravelVocabularyAssessmentRuntimeStateR1> {
    const profile = buildTravelVocabularyAbilityProfileR1({
      session,
      bank: this.#bank,
      completedAt: now.iso,
      durationSeconds: activeElapsedMs / 1000,
    })
    this.#snapshot = {
      ...this.#snapshot,
      lifecycle: 'completed',
      resumeTo: null,
      session,
      activeElapsedMs,
      profile,
      updatedAt: now.iso,
    }
    this.#activeSinceMs = null
    if (!this.#completionDelivered) {
      this.#completionDelivered = true
      await this.#onCompleted?.(profile)
    }
    return this.#buildState(activeElapsedMs)
  }

  #requireLifecycle(
    expected: TravelVocabularyAssessmentLifecycleR1,
  ): void {
    if (this.#snapshot.lifecycle !== expected) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        `Expected ${expected}, received ${this.#snapshot.lifecycle}.`,
      )
    }
  }

  #activeElapsed(nowMs: number): number {
    if (this.#activeSinceMs === null) {
      return this.#snapshot.activeElapsedMs
    }
    if (nowMs < this.#activeSinceMs) {
      throw new AssessmentRuntimeError(
        'clock-invalid',
        'Travel vocabulary assessment clock moved backwards.',
      )
    }
    return (
      this.#snapshot.activeElapsedMs +
      (nowMs - this.#activeSinceMs)
    )
  }

  #readNow(): { readonly iso: string; readonly ms: number } {
    const iso = this.#now()
    return { iso, ms: timestamp(iso) }
  }

  #buildState(
    activeElapsedMs: number,
  ): TravelVocabularyAssessmentRuntimeStateR1 {
    const session = this.#snapshot.session
    const lifecycle = this.#snapshot.lifecycle
    const stageDefinition =
      lifecycle === 'intro' || lifecycle === 'completed'
        ? null
        : this.#bank.stages[session.currentStageIndex] ?? null
    const stagePlan =
      stageDefinition === null
        ? null
        : session.stagePlans[session.currentStageIndex] ?? null
    const questions =
      stagePlan?.questions.map(
        toPublicTravelVocabularyQuestionR1,
      ) ?? []
    const answeredInStage = Object.keys(
      session.draftAnswers,
    ).length
    const answeredOverall =
      session.completedStages.length * 30 + answeredInStage
    const editable = lifecycle === 'active'

    return {
      schemaVersion: 3,
      assessmentKind: 'staged-travel-vocabulary',
      lifecycle,
      sessionId: session.id,
      stage:
        stageDefinition === null
          ? null
          : {
              id: stageDefinition.id,
              order: stageDefinition.order,
              label: stageDefinition.label,
              representativeWordCount:
                stageDefinition.representativeWordCount,
            },
      questions,
      currentQuestionIndex: session.currentQuestionIndex,
      draftAnswers: session.draftAnswers,
      latestStageResult:
        lifecycle === 'stage-summary' ||
        lifecycle === 'completed'
          ? session.completedStages.at(-1) ?? null
          : null,
      progress: {
        currentStage: session.currentStageIndex + 1,
        totalStages: TRAVEL_VOCABULARY_TOTAL_STAGES_R1,
        currentQuestion: session.currentQuestionIndex + 1,
        questionsPerStage: 30,
        answeredInStage,
        answeredOverall: Math.min(
          answeredOverall,
          TRAVEL_VOCABULARY_TOTAL_QUESTIONS_R1,
        ),
        totalQuestions: TRAVEL_VOCABULARY_TOTAL_QUESTIONS_R1,
        elapsedSeconds: Math.round(activeElapsedMs / 1000),
      },
      profile: this.#snapshot.profile,
      migrationNotice: this.#snapshot.migrationNotice,
      actions: {
        canStart: lifecycle === 'intro',
        canNavigate: editable,
        canAnswer: editable,
        canMarkUncertain: editable,
        canClearAnswer: editable && answeredInStage > 0,
        canSubmitStage:
          editable &&
          canSubmitTravelVocabularyStageR1(session),
        canContinueToNextStage: lifecycle === 'stage-summary',
        canPause:
          lifecycle === 'active' ||
          lifecycle === 'stage-summary',
        canResume: lifecycle === 'paused',
      },
    }
  }
}

export function createTravelVocabularyAssessmentRuntimeR1(
  options: TravelVocabularyRuntimeOptionsR1 = {},
): TravelVocabularyAssessmentRuntimeR1 {
  return TravelVocabularyAssessmentRuntimeR1.create(options)
}

export function restoreTravelVocabularyAssessmentRuntimeR1(
  options: RestoreTravelVocabularyRuntimeOptionsR1,
): TravelVocabularyAssessmentRuntimeR1 {
  return TravelVocabularyAssessmentRuntimeR1.restore(options)
}
