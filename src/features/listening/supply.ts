import type {
  ExtraTrainingSupplyRequest,
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
  readonly variantFamilyId: string
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
    !Number.isInteger(value.supplyOrder) ||
    typeof value.variantFamilyId !== 'string' ||
    (value.playbackContentId !== undefined &&
      (typeof value.playbackContentId !== 'string' ||
        !/^listening-playback-v1-[a-f0-9]{8}$/u.test(value.playbackContentId))) ||
    value.variantFamilyId.length === 0 || !tags || !modes ||
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
    variantFamilyId: value.variantFamilyId,
    // Old isolated fixtures/indexes predate R11. Production accepts only the
    // published identity above; this compatibility marker merely preserves
    // their historical item-id behavior and is never emitted by 05 content.
    playbackContentId: typeof value.playbackContentId === 'string'
      ? value.playbackContentId
      : `legacy-listening-playback-${value.source.sourceId}`,
    source: {
      sourceType: value.source.sourceType as ListeningSupplyItem['source']['sourceType'],
      sourceId: value.source.sourceId,
      variantId: value.source.variantId,
    },
  }
}

export interface ListeningSupplyProvider {
  next(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): Promise<LearningTaskSupplyResult>
}

function isExtraTrainingRequest(
  request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
): request is ExtraTrainingSupplyRequest {
  return 'priority' in request
}

const FAMILY_COOLDOWN_ITEMS = 4
const DIVERSITY_WINDOW_ITEMS = 10

function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function streamSeed(
  request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
): string {
  return isExtraTrainingRequest(request)
    ? `extra:${request.sessionId}`
    : `daily:${request.planId}:${request.taskId}`
}

function selectDiverseItem(
  candidates: readonly IndexedListeningSupplyItem[],
  request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  allItemsById: ReadonlyMap<string, IndexedListeningSupplyItem>,
  allowPlaybackRepeat: boolean,
  enforceFamilyCooldown: boolean,
): IndexedListeningSupplyItem | undefined {
  const recent = request.excludeItemIds
    .slice(-DIVERSITY_WINDOW_ITEMS)
    .map((itemId) => allItemsById.get(itemId))
    .filter(
      (item): item is IndexedListeningSupplyItem => item !== undefined,
    )
  const recentFamilies = new Set(
    recent
      .slice(-FAMILY_COOLDOWN_ITEMS)
      .map((item) => item.variantFamilyId),
  )
  const recentPlaybackContent = new Set(recent.map((item) => item.playbackContentId))
  const last = recent.at(-1)
  const recentTypeCounts = new Map<string, number>()
  for (const item of recent) {
    recentTypeCounts.set(
      item.source.variantId,
      (recentTypeCounts.get(item.source.variantId) ?? 0) + 1,
    )
  }
  const seed = streamSeed(request)
  // A penalty is not a cooldown: stable shuffle ranks can still make a
  // recently-used family win. Ordinary supply must instead exclude it while
  // another family remains. Explicit R6 review priorities intentionally pass
  // false and may override this normal-stream diversity guard.
  const cooledCandidates = enforceFamilyCooldown
    ? candidates.filter((item) => !recentFamilies.has(item.variantFamilyId))
    : candidates
  const selectable = cooledCandidates.length > 0 ? cooledCandidates : candidates
  return [...selectable].sort((left, right) => {
    const score = (item: IndexedListeningSupplyItem) => {
      const familyPenalty = !enforceFamilyCooldown && recentFamilies.has(item.variantFamilyId)
        ? 10_000
        : 0
      const playbackPenalty = !allowPlaybackRepeat && recentPlaybackContent.has(item.playbackContentId)
        ? 100_000
        : 0
      const consecutiveTypePenalty =
        item.source.variantId === last?.source.variantId ? 2_000 : 0
      const typeBalancePenalty =
        (recentTypeCounts.get(item.source.variantId) ?? 0) * 100
      const randomRank =
        stableHash(`${seed}:${item.itemId}`) / 0x1_0000_0000
      return (
        playbackPenalty +
        familyPenalty +
        consecutiveTypePenalty +
        typeBalancePenalty +
        randomRank
      )
    }
    return (
      score(left) - score(right) ||
      left.supplyOrder - right.supplyOrder
    )
  })[0]
}

/** Deterministic per-session shuffle with durable item and dialogue cooldowns. */
export class ListeningCatalogSupplyProvider implements ListeningSupplyProvider {
  private readonly items: readonly IndexedListeningSupplyItem[]
  private readonly itemsById: ReadonlyMap<
    string,
    IndexedListeningSupplyItem
  >

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
    this.itemsById = new Map(this.items.map((item) => [item.itemId, item]))
  }

  async next(
    request: LearningTaskSupplyRequest | ExtraTrainingSupplyRequest,
  ): Promise<LearningTaskSupplyResult> {
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
    const completedPlaybackContent = new Set(
      request.excludeItemIds
        .map((itemId) => this.itemsById.get(itemId)?.playbackContentId)
        .filter((identity): identity is string => identity !== undefined),
    )
    const availableByItem = eligible.filter((item) => !excluded.has(item.itemId))
    const available = availableByItem.filter((item) =>
      !completedPlaybackContent.has(item.playbackContentId),
    )
    if (available.length === 0 && !isExtraTrainingRequest(request)) {
      return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'all-eligible-content-recently-used' }
    }
    if (isExtraTrainingRequest(request)) {
      const allPriorityIds = request.priority.flatMap(
        (priority) => request.priorityItemIds[priority],
      )
      if (allPriorityIds.some((itemId) => !this.items.some((item) => item.itemId === itemId))) {
        return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'provider-failure' }
      }
      for (const priority of request.priority) {
        const declaredCandidates = request.priorityItemIds[priority]
          .map((itemId) => this.items.find((item) => item.itemId === itemId)!)
        const priorityCandidates = (
          priority === 'same-day-variant'
            ? available.filter((item) =>
                declaredCandidates.some(
                  (declared) =>
                    declared.variantFamilyId === item.variantFamilyId,
                ),
              )
            : declaredCandidates.filter((item) => available.includes(item))
        )
          const selected = selectDiverseItem(
            priorityCandidates,
            request,
            this.itemsById,
            priority === 'recent-error' || priority === 'due-review',
            false,
        )
        if (selected) {
          return { schemaVersion: 1, requestId: request.requestId, status: 'item', item: selected, nextCursor: selected.itemId }
        }
      }
    }
    if (available.length === 0) {
      // A priority tier never gets to replay identical audio under another
      // item ID.  Only when this entire eligible pool has exhausted distinct
      // published playback identities may an extra session honestly relax
      // that rule; daily sessions retain their explicit exhausted result.
      if (isExtraTrainingRequest(request) && availableByItem.length > 0) {
        const item = selectDiverseItem(
          availableByItem,
          request,
          this.itemsById,
          true,
          true,
        )
        if (item) {
          return { schemaVersion: 1, requestId: request.requestId, status: 'item', item, nextCursor: item.itemId }
        }
      }
      return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'all-eligible-content-recently-used' }
    }
    const cursorIndex = request.cursor === null ? -1 : eligible.findIndex((item) => item.itemId === request.cursor)
    if (request.cursor !== null && cursorIndex < 0) {
      return { schemaVersion: 1, requestId: request.requestId, status: 'content-exhausted', reason: 'provider-failure' }
    }
    const item = selectDiverseItem(available, request, this.itemsById, false, true)
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
