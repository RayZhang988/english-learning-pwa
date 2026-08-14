import {
  SHORT_TERM_EXCLUSION_WINDOW,
  assertTrainingSupplyRound,
  type TrainingSupplyCandidateIdentity,
  type TrainingSupplyOrderAudit,
  type TrainingSupplyRound,
} from './training-randomization.ts'

function sameOrder(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((itemId, index) => itemId === right[index])
}

function sameIdentity(
  left: TrainingSupplyCandidateIdentity,
  right: TrainingSupplyCandidateIdentity,
): boolean {
  return left.itemId === right.itemId &&
    left.knowledgePointId === right.knowledgePointId &&
    left.semanticCategoryId === right.semanticCategoryId
}

function sameAudit(
  left: TrainingSupplyOrderAudit,
  right: TrainingSupplyOrderAudit,
): boolean {
  return sameIdentity(left, right) &&
    left.priorityReason === right.priorityReason &&
    left.relaxationTier === right.relaxationTier
}

/**
 * A persisted round may only advance one acknowledged item at a time. Legacy
 * events omit the snapshot entirely and retain their pre-R11 compatibility.
 */
export function assertSupplyRoundAdvances(
  previous: TrainingSupplyRound | undefined,
  received: TrainingSupplyRound | undefined,
): void {
  if (received === undefined || previous === undefined) {
    return
  }
  assertTrainingSupplyRound(previous)
  assertTrainingSupplyRound(received)
  if (previous.schemaVersion !== received.schemaVersion ||
    previous.seed !== received.seed || !sameOrder(previous.order, received.order)) {
    throw new TypeError('supplyRound does not match the established training round')
  }
  if (received.cursor !== previous.cursor + 1) {
    throw new TypeError('supplyRound must advance exactly one item')
  }
  if (previous.schemaVersion === 2 && received.schemaVersion === 2) {
    if (previous.relaxationTier !== received.relaxationTier ||
      previous.orderAudit.length !== received.orderAudit.length ||
      previous.orderAudit.some((entry, index) => !sameAudit(entry, received.orderAudit[index]!))) {
      throw new TypeError('supplyRound does not match the established training round')
    }
    const acknowledged = previous.orderAudit[previous.cursor]!
    const expectedHistory = [...previous.shortTermHistory, {
      itemId: acknowledged.itemId,
      knowledgePointId: acknowledged.knowledgePointId,
      semanticCategoryId: acknowledged.semanticCategoryId,
    }].slice(-SHORT_TERM_EXCLUSION_WINDOW)
    if (expectedHistory.length !== received.shortTermHistory.length ||
      expectedHistory.some((entry, index) => !sameIdentity(entry, received.shortTermHistory[index]!))) {
      throw new TypeError('supplyRound semantic history must append the acknowledged item')
    }
  }
}
