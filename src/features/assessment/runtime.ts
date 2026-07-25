import { placementBankV1 } from '../../../content/assessment/placement-bank.v1.ts'
import { toPublicAssessmentItem } from './bank.ts'
import {
  createAssessmentSession,
  getNextAssessmentItem,
  stopAssessment,
  submitAssessmentResponse,
} from './engine.ts'
import { buildAbilityProfile } from './profile.ts'
import {
  ASSESSMENT_TIMING,
  DOMAIN_RULES,
} from './rules.ts'
import {
  ASSESSMENT_RUNTIME_SCHEMA_VERSION,
  type AbilityProfileCompletionHandler,
  type AssessmentRuntimeActions,
  type AssessmentRuntimeLifecycle,
  type AssessmentRuntimeProgress,
  type AssessmentRuntimeSnapshotV1,
  type AssessmentRuntimeState,
  type AssessmentSubmissionSummary,
} from './runtime-types.ts'
import { parseAssessmentRuntimeSnapshot } from './snapshot.ts'
import type {
  AbilityDomain,
  AbilityProfile,
  AssessmentBank,
  AssessmentItem,
  AssessmentSession,
  FailedSpeechObservation,
  NonSpeechFailureReason,
  SpeechObservation,
} from './types.ts'

export type AssessmentRuntimeErrorCode =
  | 'invalid-transition'
  | 'stale-item'
  | 'invalid-option'
  | 'clock-invalid'

export class AssessmentRuntimeError extends Error {
  readonly code: AssessmentRuntimeErrorCode

  constructor(code: AssessmentRuntimeErrorCode, message: string) {
    super(message)
    this.name = 'AssessmentRuntimeError'
    this.code = code
  }
}

export interface PlacementAssessmentRuntimeOptions {
  readonly bank?: AssessmentBank
  readonly now?: () => string
  readonly createId?: () => string
  readonly onCompleted?: AbilityProfileCompletionHandler
}

export interface RestorePlacementAssessmentRuntimeOptions
  extends PlacementAssessmentRuntimeOptions {
  readonly snapshot: unknown
}

function defaultNow(): string {
  return new Date().toISOString()
}

function defaultId(): string {
  return globalThis.crypto.randomUUID()
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new AssessmentRuntimeError(
      'clock-invalid',
      'Assessment clock returned an invalid timestamp.',
    )
  }
  return parsed
}

function totalMaximumItems(): number {
  return Object.values(DOMAIN_RULES).reduce(
    (total, rule) => total + rule.maximumAttempts,
    0,
  )
}

export class PlacementAssessmentRuntime {
  readonly #bank: AssessmentBank
  readonly #now: () => string
  readonly #onCompleted?: AbilityProfileCompletionHandler
  #snapshot: AssessmentRuntimeSnapshotV1
  #activeSinceMs: number | null = null
  #completionDelivered: boolean

  private constructor(
    options: PlacementAssessmentRuntimeOptions,
    restored?: AssessmentRuntimeSnapshotV1,
  ) {
    this.#bank = options.bank ?? placementBankV1
    this.#now = options.now ?? defaultNow
    this.#onCompleted = options.onCompleted
    const now = this.#readNow()

    if (restored) {
      const resumeTo =
        restored.lifecycle === 'active' ||
        restored.lifecycle === 'feedback'
          ? restored.lifecycle
          : restored.resumeTo
      const lifecycle =
        restored.lifecycle === 'active' ||
        restored.lifecycle === 'feedback'
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
    const session = createAssessmentSession({
      id: createId(),
      startedAt: now.iso,
      bank: this.#bank,
    })
    this.#snapshot = {
      schemaVersion: ASSESSMENT_RUNTIME_SCHEMA_VERSION,
      bankId: this.#bank.id,
      lifecycle: 'intro',
      resumeTo: null,
      session,
      selectedOptionId: null,
      activeElapsedMs: 0,
      itemStartedAtActiveMs: null,
      lastSubmission: null,
      profile: null,
      updatedAt: now.iso,
    }
    this.#completionDelivered = false
  }

  static create(
    options: PlacementAssessmentRuntimeOptions = {},
  ): PlacementAssessmentRuntime {
    return new PlacementAssessmentRuntime(options)
  }

  static restore(
    options: RestorePlacementAssessmentRuntimeOptions,
  ): PlacementAssessmentRuntime {
    const bank = options.bank ?? placementBankV1
    const restored = parseAssessmentRuntimeSnapshot(
      options.snapshot,
      bank,
    )
    return new PlacementAssessmentRuntime(
      { ...options, bank },
      restored,
    )
  }

