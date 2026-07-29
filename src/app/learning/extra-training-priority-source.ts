import type { ReadonlyDataSource } from '../../core/index.ts'
import type {
  ExtraTrainingPriorityItemIds,
  LearningEngineState,
  TrainingModuleId,
} from '../../learning-engine/index.ts'
import type { ActiveLearningRuntime } from './active-plan-repository.ts'

interface TrainingSupplyCatalog {
  readonly trainingSupplyIndex?: unknown
}

interface IndexedSupplyCandidate {
  readonly itemId: string
  readonly supplyOrder: number
  readonly domain: TrainingModuleId
  readonly targetModuleId: TrainingModuleId
  readonly learningUnitId: string
  readonly contentRef: string
  readonly allowedModes: readonly string[]
}

export interface ExtraTrainingPriorityInput {
  readonly moduleId: TrainingModuleId
  readonly localDate: string
  readonly asOf: string
  readonly runtime: ActiveLearningRuntime
  readonly engineState: LearningEngineState
}

export interface ExtraTrainingPrioritySource {
  load(
    input: ExtraTrainingPriorityInput,
  ): Promise<ExtraTrainingPriorityItemIds>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseCandidate(
  value: unknown,
  index: number,
): IndexedSupplyCandidate {
  if (!isRecord(value)) {
    throw new TypeError(
      `trainingSupplyIndex.candidates[${index}] must be an object.`,
    )
  }
  if (
    !nonEmptyString(value.itemId) ||
    !Number.isInteger(value.supplyOrder) ||
    (value.supplyOrder as number) < 1 ||
    (value.domain !== 'vocabulary' &&
      value.domain !== 'listening' &&
      value.domain !== 'speaking') ||
    value.targetModuleId !== value.domain ||
    !nonEmptyString(value.learningUnitId) ||
    !nonEmptyString(value.contentRef) ||
    !Array.isArray(value.allowedModes) ||
    value.allowedModes.some((mode) => !nonEmptyString(mode))
  ) {
    throw new TypeError(
      `trainingSupplyIndex.candidates[${index}] is invalid.`,
    )
  }
  const domain = value.domain
  return {
    itemId: value.itemId,
    supplyOrder: value.supplyOrder as number,
    domain,
    targetModuleId: domain,
    learningUnitId: value.learningUnitId,
    contentRef: value.contentRef,
    allowedModes: value.allowedModes,
  }
}

function parseSupplyIndex(value: unknown): readonly IndexedSupplyCandidate[] {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.documentType !== 'continuous-training-supply-index' ||
    !Array.isArray(value.candidates)
  ) {
    throw new TypeError(
      'Released training supply index is not schema version 1.',
    )
  }
  const candidates = value.candidates
    .map(parseCandidate)
    .sort((left, right) => left.supplyOrder - right.supplyOrder)
  const itemIds = new Set<string>()
  for (const candidate of candidates) {
    if (itemIds.has(candidate.itemId)) {
      throw new TypeError(
        `Released training supply index contains duplicate itemId ${candidate.itemId}.`,
      )
    }
    itemIds.add(candidate.itemId)
  }
  return candidates
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)]
}

function dueAtOrBefore(
  timestamp: string | null,
  asOfMs: number,
): boolean {
  return timestamp !== null && Date.parse(timestamp) <= asOfMs
}

/**
 * Projects durable learning history onto 05's released candidate IDs.
 *
 * The engine intentionally stores learning-unit evidence rather than a
 * feature-owned item ID. This adapter therefore expands an exact unit
 * identity only to candidate IDs that actually exist in the released index.
 * It never synthesizes an item ID or ranks answers itself.
 */
