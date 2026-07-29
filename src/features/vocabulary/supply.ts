import type {
  ExtraTrainingSupplyRequest,
  LearningTaskSupplyRequest,
  LearningTaskSupplyResult,
} from '../../learning-engine/index.ts'
import { VocabularyError } from './errors.ts'
import type { VocabularyCatalog, VocabularySupplyItem } from './types.ts'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry)
    ? value as readonly string[]
    : null
}

type IndexedVocabularySupplyItem = VocabularySupplyItem & {
  readonly supplyOrder: number
  readonly allowedModes: readonly string[]
  readonly variantFamilyId: string
}

function parseItem(value: unknown): IndexedVocabularySupplyItem {
  if (!isRecord(value) || !isRecord(value.source)) {
    throw new VocabularyError('content-invalid', 'Training supply item must be an object.')
  }
  const tags = strings(value.tags)
  const modes = strings(value.allowedModes)
  const distractorItemIds = strings(value.source.distractorItemIds)
  if (
    typeof value.itemId !== 'string' || typeof value.learningUnitId !== 'string' ||
    typeof value.contentRef !== 'string' || typeof value.difficultyLevel !== 'number' ||
    !Number.isFinite(value.difficultyLevel) || typeof value.supplyOrder !== 'number' ||
    !Number.isInteger(value.supplyOrder) || typeof value.variantFamilyId !== 'string' ||
    value.variantFamilyId.length === 0 || !tags || !modes ||
    value.source.sourceType !== 'vocabulary-item' || typeof value.source.sourceId !== 'string' ||
    !['term-to-meaning-choice', 'meaning-to-term-choice', 'example-gap-choice'].includes(String(value.source.variantId)) ||
    !distractorItemIds
  ) {
    throw new VocabularyError('content-invalid', 'Training supply item has invalid vocabulary fields.')
  }
  return {
    itemId: value.itemId,
    learningUnitId: value.learningUnitId,
    contentRef: value.contentRef,
    difficultyLevel: value.difficultyLevel,
    tags,
    supplyOrder: value.supplyOrder,
    allowedModes: modes,
    variantFamilyId: value.variantFamilyId,
    source: {
      sourceType: 'vocabulary-item',
      sourceId: value.source.sourceId,
      variantId: value.source.variantId as VocabularySupplyItem['source']['variantId'],
      distractorItemIds,
    },
  }
}

export interface VocabularySupplyProvider {
  next(request: LearningTaskSupplyRequest): Promise<LearningTaskSupplyResult>
}

/** R6 provider: preserves 05's exact extra-training priority ordering. */
export interface ExtraVocabularySupplyProvider {
  next(request: ExtraTrainingSupplyRequest): Promise<LearningTaskSupplyResult>
}

/** Strict, local implementation of the 05 training-supply handoff v1 selection. */
export class VocabularyCatalogSupplyProvider implements VocabularySupplyProvider, ExtraVocabularySupplyProvider {
  private readonly items: readonly IndexedVocabularySupplyItem[]

  constructor(index: unknown, catalog: VocabularyCatalog) {
    if (!isRecord(index) || index.schemaVersion !== 1 || !Array.isArray(index.candidates)) {
      throw new VocabularyError('content-invalid', 'Training supply index is unavailable or unsupported.')
    }
    this.items = index.candidates
      .filter((candidate) => isRecord(candidate) && candidate.domain === 'vocabulary' && candidate.targetModuleId === 'vocabulary')
      .map(parseItem)
      .sort((left, right) => left.supplyOrder - right.supplyOrder)
    const ids = new Set<string>()
    for (const item of this.items) {
      if (ids.has(item.itemId) || !catalog.getUnit(item.contentRef) || !catalog.getItem(item.source.sourceId) ||
        item.source.distractorItemIds.some((id) => !catalog.getItem(id))) {
        throw new VocabularyError('content-invalid', 'Training supply index references unavailable vocabulary content.')
      }
      ids.add(item.itemId)
    }
  }

  async next(request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest): Promise<LearningTaskSupplyResult> {
    if (request.schemaVersion !== 1 || request.domain !== 'vocabulary' || request.targetModuleId !== 'vocabulary') {
      return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'provider-failure' }
    }
    const eligible = this.items.filter((item) =>
      item.allowedModes.includes(request.mode) &&
      (request.targetDifficulty < 0.5
        ? item.difficultyLevel >= 0.5 && item.difficultyLevel <= 2.5
        : Math.abs(item.difficultyLevel - request.targetDifficulty) <= 1.5),
    )
    if (eligible.length === 0) {
      return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'no-eligible-content' }
    }
    const excluded = new Set(request.excludeItemIds)
    const available = eligible.filter((item) => !excluded.has(item.itemId))
    if (available.length === 0) {
      return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'all-eligible-content-recently-used' }
    }
    if ('priority' in request) {
      const allIds = request.priority.flatMap((priority) => request.priorityItemIds[priority])
      if (allIds.some((itemId) => !this.items.some((item) => item.itemId === itemId))) {
        return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'provider-failure' }
      }
      for (const priority of request.priority) {
        const ids = request.priorityItemIds[priority]
        if (priority === 'recent-error' || priority === 'due-review') {
          const selected = ids
            .map((itemId) => this.items.find((item) => item.itemId === itemId)!)
            .find((item) => available.includes(item))
          if (selected) return { schemaVersion: 1, requestId: request.requestId, status: 'item', item: selected, nextCursor: selected.itemId }
        } else if (priority === 'same-day-variant') {
          const selected = ids
            .flatMap((itemId) => {
              const source = this.items.find((item) => item.itemId === itemId)!
              return available.filter((item) => item.itemId !== itemId && item.variantFamilyId === source.variantFamilyId)
            })
            .sort((left, right) => left.supplyOrder - right.supplyOrder)[0]
          if (selected) return { schemaVersion: 1, requestId: request.requestId, status: 'item', item: selected, nextCursor: selected.itemId }
        }
      }
    }
    const cursorIndex = request.cursor === null ? -1 : eligible.findIndex((item) => item.itemId === request.cursor)
    if (request.cursor !== null && cursorIndex < 0) {
      return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'provider-failure' }
    }
    const ordered = request.cursor === null
      ? eligible
      : [...eligible.slice(cursorIndex + 1), ...eligible.slice(0, cursorIndex + 1)]
    const item = ordered.find((candidate) => !excluded.has(candidate.itemId))
    if (!item) {
      return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'all-eligible-content-recently-used' }
    }
    return { schemaVersion: 1, requestId: request.requestId, status: 'item', item, nextCursor: item.itemId }
  }
}