  get state(): AssessmentRuntimeState {
    const now = this.#readNow()
    return this.#buildState(this.#activeElapsed(now.ms))
  }

  get profile(): AbilityProfile | null {
    return this.#snapshot.profile
  }

  toSnapshot(): AssessmentRuntimeSnapshotV1 {
    const now = this.#readNow()
    return structuredClone({
      ...this.#snapshot,
      activeElapsedMs: this.#activeElapsed(now.ms),
      updatedAt: now.iso,
    })
  }

  async start(): Promise<AssessmentRuntimeState> {
    this.#requireLifecycle('intro')
    const now = this.#readNow()
    const session = createAssessmentSession({
      id: this.#snapshot.session.id,
      startedAt: now.iso,
      bank: this.#bank,
    })
    this.#snapshot = {
      ...this.#snapshot,
      lifecycle: 'active',
      session,
      activeElapsedMs: 0,
      updatedAt: now.iso,
    }
    this.#activeSinceMs = now.ms
    return this.#loadNextItem(now)
  }

  selectChoice(
    itemId: string,
    optionId: string,
  ): AssessmentRuntimeState {
    const item = this.#requireCurrentItem(itemId, 'choice')
    if (item.kind !== 'choice') {
      throw new AssessmentRuntimeError(
        'stale-item',
        `Item ${itemId} is not a choice item.`,
      )
    }
    if (!item.options.some((option) => option.id === optionId)) {
      throw new AssessmentRuntimeError(
        'invalid-option',
        `Option ${optionId} does not belong to item ${itemId}.`,
      )
    }
    const now = this.#readNow()
    this.#snapshot = {
      ...this.#snapshot,
      selectedOptionId: optionId,
      updatedAt: now.iso,
    }
    return this.#buildState(this.#activeElapsed(now.ms))
  }

  async submitChoice(itemId: string): Promise<AssessmentRuntimeState> {
    this.#requireCurrentItem(itemId, 'choice')
    const selectedOptionId = this.#snapshot.selectedOptionId
    if (!selectedOptionId) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        'A choice must be selected before submission.',
      )
    }
    return this.#submit(
      itemId,
      {
        kind: 'choice',
        selectedOptionId,
        durationMs: this.#currentItemDuration(),
      },
      'recorded',
    )
  }

  async submitSpeech(
    itemId: string,
    observation: SpeechObservation,
  ): Promise<AssessmentRuntimeState> {
    this.#requireCurrentItem(itemId, 'speech')
    return this.#submit(
      itemId,
      {
        kind: 'speech',
        observation,
        durationMs: this.#currentItemDuration(),
      },
      observation.status === 'scored' ? 'recorded' : 'unscorable',
    )
  }

  async reportRecognitionFailure(
    itemId: string,
    observation: FailedSpeechObservation,
  ): Promise<AssessmentRuntimeState> {
    return this.submitSpeech(itemId, observation)
  }

  async reportItemFailure(
    itemId: string,
    reason: Exclude<NonSpeechFailureReason, 'user-skipped'>,
  ): Promise<AssessmentRuntimeState> {
    this.#requireCurrentItem(itemId)
    return this.#submit(
      itemId,
      {
        kind: 'unscorable',
        reason,
        durationMs: this.#currentItemDuration(),
      },
      'unscorable',
    )
  }

  async skip(itemId: string): Promise<AssessmentRuntimeState> {
    const item = this.#requireCurrentItem(itemId)
    if (item.kind === 'choice') {
      return this.#submit(
        itemId,
        {
          kind: 'choice',
          selectedOptionId: null,
          durationMs: this.#currentItemDuration(),
        },
        'skipped',
        'user-skipped',
      )
    }
    return this.#submit(
      itemId,
      {
        kind: 'unscorable',
        reason: 'user-skipped',
        durationMs: this.#currentItemDuration(),
      },
      'skipped',
      'user-skipped',
    )
  }

  async continue(): Promise<AssessmentRuntimeState> {
    this.#requireLifecycle('feedback')
    const now = this.#readNow()
    this.#snapshot = {
      ...this.#snapshot,
      lifecycle: 'active',
      lastSubmission: null,
      updatedAt: now.iso,
    }
    return this.#loadNextItem(now)
  }

  pause(): AssessmentRuntimeState {
    if (
      this.#snapshot.lifecycle !== 'active' &&
      this.#snapshot.lifecycle !== 'feedback'
    ) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        'Only an active assessment can be paused.',
      )
    }
    const now = this.#readNow()
    const activeElapsedMs = this.#activeElapsed(now.ms)
    const resumeTo = this.#snapshot.lifecycle
    this.#snapshot = {
      ...this.#snapshot,
      lifecycle: 'paused',
      resumeTo,
      activeElapsedMs,
      updatedAt: now.iso,
    }
    this.#activeSinceMs = null
    return this.#buildState(activeElapsedMs)
  }

  async resume(): Promise<AssessmentRuntimeState> {
    this.#requireLifecycle('paused')
    const now = this.#readNow()
    const resumeTo = this.#snapshot.resumeTo
    if (!resumeTo) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        'Paused assessment has no resumable state.',
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

  async stop(): Promise<AssessmentRuntimeState> {
    if (
      this.#snapshot.lifecycle !== 'active' &&
      this.#snapshot.lifecycle !== 'feedback' &&
      this.#snapshot.lifecycle !== 'paused'
    ) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        'Assessment cannot be stopped from its current state.',
      )
    }
    const now = this.#readNow()
    const activeElapsedMs = this.#activeElapsed(now.ms)
    const session = stopAssessment(this.#snapshot.session)
    return this.#complete(session, now, activeElapsedMs)
  }

  async #submit(
    itemId: string,
    submission: Parameters<
      typeof submitAssessmentResponse
    >[0]['submission'],
    status: AssessmentSubmissionSummary['status'],
    explicitFailureReason?: NonSpeechFailureReason,
  ): Promise<AssessmentRuntimeState> {
    const now = this.#readNow()
    const result = submitAssessmentResponse({
      session: this.#snapshot.session,
      bank: this.#bank,
      submission,
      submittedAt: now.iso,
    })
    const lastSubmission: AssessmentSubmissionSummary = {
      itemId,
      status,
      failureReason:
        explicitFailureReason ?? result.scoring.failureReason,
      fallback: result.scoring.fallback,
    }
    this.#snapshot = {
      ...this.#snapshot,
      lifecycle: 'feedback',
      session: result.session,
      selectedOptionId: null,
      itemStartedAtActiveMs: null,
      lastSubmission,
      updatedAt: now.iso,
    }
    return this.#buildState(this.#activeElapsed(now.ms))
  }

  async #loadNextItem(now: {
    readonly iso: string
    readonly ms: number
  }): Promise<AssessmentRuntimeState> {
    const activeElapsedMs = this.#activeElapsed(now.ms)
    const next = getNextAssessmentItem(
      this.#snapshot.session,
      this.#bank,
      this.#engineNow(activeElapsedMs),
    )
    if (!next.item) {
      if (next.session.status === 'in-progress') {
        throw new AssessmentRuntimeError(
          'invalid-transition',
          'Assessment engine returned no item without completing.',
        )
      }
      return this.#complete(next.session, now, activeElapsedMs)
    }
    this.#snapshot = {
      ...this.#snapshot,
      lifecycle: 'active',
      session: next.session,
      selectedOptionId: null,
      itemStartedAtActiveMs: activeElapsedMs,
      lastSubmission: null,
      updatedAt: now.iso,
    }
    return this.#buildState(activeElapsedMs)
  }

  async #complete(
    session: AssessmentSession,
    now: {
      readonly iso: string
      readonly ms: number
    },
    activeElapsedMs: number,
  ): Promise<AssessmentRuntimeState> {
    const profile = buildAbilityProfile({
      session,
      completedAt: now.iso,
      durationSeconds: activeElapsedMs / 1000,
    })
    this.#snapshot = {
      ...this.#snapshot,
      lifecycle: 'completed',
      resumeTo: null,
      session,
      selectedOptionId: null,
      activeElapsedMs,
      itemStartedAtActiveMs: null,
      lastSubmission: null,
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

  #requireLifecycle(expected: AssessmentRuntimeLifecycle): void {
    if (this.#snapshot.lifecycle !== expected) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        `Expected ${expected}, received ${this.#snapshot.lifecycle}.`,
      )
    }
  }

  #requireCurrentItem(
    itemId: string,
    expectedKind?: AssessmentItem['kind'],
  ): AssessmentItem {
    this.#requireLifecycle('active')
    const currentItemId = this.#snapshot.session.currentItemId
    if (currentItemId !== itemId) {
      throw new AssessmentRuntimeError(
        'stale-item',
        `Item ${itemId} is no longer current.`,
      )
    }
    const item = this.#bank.items.find(
      (candidate) => candidate.id === currentItemId,
    )
    if (!item || (expectedKind && item.kind !== expectedKind)) {
      throw new AssessmentRuntimeError(
        'stale-item',
        `Item ${itemId} is incompatible with this action.`,
      )
    }
    return item
  }

  #currentItemDuration(): number {
    const startedAt = this.#snapshot.itemStartedAtActiveMs
    if (startedAt === null) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        'Current item has no active start time.',
      )
    }
    const now = this.#readNow()
    return Math.max(
      0,
      Math.round(this.#activeElapsed(now.ms) - startedAt),
    )
  }

  #activeElapsed(nowMs: number): number {
    if (this.#activeSinceMs === null) {
      return this.#snapshot.activeElapsedMs
    }
    if (nowMs < this.#activeSinceMs) {
      throw new AssessmentRuntimeError(
        'clock-invalid',
        'Assessment clock moved backwards.',
      )
    }
    return (
      this.#snapshot.activeElapsedMs +
      (nowMs - this.#activeSinceMs)
    )
  }

  #engineNow(activeElapsedMs: number): string {
    return new Date(
      timestamp(this.#snapshot.session.startedAt) + activeElapsedMs,
    ).toISOString()
  }

  #readNow(): { readonly iso: string; readonly ms: number } {
    const iso = this.#now()
    return { iso, ms: timestamp(iso) }
  }

  #currentItem(): AssessmentItem | null {
    const currentItemId = this.#snapshot.session.currentItemId
    if (!currentItemId) {
      return null
    }
    return (
      this.#bank.items.find((item) => item.id === currentItemId) ??
      null
    )
  }

  #progress(activeElapsedMs: number): AssessmentRuntimeProgress {
    const phase = this.#snapshot.session.phase
    const domain: AbilityDomain | null =
      phase === 'complete' ? null : phase
    const estimate = domain
      ? this.#snapshot.session.estimates[domain]
      : null
    const rule = domain ? DOMAIN_RULES[domain] : null
    return {
      phase,
      domain,
      elapsedSeconds: Math.round(activeElapsedMs / 1000),
      targetMinimumSeconds:
        ASSESSMENT_TIMING.targetMinimumMs / 1000,
      hardLimitSeconds: ASSESSMENT_TIMING.hardLimitMs / 1000,
      totalAttempted: this.#snapshot.session.responses.length,
      totalMaximum: totalMaximumItems(),
      domainAttempted: estimate?.attemptedCount ?? 0,
      domainMinimum: rule?.minimumScored ?? 0,
      domainMaximum: rule?.maximumAttempts ?? 0,
    }
  }

  #actions(item: AssessmentItem | null): AssessmentRuntimeActions {
    const lifecycle = this.#snapshot.lifecycle
    return {
      canStart: lifecycle === 'intro',
      canSelectChoice:
        lifecycle === 'active' && item?.kind === 'choice',
      canSubmitChoice:
        lifecycle === 'active' &&
        item?.kind === 'choice' &&
        this.#snapshot.selectedOptionId !== null,
      canSubmitSpeech:
        lifecycle === 'active' && item?.kind === 'speech',
      canReportItemFailure:
        lifecycle === 'active' && item !== null,
      canSkip: lifecycle === 'active' && item !== null,
      canContinue: lifecycle === 'feedback',
      canPause:
        lifecycle === 'active' || lifecycle === 'feedback',
      canResume: lifecycle === 'paused',
      canStop:
        lifecycle === 'active' ||
        lifecycle === 'feedback' ||
        lifecycle === 'paused',
    }
  }

  #buildState(activeElapsedMs: number): AssessmentRuntimeState {
    const item = this.#currentItem()
    return {
      schemaVersion: ASSESSMENT_RUNTIME_SCHEMA_VERSION,
      lifecycle: this.#snapshot.lifecycle,
      sessionId: this.#snapshot.session.id,
      phase: this.#snapshot.session.phase,
      item: item ? toPublicAssessmentItem(item) : null,
      selectedOptionId: this.#snapshot.selectedOptionId,
      progress: this.#progress(activeElapsedMs),
      lastSubmission: this.#snapshot.lastSubmission,
      profile: this.#snapshot.profile,
      actions: this.#actions(item),
    }
  }
}

export function createPlacementAssessmentRuntime(
  options: PlacementAssessmentRuntimeOptions = {},
): PlacementAssessmentRuntime {
  return PlacementAssessmentRuntime.create(options)
}

export function restorePlacementAssessmentRuntime(
  options: RestorePlacementAssessmentRuntimeOptions,
): PlacementAssessmentRuntime {
  return PlacementAssessmentRuntime.restore(options)
}
