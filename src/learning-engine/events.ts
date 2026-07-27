import type { PlatformEvent } from '../core/index.ts'
import type {
  LearningEvent,
  StandardErrorTag,
} from './contracts.ts'
import { classifyTimingSegment } from './timing.ts'
import {
  assertLocalDate,
  assertPositiveSeconds,
  assertUnitInterval,
  parseTimestamp,
} from './utils.ts'

const EVENT_TYPES = [
  'learning.task.started.v1',
  'learning.task.paused.v1',
  'learning.task.skipped.v1',
  'learning.attempt.completed.v1',
  'learning.timing.segment.recorded.v1',
] as const

const MODES = ['learn', 'calibration', 'review', 'retry'] as const
const PAUSE_REASONS = [
  'user-paused',
  'app-backgrounded',
  'device-failure',
  'content-failure',
  'time-budget-ended',
] as const
const SKIP_REASONS = [
  'user-skipped',
  'time-budget-ended',
  'device-failure',
  'content-failure',
] as const
const FAILURE_CATEGORIES = [
  'device',
  'permission',
  'network',
  'content',
  'interrupted',
] as const
const TIMING_PHASES = [
  'answering',
  'audio-listening',
  'recording',
  'playback',
  'feedback',
  'loading',
  'permission-wait',
  'network-wait',
  'paused',
  'idle',
] as const
const TIMING_REASONS = [
  'active-answering',
  'active-audio-listening',
  'active-recording',
  'active-playback',
  'active-feedback',
  'app-backgrounded',
  'user-paused',
  'idle-timeout',
  'content-loading',
  'permission-wait',
  'network-wait',
  'media-loading',
] as const
const ERROR_TAGS: readonly StandardErrorTag[] = [
  'meaning-recall',
  'form-recall',
  'sound-discrimination',
  'detail-missed',
  'inference',
  'pronunciation',
  'fluency',
  'grammar',
  'word-choice',
  'task-understanding',
  'timeout',
  'other',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function requireString(
  payload: Record<string, unknown>,
  key: string,
): string {
  const value = payload[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${key} must be a non-empty string`)
  }
  return value
}

function requireNumber(
  payload: Record<string, unknown>,
  key: string,
): number {
  const value = payload[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${key} must be a finite number`)
  }
  return value
}

function requireStringArray(
  payload: Record<string, unknown>,
  key: string,
): readonly string[] {
  const value = payload[key]
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new TypeError(`${key} must be a string array`)
  }
  return value
}

function requireEnum<T extends string>(
  payload: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T {
  const value = payload[key]
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new TypeError(`${key} has an unsupported value`)
  }
  return value as T
}

function validateBase(
  event: PlatformEvent,
  payload: Record<string, unknown>,
): void {
  if (event.id.trim().length === 0) {
    throw new TypeError('event.id cannot be empty')
  }
  if (event.schemaVersion !== 1) {
    throw new TypeError('Unsupported learning event schemaVersion')
  }
  parseTimestamp(event.occurredAt, 'event.occurredAt')
  const domain = requireEnum(payload, 'domain', [
    'vocabulary',
    'listening',
    'speaking',
  ])
  const targetModuleId = requireEnum(payload, 'targetModuleId', [
    'vocabulary',
    'listening',
    'speaking',
  ])
  if (domain !== targetModuleId || event.sourceModuleId !== targetModuleId) {
    throw new TypeError(
      'domain, targetModuleId, and sourceModuleId must match',
    )
  }
  requireString(payload, 'planId')
  requireString(payload, 'taskId')
  requireString(payload, 'learningUnitId')
  requireString(payload, 'contentRef')
  assertLocalDate(requireString(payload, 'localDate'))
}

export function parseLearningEvent(event: PlatformEvent): LearningEvent {
  if (
    !EVENT_TYPES.includes(
      event.type as (typeof EVENT_TYPES)[number],
    )
  ) {
    throw new TypeError(`Unsupported learning event type: ${event.type}`)
  }
  if (!isRecord(event.payload)) {
    throw new TypeError('learning event payload must be an object')
  }
  const payload = event.payload
  validateBase(event, payload)

  if (event.type === 'learning.task.started.v1') {
    requireEnum(payload, 'mode', MODES)
  } else if (event.type === 'learning.task.paused.v1') {
    requireEnum(payload, 'reason', PAUSE_REASONS)
    const durationSeconds = requireNumber(payload, 'durationSeconds')
    if (durationSeconds < 0) {
      throw new RangeError('durationSeconds cannot be negative')
    }
  } else if (event.type === 'learning.task.skipped.v1') {
    requireEnum(payload, 'reason', SKIP_REASONS)
  } else if (event.type === 'learning.attempt.completed.v1') {
    requireEnum(payload, 'mode', MODES)
    const difficultyLevel = requireNumber(payload, 'difficultyLevel')
    if (difficultyLevel < 0 || difficultyLevel > 12) {
      throw new RangeError('difficultyLevel must be between 0 and 12')
    }
    assertPositiveSeconds(
      requireNumber(payload, 'estimatedSeconds'),
      'estimatedSeconds',
    )
    const result = requireEnum(payload, 'result', [
      'scored',
      'unscorable',
    ])
    const performanceScore = payload.performanceScore
    if (result === 'scored') {
      if (typeof performanceScore !== 'number') {
        throw new TypeError(
          'scored attempt requires a performanceScore',
        )
      }
      assertUnitInterval(performanceScore, 'performanceScore')
      if (payload.failureCategory !== null) {
        throw new TypeError(
          'scored attempt cannot include a failureCategory',
        )
      }
    } else {
      if (performanceScore !== null) {
        throw new TypeError(
          'unscorable attempt must use a null performanceScore',
        )
      }
      if (payload.taskCompleted !== false) {
        throw new TypeError(
          'unscorable attempt cannot complete a task',
        )
      }
      requireEnum(payload, 'failureCategory', FAILURE_CATEGORIES)
    }
    assertUnitInterval(
      requireNumber(payload, 'evidenceQuality'),
      'evidenceQuality',
    )
    assertUnitInterval(
      requireNumber(payload, 'assistanceLevel'),
      'assistanceLevel',
    )
    const durationSeconds = requireNumber(payload, 'durationSeconds')
    if (durationSeconds < 0) {
      throw new RangeError('durationSeconds cannot be negative')
    }
    if (typeof payload.taskCompleted !== 'boolean') {
      throw new TypeError('taskCompleted must be boolean')
    }
    const errorTags = requireStringArray(payload, 'errorTags')
    if (
      errorTags.some(
        (tag) => !ERROR_TAGS.includes(tag as StandardErrorTag),
      )
    ) {
      throw new TypeError('errorTags contains an unsupported tag')
    }
    requireStringArray(payload, 'contentTags')
  } else {
    requireEnum(payload, 'mode', MODES)
    requireEnum(payload, 'phase', TIMING_PHASES)
    requireEnum(payload, 'reason', TIMING_REASONS)
    requireEnum(payload, 'visibility', ['foreground', 'background'])
    requireString(payload, 'startedAt')
    requireString(payload, 'endedAt')
    requireNumber(payload, 'elapsedSeconds')
    requireNumber(payload, 'idleThresholdSeconds')
    classifyTimingSegment(
      payload as unknown as Extract<
        LearningEvent,
        { type: 'learning.timing.segment.recorded.v1' }
      >['payload'],
    )
  }

  return event as unknown as LearningEvent
}

export function isLearningEvent(event: PlatformEvent): boolean {
  try {
    parseLearningEvent(event)
    return true
  } catch {
    return false
  }
}
