import type { PlatformEvent } from '../core/index.ts'
import type {
  ExtraTrainingEvent,
  LearningEvent,
  StandardErrorTag,
} from './contracts.ts'
import { classifyTimingSegment } from './timing.ts'
import { assertTrainingUnitScore } from './training-score.ts'
import { assertTrainingSupplyRound } from './training-randomization.ts'
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
  'learning.training.item.completed.v1',
  'learning.training.content.exhausted.v1',
  'learning.training.content.recovered.v1',
  'learning.training.budget.completed.v1',
] as const

const EXTRA_TRAINING_EVENT_TYPES = [
  'learning.extra-training.started.v1',
  'learning.extra-training.timing.segment.recorded.v1',
  'learning.extra-training.item.completed.v1',
  'learning.extra-training.exited.v1',
  'learning.extra-training.budget.completed.v1',
  'learning.extra-training.failed.v1',
  'learning.extra-training.attempt.completed.v1',
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

function validateOptionalScoreDelta(
  payload: Record<string, unknown>,
  result: 'scored' | 'unscorable',
): void {
  if (payload.scoreDelta === undefined) {
    return
  }
  if (
    typeof payload.scoreDelta !== 'object' ||
    payload.scoreDelta === null ||
    Array.isArray(payload.scoreDelta)
  ) {
    throw new TypeError('scoreDelta must be an object')
  }
  const score = payload.scoreDelta as {
    schemaVersion: 1
    correctCount: number
    incorrectCount: number
    unscorableCount: number
  }
  assertTrainingUnitScore(score, 'scoreDelta')
  const scoredCount = score.correctCount + score.incorrectCount
  if (result === 'scored' && scoredCount === 0) {
    throw new TypeError('scored attempt scoreDelta requires a scored item')
  }
  if (
    result === 'unscorable' &&
    (scoredCount !== 0 || score.unscorableCount === 0)
  ) {
    throw new TypeError(
      'unscorable attempt scoreDelta must contain only unscorable items',
    )
  }
}
const CONTENT_EXHAUSTION_REASONS = [
  'no-eligible-content',
  'all-eligible-content-recently-used',
  'provider-failure',
] as const

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

function validateExtraTrainingBase(
  event: PlatformEvent,
  payload: Record<string, unknown>,
): void {
  if (event.id.trim().length === 0) {
    throw new TypeError('event.id cannot be empty')
  }
  if (event.schemaVersion !== 1) {
    throw new TypeError('Unsupported extra-training event schemaVersion')
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
    throw new TypeError('domain, targetModuleId, and sourceModuleId must match')
  }
  requireString(payload, 'sessionId')
  assertLocalDate(requireString(payload, 'localDate'))
  if (payload.mode !== 'learn') {
    throw new TypeError('Extra-training mode must be learn')
  }
}

function validateStreamItem(payload: Record<string, unknown>): void {
  if (!isRecord(payload.item)) {
    throw new TypeError('item must be an object')
  }
  requireString(payload.item, 'itemId')
  requireString(payload.item, 'learningUnitId')
  requireString(payload.item, 'contentRef')
  const difficultyLevel = requireNumber(payload.item, 'difficultyLevel')
  if (difficultyLevel < 0 || difficultyLevel > 12) {
    throw new RangeError('item.difficultyLevel must be between 0 and 12')
  }
  requireStringArray(payload.item, 'tags')
}

function validateAcknowledgedSupplyRound(
  payload: Record<string, unknown>,
): void {
  if (payload.supplyRound === undefined) return
  assertTrainingSupplyRound(payload.supplyRound)
  const round = payload.supplyRound
  const itemId = isRecord(payload.item) ? payload.item.itemId : undefined
  if (round.cursor < 1 || round.order[round.cursor - 1] !== itemId) {
    throw new TypeError('supplyRound must acknowledge the completed item exactly once')
  }
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
    validateOptionalScoreDelta(payload, result)
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
  } else if (event.type === 'learning.timing.segment.recorded.v1') {
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
  } else if (event.type === 'learning.training.item.completed.v1') {
    requireEnum(payload, 'mode', MODES)
    validateStreamItem(payload)
    requireString(payload, 'requestId')
    if (payload.nextSupplyCursor !== null && typeof payload.nextSupplyCursor !== 'string') {
      throw new TypeError('nextSupplyCursor must be a string or null')
    }
    requireEnum(payload, 'outcome', ['scored', 'unscorable-practice'])
    validateAcknowledgedSupplyRound(payload)
  } else if (event.type === 'learning.training.content.exhausted.v1') {
    requireEnum(payload, 'mode', MODES)
    requireString(payload, 'requestId')
    if (payload.cursor !== null && typeof payload.cursor !== 'string') {
      throw new TypeError('cursor must be a string or null')
    }
    requireEnum(payload, 'reason', CONTENT_EXHAUSTION_REASONS)
  } else if (event.type === 'learning.training.content.recovered.v1') {
    requireEnum(payload, 'mode', MODES)
    requireString(payload, 'exhaustionRequestId')
  } else {
    requireEnum(payload, 'mode', MODES)
    requireString(payload, 'lastCompletedItemId')
    const completedItemCount = requireNumber(payload, 'completedItemCount')
    if (!Number.isInteger(completedItemCount) || completedItemCount <= 0) {
      throw new RangeError('completedItemCount must be a positive integer')
    }
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

/**
 * Extra-training events intentionally parse through a separate boundary: they
 * carry a session identity, never a daily plan/task identity, and must not be
 * passed to applyPlanEvent().
 */
export function parseExtraTrainingEvent(
  event: PlatformEvent,
): ExtraTrainingEvent {
  if (!EXTRA_TRAINING_EVENT_TYPES.includes(event.type as (typeof EXTRA_TRAINING_EVENT_TYPES)[number])) {
    throw new TypeError(`Unsupported extra-training event type: ${event.type}`)
  }
  if (!isRecord(event.payload)) {
    throw new TypeError('extra-training event payload must be an object')
  }
  const payload = event.payload
  validateExtraTrainingBase(event, payload)

  if (event.type === 'learning.extra-training.timing.segment.recorded.v1') {
    requireEnum(payload, 'phase', TIMING_PHASES)
    requireEnum(payload, 'reason', TIMING_REASONS)
    requireEnum(payload, 'visibility', ['foreground', 'background'])
    requireString(payload, 'startedAt')
    requireString(payload, 'endedAt')
    requireNumber(payload, 'elapsedSeconds')
    requireNumber(payload, 'idleThresholdSeconds')
    classifyTimingSegment(payload as never)
  } else if (event.type === 'learning.extra-training.item.completed.v1') {
    validateStreamItem(payload)
    requireString(payload, 'requestId')
    if (payload.nextSupplyCursor !== null && typeof payload.nextSupplyCursor !== 'string') {
      throw new TypeError('nextSupplyCursor must be a string or null')
    }
    validateAcknowledgedSupplyRound(payload)
  } else if (event.type === 'learning.extra-training.budget.completed.v1') {
    const count = requireNumber(payload, 'completedItemCount')
    if (!Number.isInteger(count) || count <= 0) {
      throw new RangeError('completedItemCount must be a positive integer')
    }
  } else if (event.type === 'learning.extra-training.failed.v1') {
    requireEnum(payload, 'reason', [
      'content-exhausted',
      'provider-failure',
      'device-failure',
    ])
  } else if (event.type === 'learning.extra-training.attempt.completed.v1') {
    requireString(payload, 'learningUnitId')
    requireString(payload, 'contentRef')
    const difficultyLevel = requireNumber(payload, 'difficultyLevel')
    if (difficultyLevel < 0 || difficultyLevel > 12) {
      throw new RangeError('difficultyLevel must be between 0 and 12')
    }
    assertPositiveSeconds(requireNumber(payload, 'estimatedSeconds'), 'estimatedSeconds')
    const result = requireEnum(payload, 'result', ['scored', 'unscorable'])
    validateOptionalScoreDelta(payload, result)
    if (result === 'scored') {
      assertUnitInterval(requireNumber(payload, 'performanceScore'), 'performanceScore')
      if (payload.failureCategory !== null) {
        throw new TypeError('scored attempt cannot include a failureCategory')
      }
    } else if (payload.performanceScore !== null) {
      throw new TypeError('unscorable attempt must use a null performanceScore')
    } else {
      requireEnum(payload, 'failureCategory', FAILURE_CATEGORIES)
    }
    assertUnitInterval(requireNumber(payload, 'evidenceQuality'), 'evidenceQuality')
    assertUnitInterval(requireNumber(payload, 'assistanceLevel'), 'assistanceLevel')
    const durationSeconds = requireNumber(payload, 'durationSeconds')
    if (durationSeconds < 0) {
      throw new RangeError('durationSeconds cannot be negative')
    }
    const errorTags = requireStringArray(payload, 'errorTags')
    if (errorTags.some((tag) => !ERROR_TAGS.includes(tag as StandardErrorTag))) {
      throw new TypeError('errorTags contains an unsupported tag')
    }
    requireStringArray(payload, 'contentTags')
  }
  return event as unknown as ExtraTrainingEvent
}

export function isExtraTrainingEvent(event: PlatformEvent): boolean {
  try {
    parseExtraTrainingEvent(event)
    return true
  } catch {
    return false
  }
}
