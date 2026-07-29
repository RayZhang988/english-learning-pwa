import { AppError } from '../../core/index.ts'
import {
  parseExtraTrainingEvent,
  type ExtraTrainingTimingSegmentRecordedEvent,
  type LearningTimingPhase,
  type LearningTimingSegmentReason,
} from '../../learning-engine/index.ts'
import {
  EFFECTIVE_TIMING_SNAPSHOT_SCHEMA_VERSION,
  type EffectiveTimingPhaseDeclaration,
  type EffectiveTimingSessionSnapshot,
  type EffectiveTimingSnapshotStore,
  type PersistedTimingOpenSegment,
} from '../../platform/index.ts'
import type { NamespaceStore } from '../../storage/index.ts'
import { assertLocalDateValue } from './local-date.ts'

export const EXTRA_TRAINING_EFFECTIVE_TIMING_STORAGE_NAMESPACE =
  'app.extra-training-effective-timing'
export const EXTRA_TRAINING_EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION =
  1

export interface ExtraTrainingEffectiveTimingIdentity {
  readonly sessionId: string
  readonly localDate: string
  readonly domain: 'vocabulary' | 'listening' | 'speaking'
  readonly targetModuleId: 'vocabulary' | 'listening' | 'speaking'
  readonly mode: 'learn'
}

export type ExtraTrainingEffectiveTimingSnapshot =
  EffectiveTimingSessionSnapshot<
    ExtraTrainingEffectiveTimingIdentity,
    ExtraTrainingTimingSegmentRecordedEvent
  >

export type ExtraTrainingEffectiveTimingSnapshotStore =
  EffectiveTimingSnapshotStore<
    ExtraTrainingEffectiveTimingIdentity,
    ExtraTrainingTimingSegmentRecordedEvent
  >

const ACTIVE_PHASE_REASONS: Readonly<
  Record<string, LearningTimingSegmentReason>
