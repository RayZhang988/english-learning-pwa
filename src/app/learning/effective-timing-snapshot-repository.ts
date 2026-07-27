import { AppError } from '../../core/index.ts'
import {
  parseLearningEvent,
  type LearningTimingPhase,
  type LearningTimingSegmentReason,
} from '../../learning-engine/index.ts'
import {
  EFFECTIVE_TIMING_SNAPSHOT_SCHEMA_VERSION,
  type EffectiveTimingPhaseDeclaration,
  type EffectiveTimingSessionSnapshot,
  type EffectiveTimingSnapshotStore,
  type EffectiveTimingTaskIdentity,
  type PersistedTimingOpenSegment,
} from '../../platform/index.ts'
import type { NamespaceStore } from '../../storage/index.ts'
import { assertLocalDateValue } from './local-date.ts'

export const EFFECTIVE_TIMING_STORAGE_NAMESPACE =
  'app.effective-timing'
export const EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION = 1

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
): asserts value is EffectiveTimingTaskIdentity {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  requireString(value.planId, `${label}.planId`)
  requireString(value.taskId, `${label}.taskId`)
  requireString(value.learningUnitId, `${label}.learningUnitId`)
  requireString(value.contentRef, `${label}.contentRef`)
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
  if (
    value.mode !== 'learn' &&
    value.mode !== 'calibration' &&
    value.mode !== 'review' &&
    value.mode !== 'retry'
  ) {
    throw new TypeError(`${label}.mode is unsupported.`)
  }
}

function sameIdentity(
  left: EffectiveTimingTaskIdentity,
  right: EffectiveTimingTaskIdentity,
): boolean {
  return (
    left.planId === right.planId &&
    left.taskId === right.taskId &&
    left.learningUnitId === right.learningUnitId &&
    left.contentRef === right.contentRef &&
    left.domain === right.domain &&
    left.targetModuleId === right.targetModuleId &&
    left.localDate === right.localDate &&
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
  label: string,
): asserts value is EffectiveTimingPhaseDeclaration {
  if (
    !isRecord(value) ||
    !validDeclaration(value.phase, value.reason)
  ) {
    throw new TypeError(
      `${label} has an unsupported phase/reason combination.`,
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
): asserts value is EffectiveTimingSessionSnapshot {
  if (
    !isRecord(value) ||
    value.schemaVersion !==
      EFFECTIVE_TIMING_SNAPSHOT_SCHEMA_VERSION
  ) {
    throw new TypeError(
      'Stored timing session is not schema version 1.',
    )
  }
  requireString(value.sessionId, 'sessionId')
  assertIdentity(value.identity, 'identity')
  if (value.declaration !== null) {
    assertDeclaration(value.declaration, 'declaration')
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
  const eventIdPrefix = `timing:${value.sessionId}:`
  let previousSequence = 0
  for (const pending of value.pendingEvents) {
    const event = parseLearningEvent(pending)
    if (event.type !== 'learning.timing.segment.recorded.v1') {
      throw new TypeError(
        'pendingEvents may contain timing segment events only.',
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
    if (
      event.occurredAt !== event.payload.endedAt
    ) {
      throw new TypeError(
        'pending timing event occurredAt must match endedAt.',
      )
    }
    eventIds.add(event.id)
    const eventIdentity: EffectiveTimingTaskIdentity = {
      planId: event.payload.planId,
      taskId: event.payload.taskId,
      learningUnitId: event.payload.learningUnitId,
      contentRef: event.payload.contentRef,
      domain: event.payload.domain,
      targetModuleId: event.payload.targetModuleId,
      localDate: event.payload.localDate,
      mode: event.payload.mode,
    }
    if (!sameIdentity(value.identity, eventIdentity)) {
      throw new TypeError(
        'pending timing event identity does not match its session.',
      )
    }
  }
  requireString(value.updatedAt, 'updatedAt')
  if (!Number.isFinite(Date.parse(value.updatedAt))) {
    throw new TypeError('updatedAt must be ISO 8601.')
  }
}

export function effectiveTimingSnapshotKey(
  identity: Pick<EffectiveTimingTaskIdentity, 'planId' | 'taskId'>,
): string {
  return `session:${encodeURIComponent(identity.planId)}:${encodeURIComponent(identity.taskId)}`
}

export class EffectiveTimingSnapshotRepository
  implements EffectiveTimingSnapshotStore
{
  readonly #store: NamespaceStore

  constructor(store: NamespaceStore) {
    this.#store = store
  }

  async load(
    identity: EffectiveTimingTaskIdentity,
  ): Promise<EffectiveTimingSessionSnapshot | undefined> {
    const key = effectiveTimingSnapshotKey(identity)
    const record = await this.#store.get<unknown>(key)
    if (!record) {
      return undefined
    }
    if (
      record.schemaVersion !==
      EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION
    ) {
      throw this.#snapshotError(
        identity,
        key,
        new TypeError(
          `Unsupported timing snapshot version: ${record.schemaVersion}.`,
        ),
      )
    }
    try {
      assertSnapshot(record.value)
      if (!sameIdentity(record.value.identity, identity)) {
        throw new TypeError(
          'Stored timing identity does not match the active plan task.',
        )
      }
      return record.value
    } catch (error) {
      throw this.#snapshotError(identity, key, error)
    }
  }

  async save(snapshot: EffectiveTimingSessionSnapshot): Promise<void> {
    assertSnapshot(snapshot)
    await this.#store.put(
      effectiveTimingSnapshotKey(snapshot.identity),
      snapshot,
      EFFECTIVE_TIMING_STORAGE_SCHEMA_VERSION,
    )
  }

  async delete(identity: EffectiveTimingTaskIdentity): Promise<void> {
    await this.#store.delete(effectiveTimingSnapshotKey(identity))
  }

  #snapshotError(
    identity: EffectiveTimingTaskIdentity,
    key: string,
    cause: unknown,
  ): AppError {
    return new AppError(
      'schema_incompatible',
      '本地计时会话与当前任务不匹配，已停止计时以避免污染学习记录。',
      {
        cause,
        recoverable: true,
        details: {
          namespace: EFFECTIVE_TIMING_STORAGE_NAMESPACE,
          key,
          planId: identity.planId,
          taskId: identity.taskId,
        },
      },
    )
  }
}
