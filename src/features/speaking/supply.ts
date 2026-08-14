import type {
  ExtraTrainingSupplyRequest,
  LearningTaskSupplyRequest,
  LearningTaskSupplyResult,
  TrainingSupplyCandidateIdentity,
  TrainingSupplyPriorityItem,
} from '../../learning-engine/index.ts'
import { assertTrainingSupplyRound, nextTrainingSupplyItem } from '../../learning-engine/index.ts'
import { SpeakingError } from './errors.ts'
import type {
  SpeakingCatalog,
  SpeakingPrompt,
  SpeakingSupplyItem,
  SpeakingTrainingUnit,
} from './types.ts'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function parseItem(value: unknown): SpeakingSupplyItem | null {
  const item = record(value)
  const source = item && record(item.source)
  if (!item || !source || item.domain !== 'speaking' || item.targetModuleId !== 'speaking' ||
    typeof item.itemId !== 'string' || typeof item.supplyOrder !== 'number' ||
    typeof item.learningUnitId !== 'string' || typeof item.contentRef !== 'string' ||
    typeof item.knowledgePointId !== 'string' || item.knowledgePointId.trim().length === 0 ||
    typeof item.semanticCategoryId !== 'string' || item.semanticCategoryId.trim().length === 0 ||
    typeof item.difficultyLevel !== 'number' || !Array.isArray(item.tags) ||
    !Array.isArray(item.allowedModes) || typeof item.nominalEffectiveSeconds !== 'number' ||
    (source.sourceType !== 'speaking-prompt' && source.sourceType !== 'speaking-scene-quiz') ||
    typeof source.sourceId !== 'string' ||
    (source.variantId !== 'activity-prompt' && source.variantId !== 'scene-fixed-response')) {
    return null
  }
  return item as unknown as SpeakingSupplyItem
}

function eligible(
  item: SpeakingSupplyItem,
  request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
): boolean {
  if (!(item.allowedModes as readonly string[]).includes(request.mode)) return false
  return request.targetDifficulty < 0.5
    ? item.difficultyLevel >= 0.5 && item.difficultyLevel <= 2.5
    : Math.abs(item.difficultyLevel - request.targetDifficulty) <= 1.5
}

export interface SpeakingSupplyProvider {
  next(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): Promise<LearningTaskSupplyResult>
}

export type SpeakingEligibleCandidateIdentitiesResult =
  | {
      readonly schemaVersion: 1
      readonly requestId: string
      readonly status: 'eligible-candidates'
      readonly candidates: readonly TrainingSupplyCandidateIdentity[]
      readonly priorityItems: readonly TrainingSupplyPriorityItem[]
    }
  | {
      readonly schemaVersion: 1
      readonly requestId: string
      readonly status: 'content-exhausted'
      readonly reason: 'no-eligible-content' | 'all-eligible-content-recently-used' | 'provider-failure'
    }

export interface SpeakingEligibleCandidateIdentitiesProvider {
  eligibleCandidateIdentities(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): Promise<SpeakingEligibleCandidateIdentitiesResult>
}

function isExtraTrainingRequest(
  request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
): request is ExtraTrainingSupplyRequest {
  return 'priority' in request
}

/** Strict local adapter for the 05 index; it never invents prompts or repeats excluded IDs. */
export class SpeakingCatalogSupplyProvider implements SpeakingSupplyProvider, SpeakingEligibleCandidateIdentitiesProvider {
  private readonly items: readonly SpeakingSupplyItem[]

  constructor(index: unknown, catalog: SpeakingCatalog) {
    const root = record(index)
    if (!root || root.schemaVersion !== 1 || !Array.isArray(root.candidates)) {
      throw new SpeakingError('content-invalid', 'Speaking training supply index is missing or unsupported.')
    }
    const items = root.candidates
      .filter((candidate) => record(candidate)?.domain === 'speaking')
      .map(parseItem)
    if (items.some((item) => item === null)) {
      throw new SpeakingError('content-invalid', 'Speaking training supply index contains an invalid candidate.')
    }
    this.items = (items as SpeakingSupplyItem[]).sort((a, b) =>
      Number(a.supplyOrder) - Number(b.supplyOrder),
    )
    if (new Set(this.items.map((item) => item.itemId)).size !== this.items.length ||
      this.items.some((item) => !resolveSpeakingSupplyPrompt(catalog, item))) {
      throw new SpeakingError('content-invalid', 'Speaking training supply index has duplicate or unresolved sources.')
    }
  }

  async eligibleCandidateIdentities(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): Promise<SpeakingEligibleCandidateIdentitiesResult> {
    const base = { schemaVersion: 1, requestId: request.requestId } as const
    if (request.schemaVersion !== 1 || request.domain !== 'speaking' || request.targetModuleId !== 'speaking') {
      return { ...base, status: 'content-exhausted', reason: 'provider-failure' }
    }
    const eligibleItems = this.items.filter((item) => eligible(item, request))
    if (eligibleItems.length === 0) {
      return { ...base, status: 'content-exhausted', reason: 'no-eligible-content' }
    }
    const itemsById = new Map(this.items.map((item) => [item.itemId, item]))
    const priorityReasonById = new Map<string, string>()
    if (isExtraTrainingRequest(request)) {
      for (const reason of request.priority) {
        for (const itemId of request.priorityItemIds[reason]) {
          if (!itemsById.has(itemId)) {
            return { ...base, status: 'content-exhausted', reason: 'provider-failure' }
          }
          if (!priorityReasonById.has(itemId)) priorityReasonById.set(itemId, reason)
        }
      }
    }
    const excluded = new Set(request.excludeItemIds)
    const available = eligibleItems.filter((item) =>
      !excluded.has(item.itemId) || priorityReasonById.has(item.itemId),
    )
    if (available.length === 0) {
      return { ...base, status: 'content-exhausted', reason: 'all-eligible-content-recently-used' }
    }
    const candidates = available.map(({ itemId, knowledgePointId, semanticCategoryId }) => ({
        itemId,
        knowledgePointId,
        semanticCategoryId,
      }))
    const availableIds = new Set(candidates.map((item) => item.itemId))
    const priorityItems = [...priorityReasonById]
      .filter(([itemId]) => availableIds.has(itemId))
      .map(([itemId, reason]) => ({ itemId, reason }))
    return { ...base, status: 'eligible-candidates', candidates, priorityItems }
  }