> = {
  answering: 'active-answering',
  'audio-listening': 'active-audio-listening',
  recording: 'active-recording',
  playback: 'active-playback',
  feedback: 'active-feedback',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function requireString(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`)
  }
}

function assertIdentity(
  value: unknown,
  label: string,
): asserts value is ExtraTrainingEffectiveTimingIdentity {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  if ('planId' in value || 'taskId' in value) {
    throw new TypeError(
      `${label} must not contain a daily plan/task identity.`,
    )
  }
  requireString(value.sessionId, `${label}.sessionId`)
  requireString(value.localDate, `${label}.localDate`)
  assertLocalDateValue(value.localDate, `${label}.localDate`)
  if (
    value.domain !== 'vocabulary' &&
    value.domain !== 'listening' &&
    value.domain !== 'speaking'
  ) {
    throw new TypeError(`${label}.domain is unsupported.`)
  }
  if (value.targetModuleId !== value.domain) {
    throw new TypeError(
      `${label}.targetModuleId must match its domain.`,
    )
  }
  if (value.mode !== 'learn') {
    throw new TypeError(`${label}.mode must be learn.`)
  }
}

function sameIdentity(
  left: ExtraTrainingEffectiveTimingIdentity,
  right: ExtraTrainingEffectiveTimingIdentity,
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.localDate === right.localDate &&
    left.domain === right.domain &&
    left.targetModuleId === right.targetModuleId &&
    left.mode === right.mode
  )
}

function validDeclaration(
  phase: unknown,
  reason: unknown,
): phase is EffectiveTimingPhaseDeclaration['phase'] {
  if (
    typeof phase !== 'string' ||
    typeof reason !== 'string'
  ) {
    return false
  }
  if (ACTIVE_PHASE_REASONS[phase] === reason) {
    return true
  }
  return (
    (phase === 'loading' &&
      (reason === 'content-loading' ||
        reason === 'media-loading')) ||
    (phase === 'permission-wait' &&
      reason === 'permission-wait') ||
    (phase === 'network-wait' && reason === 'network-wait') ||
    (phase === 'paused' && reason === 'user-paused')
  )
}

function assertDeclaration(
  value: unknown,
): asserts value is EffectiveTimingPhaseDeclaration {
  if (
    !isRecord(value) ||
    !validDeclaration(value.phase, value.reason)
  ) {
    throw new TypeError(
      'declaration has an unsupported phase/reason combination.',
    )
  }
}

function validPersistedOpenSegment(
  phase: unknown,
  reason: unknown,
): phase is LearningTimingPhase {
  return (
    validDeclaration(phase, reason) ||
    (phase === 'idle' && reason === 'idle-timeout')
  )
}

function assertOpenSegment(
  value: unknown,
): asserts value is PersistedTimingOpenSegment {
  if (
    !isRecord(value) ||
    !validPersistedOpenSegment(value.phase, value.reason) ||
    value.visibility !== 'foreground'
  ) {
    throw new TypeError(
      'openSegment has an unsupported timing state.',
    )
  }
  requireString(value.startedAt, 'openSegment.startedAt')
  if (!Number.isFinite(Date.parse(value.startedAt))) {
    throw new TypeError('openSegment.startedAt must be ISO 8601.')
  }
}

function assertSnapshot(
  value: unknown,
): asserts value is ExtraTrainingEffectiveTimingSnapshot {
  if (
    !isRecord(value) ||
    value.schemaVersion !==
      EFFECTIVE_TIMING_SNAPSHOT_SCHEMA_VERSION
  ) {
    throw new TypeError(
      'Stored extra-training timing session is not schema version 1.',
    )
  }
  requireString(value.sessionId, 'sessionId')
  assertIdentity(value.identity, 'identity')
  if (value.declaration !== null) {
    assertDeclaration(value.declaration)
  }
  if (value.openSegment !== null) {
    assertOpenSegment(value.openSegment)
    if (value.declaration === null) {
      throw new TypeError(
        'openSegment requires a declared module phase.',
      )
    }
    const openMatchesDeclaration =
      (value.openSegment.phase === value.declaration.phase &&
        value.openSegment.reason === value.declaration.reason) ||
      (value.openSegment.phase === 'idle' &&
        value.openSegment.reason === 'idle-timeout' &&
        (value.declaration.reason === 'active-answering' ||
          value.declaration.reason === 'active-feedback'))
    if (!openMatchesDeclaration) {
      throw new TypeError(
        'openSegment does not match the declared module phase.',
      )
    }
  }
  if (typeof value.suspended !== 'boolean') {
    throw new TypeError('suspended must be boolean.')
  }
  const openReason = value.openSegment?.reason
  const openIsActive =
    openReason === 'active-answering' ||
    openReason === 'active-audio-listening' ||
    openReason === 'active-recording' ||
    openReason === 'active-playback' ||
    openReason === 'active-feedback'
  if (
    (value.openSegment === null && !value.suspended) ||
    (value.openSegment !== null &&
      value.suspended === openIsActive)
  ) {
    throw new TypeError(
      'suspended does not match the persisted open segment.',
    )
  }
  if (
    typeof value.nextEventSequence !== 'number' ||
    !Number.isSafeInteger(value.nextEventSequence) ||
    value.nextEventSequence < 1
  ) {
    throw new TypeError(
      'nextEventSequence must be a positive integer.',
    )
  }
  if (!Array.isArray(value.pendingEvents)) {
    throw new TypeError('pendingEvents must be an array.')
  }
  const eventIds = new Set<string>()
  const eventIdPrefix = `extra-timing:${value.sessionId}:`
  let previousSequence = 0
  for (const pending of value.pendingEvents) {
    const event = parseExtraTrainingEvent(pending)
    if (
      event.type !==
      'learning.extra-training.timing.segment.recorded.v1'
    ) {
      throw new TypeError(
        'pendingEvents may contain extra-training timing events only.',
      )
    }
    if (
      'planId' in event.payload ||
      'taskId' in event.payload
    ) {
      throw new TypeError(
        'Extra-training timing events must not contain planId/taskId.',
      )
    }
    if (eventIds.has(event.id)) {
      throw new TypeError('pendingEvents contains duplicate IDs.')
    }
    const sequenceText = event.id.startsWith(eventIdPrefix)
      ? event.id.slice(eventIdPrefix.length)
      : ''
    const sequence = /^\d{6,}$/.test(sequenceText)
      ? Number(sequenceText)
      : Number.NaN
    if (
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      sequence >= value.nextEventSequence
    ) {
      throw new TypeError(
        'pending timing event ID does not belong to this session sequence.',
      )
    }
    if (sequence <= previousSequence) {
      throw new TypeError(
        'pending timing events are not in sequence order.',
      )
    }
    previousSequence = sequence
    if (event.occurredAt !== event.payload.endedAt) {
      throw new TypeError(
        'pending timing event occurredAt must match endedAt.',
      )
    }
    const eventIdentity: ExtraTrainingEffectiveTimingIdentity = {
      sessionId: event.payload.sessionId,
      localDate: event.payload.localDate,
      domain: event.payload.domain,
      targetModuleId: event.payload.targetModuleId,
      mode: event.payload.mode,
    }
    if (!sameIdentity(value.identity, eventIdentity)) {
      throw new TypeError(
        'pending timing event identity does not match its session.',
      )
    }
    eventIds.add(event.id)
  }
  requireString(value.updatedAt, 'updatedAt')
  if (!Number.isFinite(Date.parse(value.updatedAt))) {
    throw new TypeError('updatedAt must be ISO 8601.')
  }
}

export function extraTrainingEffectiveTimingSnapshotKey(
  identity: Pick<ExtraTrainingEffectiveTimingIdentity, 'sessionId'>,
): string {
  return `session:${encodeURIComponent(identity.sessionId)}`
}

export class ExtraTrainingEffectiveTimingSnapshotRepository
  implements ExtraTrainingEffectiveTimingSnapshotStore
{
  readonly #store: NamespaceStore

  constructor(store: NamespaceStore) {
    this.#store = store
  }

  async load(
    identity: ExtraTrainingEffectiveTimingIdentity,
  ): Promise<ExtraTrainingEffectiveTimingSnapshot | undefined> {
    const key = extraTrainingEffectiveTimingSnapshotKey(identity)
    const record = await this.#store.get<unknown>(key)
    if (!record) {
      return undefined
    }
    if (
      record.schemaVersion !==
      EXTRA_TRAINING_EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION
    ) {
      throw this.#snapshotError(
        identity,
        key,
        new TypeError(
          `Unsupported extra-training timing snapshot version: ${record.schemaVersion}.`,
        ),
      )
    }
    try {
      assertSnapshot(record.value)
      if (!sameIdentity(record.value.identity, identity)) {
        throw new TypeError(
          'Stored timing identity does not match the extra-training session.',
        )
      }
      return record.value
    } catch (error) {
      throw this.#snapshotError(identity, key, error)
    }
  }

  async save(
    snapshot: ExtraTrainingEffectiveTimingSnapshot,
  ): Promise<void> {
    assertSnapshot(snapshot)
    await this.#store.put(
      extraTrainingEffectiveTimingSnapshotKey(snapshot.identity),
      snapshot,
      EXTRA_TRAINING_EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION,
    )
  }

  async delete(
    identity: ExtraTrainingEffectiveTimingIdentity,
  ): Promise<void> {
    await this.#store.delete(
      extraTrainingEffectiveTimingSnapshotKey(identity),
    )
  }

  #snapshotError(
    identity: ExtraTrainingEffectiveTimingIdentity,
    key: string,
    cause: unknown,
  ): AppError {
    return new AppError(
      'schema_incompatible',
      '本地额外训练计时会话与当前会话不匹配，已停止计时以避免污染每日计划。',
      {
        cause,
        recoverable: true,
        details: {
          namespace:
            EXTRA_TRAINING_EFFECTIVE_TIMING_STORAGE_NAMESPACE,
          key,
          sessionId: identity.sessionId,
        },
      },
    )
  }
}
