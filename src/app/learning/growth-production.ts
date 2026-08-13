import type { ReadonlyDataSource } from '../../core/index.ts'
import {
  applyGrowthTrainingCompleted,
  getGrowthEligibility,
  startGrowthUpgradeTest,
  submitGrowthUpgradeAnswer,
  type AbilityDomain,
  type GrowthEligibility,
  type GrowthState,
  type LearningEngineRepository,
  type LearningEngineState,
} from '../../learning-engine/index.ts'

/** The product's fifteen labels map one-to-one to 05's published difficulty. */
export const R17_GROWTH_DIFFICULTIES = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8,
] as const

export const R17_GROWTH_LEVEL_LABELS = [
  '幼儿园', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级',
  '初一', '初二', '初三', '高一', '高二', '高三', '大学四级', '大学六级',
] as const

type SupplyCandidate = {
  readonly itemId: string
  readonly domain: AbilityDomain
  readonly difficultyLevel: number
}

export interface GrowthCandidateCatalog {
  readonly trainingSupplyIndex?: unknown
}

export interface GrowthCandidateSources {
  readonly vocabulary: ReadonlyDataSource<GrowthCandidateCatalog>
  readonly listening: ReadonlyDataSource<GrowthCandidateCatalog>
  readonly speaking: ReadonlyDataSource<GrowthCandidateCatalog>
}

export interface GrowthDomainViewModel {
  readonly domain: AbilityDomain
  readonly currentLevelOrdinal: number
  readonly currentLevelLabel: string
  readonly progressPercent: number
  readonly recentSessionCount: number
  readonly scoredItemCount: number
  readonly recentAccuracyPercent: number | null
  readonly eligibility: GrowthEligibility['status']
  readonly remainingCooldownSessions: number
  readonly action: {
    readonly label: string
    readonly disabled: boolean
    readonly busy: boolean
  }
  readonly activeTest: {
    readonly itemIds: readonly string[]
    readonly index: number
    readonly score: { readonly correctCount: number; readonly answeredCount: number }
  } | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function candidates(index: unknown, domain: AbilityDomain, levelOrdinal: number): readonly string[] {
  if (!isRecord(index) || !Array.isArray(index.candidates)) throw new TypeError('Released growth candidate index is invalid.')
  const expectedDifficulty = R17_GROWTH_DIFFICULTIES[levelOrdinal]
  const rows = index.candidates as readonly unknown[]
  const selected = rows.filter((value): value is SupplyCandidate => isRecord(value) && typeof value.itemId === 'string' && value.itemId.trim().length > 0 && value.domain === domain && value.difficultyLevel === expectedDifficulty)
    .map((value) => value.itemId)
  if (new Set(selected).size !== selected.length) throw new TypeError('Released growth candidate index has duplicate item IDs.')
  if (selected.length < 10) throw new TypeError(`Released ${domain} level ${levelOrdinal} has fewer than ten upgrade candidates.`)
  return selected
}

export function toGrowthDomainViewModel(
  growth: GrowthState,
  domain: AbilityDomain,
  busy = false,
): GrowthDomainViewModel {
  const entry = growth.domains[domain]
  const eligibility = getGrowthEligibility(growth, domain)
  const test = entry.upgradeTest
  const label = eligibility.status === 'test-in-progress'
    ? '继续升级测试'
    : eligibility.status === 'eligible'
      ? '开始升级测试'
      : eligibility.status === 'highest-level'
        ? '已达最高等级'
        : eligibility.status === 'cooling-down'
          ? `还需完成 ${eligibility.remainingCooldownSessions} 次训练`
          : '继续日常训练'
  return {
    domain,
    currentLevelOrdinal: entry.currentLevelOrdinal,
    currentLevelLabel: R17_GROWTH_LEVEL_LABELS[entry.currentLevelOrdinal]!,
    progressPercent: eligibility.progressPercent,
    recentSessionCount: eligibility.recentSessionCount,
    scoredItemCount: eligibility.levelScoredItemCount,
    recentAccuracyPercent: eligibility.recentAccuracyPercent,
    eligibility: eligibility.status,
    remainingCooldownSessions: eligibility.remainingCooldownSessions,
    action: { label, disabled: busy || eligibility.status === 'ineligible' || eligibility.status === 'cooling-down' || eligibility.status === 'highest-level', busy },
    activeTest: test === null ? null : { itemIds: test.itemIds, index: test.answers.length, score: test.score },
  }
}

/**
 * Production state facade. It has no answer-key access: modules submit only
 * their existing boolean scoring result. Every mutation is serialized so a
 * repeated click/reload cannot split an answer checkpoint from its score.
 */
export class GrowthProductionCoordinator {
  readonly #engineStates: LearningEngineRepository
  readonly #sources: GrowthCandidateSources
  #queue: Promise<void> = Promise.resolve()

  constructor(options: { readonly engineStates: LearningEngineRepository; readonly sources: GrowthCandidateSources }) {
    this.#engineStates = options.engineStates
    this.#sources = options.sources
  }

  async view(domain: AbilityDomain): Promise<GrowthDomainViewModel> {
    const state = await this.#requireState()
    return toGrowthDomainViewModel(state.growth!, domain)
  }

  recordFormalSession(input: {
    readonly eventId: string
    readonly source: 'daily-training' | 'extra-training'
    readonly sessionId: string
    readonly domain: AbilityDomain
    readonly correctCount: number
    readonly incorrectCount: number
    readonly localDate: string
    readonly completedAt: string
  }): Promise<LearningEngineState> {
    return this.#update((state) => {
      const growth = state.growth!
      return { ...state, growth: applyGrowthTrainingCompleted(growth, { ...input, levelOrdinal: growth.domains[input.domain].currentLevelOrdinal }) }
    })
  }

  async startUpgradeTest(input: { readonly eventId: string; readonly domain: AbilityDomain; readonly seed: number; readonly startedAt: string }): Promise<LearningEngineState> {
    const source = this.#sources[input.domain]
    const catalog = await source.load()
    return this.#update((state) => {
      const current = state.growth!.domains[input.domain]
      const nextLevel = current.currentLevelOrdinal + 1
      return { ...state, growth: startGrowthUpgradeTest(state.growth!, { ...input, candidateItemIds: candidates(catalog.trainingSupplyIndex, input.domain, nextLevel) }) }
    })
  }

  submitUpgradeAnswer(input: { readonly eventId: string; readonly domain: AbilityDomain; readonly index: number; readonly correct: boolean; readonly draft?: string | null; readonly answeredAt: string }): Promise<LearningEngineState> {
    return this.#update((state) => ({ ...state, growth: submitGrowthUpgradeAnswer(state.growth!, input) }))
  }

  recoverCorruptGrowthOnly(): Promise<LearningEngineState> {
    return this.#engineStates.resetCorruptGrowthOnly()
  }

  async #requireState(): Promise<LearningEngineState> {
    const state = await this.#engineStates.load()
    if (!state?.growth) throw new TypeError('Growth state is unavailable.')
    return state
  }

  #update(transform: (state: LearningEngineState) => LearningEngineState): Promise<LearningEngineState> {
    const operation = this.#queue.then(async () => {
      const state = await this.#requireState()
      const next = transform(state)
      await this.#engineStates.save(next)
      return next
    })
    this.#queue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
