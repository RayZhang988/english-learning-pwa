import type {
  LearningTaskSupplyRequest,
  LearningTaskSupplyResult,
} from '../../learning-engine/index.ts'
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
    typeof item.difficultyLevel !== 'number' || !Array.isArray(item.tags) ||
    !Array.isArray(item.allowedModes) || typeof item.nominalEffectiveSeconds !== 'number' ||
    (source.sourceType !== 'speaking-prompt' && source.sourceType !== 'speaking-scene-quiz') ||
    typeof source.sourceId !== 'string' ||
    (source.variantId !== 'activity-prompt' && source.variantId !== 'scene-fixed-response')) {
    return null
  }
  return item as unknown as SpeakingSupplyItem
}

function eligible(item: SpeakingSupplyItem, request: LearningTaskSupplyRequest): boolean {
  if (!(item.allowedModes as readonly string[]).includes(request.mode)) return false
  return request.targetDifficulty < 0.5
    ? item.difficultyLevel >= 0.5 && item.difficultyLevel <= 2.5
    : Math.abs(item.difficultyLevel - request.targetDifficulty) <= 1.5
}

export interface SpeakingSupplyProvider {
  next(request: LearningTaskSupplyRequest): Promise<LearningTaskSupplyResult>
}

/** Strict local adapter for the 05 index; it never invents prompts or repeats excluded IDs. */
export class SpeakingCatalogSupplyProvider implements SpeakingSupplyProvider {
  private readonly items: readonly SpeakingSupplyItem[]

  constructor(index: unknown, catalog: SpeakingCatalog) {
    const root = record(index)
    if (!root || root.schemaVersion !== 1 || !Array.isArray(root.candidates)) {
      throw new SpeakingError('content-invalid', 'Speaking training supply index is missing or unsupported.')
    }
    const items = root.candidates.map(parseItem)
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

  async next(request: LearningTaskSupplyRequest): Promise<LearningTaskSupplyResult> {
    const base = { requestId: request.requestId } as const
    if (request.domain !== 'speaking' || request.targetModuleId !== 'speaking') {
      return { schemaVersion: 1, ...base, status: 'content-exhausted', reason: 'provider-failure' }
    }
    const candidates = this.items.filter((item) => eligible(item, request))
    if (!candidates.length) return { schemaVersion: 1, ...base, status: 'content-exhausted', reason: 'no-eligible-content' }
    const cursor = request.cursor
    const cursorIndex = cursor === null ? -1 : candidates.findIndex((item) => item.itemId === cursor)
    if (cursor !== null && cursorIndex < 0) return { schemaVersion: 1, ...base, status: 'content-exhausted', reason: 'provider-failure' }
    const excluded = new Set(request.excludeItemIds)
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
  const prompt = unit?.prompts.find((candidate) => candidate.id === item.source.sourceId)
  if (!unit || unit.learningUnitId !== item.learningUnitId || !prompt ||
    (item.source.sourceType === 'speaking-prompt' && item.source.variantId !== 'activity-prompt') ||
    (item.source.sourceType === 'speaking-scene-quiz' && item.source.variantId !== 'scene-fixed-response')) {
    throw new SpeakingError('content-reference-missing', 'Speaking supply item does not resolve to a released prompt.')
  }
  return { unit, prompt }
}
