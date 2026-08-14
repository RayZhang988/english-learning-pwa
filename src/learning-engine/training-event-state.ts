import type {
  ExtraTrainingEvent,
  ExtraTrainingState,
  LearningEngineState,
  LearningEvent,
  PlanProgress,
  SkipHistoryEntry,
} from './contracts.ts'
import {
  recordRecentTrainingItem,
  recordRecentTrainingSemanticIdentity,
  trainingRecentBucket,
} from './engine.ts'
import { applyExtraTrainingEvent } from './extra-training.ts'
import { applyPlanEvent } from './lifecycle.ts'

export interface ApplyLearningEngineTrainingEventInput {
  readonly engineState: LearningEngineState
  readonly progress: PlanProgress
  readonly event: LearningEvent
  readonly skipHistory?: readonly SkipHistoryEntry[]
}

export interface ApplyLearningEngineTrainingEventResult {
  readonly engineState: LearningEngineState
  readonly progress: PlanProgress
}

export interface ApplyLearningEngineExtraTrainingEventInput {
  readonly engineState: LearningEngineState
  readonly extraTraining: ExtraTrainingState
  readonly event: ExtraTrainingEvent
}

export interface ApplyLearningEngineExtraTrainingEventResult {
  readonly engineState: LearningEngineState
  readonly extraTraining: ExtraTrainingState
}

function withRecentCompletedItem(
  state: LearningEngineState,
  event: LearningEvent | ExtraTrainingEvent,
): LearningEngineState {
  if (
    event.type !== 'learning.training.item.completed.v1' &&
    event.type !== 'learning.extra-training.item.completed.v1'
  ) {
    return state
  }
  const { item } = event.payload
  const bucket = trainingRecentBucket(
    event.payload.domain,
    event.payload.mode,
    item.difficultyLevel,
  )
  const withItem = recordRecentTrainingItem(
    state,
    bucket,
    item.itemId,
  )
  const round = event.payload.supplyRound
  if (round === undefined || round.schemaVersion === 1) return withItem
  const acknowledged = round.orderAudit[round.cursor - 1]
  if (acknowledged === undefined || acknowledged.itemId !== item.itemId) {
    throw new TypeError('Semantic supply round does not acknowledge the completed item')
  }
  return recordRecentTrainingSemanticIdentity(withItem, bucket, acknowledged)
}

/**
 * The only pure state transition for a daily stream item and its cooldown
 * ledger. Consumers persist both returned values together, never as two
 * independently derived writes.
 */
export function applyLearningEngineTrainingEvent(
  input: ApplyLearningEngineTrainingEventInput,
): ApplyLearningEngineTrainingEventResult {
  const duplicate = input.progress.processedEventIds.includes(input.event.id)
  const progress = applyPlanEvent(
    input.progress,
    input.event,
    input.skipHistory,
  )
  return {
    progress,
    engineState: duplicate || progress === input.progress
      ? input.engineState
      : withRecentCompletedItem(input.engineState, input.event),
  }
}

/**
 * Extra training shares the exact same ledger while preserving its separate
 * session state and daily-plan isolation.
 */
export function applyLearningEngineExtraTrainingEvent(
  input: ApplyLearningEngineExtraTrainingEventInput,
): ApplyLearningEngineExtraTrainingEventResult {
  const duplicate = input.extraTraining.processedEventIds.includes(input.event.id)
  const extraTraining = applyExtraTrainingEvent(input.extraTraining, input.event)
  return {
    extraTraining,
    engineState: duplicate || extraTraining === input.extraTraining
      ? input.engineState
      : withRecentCompletedItem(input.engineState, input.event),
  }
}
