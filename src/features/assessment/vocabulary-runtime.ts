import { vocabularyPlacementBankV2 } from '../../../content/assessment/placement-bank.v2.ts'
import { confidenceBand } from './confidence.ts'
import { AssessmentRuntimeError } from './runtime.ts'
import {
  createVocabularyAssessmentSessionV2,
  expireVocabularyAssessmentV2,
  getNextVocabularyAssessmentItemV2,
  stopVocabularyAssessmentV2,
  submitVocabularyAssessmentResponseV2,
} from './vocabulary-engine.ts'
import {
  migrateAssessmentRuntimeSnapshotV1ToVocabularyV2,
} from './vocabulary-migration.ts'
import { buildVocabularyAbilityProfileV2 } from './vocabulary-profile.ts'
import { VOCABULARY_ASSESSMENT_RULES_V2 } from './vocabulary-rules.ts'
import {
  parseVocabularyAssessmentRuntimeSnapshotV2,
} from './vocabulary-snapshot.ts'
import type {
  AbilityProfileV2,
  PublicVocabularyAssessmentItemV2,
  VocabularyAbilityProfileCompletionHandler,
  VocabularyAssessmentBankV2,
  VocabularyAssessmentLifecycleV2,
  VocabularyAssessmentRuntimeSnapshotV2,
  VocabularyAssessmentRuntimeStateV2,
  VocabularySubmissionSummaryV2,
} from './vocabulary-types.ts'

export const VOCABULARY_ASSESSMENT_RUNTIME_SCHEMA_VERSION = 2 as const
export const VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY =
  'active-vocabulary-assessment-runtime-v2'
export const LEGACY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY =
  'active-assessment-runtime-v1'

export interface VocabularyPlacementRuntimeOptions {
  readonly bank?: VocabularyAssessmentBankV2
  readonly now?: () => string
  readonly createId?: () => string
  readonly onCompleted?: VocabularyAbilityProfileCompletionHandler
}

