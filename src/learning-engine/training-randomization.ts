import type { PortableData } from '../core/index.ts'

export const SHORT_TERM_EXCLUSION_WINDOW = 12

export interface TrainingSupplyCandidateIdentity extends Readonly<Record<string, PortableData>> {
  readonly itemId: string
  readonly knowledgePointId: string
  readonly semanticCategoryId: string
}

export interface TrainingSupplyPriorityItem extends Readonly<Record<string, PortableData>> {
  readonly itemId: string
  readonly reason: string
}

export interface TrainingSupplyOrderAudit extends TrainingSupplyCandidateIdentity {
  readonly priorityReason: string | null
  /** 0=strict, 1=semantic cooldown relaxed, 2=all diversity constraints relaxed. */
  readonly relaxationTier: 0 | 1 | 2
}

interface TrainingSupplyRoundBase extends Readonly<Record<string, PortableData>> {
  readonly seed: string
  readonly order: readonly string[]
  readonly cursor: number
  readonly shortTermExcludedItemIds: readonly string[]
}

export interface LegacyTrainingSupplyRound extends TrainingSupplyRoundBase {
  readonly schemaVersion: 1
}

export interface SemanticTrainingSupplyRound extends TrainingSupplyRoundBase {
  readonly schemaVersion: 2
  readonly shortTermHistory: readonly TrainingSupplyCandidateIdentity[]
  readonly orderAudit: readonly TrainingSupplyOrderAudit[]
  readonly relaxationTier: 0 | 1 | 2
}

export type TrainingSupplyRound = LegacyTrainingSupplyRound | SemanticTrainingSupplyRound

export interface CreateTrainingSupplyRoundInput {
  readonly seed: string
  /** Legacy R11 input. R15 integrations must use candidates. */
  readonly candidateItemIds?: readonly string[]
  readonly candidates?: readonly TrainingSupplyCandidateIdentity[]
  readonly shortTermExcludedItemIds: readonly string[]
  readonly shortTermHistory?: readonly TrainingSupplyCandidateIdentity[]
  readonly priorityItemIds?: readonly string[]
  readonly priorityItems?: readonly TrainingSupplyPriorityItem[]
}

export type NextTrainingSupplyItem =
  | {
      readonly status: 'item'
      readonly itemId: string
      readonly priorityReason?: string | null
      readonly relaxationTier?: 0 | 1 | 2
    }
  | { readonly status: 'content-exhausted'; readonly reason: 'all-eligible-content-recently-used' }

function assertDenseNonEmptyStrings(value: readonly string[], field: string): void {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`)
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError(`${field} must be dense`)
    const item = value[index]
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new TypeError(`${field} must contain non-empty strings`)
    }
    if (seen.has(item)) throw new TypeError(`${field} must not contain duplicates`)
    seen.add(item)
  }
}

function assertIdentity(value: unknown, field: string): asserts value is TrainingSupplyCandidateIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`)
  }
  const identity = value as Record<string, unknown>
  for (const name of ['itemId', 'knowledgePointId', 'semanticCategoryId'] as const) {
    if (typeof identity[name] !== 'string' || identity[name].trim().length === 0) {
      throw new TypeError(`${field}.${name} must be a non-empty string`)
    }
  }
}

