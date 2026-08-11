import type { TrainingSupplyRound } from './training-randomization.ts'

function sameOrder(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((itemId, index) => itemId === right[index])
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
  if (previous.seed !== received.seed || !sameOrder(previous.order, received.order)) {
    throw new TypeError('supplyRound does not match the established training round')
  }
  if (received.cursor !== previous.cursor + 1) {
    throw new TypeError('supplyRound must advance exactly one item')
  }
}