export interface RestoreVocabularyPlacementRuntimeOptions
  extends VocabularyPlacementRuntimeOptions {
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
      'Vocabulary assessment clock returned an invalid timestamp.',
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

export class VocabularyPlacementRuntime {
  readonly #bank: VocabularyAssessmentBankV2
  readonly #now: () => string
  readonly #onCompleted?: VocabularyAbilityProfileCompletionHandler
  #snapshot: VocabularyAssessmentRuntimeSnapshotV2
  #activeSinceMs: number | null = null
  #completionDelivered: boolean

  private constructor(
    options: VocabularyPlacementRuntimeOptions,
    restored?: VocabularyAssessmentRuntimeSnapshotV2,
  ) {
    this.#bank = options.bank ?? vocabularyPlacementBankV2
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
    const session = createVocabularyAssessmentSessionV2({
      id: createId(),
      startedAt: now.iso,
      bank: this.#bank,
    })
    this.#snapshot = {
      schemaVersion: VOCABULARY_ASSESSMENT_RUNTIME_SCHEMA_VERSION,
      assessmentKind: 'adaptive-vocabulary',
      bankId: this.#bank.id,
      lifecycle: 'intro',
      resumeTo: null,
      session,
      selectedOptionId: null,
      activeElapsedMs: 0,
      itemStartedAtActiveMs: null,
      lastSubmission: null,
      profile: null,
      legacySource: null,
      updatedAt: now.iso,
    }
    this.#completionDelivered = false
  }

  static create(
    options: VocabularyPlacementRuntimeOptions = {},
  ): VocabularyPlacementRuntime {
    return new VocabularyPlacementRuntime(options)
  }

  static restore(
    options: RestoreVocabularyPlacementRuntimeOptions,
  ): VocabularyPlacementRuntime {
    const bank = options.bank ?? vocabularyPlacementBankV2
    const nowProvider = options.now ?? defaultNow
    const updatedAt = nowProvider()
    const restored =
      snapshotVersion(options.snapshot) === 1
        ? migrateAssessmentRuntimeSnapshotV1ToVocabularyV2({
            snapshot: options.snapshot,
            bank,
            updatedAt,
          })
        : parseVocabularyAssessmentRuntimeSnapshotV2(
            options.snapshot,
            bank,
          )
    return new VocabularyPlacementRuntime(
      { ...options, bank, now: nowProvider },
      restored,
    )
  }

  get state(): VocabularyAssessmentRuntimeStateV2 {
    const now = this.#readNow()
    return this.#buildState(this.#activeElapsed(now.ms))
  }

  get profile(): AbilityProfileV2 | null {
    return this.#snapshot.profile
  }

  toSnapshot(): VocabularyAssessmentRuntimeSnapshotV2 {
    const now = this.#readNow()
    return structuredClone({
      ...this.#snapshot,
      activeElapsedMs: this.#activeElapsed(now.ms),
      updatedAt: now.iso,
    })
  }

  async start(): Promise<VocabularyAssessmentRuntimeStateV2> {
    this.#requireLifecycle('intro')
    const now = this.#readNow()
    const session = createVocabularyAssessmentSessionV2({
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
  ): VocabularyAssessmentRuntimeStateV2 {
    const item = this.#requireCurrentItem(itemId)
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

  async submitChoice(
    itemId: string,
  ): Promise<VocabularyAssessmentRuntimeStateV2> {
    this.#requireCurrentItem(itemId)
    if (this.#snapshot.selectedOptionId === null) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        'A choice must be selected before submission.',
      )
    }
    return this.#submit(
      itemId,
      this.#snapshot.selectedOptionId,
      'recorded',
    )
  }

  async submitUncertain(
    itemId: string,
  ): Promise<VocabularyAssessmentRuntimeStateV2> {
    this.#requireCurrentItem(itemId)
    return this.#submit(itemId, null, 'uncertain')
  }

  async skip(
    itemId: string,
  ): Promise<VocabularyAssessmentRuntimeStateV2> {
    return this.submitUncertain(itemId)
  }

  async continue(): Promise<VocabularyAssessmentRuntimeStateV2> {
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

  pause(): VocabularyAssessmentRuntimeStateV2 {
    if (
      this.#snapshot.lifecycle !== 'active' &&
      this.#snapshot.lifecycle !== 'feedback'
    ) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        'Only an active vocabulary assessment can be paused.',
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

  async resume(): Promise<VocabularyAssessmentRuntimeStateV2> {
    this.#requireLifecycle('paused')
    const now = this.#readNow()
    const resumeTo = this.#snapshot.resumeTo
    if (!resumeTo) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        'Paused vocabulary assessment has no resumable state.',
      )
    }
    this.#snapshot = {
      ...this.#snapshot,
      lifecycle: resumeTo,
      resumeTo: null,
      updatedAt: now.iso,
    }
    this.#activeSinceMs = now.ms
    if (
      resumeTo === 'active' &&
      this.#snapshot.session.currentItemId === null
    ) {
      return this.#loadNextItem(now)
    }
    return this.#buildState(this.#snapshot.activeElapsedMs)
  }

  async stop(): Promise<VocabularyAssessmentRuntimeStateV2> {
    if (
      this.#snapshot.lifecycle !== 'active' &&
      this.#snapshot.lifecycle !== 'feedback' &&
      this.#snapshot.lifecycle !== 'paused'
    ) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        'Vocabulary assessment cannot be stopped now.',
      )
    }
    const now = this.#readNow()
    const activeElapsedMs = this.#activeElapsed(now.ms)
    return this.#complete(
      stopVocabularyAssessmentV2(this.#snapshot.session),
      now,
      activeElapsedMs,
    )
  }

  async #submit(
    itemId: string,
    selectedOptionId: string | null,
    status: VocabularySubmissionSummaryV2['status'],
  ): Promise<VocabularyAssessmentRuntimeStateV2> {
    const now = this.#readNow()
    const activeElapsedMs = this.#activeElapsed(now.ms)
    if (
      activeElapsedMs >=
      VOCABULARY_ASSESSMENT_RULES_V2.hardLimitMs
    ) {
      return this.#complete(
        expireVocabularyAssessmentV2(this.#snapshot.session),
        now,
        VOCABULARY_ASSESSMENT_RULES_V2.hardLimitMs,
      )
    }
    const result = submitVocabularyAssessmentResponseV2({
      session: this.#snapshot.session,
      bank: this.#bank,
      submission: {
        selectedOptionId,
        durationMs: this.#currentItemDuration(now.ms),
      },
      submittedAt: now.iso,
    })
    this.#snapshot = {
      ...this.#snapshot,
      lifecycle: 'feedback',
      session: result.session,
      selectedOptionId: null,
      itemStartedAtActiveMs: null,
      lastSubmission: {
        itemId,
        status,
      },
      updatedAt: now.iso,
    }
    return this.#buildState(this.#activeElapsed(now.ms))
  }

  async #loadNextItem(now: {
    readonly iso: string
    readonly ms: number
  }): Promise<VocabularyAssessmentRuntimeStateV2> {
    const activeElapsedMs = this.#activeElapsed(now.ms)
    const next = getNextVocabularyAssessmentItemV2(
      this.#snapshot.session,
      this.#bank,
      this.#engineNow(activeElapsedMs),
    )
    if (!next.item) {
      if (next.session.status === 'in-progress') {
        throw new AssessmentRuntimeError(
          'invalid-transition',
          'Vocabulary engine returned no item without completing.',
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
    session: VocabularyAssessmentRuntimeSnapshotV2['session'],
    now: {
      readonly iso: string
      readonly ms: number
    },
    activeElapsedMs: number,
  ): Promise<VocabularyAssessmentRuntimeStateV2> {
    const profile = buildVocabularyAbilityProfileV2({
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

  #requireLifecycle(expected: VocabularyAssessmentLifecycleV2): void {
    if (this.#snapshot.lifecycle !== expected) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        `Expected ${expected}, received ${this.#snapshot.lifecycle}.`,
      )
    }
  }

  #requireCurrentItem(
    itemId: string,
  ): PublicVocabularyAssessmentItemV2 {
    this.#requireLifecycle('active')
    if (this.#snapshot.session.currentItemId !== itemId) {
      throw new AssessmentRuntimeError(
        'stale-item',
        `Item ${itemId} is no longer current.`,
      )
    }
    const item = this.#bank.items.find(
      (candidate) => candidate.id === itemId,
    )
    if (!item) {
      throw new AssessmentRuntimeError(
        'stale-item',
        `Item ${itemId} is unavailable.`,
      )
    }
    const publicItem = { ...item } as unknown as Record<string, unknown>
    Reflect.deleteProperty(publicItem, 'scoring')
    return publicItem as unknown as PublicVocabularyAssessmentItemV2
  }

  #currentItemDuration(nowMs: number): number {
    const startedAt = this.#snapshot.itemStartedAtActiveMs
    if (startedAt === null) {
      throw new AssessmentRuntimeError(
        'invalid-transition',
        'Current item has no active start time.',
      )
    }
    return Math.max(
      0,
      Math.round(this.#activeElapsed(nowMs) - startedAt),
    )
  }

  #activeElapsed(nowMs: number): number {
    if (this.#activeSinceMs === null) {
      return this.#snapshot.activeElapsedMs
    }
    if (nowMs < this.#activeSinceMs) {
      throw new AssessmentRuntimeError(
        'clock-invalid',
        'Vocabulary assessment clock moved backwards.',
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

  #currentItem(): PublicVocabularyAssessmentItemV2 | null {
    const itemId = this.#snapshot.session.currentItemId
    if (!itemId) {
      return null
    }
    const item = this.#bank.items.find(
      (candidate) => candidate.id === itemId,
    )
    if (!item) {
      return null
    }
    const publicItem = { ...item } as unknown as Record<string, unknown>
    Reflect.deleteProperty(publicItem, 'scoring')
    return publicItem as unknown as PublicVocabularyAssessmentItemV2
  }

  #buildState(
    activeElapsedMs: number,
  ): VocabularyAssessmentRuntimeStateV2 {
    const item = this.#currentItem()
    const estimate = this.#snapshot.session.estimate
    const margin = Math.max(0.5, estimate.standardError * 1.1)
    const lifecycle = this.#snapshot.lifecycle
    return {
      schemaVersion: 2,
      assessmentKind: 'adaptive-vocabulary',
      lifecycle,
      sessionId: this.#snapshot.session.id,
      phase: this.#snapshot.session.phase,
      item,
      selectedOptionId: this.#snapshot.selectedOptionId,
      progress: {
        phase: this.#snapshot.session.phase,
        elapsedSeconds: Math.round(activeElapsedMs / 1000),
        targetMinimumSeconds:
          VOCABULARY_ASSESSMENT_RULES_V2.targetMinimumMs / 1000,
        targetMaximumSeconds:
          VOCABULARY_ASSESSMENT_RULES_V2.targetMaximumMs / 1000,
        hardLimitSeconds:
          VOCABULARY_ASSESSMENT_RULES_V2.hardLimitMs / 1000,
        attempted: estimate.attemptedCount,
        minimumEvidence:
          VOCABULARY_ASSESSMENT_RULES_V2.minimumReliableEvidence,
        maximumAttempts:
          VOCABULARY_ASSESSMENT_RULES_V2.maximumAttempts,
        estimatedLevel: estimate.level,
        estimatedRange: {
          lower: Math.max(0, estimate.level - margin),
          upper: Math.min(12, estimate.level + margin),
        },
        confidence: estimate.confidence,
        confidenceBand: confidenceBand(estimate.confidence),
      },
      lastSubmission: this.#snapshot.lastSubmission,
      profile: this.#snapshot.profile,
      actions: {
        canStart: lifecycle === 'intro',
        canSelectChoice: lifecycle === 'active' && item !== null,
        canSubmitChoice:
          lifecycle === 'active' &&
          item !== null &&
          this.#snapshot.selectedOptionId !== null,
        canMarkUncertain: lifecycle === 'active' && item !== null,
        canSkip: lifecycle === 'active' && item !== null,
        canContinue: lifecycle === 'feedback',
        canPause:
          lifecycle === 'active' || lifecycle === 'feedback',
        canResume: lifecycle === 'paused',
        canStop:
          lifecycle === 'active' ||
          lifecycle === 'feedback' ||
          lifecycle === 'paused',
      },
    }
  }
}

export function createVocabularyPlacementRuntime(
  options: VocabularyPlacementRuntimeOptions = {},
): VocabularyPlacementRuntime {
  return VocabularyPlacementRuntime.create(options)
}

export function restoreVocabularyPlacementRuntime(
  options: RestoreVocabularyPlacementRuntimeOptions,
): VocabularyPlacementRuntime {
  return VocabularyPlacementRuntime.restore(options)
}