function assertIdentities(
  value: readonly TrainingSupplyCandidateIdentity[],
  field: string,
  unique: boolean,
): void {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`)
  const seen = new Set<string>()
  value.forEach((identity, index) => {
    if (!Object.hasOwn(value, index)) throw new TypeError(`${field} must be dense`)
    assertIdentity(identity, `${field}[${index}]`)
    if (unique && seen.has(identity.itemId)) {
      throw new TypeError(`${field} must not contain duplicate itemId values`)
    }
    seen.add(identity.itemId)
  })
}

function identityOnly(identity: TrainingSupplyCandidateIdentity): TrainingSupplyCandidateIdentity {
  return {
    itemId: identity.itemId,
    knowledgePointId: identity.knowledgePointId,
    semanticCategoryId: identity.semanticCategoryId,
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

function shuffle<T>(values: readonly T[], seed: string): T[] {
  const result = [...values]
  const random = seededRandom(seed)
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!]
  }
  return result
}

interface RankedCandidate {
  readonly identity: TrainingSupplyCandidateIdentity
  readonly rank: number
}

class MinHeap {
  private readonly values: RankedCandidate[] = []
  get size(): number { return this.values.length }
  push(value: RankedCandidate): void {
    this.values.push(value)
    let index = this.values.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.values[parent]!.rank <= value.rank) break
      this.values[index] = this.values[parent]!
      index = parent
    }
    this.values[index] = value
  }
  pop(): RankedCandidate | undefined {
    const first = this.values[0]
    const last = this.values.pop()
    if (first === undefined || last === undefined || this.values.length === 0) return first
    let index = 0
    while (true) {
      const left = index * 2 + 1
      if (left >= this.values.length) break
      const right = left + 1
      const child = right < this.values.length && this.values[right]!.rank < this.values[left]!.rank ? right : left
      if (this.values[child]!.rank >= last.rank) break
      this.values[index] = this.values[child]!
      index = child
    }
    this.values[index] = last
    return first
  }
}

function semanticOrder(
  candidates: readonly TrainingSupplyCandidateIdentity[],
  history: readonly TrainingSupplyCandidateIdentity[],
  seed: string,
): TrainingSupplyOrderAudit[] {
  const heap = new MinHeap()
  shuffle(candidates, seed).forEach((identity, rank) => heap.push({ identity, rank }))
  const semanticCounts = new Map<string, number>()
  const knowledgeCounts = new Map<string, number>()
  for (const identity of candidates) {
    semanticCounts.set(identity.semanticCategoryId, (semanticCounts.get(identity.semanticCategoryId) ?? 0) + 1)
    knowledgeCounts.set(identity.knowledgePointId, (knowledgeCounts.get(identity.knowledgePointId) ?? 0) + 1)
  }
  const result: TrainingSupplyOrderAudit[] = []
  let lastKnowledge = history.at(-1)?.knowledgePointId
  let lastSemantic = history.at(-1)?.semanticCategoryId
  let semanticRun = 0
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]!.semanticCategoryId !== lastSemantic) break
    semanticRun += 1
  }
  while (heap.size > 0) {
    let chosen: RankedCandidate | undefined
    let tier: 0 | 1 | 2 = 0
    const noSemanticAlternative = semanticRun >= 2 && lastSemantic !== undefined &&
      (semanticCounts.get(lastSemantic) ?? 0) === heap.size
    const noKnowledgeAlternative = lastKnowledge !== undefined &&
      (knowledgeCounts.get(lastKnowledge) ?? 0) === heap.size
    const tiers: readonly (0 | 1 | 2)[] = noKnowledgeAlternative
      ? [2]
      : noSemanticAlternative
        ? [1, 2]
        : [0, 1, 2]
    for (const requestedTier of tiers) {
      const held: RankedCandidate[] = []
      while (heap.size > 0) {
        const current = heap.pop()!
        const knowledgeBlocked = requestedTier < 2 && current.identity.knowledgePointId === lastKnowledge
        const semanticBlocked = requestedTier < 1 && semanticRun >= 2 && current.identity.semanticCategoryId === lastSemantic
        if (!knowledgeBlocked && !semanticBlocked) {
          chosen = current
          tier = requestedTier
          break
        }
        held.push(current)
      }
      held.forEach((item) => heap.push(item))
      if (chosen !== undefined) break
    }
    if (chosen === undefined) throw new TypeError('Semantic supply ordering made no progress')
    const identity = chosen.identity
    semanticCounts.set(identity.semanticCategoryId, semanticCounts.get(identity.semanticCategoryId)! - 1)
    knowledgeCounts.set(identity.knowledgePointId, knowledgeCounts.get(identity.knowledgePointId)! - 1)
    result.push({ ...identity, priorityReason: null, relaxationTier: tier })
    if (identity.semanticCategoryId === lastSemantic) semanticRun += 1
    else { lastSemantic = identity.semanticCategoryId; semanticRun = 1 }
    lastKnowledge = identity.knowledgePointId
  }
  return result
}

function createLegacyRound(input: CreateTrainingSupplyRoundInput): TrainingSupplyRound {
  const candidateItemIds = input.candidateItemIds ?? []
  assertDenseNonEmptyStrings(candidateItemIds, 'candidateItemIds')
  const priority = input.priorityItemIds ?? []
  assertDenseNonEmptyStrings(priority, 'priorityItemIds')
  const candidateIds = new Set(candidateItemIds)
  if (priority.some((itemId) => !candidateIds.has(itemId))) {
    throw new TypeError('priorityItemIds must be formal candidate identities')
  }
  const shortTermExcludedItemIds = input.shortTermExcludedItemIds.slice(-SHORT_TERM_EXCLUSION_WINDOW)
  const excluded = new Set(shortTermExcludedItemIds)
  const prioritySet = new Set(priority)
  const ordinary = candidateItemIds.filter((itemId) => !excluded.has(itemId) && !prioritySet.has(itemId))
  return {
    schemaVersion: 1,
    seed: input.seed,
    order: [...priority, ...shuffle(ordinary, input.seed)],
    cursor: 0,
    shortTermExcludedItemIds,
  }
}

export function createTrainingSupplyRound(
  input: CreateTrainingSupplyRoundInput & { readonly candidates: readonly TrainingSupplyCandidateIdentity[] },
): SemanticTrainingSupplyRound
export function createTrainingSupplyRound(input: CreateTrainingSupplyRoundInput): TrainingSupplyRound
export function createTrainingSupplyRound(input: CreateTrainingSupplyRoundInput): TrainingSupplyRound {
  if (typeof input.seed !== 'string' || input.seed.trim().length === 0) {
    throw new TypeError('Training supply round seed must be a non-empty string')
  }
  assertDenseNonEmptyStrings(input.shortTermExcludedItemIds, 'shortTermExcludedItemIds')
  if (input.candidates === undefined) return createLegacyRound(input)
  if (input.candidateItemIds !== undefined) throw new TypeError('Use candidates or candidateItemIds, not both')
  assertIdentities(input.candidates, 'candidates', true)
  const candidates = input.candidates.map(identityOnly)
  const inputHistory = (input.shortTermHistory ?? []).slice(-SHORT_TERM_EXCLUSION_WINDOW)
  assertIdentities(inputHistory, 'shortTermHistory', false)
  const shortTermHistory = inputHistory.map(identityOnly)
  if (shortTermHistory.some((item) => !input.shortTermExcludedItemIds.includes(item.itemId))) {
    throw new TypeError('shortTermHistory itemId values must be present in shortTermExcludedItemIds')
  }
  const byId = new Map(candidates.map((item) => [item.itemId, item]))
  const legacyPriority = (input.priorityItemIds ?? []).map((itemId) => ({ itemId, reason: 'legacy-explicit-priority' }))
  const priorityItems = input.priorityItems ?? legacyPriority
  if (input.priorityItems !== undefined && input.priorityItemIds !== undefined) {
    throw new TypeError('Use priorityItems or priorityItemIds, not both')
  }
  if (!Array.isArray(priorityItems)) throw new TypeError('priorityItems must be an array')
  const seenPriority = new Set<string>()
  const priorityAudit: TrainingSupplyOrderAudit[] = priorityItems.map((priority, index) => {
    if (typeof priority !== 'object' || priority === null || Array.isArray(priority) ||
      typeof priority.itemId !== 'string' || priority.itemId.trim().length === 0 ||
      typeof priority.reason !== 'string' || priority.reason.trim().length === 0) {
      throw new TypeError(`priorityItems[${index}] must contain itemId and reason`)
    }
    const identity = byId.get(priority.itemId)
    if (identity === undefined) throw new TypeError('priorityItems must be formal candidate identities')
    if (seenPriority.has(priority.itemId)) throw new TypeError('priorityItems must not contain duplicates')
    seenPriority.add(priority.itemId)
    return { ...identity, priorityReason: priority.reason, relaxationTier: 0 }
  })
  const excluded = new Set(input.shortTermExcludedItemIds)
  const ordinary = candidates.filter((item) => !excluded.has(item.itemId) && !seenPriority.has(item.itemId))
  const simulatedHistory = [...shortTermHistory, ...priorityAudit].slice(-SHORT_TERM_EXCLUSION_WINDOW)
  const orderAudit = [...priorityAudit, ...semanticOrder(ordinary, simulatedHistory, input.seed)]
  const relaxationTier = orderAudit.reduce<0 | 1 | 2>(
    (maximum, entry) => Math.max(maximum, entry.relaxationTier) as 0 | 1 | 2,
    0,
  )
  return {
    schemaVersion: 2,
    seed: input.seed,
    order: orderAudit.map((item) => item.itemId),
    cursor: 0,
    shortTermExcludedItemIds: input.shortTermExcludedItemIds.slice(-SHORT_TERM_EXCLUSION_WINDOW),
    shortTermHistory,
    orderAudit,
    relaxationTier,
  }
}

export function nextTrainingSupplyItem(round: TrainingSupplyRound): NextTrainingSupplyItem {
  assertTrainingSupplyRound(round)
  const itemId = round.order[round.cursor]
  if (itemId === undefined) {
    return { status: 'content-exhausted', reason: 'all-eligible-content-recently-used' }
  }
  if (round.schemaVersion === 1) return { status: 'item', itemId }
  const audit = round.orderAudit![round.cursor]!
  return { status: 'item', itemId, priorityReason: audit.priorityReason, relaxationTier: audit.relaxationTier }
}

export function recordTrainingSupplyItem(
  round: SemanticTrainingSupplyRound,
  itemId: string,
): SemanticTrainingSupplyRound
export function recordTrainingSupplyItem(round: TrainingSupplyRound, itemId: string): TrainingSupplyRound
export function recordTrainingSupplyItem(round: TrainingSupplyRound, itemId: string): TrainingSupplyRound {
  assertTrainingSupplyRound(round)
  if (typeof itemId !== 'string' || itemId.trim().length === 0) throw new TypeError('itemId must be a non-empty string')
  if (round.order[round.cursor - 1] === itemId) return round
  if (round.order[round.cursor] !== itemId) {
    throw new TypeError('Training supply item does not match the current round order')
  }
  const excluded = round.shortTermExcludedItemIds.includes(itemId)
    ? round.shortTermExcludedItemIds
    : [...round.shortTermExcludedItemIds, itemId].slice(-SHORT_TERM_EXCLUSION_WINDOW)
  if (round.schemaVersion === 1) {
    return { ...round, cursor: round.cursor + 1, shortTermExcludedItemIds: excluded }
  }
  const audit = round.orderAudit![round.cursor]!
  const history = [...round.shortTermHistory!, {
    itemId: audit.itemId,
    knowledgePointId: audit.knowledgePointId,
    semanticCategoryId: audit.semanticCategoryId,
  }].slice(-SHORT_TERM_EXCLUSION_WINDOW)
  return { ...round, cursor: round.cursor + 1, shortTermExcludedItemIds: excluded, shortTermHistory: history }
}

export function assertTrainingSupplyRound(value: unknown): asserts value is TrainingSupplyRound {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Training supply round must be an object')
  }
  const round = value as Record<string, unknown>
  if ((round.schemaVersion !== 1 && round.schemaVersion !== 2) ||
    typeof round.seed !== 'string' || round.seed.trim().length === 0 ||
    !Array.isArray(round.order) || !Array.isArray(round.shortTermExcludedItemIds) ||
    !Number.isInteger(round.cursor) || Number(round.cursor) < 0 || Number(round.cursor) > round.order.length) {
    throw new TypeError('Training supply round is invalid')
  }
  assertDenseNonEmptyStrings(round.order, 'order')
  assertDenseNonEmptyStrings(round.shortTermExcludedItemIds, 'shortTermExcludedItemIds')
  if (round.shortTermExcludedItemIds.length > SHORT_TERM_EXCLUSION_WINDOW) {
    throw new TypeError('shortTermExcludedItemIds exceeds its bounded window')
  }
  if (round.schemaVersion === 1) return
  if (!Array.isArray(round.shortTermHistory) || !Array.isArray(round.orderAudit) ||
    ![0, 1, 2].includes(round.relaxationTier as number) || round.orderAudit.length !== round.order.length) {
    throw new TypeError('Schema-2 training supply round is invalid')
  }
  assertIdentities(round.shortTermHistory as TrainingSupplyCandidateIdentity[], 'shortTermHistory', false)
  if (round.shortTermHistory.length > SHORT_TERM_EXCLUSION_WINDOW) {
    throw new TypeError('shortTermHistory exceeds its bounded window')
  }
  let maximumTier = 0
  const order = round.order as string[]
  round.orderAudit.forEach((entry, index) => {
    assertIdentity(entry, `orderAudit[${index}]`)
    const audit = entry as unknown as Record<string, unknown>
    if ((audit.priorityReason !== null &&
      (typeof audit.priorityReason !== 'string' || audit.priorityReason.trim().length === 0)) ||
      ![0, 1, 2].includes(audit.relaxationTier as number) || audit.itemId !== order[index]) {
      throw new TypeError(`orderAudit[${index}] is invalid`)
    }
    maximumTier = Math.max(maximumTier, Number(audit.relaxationTier))
  })
  if (maximumTier !== round.relaxationTier) {
    throw new TypeError('relaxationTier must equal the maximum audited tier')
  }
}