export class ProductionExtraTrainingPrioritySource
  implements ExtraTrainingPrioritySource
{
  readonly #source: ReadonlyDataSource<TrainingSupplyCatalog>
  #candidatesPromise: Promise<readonly IndexedSupplyCandidate[]> | null =
    null

  constructor(source: ReadonlyDataSource<TrainingSupplyCatalog>) {
    this.#source = source
  }

  async load(
    input: ExtraTrainingPriorityInput,
  ): Promise<ExtraTrainingPriorityItemIds> {
    const asOfMs = Date.parse(input.asOf)
    if (!Number.isFinite(asOfMs)) {
      throw new TypeError('Extra-training priority asOf is invalid.')
    }
    const candidates = (await this.#candidates()).filter(
      (candidate) =>
        candidate.domain === input.moduleId &&
        candidate.targetModuleId === input.moduleId &&
        candidate.allowedModes.includes('learn'),
    )
    const candidateIds = new Set(
      candidates.map((candidate) => candidate.itemId),
    )
    const idsForUnits = (unitIds: readonly string[]) => {
      const order = new Map(
        unique(unitIds).map((unitId, index) => [unitId, index]),
      )
      return candidates
        .filter((candidate) => order.has(candidate.learningUnitId))
        .sort((left, right) => {
          const unitOrder =
            (order.get(left.learningUnitId) ?? 0) -
            (order.get(right.learningUnitId) ?? 0)
          return unitOrder || left.supplyOrder - right.supplyOrder
        })
        .map((candidate) => candidate.itemId)
    }

    const recentErrorUnits = [...input.engineState.progress.attempts]
      .reverse()
      .filter(
        (attempt) =>
          attempt.domain === input.moduleId &&
          (attempt.errorTags.length > 0 ||
            attempt.performanceScore < 1),
      )
      .map((attempt) => attempt.learningUnitId)
    const dueReviewUnits = Object.values(
      input.engineState.reviewItems,
    )
      .filter(
        (item) =>
          item.domain === input.moduleId &&
          (dueAtOrBefore(item.retryAt, asOfMs) ||
            dueAtOrBefore(item.nextReviewAt, asOfMs)),
      )
      .sort((left, right) => {
        const leftAt = left.retryAt ?? left.nextReviewAt
        const rightAt = right.retryAt ?? right.nextReviewAt
        return leftAt.localeCompare(rightAt)
      })
      .map((item) => item.learningUnitId)
    const sameDayItemIds = unique([
      ...input.runtime.activePlan.tasks
        .filter(
          (execution) =>
            execution.task.targetModuleId === input.moduleId,
        )
        .flatMap(
          (execution) =>
            execution.training?.completedItemIds ?? [],
        ),
      ...Object.values(
        input.engineState.extraTraining?.sessions ?? {},
      )
        .filter(
          (session) =>
            session.localDate === input.localDate &&
            session.targetModuleId === input.moduleId,
        )
        .flatMap((session) => session.excludeItemIds),
    ]).filter((itemId) => candidateIds.has(itemId))

    const claimed = new Set<string>()
    const claim = (itemIds: readonly string[]) =>
      itemIds.filter((itemId) => {
        if (!candidateIds.has(itemId) || claimed.has(itemId)) {
          return false
        }
        claimed.add(itemId)
        return true
      })

    return {
      'recent-error': claim(idsForUnits(recentErrorUnits)),
      'due-review': claim(idsForUnits(dueReviewUnits)),
      'same-day-variant': claim(sameDayItemIds),
      'new-optional-content': [],
    }
  }

  #candidates(): Promise<readonly IndexedSupplyCandidate[]> {
    if (!this.#candidatesPromise) {
      this.#candidatesPromise = this.#source
        .load()
        .then((catalog) => {
          if (catalog.trainingSupplyIndex === undefined) {
            throw new TypeError(
              'Released content package has no training supply index.',
            )
          }
          return parseSupplyIndex(catalog.trainingSupplyIndex)
        })
        .catch((error: unknown) => {
          this.#candidatesPromise = null
          throw error
        })
    }
    return this.#candidatesPromise
  }
}

export const emptyExtraTrainingPrioritySource: ExtraTrainingPrioritySource = {
  async load() {
    return {
      'recent-error': [],
      'due-review': [],
      'same-day-variant': [],
      'new-optional-content': [],
    }
  },
}
