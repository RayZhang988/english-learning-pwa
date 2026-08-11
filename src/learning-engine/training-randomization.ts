/**
 * R11-A shared selection contract. Providers receive the persisted seed,
 * order and cursor; they must not replace it with source-file order.
 *
 * Twelve items is deliberately short: it blocks the immediately frustrating
 * repeats while avoiding a false "no content" result in small difficulty
 * pools. Explicit review priorities are allowed to override this cooldown.
 */
export const SHORT_TERM_EXCLUSION_WINDOW = 12

export interface TrainingSupplyRound extends Readonly<Record<string, PortableData>> {
  readonly schemaVersion: 1
  readonly seed: string
  readonly order: readonly string[]
  readonly cursor: number
  readonly shortTermExcludedItemIds: readonly string[]
}

export interface CreateTrainingSupplyRoundInput {
  readonly seed: string
  readonly candidateItemIds: readonly string[]
  readonly shortTermExcludedItemIds: readonly string[]
  /** Formal error retry / due review may deliberately bypass normal cooldown. */
  readonly priorityItemIds?: readonly string[]
}

export type NextTrainingSupplyItem =
  | { readonly status: 'item'; readonly itemId: string }
  | {
      readonly status: 'content-exhausted'
      readonly reason: 'all-eligible-content-recently-used'
    }

function assertDenseNonEmptyStrings(
  value: readonly string[],
  field: string,
): void {
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`${field} must be dense`)
    }
    const item = value[index]
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new TypeError(`${field} must contain non-empty strings`)
    }
    if (seen.has(item)) {
      throw new TypeError(`${field} must not contain duplicates`)
    }
    seen.add(item)
  }
}

function seededRandom(seed: string): () => number {
  let value = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return () => {
    value += 0x6d2b79f5
    let mixed = value
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

function shuffle(ids: readonly string[], seed: string): readonly string[] {
  const result = [...ids]
  const random = seededRandom(seed)
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!]
  }
  return result
}

export function createTrainingSupplyRound(
  input: CreateTrainingSupplyRoundInput,
): TrainingSupplyRound {
  if (typeof input.seed !== 'string' || input.seed.trim().length === 0) {
    throw new TypeError('Training supply round seed must be a non-empty string')
  }
  assertDenseNonEmptyStrings(input.candidateItemIds, 'candidateItemIds')
  assertDenseNonEmptyStrings(
    input.shortTermExcludedItemIds,
    'shortTermExcludedItemIds',
  )
  const priority = input.priorityItemIds ?? []
  assertDenseNonEmptyStrings(priority, 'priorityItemIds')
  const candidateIds = new Set(input.candidateItemIds)
  if (priority.some((itemId) => !candidateIds.has(itemId))) {
    throw new TypeError('priorityItemIds must be formal candidate identities')
  }
  const shortTermExcludedItemIds = input.shortTermExcludedItemIds.slice(
    -SHORT_TERM_EXCLUSION_WINDOW,
  )
  const excluded = new Set(shortTermExcludedItemIds)
  const prioritySet = new Set(priority)
  const ordinary = input.candidateItemIds.filter(
    (itemId) => !excluded.has(itemId) && !prioritySet.has(itemId),
  )
  const prioritized = priority.filter((itemId) => candidateIds.has(itemId))
  return {
    schemaVersion: 1,
    seed: input.seed,
    order: [...prioritized, ...shuffle(ordinary, input.seed)],
    cursor: 0,
    shortTermExcludedItemIds,
  }
}

export function nextTrainingSupplyItem(
  round: TrainingSupplyRound,
): NextTrainingSupplyItem {
  assertTrainingSupplyRound(round)
  const itemId = round.order[round.cursor]
  return itemId === undefined
    ? { status: 'content-exhausted', reason: 'all-eligible-content-recently-used' }
    : { status: 'item', itemId }
}

export function recordTrainingSupplyItem(
  round: TrainingSupplyRound,
  itemId: string,
): TrainingSupplyRound {
  assertTrainingSupplyRound(round)
  if (typeof itemId !== 'string' || itemId.trim().length === 0) {
    throw new TypeError('itemId must be a non-empty string')
  }
  if (round.order[round.cursor - 1] === itemId) {
    return round
  }
  if (round.order[round.cursor] !== itemId) {
    throw new TypeError('Training supply item does not match the current round order')
  }
  const history = round.shortTermExcludedItemIds.includes(itemId)
    ? round.shortTermExcludedItemIds
    : [...round.shortTermExcludedItemIds, itemId].slice(
        -SHORT_TERM_EXCLUSION_WINDOW,
      )
  return { ...round, cursor: round.cursor + 1, shortTermExcludedItemIds: history }
}

export function assertTrainingSupplyRound(value: unknown): asserts value is TrainingSupplyRound {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Training supply round must be an object')
  }
  const round = value as Record<string, unknown>
  if (round.schemaVersion !== 1 || typeof round.seed !== 'string' || round.seed.trim().length === 0 ||
    !Array.isArray(round.order) || !Array.isArray(round.shortTermExcludedItemIds) ||
    !Number.isInteger(round.cursor) || Number(round.cursor) < 0 || Number(round.cursor) > round.order.length) {
    throw new TypeError('Training supply round is invalid')
  }
  assertDenseNonEmptyStrings(round.order, 'order')
  assertDenseNonEmptyStrings(
    round.shortTermExcludedItemIds,
    'shortTermExcludedItemIds',
  )
  if (round.shortTermExcludedItemIds.length > SHORT_TERM_EXCLUSION_WINDOW) {
    throw new TypeError('shortTermExcludedItemIds exceeds its bounded window')
  }
}
import type { PortableData } from '../core/index.ts'
