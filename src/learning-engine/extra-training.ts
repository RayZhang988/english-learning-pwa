import type {
  ExtraTrainingEvent,
  ExtraTrainingPriorityItemIds,
  ExtraTrainingSession,
  ExtraTrainingState,
  ExtraTrainingSupplyRequest,
  PlanProgress,
} from './contracts.ts'
import { EXTRA_TRAINING_EFFECTIVE_SECONDS } from './contracts.ts'
import { classifyTimingSegment } from './timing.ts'
import { emptyTrainingUnitScore, mergeTrainingUnitScore } from './training-score.ts'
import { assertLocalDate, parseTimestamp } from './utils.ts'

const MAX_PROCESSED_EVENT_IDS = 500
const MAX_EXCLUDED_ITEM_IDS = 500
const PRIORITY = [
  'recent-error',
  'due-review',
  'same-day-variant',
  'new-optional-content',
] as const

function emptyPriorityItemIds(): ExtraTrainingPriorityItemIds {
  return {
    'recent-error': [],
    'due-review': [],
    'same-day-variant': [],
    'new-optional-content': [],
  }
}

function normalizePriorityItemIds(
  value: unknown,
  fieldName = 'priorityItemIds',
): ExtraTrainingPriorityItemIds {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must contain every priority group`)
  }
  const record = value as Record<string, unknown>
  const seen = new Set<string>()
  const groups = PRIORITY.map((priority) => {
    const itemIds = record[priority]
    if (!Array.isArray(itemIds)) {
      throw new TypeError(`${fieldName}.${priority} must be an itemId array`)
    }
    const normalized: string[] = []
    for (const itemId of itemIds) {
      if (typeof itemId !== 'string' || itemId.trim().length === 0) {
        throw new TypeError(`${fieldName}.${priority} contains an invalid itemId`)
      }
      if (!seen.has(itemId)) {
        seen.add(itemId)
        normalized.push(itemId)
      }
    }
    return [priority, normalized] as const
  })
  if (Object.keys(record).some((key) => !PRIORITY.includes(key as typeof PRIORITY[number]))) {
    throw new TypeError(`${fieldName} contains an unsupported priority group`)
  }
  return {
    'recent-error': groups[0][1],
    'due-review': groups[1][1],
    'same-day-variant': groups[2][1],
    'new-optional-content': groups[3][1],
  }
}

function sessionPriorityItemIds(
  session: ExtraTrainingSession,
): ExtraTrainingPriorityItemIds {
  return session.priorityItemIds === undefined
    ? emptyPriorityItemIds()
    : normalizePriorityItemIds(session.priorityItemIds)
}

export interface CreateExtraTrainingSessionInput {
  readonly sessionId: string
  readonly localDate: string
  readonly domain: ExtraTrainingSession['domain']
  readonly targetModuleId: ExtraTrainingSession['targetModuleId']
  readonly targetDifficulty: number
  readonly priorityItemIds: ExtraTrainingPriorityItemIds
  readonly startedAt: string
}

function assertSessionIdentity(
  session: ExtraTrainingSession,
  event: ExtraTrainingEvent,
): void {
  if (
    event.payload.sessionId !== session.sessionId ||
    event.payload.localDate !== session.localDate ||
    event.payload.domain !== session.domain ||
    event.payload.targetModuleId !== session.targetModuleId ||
    event.payload.mode !== session.mode ||
    event.sourceModuleId !== session.targetModuleId
  ) {
    throw new TypeError('Extra-training event identity does not match session')
  }
}

function replaceSession(
  state: ExtraTrainingState,
  session: ExtraTrainingSession,
  eventId?: string,
): ExtraTrainingState {
  return {
    ...state,
    sessions: { ...state.sessions, [session.sessionId]: session },
    processedEventIds:
      eventId === undefined
        ? state.processedEventIds
        : [...state.processedEventIds, eventId].slice(-MAX_PROCESSED_EVENT_IDS),
  }
}

export function createExtraTrainingState(): ExtraTrainingState {
  return { schemaVersion: 1, sessions: {}, processedEventIds: [] }
}

export function isOpenEndedExtraTrainingSession(
  session: ExtraTrainingSession,
): boolean {
  return session.completionMode === 'open-ended'
}

function withoutLegacyBudget(
  session: ExtraTrainingSession,
): ExtraTrainingSession {
  const {
    targetEffectiveSeconds: _targetEffectiveSeconds,
    remainingEffectiveSeconds: _remainingEffectiveSeconds,
    ...current
  } = session
  return current
}

/**
 * Upgrades an unfinished pre-R6.1 optional session without losing practice
 * time, score, content cursor or exclusions. Historical completed sessions
 * stay unchanged so past records remain truthful.
 */
export function migrateExtraTrainingSessionsToOpenEnded(
  state: ExtraTrainingState,
  occurredAt: string,
): ExtraTrainingState {
  parseTimestamp(occurredAt, 'occurredAt')
  let updated = state
  for (const session of Object.values(state.sessions)) {
    if (
      isOpenEndedExtraTrainingSession(session) ||
      session.status === 'completed' ||
      session.status === 'expired'
    ) {
      continue
    }
    const migrated = migrateExtraTrainingSessionToOpenEnded(
      session,
      occurredAt,
    )
    updated = replaceSession(updated, migrated)
  }
  return updated
}

export function migrateExtraTrainingSessionToOpenEnded(
  session: ExtraTrainingSession,
  occurredAt: string,
): ExtraTrainingSession {
  parseTimestamp(occurredAt, 'occurredAt')
  if (isOpenEndedExtraTrainingSession(session)) {
    return session
  }
  const elapsed = Math.max(
    0,
    (session.targetEffectiveSeconds ?? EXTRA_TRAINING_EFFECTIVE_SECONDS) -
      (session.remainingEffectiveSeconds ?? EXTRA_TRAINING_EFFECTIVE_SECONDS),
  )
  return withoutLegacyBudget({
    ...session,
    completionMode: 'open-ended',
    effectiveSeconds: Math.max(session.effectiveSeconds ?? 0, elapsed),
    status:
      session.status === 'finish-current-item'
        ? 'running'
        : session.status,
    endedAt:
      session.status === 'finish-current-item'
        ? null
        : session.endedAt,
    endReason:
      session.status === 'finish-current-item'
        ? null
        : session.endReason,
    updatedAt: occurredAt,
  })
}

/** A session can start only after the same day's daily plan has reached 3/3. */
export function createExtraTrainingSession(
  state: ExtraTrainingState | undefined,
  completedPlan: PlanProgress,
  input: CreateExtraTrainingSessionInput,
): ExtraTrainingState {
  assertLocalDate(input.localDate)
  parseTimestamp(input.startedAt, 'startedAt')
  if (input.sessionId.trim().length === 0) {
    throw new TypeError('sessionId cannot be empty')
  }
  if (input.domain !== input.targetModuleId) {
    throw new TypeError('Extra-training domain and target module must match')
  }
  if (!Number.isFinite(input.targetDifficulty) || input.targetDifficulty < 0 || input.targetDifficulty > 12) {
    throw new RangeError('targetDifficulty must be between 0 and 12')
  }
  if (
    completedPlan.status !== 'completed' ||
    completedPlan.plan.localDate !== input.localDate ||
    completedPlan.tasks.length !== 3 ||
    !completedPlan.tasks.every((task) => task.status === 'completed' || task.status === 'skipped')
  ) {
    throw new TypeError('Extra training requires the completed daily plan for its localDate')
  }
  const current = state ?? createExtraTrainingState()
  if (current.sessions[input.sessionId] !== undefined) {
    return current
  }
  return replaceSession(current, {
    schemaVersion: 1,
    sessionId: input.sessionId,
    localDate: input.localDate,
    domain: input.domain,
    targetModuleId: input.targetModuleId,
    mode: 'learn',
    targetDifficulty: input.targetDifficulty,
    completionMode: 'open-ended',
    effectiveSeconds: 0,
    status: 'running',
    nextSupplyCursor: null,
    excludeItemIds: [],
    priorityItemIds: normalizePriorityItemIds(input.priorityItemIds),
    completedItemCount: 0,
    score: emptyTrainingUnitScore(),
    startedAt: input.startedAt,
    updatedAt: input.startedAt,
    endedAt: null,
    endReason: null,
  })
}

export function buildExtraTrainingSupplyRequest(
  session: ExtraTrainingSession,
): ExtraTrainingSupplyRequest | null {
  if (
    session.status === 'completed' ||
    session.status === 'failed' ||
    session.status === 'expired'
  ) {
    return null
  }
  return {
    schemaVersion: 1,
    requestId: `${session.sessionId}:supply:${session.completedItemCount + 1}:${session.nextSupplyCursor ?? 'initial'}`,
    sessionId: session.sessionId,
    localDate: session.localDate,
    domain: session.domain,
    targetModuleId: session.targetModuleId,
    mode: 'learn',
    targetDifficulty: session.targetDifficulty,
    cursor: session.nextSupplyCursor,
    excludeItemIds: session.excludeItemIds,
    priority: PRIORITY,
    priorityItemIds: sessionPriorityItemIds(session),
    reason:
      session.completedItemCount === 0
        ? 'initial'
        : session.status === 'paused' || session.endReason === 'user-exited'
          ? 'resume'
          : 'continue-after-item',
  }
}

/**
 * Applies only `learning.extra-training.*` events. It has no PlanProgress
 * parameter by design, so it cannot change the completed daily plan.
 */
export function applyExtraTrainingEvent(
  state: ExtraTrainingState,
  event: ExtraTrainingEvent,
): ExtraTrainingState {
  if (state.processedEventIds.includes(event.id)) {
    return state
  }
  const session = state.sessions[event.payload.sessionId]
  if (session === undefined) {
    throw new TypeError('Extra-training session does not exist')
  }
  assertSessionIdentity(session, event)
  if (session.status === 'completed' || session.status === 'expired') {
    return state
  }

  let updated: ExtraTrainingSession
  if (event.type === 'learning.extra-training.attempt.completed.v1') {
    updated = {
      ...session,
      score: mergeTrainingUnitScore(session.score, event.payload.scoreDelta),
      updatedAt: event.occurredAt,
    }
  } else if (event.type === 'learning.extra-training.started.v1') {
    if (
      !isOpenEndedExtraTrainingSession(session) &&
      session.status === 'finish-current-item'
    ) {
      throw new TypeError('Cannot resume after the effective budget has ended')
    }
    updated = {
      ...session,
      status: 'running',
      endedAt: null,
      updatedAt: event.occurredAt,
    }
  } else if (event.type === 'learning.extra-training.timing.segment.recorded.v1') {
    const classification = classifyTimingSegment(event.payload)
    if (isOpenEndedExtraTrainingSession(session)) {
      updated = {
        ...session,
        effectiveSeconds:
          (session.effectiveSeconds ?? 0) + classification.effectiveSeconds,
        updatedAt: event.occurredAt,
      }
    } else {
      const remaining = Math.max(
        0,
        (session.remainingEffectiveSeconds ??
          EXTRA_TRAINING_EFFECTIVE_SECONDS) -
          classification.effectiveSeconds,
      )
      updated = {
        ...session,
        remainingEffectiveSeconds: remaining,
        status:
          session.status === 'running' && remaining === 0
            ? 'finish-current-item'
            : session.status,
        updatedAt: event.occurredAt,
      }
    }
  } else if (event.type === 'learning.extra-training.item.completed.v1') {
    if (session.status !== 'running' && session.status !== 'finish-current-item') {
      throw new TypeError('Extra-training session is not accepting completed items')
    }
    const excluded = session.excludeItemIds.includes(event.payload.item.itemId)
      ? session.excludeItemIds
      : [...session.excludeItemIds, event.payload.item.itemId].slice(-MAX_EXCLUDED_ITEM_IDS)
    updated = {
      ...session,
      excludeItemIds: excluded,
      completedItemCount: session.completedItemCount + (excluded === session.excludeItemIds ? 0 : 1),
      nextSupplyCursor: event.payload.nextSupplyCursor,
      endReason: null,
      updatedAt: event.occurredAt,
    }
  } else if (event.type === 'learning.extra-training.exited.v1') {
    updated = {
      ...session,
      status: 'paused',
      endedAt: event.occurredAt,
      endReason: 'user-exited',
      updatedAt: event.occurredAt,
    }
  } else if (event.type === 'learning.extra-training.budget.completed.v1') {
    if (isOpenEndedExtraTrainingSession(session)) {
      throw new TypeError(
        'Open-ended extra training cannot complete from a time budget',
      )
    }
    if (session.status !== 'finish-current-item') {
      throw new TypeError('Extra-training effective budget has not ended')
    }
    if (event.payload.completedItemCount !== session.completedItemCount) {
      throw new TypeError('Extra-training completion count does not match session')
    }
    updated = {
      ...session,
      status: 'completed',
      remainingEffectiveSeconds: 0,
      endedAt: event.occurredAt,
      endReason: 'budget-reached',
      updatedAt: event.occurredAt,
    }
  } else {
    updated = {
      ...session,
      status: 'failed',
      endedAt: event.occurredAt,
      endReason: event.payload.reason,
      updatedAt: event.occurredAt,
    }
  }
  return replaceSession(state, updated, event.id)
}

/** Cross-day handling is session-only; it never touches completed PlanProgress. */
export function expireExtraTrainingSessions(
  state: ExtraTrainingState,
  currentLocalDate: string,
  occurredAt: string,
): ExtraTrainingState {
  assertLocalDate(currentLocalDate)
  parseTimestamp(occurredAt, 'occurredAt')
  let updated = state
  for (const session of Object.values(state.sessions)) {
    if (
      session.localDate !== currentLocalDate &&
      session.status !== 'completed' &&
      session.status !== 'expired'
    ) {
      updated = replaceSession(updated, {
        ...session,
        status: 'expired',
        endedAt: occurredAt,
        endReason: 'cross-day-expired',
        updatedAt: occurredAt,
      })
    }
  }
  return updated
}
