import type {
  LearningTaskSupplyRequest,
  LearningTaskSupplyResult,
} from '../../learning-engine/index.ts'
import { ListeningError } from './errors.ts'
import type { ListeningCatalog, ListeningSupplyItem } from './types.ts'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry)
    ? value as readonly string[]
    : null
}

type IndexedListeningSupplyItem = ListeningSupplyItem & {
  readonly supplyOrder: number
  readonly allowedModes: readonly string[]
}

function parseItem(value: unknown): IndexedListeningSupplyItem {
  if (!isRecord(value) || !isRecord(value.source)) {
    throw new ListeningError('content-invalid', 'Training supply item must be an object.')
  }
  const tags = strings(value.tags)
  const modes = strings(value.allowedModes)
  const sourceTypes = ['listening-extension', 'listening-core-check', 'listening-scene-quiz']
  if (
    typeof value.itemId !== 'string' || typeof value.learningUnitId !== 'string' ||
    typeof value.contentRef !== 'string' || typeof value.difficultyLevel !== 'number' ||
    !Number.isFinite(value.difficultyLevel) || typeof value.supplyOrder !== 'number' ||
    !Number.isInteger(value.supplyOrder) || !tags || !modes ||
    !sourceTypes.includes(String(value.source.sourceType)) ||
    typeof value.source.sourceId !== 'string' || typeof value.source.variantId !== 'string'
  ) {
    throw new ListeningError('content-invalid', 'Training supply item has invalid listening fields.')
  }
  return {
    itemId: value.itemId,
    learningUnitId: value.learningUnitId,
    contentRef: value.contentRef,
    difficultyLevel: value.difficultyLevel,
    tags,
    supplyOrder: value.supplyOrder,
    allowedModes: modes,
    source: {
      sourceType: value.source.sourceType as ListeningSupplyItem['source']['sourceType'],
      sourceId: value.source.sourceId,
      variantId: value.source.variantId,
    },
  }
}

export interface ListeningSupplyProvider {
  next(request: LearningTaskSupplyRequest): Promise<LearningTaskSupplyResult>
}

/** Strict, local implementation of the 05 training-supply handoff v1 selection. */
export class ListeningCatalogSupplyProvider implements ListeningSupplyProvider {
  private readonly items: readonly IndexedListeningSupplyItem[]

  constructor(index: unknown, catalog: ListeningCatalog) {
    if (!isRecord(index) || index.schemaVersion !== 1 || !Array.isArray(index.candidates)) {
      throw new ListeningError('content-invalid', 'Training supply index is unavailable or unsupported.')
    }
    this.items = index.candidates
      .filter((candidate) => isRecord(candidate) && candidate.domain === 'listening' && candidate.targetModuleId === 'listening')
      .map(parseItem)
      .sort((left, right) => left.supplyOrder - right.supplyOrder)
    const ids = new Set<string>()
    for (const item of this.items) {
      const unit = catalog.getUnit(item.contentRef)
      const question = unit?.questions.find((candidate) => candidate.id === item.source.sourceId)
      if (
        ids.has(item.itemId) || !unit || unit.learningUnitId !== item.learningUnitId || !question ||
        !matchesSource(question.type, item.source.sourceType, item.source.variantId)
      ) {
        throw new ListeningError('content-invalid', 'Training supply index references unavailable listening content.')
      }
      ids.add(item.itemId)
    }
  }

  async next(request: LearningTaskSupplyRequest): Promise<LearningTaskSupplyResult> {
    if (request.schemaVersion !== 1 || request.domain !== 'listening' || request.targetModuleId !== 'listening') {
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
    if (eligible.every((item) => excluded.has(item.itemId))) {
      return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'all-eligible-content-recently-used' }
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

export function resolveListeningSupplyQuestion(
  catalog: ListeningCatalog,
  item: ListeningSupplyItem,
) {
  const unit = catalog.getUnit(item.contentRef)
  const question = unit?.questions.find((candidate) => candidate.id === item.source.sourceId)
  if (!unit || unit.learningUnitId !== item.learningUnitId || !question ||
    !matchesSource(question.type, item.source.sourceType, item.source.variantId)) {
    throw new ListeningError('content-reference-missing', 'Listening supply item cannot be resolved.')
  }
  return { unit, question }
}

function matchesSource(
  type: string,
  sourceType: ListeningSupplyItem['source']['sourceType'],
  variantId: string,
): boolean {
  if (sourceType === 'listening-extension') {
    return type === variantId && ['word-discrimination', 'short-sentence-choice', 'keyword-dictation'].includes(type)
  }
  if (sourceType === 'listening-core-check') {
    return type === 'core-information' && variantId === 'full-transcript-detail-choice'
  }
  return type === 'scene-comprehension' && variantId === 'scene-audio-single-choice'
}