  async next(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): Promise<LearningTaskSupplyResult> {
    const base = { requestId: request.requestId } as const
    if (request.domain !== 'speaking' || request.targetModuleId !== 'speaking') {
      return { schemaVersion: 1, ...base, status: 'content-exhausted', reason: 'provider-failure' }
    }
    const candidates = this.items.filter((item) => eligible(item, request))
    if (!candidates.length) return { schemaVersion: 1, ...base, status: 'content-exhausted', reason: 'no-eligible-content' }
    const excluded = new Set(request.excludeItemIds)
    const available = candidates.filter((item) => !excluded.has(item.itemId))
    if (request.supplyRound !== undefined) {
      try { assertTrainingSupplyRound(request.supplyRound) } catch {
        return { schemaVersion: 1, ...base, status: 'content-exhausted', reason: 'provider-failure' }
      }
      const next = nextTrainingSupplyItem(request.supplyRound)
      if (next.status === 'content-exhausted') return { schemaVersion: 1, ...base, status: 'content-exhausted', reason: next.reason }
      const audit = request.supplyRound.schemaVersion === 2
        ? request.supplyRound.orderAudit[request.supplyRound.cursor]
        : undefined
      const item = candidates.find((candidate) => candidate.itemId === next.itemId &&
        (!excluded.has(candidate.itemId) ||
          (audit !== undefined && audit.priorityReason !== null &&
            isExtraTrainingRequest(request) && request.priority.some((reason) =>
              reason === audit.priorityReason &&
              request.priorityItemIds[reason].includes(candidate.itemId)))))
      if (!item || (audit !== undefined &&
        (audit.knowledgePointId !== item.knowledgePointId ||
          audit.semanticCategoryId !== item.semanticCategoryId))) {
        return { schemaVersion: 1, ...base, status: 'content-exhausted', reason: 'provider-failure' }
      }
      return { schemaVersion: 1, ...base, status: 'item', item, nextCursor: item.itemId }
    }
    if (!available.length) return { schemaVersion: 1, ...base, status: 'content-exhausted', reason: 'all-eligible-content-recently-used' }
    if (isExtraTrainingRequest(request)) {
      const allPriorityIds = request.priority.flatMap(
        (priority) => request.priorityItemIds[priority],
      )
      if (allPriorityIds.some((itemId) => !this.items.some((item) => item.itemId === itemId))) {
        return { schemaVersion: 1, ...base, status: 'content-exhausted', reason: 'provider-failure' }
      }
      for (const priority of request.priority) {
        const item = request.priorityItemIds[priority]
          .map((itemId) => this.items.find((candidate) => candidate.itemId === itemId)!)
          .find((candidate) => available.includes(candidate))
        if (item) return { schemaVersion: 1, ...base, status: 'item', item, nextCursor: item.itemId }
      }
    }
    const cursor = request.cursor
    const cursorIndex = cursor === null ? -1 : candidates.findIndex((item) => item.itemId === cursor)
    if (cursor !== null && cursorIndex < 0) return { schemaVersion: 1, ...base, status: 'content-exhausted', reason: 'provider-failure' }
    const ordered = [...candidates.slice(cursorIndex + 1), ...candidates.slice(0, cursorIndex + 1)]
    const item = ordered.find((candidate) => !excluded.has(candidate.itemId))
    if (!item) return { schemaVersion: 1, ...base, status: 'content-exhausted', reason: 'all-eligible-content-recently-used' }
    return { schemaVersion: 1, ...base, status: 'item', item, nextCursor: item.itemId }
  }
}

export function resolveSpeakingSupplyPrompt(
  catalog: SpeakingCatalog,
  item: SpeakingSupplyItem,
): { readonly unit: SpeakingTrainingUnit; readonly prompt: SpeakingPrompt } {
  const unit = catalog.getUnit(item.contentRef)
  const prompt = item.source.sourceType === 'speaking-prompt'
    ? unit?.prompts.find((candidate) => candidate.id === item.source.sourceId)
    : unit?.scenePrompts.find((candidate) => candidate.id === item.source.sourceId)
  if (!unit || unit.learningUnitId !== item.learningUnitId || !prompt ||
    (item.source.sourceType === 'speaking-prompt' && item.source.variantId !== 'activity-prompt') ||
    (item.source.sourceType === 'speaking-scene-quiz' && item.source.variantId !== 'scene-fixed-response')) {
    throw new SpeakingError('content-reference-missing', 'Speaking supply item does not resolve to a released prompt.')
  }
  return { unit, prompt }
}
