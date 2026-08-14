import type {
  ExtraTrainingSupplyRequest,
  LearningTaskSupplyRequest,
  LearningTaskSupplyResult,
  TrainingSupplyCandidateIdentity,
} from '../../learning-engine/index.ts'
import { assertTrainingSupplyRound, nextTrainingSupplyItem } from '../../learning-engine/index.ts'
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
    value.variantFamilyId.length === 0 || typeof value.knowledgePointId !== 'string' ||
    value.knowledgePointId.trim().length === 0 || typeof value.semanticCategoryId !== 'string' ||
    value.semanticCategoryId.trim().length === 0 || !tags || !modes ||
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
    knowledgePointId: value.knowledgePointId,
    semanticCategoryId: value.semanticCategoryId,
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

export type VocabularyEligibleItemIdsResult =
  | {
      readonly schemaVersion: 1
      readonly requestId: string
      readonly status: 'eligible-items'
      readonly itemIds: readonly string[]
    }
  | {
      readonly schemaVersion: 1
      readonly requestId: string
      readonly status: 'invalid-request'
      readonly reason: 'provider-failure'
    }

export interface VocabularyEligibleItemIdsProvider {
  eligibleItemIds(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): Promise<VocabularyEligibleItemIdsResult>
}

export type VocabularyEligibleCandidateIdentitiesResult =
  | {
      readonly schemaVersion: 2
      readonly requestId: string
      readonly status: 'eligible-candidates'
      readonly candidates: readonly TrainingSupplyCandidateIdentity[]
    }
  | {
      readonly schemaVersion: 2
      readonly requestId: string
      readonly status: 'invalid-request'
      readonly reason: 'provider-failure'
    }

export interface VocabularyEligibleCandidateIdentitiesProvider {
  eligibleCandidateIdentities(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): Promise<VocabularyEligibleCandidateIdentitiesResult>
}

/** R6 provider: preserves 05's exact extra-training priority ordering. */
export interface ExtraVocabularySupplyProvider {
  next(request: ExtraTrainingSupplyRequest): Promise<LearningTaskSupplyResult>
}

/** Strict, local implementation of the 05 training-supply handoff v1 selection. */
export class VocabularyCatalogSupplyProvider implements VocabularySupplyProvider, ExtraVocabularySupplyProvider, VocabularyEligibleItemIdsProvider, VocabularyEligibleCandidateIdentitiesProvider {
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

  async eligibleItemIds(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): Promise<VocabularyEligibleItemIdsResult> {
    if (!this.isValidRequest(request)) {
      return {
        schemaVersion: 1,
        requestId: request.requestId,
        status: 'invalid-request',
        reason: 'provider-failure',
      }
    }
    return {
      schemaVersion: 1,
      requestId: request.requestId,
      status: 'eligible-items',
      itemIds: this.eligibleItems(request).map((item) => item.itemId),
    }
  }

  async eligibleCandidateIdentities(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): Promise<VocabularyEligibleCandidateIdentitiesResult> {
    if (!this.isValidRequest(request)) {
      return { schemaVersion: 2, requestId: request.requestId, status: 'invalid-request', reason: 'provider-failure' }
    }
    return {
      schemaVersion: 2,
      requestId: request.requestId,
      status: 'eligible-candidates',
      candidates: this.eligibleItems(request).map((item) => ({
        itemId: item.itemId,
        knowledgePointId: item.knowledgePointId,
        semanticCategoryId: item.semanticCategoryId,
      })),
    }
  }

  async next(request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest): Promise<LearningTaskSupplyResult> {
    if (!this.isValidRequest(request)) {
      return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'provider-failure' }
    }
    const eligible = this.eligibleItems(request)
    if (eligible.length === 0) {
      return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'no-eligible-content' }
    }
    const excluded = new Set(request.excludeItemIds)
    const available = eligible.filter((item) => !excluded.has(item.itemId))
    if (available.length === 0) {
      return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'all-eligible-content-recently-used' }
    }
    if (request.supplyRound !== undefined) {
      try {
        assertTrainingSupplyRound(request.supplyRound)
      } catch {
        return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'provider-failure' }
      }
      const next = nextTrainingSupplyItem(request.supplyRound)
      if (next.status === 'content-exhausted') {
        return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: next.reason }
      }
      if (next.priorityReason !== undefined && next.priorityReason !== null &&
        (!('priority' in request) || !request.priority.includes(next.priorityReason as typeof request.priority[number]))) {
        return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'provider-failure' }
      }
      const item = available.find((candidate) => candidate.itemId === next.itemId)
      if (!item) {
        return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'provider-failure' }
      }
      return { schemaVersion: 1, requestId: request.requestId, status: 'item', item, nextCursor: item.itemId }
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

  private isValidRequest(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): boolean {
    return request.schemaVersion === 1 && request.domain === 'vocabulary' &&
      request.targetModuleId === 'vocabulary' && Number.isFinite(request.targetDifficulty)
  }

  private eligibleItems(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): readonly IndexedVocabularySupplyItem[] {
    return this.items.filter((item) =>
      item.allowedModes.includes(request.mode) &&
      (request.targetDifficulty < 0.5
        ? item.difficultyLevel >= 0.5 && item.difficultyLevel <= 2.5
        : Math.abs(item.difficultyLevel - request.targetDifficulty) <= 1.5),
    )
  }
}
