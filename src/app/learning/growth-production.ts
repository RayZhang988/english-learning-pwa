import type { ReadonlyDataSource } from '../../core/index.ts'
import {
  type VocabularyGrowthUpgradeAdapter,
  type VocabularyGrowthUpgradeQuestionView,
  type VocabularyGrowthUpgradeSubmission,
} from '../../features/vocabulary/index.ts'
import {
  type ListeningGrowthUpgradeAdapter,
  type ListeningGrowthUpgradeQuestion,
  type ListeningGrowthUpgradeSubmission,
} from '../../features/listening/index.ts'
import {
  type SpeakingGrowthUpgradeAdapter,
  type SpeakingGrowthUpgradePromptView,
  type SpeakingGrowthUpgradeSubmission,
  type SpeakingRecognitionOutcome,
  SpeakingGrowthUpgradeMediaSession,
  type SpeakingGrowthUpgradeMediaView,
} from '../../features/speaking/index.ts'
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

/**
 * The application boundary for the R17 ten-question test.  It deliberately
 * contains only opaque, already-resolved domain payloads: UI renders them but
 * never obtains a course answer key or reimplements a domain scorer.
 */
export type GrowthUpgradeQuestionPayload =
  | { readonly domain: 'vocabulary'; readonly question: VocabularyGrowthUpgradeQuestionView }
  | { readonly domain: 'listening'; readonly question: ListeningGrowthUpgradeQuestion }
  | { readonly domain: 'speaking'; readonly question: SpeakingGrowthUpgradePromptView }

export type GrowthUpgradeFeedback =
  | { readonly domain: 'vocabulary'; readonly submission: VocabularyGrowthUpgradeSubmission }
  | { readonly domain: 'listening'; readonly submission: ListeningGrowthUpgradeSubmission }
  | { readonly domain: 'speaking'; readonly submission: SpeakingGrowthUpgradeSubmission }

export interface GrowthUpgradeSessionViewModel {
  readonly domain: AbilityDomain
  readonly targetLevelOrdinal: number
  readonly targetLevelLabel: string
  readonly index: number
  readonly total: 10
  readonly itemId: string
  readonly score: { readonly correctCount: number; readonly answeredCount: number }
  /** Persisted opaque input for the current/last answered item. */
  readonly draft: string | null
  readonly question: GrowthUpgradeQuestionPayload
  readonly feedback: GrowthUpgradeFeedback | null
  readonly busy: boolean
  readonly error: string | null
  readonly retryable: boolean
  readonly canExit: true
}

export type GrowthUpgradeSubmitInput =
  | { readonly domain: 'vocabulary'; readonly selectedOptionId: string }
  | { readonly domain: 'listening'; readonly response: string }
  | {
      readonly domain: 'speaking'
      readonly recognition: SpeakingRecognitionOutcome
      readonly recording: { readonly recordingId: string; readonly durationMs: number }
    }

export interface GrowthUpgradeAdapters {
  readonly vocabulary: VocabularyGrowthUpgradeAdapter
  readonly listening: ListeningGrowthUpgradeAdapter
  readonly speaking: SpeakingGrowthUpgradeAdapter
}

export interface GrowthSpeakingMediaSession {
  initialize(): Promise<SpeakingGrowthUpgradeMediaView>
  current(): SpeakingGrowthUpgradeMediaView
  subscribe(listener: (view: SpeakingGrowthUpgradeMediaView) => void): () => void
  startRecording(): Promise<SpeakingGrowthUpgradeMediaView>
  stopRecording(): Promise<SpeakingGrowthUpgradeSubmission | null>
  playRecording(): Promise<SpeakingGrowthUpgradeMediaView>
  playReference(): Promise<SpeakingGrowthUpgradeMediaView>
  retryRecognition(): Promise<SpeakingGrowthUpgradeSubmission | null>
  recordAgain(): Promise<SpeakingGrowthUpgradeMediaView>
  dispose(): void
}

export interface GrowthSpeakingMediaViewModel {
  readonly itemId: string
  readonly prompt: SpeakingGrowthUpgradePromptView
  readonly status: SpeakingGrowthUpgradeMediaView['status']
  readonly recordingAvailable: boolean
  readonly referenceText: string | null
  readonly recognition: SpeakingRecognitionOutcome | null
  readonly submission: SpeakingGrowthUpgradeSubmission | null
  readonly message: string | null
  readonly busy: boolean
  readonly retryable: boolean
}

type SpeakingMediaFactory = (input: {
  readonly adapter: SpeakingGrowthUpgradeAdapter
  readonly itemId: string
  readonly expectedDifficultyLevel: number
}) => GrowthSpeakingMediaSession

type ManagedSpeakingMedia = {
  readonly itemId: string
  readonly level: number
  readonly session: GrowthSpeakingMediaSession
  unsubscribe: () => void
  view: SpeakingGrowthUpgradeMediaView | null
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
  readonly #adapters: GrowthUpgradeAdapters | null
  readonly #createSpeakingMedia: SpeakingMediaFactory
  #speakingMedia: ManagedSpeakingMedia | null = null
  readonly #sessionListeners = new Set<(view: GrowthSpeakingMediaViewModel) => void>()
  #queue: Promise<void> = Promise.resolve()

  constructor(options: {
    readonly engineStates: LearningEngineRepository
    readonly sources: GrowthCandidateSources
    /** Optional only for legacy, read-only callers. Production must provide it. */
    readonly adapters?: GrowthUpgradeAdapters
    readonly createSpeakingMedia?: SpeakingMediaFactory
  }) {
    this.#engineStates = options.engineStates
    this.#sources = options.sources
    this.#adapters = options.adapters ?? null
    this.#createSpeakingMedia = options.createSpeakingMedia ?? ((input) => new SpeakingGrowthUpgradeMediaSession(input))
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

  /** Resolves exactly the already persisted item at the current test cursor. */
  async upgradeSession(domain: AbilityDomain): Promise<GrowthUpgradeSessionViewModel> {
    const state = await this.#requireState()
    const test = state.growth!.domains[domain].upgradeTest
    if (!test) throw new TypeError('No saved upgrade test is available.')
    if (test.answers.length >= test.itemIds.length) throw new TypeError('Saved upgrade test has no remaining item.')
    return this.#sessionView(state.growth!, domain, test.answers.length, null)
  }

  /**
   * Scores through the owning domain adapter first, then appends precisely one
   * 04 answer checkpoint.  Adapter scoring is stateless, so a failed save has
   * no learning side effect and can safely be retried with the same event ID.
   */
  async submitUpgradeSessionAnswer(input: {
    readonly eventId: string
    readonly domain: AbilityDomain
    readonly answer: GrowthUpgradeSubmitInput
    readonly answeredAt: string
  }): Promise<{ readonly state: LearningEngineState; readonly feedback: GrowthUpgradeFeedback; readonly advanced: boolean }> {
    if (input.answer.domain !== input.domain) throw new TypeError('Growth answer domain does not match its session.')
    const before = await this.#requireState()
    const test = before.growth!.domains[input.domain].upgradeTest
    if (!test) throw new TypeError('No saved upgrade test is available.')
    const index = test.answers.length
    const itemId = test.itemIds[index]
    if (!itemId) throw new TypeError('Saved upgrade test has no remaining item.')
    const level = before.growth!.domains[input.domain].currentLevelOrdinal + 1
    const feedback = await this.#score(input.answer, itemId, level)
    // Recognition failures are deliberately not a wrong answer and do not
    // consume one of the ten saved positions.
    if (feedback.domain === 'speaking' && !feedback.submission.scorable) {
      return { state: before, feedback, advanced: false }
    }
    if (feedback.submission.correct === null) {
      throw new TypeError('Unscorable growth answer cannot advance the test.')
    }
    const correct = feedback.submission.correct
    const draft = JSON.stringify(input.answer)
    const state = await this.submitUpgradeAnswer({
      eventId: input.eventId,
      domain: input.domain,
      index,
      correct,
      draft,
      answeredAt: input.answeredAt,
    })
    return { state, feedback, advanced: true }
  }

  subscribeSpeakingUpgradeMedia(listener: (view: GrowthSpeakingMediaViewModel) => void): () => void {
    this.#sessionListeners.add(listener)
    if (this.#speakingMedia?.view) listener(this.#toSpeakingMediaView(this.#speakingMedia.itemId, this.#speakingMedia.view))
    return () => this.#sessionListeners.delete(listener)
  }

  async speakingUpgradeMedia(): Promise<GrowthSpeakingMediaViewModel> {
    const context = await this.#requireSpeakingMedia()
    return this.#toSpeakingMediaView(context.itemId, context.view!)
  }

  async startSpeakingUpgradeRecording(): Promise<GrowthSpeakingMediaViewModel> {
    const context = await this.#requireSpeakingMedia()
    context.view = await context.session.startRecording()
    this.#emitSpeakingMedia(context)
    return this.#toSpeakingMediaView(context.itemId, context.view)
  }

  async stopSpeakingUpgradeRecording(input: { readonly eventId: string; readonly answeredAt: string }): Promise<{ readonly state: LearningEngineState; readonly advanced: boolean; readonly feedback: GrowthUpgradeFeedback | null }> {
    const context = await this.#requireSpeakingMedia()
    const submitted = await context.session.stopRecording()
    context.view = context.session.current()
    this.#emitSpeakingMedia(context)
    if (!submitted || !submitted.scorable || !context.view.recognition || context.view.recognition.status !== 'recognized') {
      return { state: await this.#requireState(), advanced: false, feedback: submitted ? { domain: 'speaking', submission: submitted } : null }
    }
    const outcome = await this.submitUpgradeSessionAnswer({
      eventId: input.eventId,
      domain: 'speaking',
      answer: { domain: 'speaking', recognition: context.view.recognition, recording: submitted.recording },
      answeredAt: input.answeredAt,
    })
    // Once 04 consumes a scored item, its cursor may now point at the next
    // prompt or have reached a pass/fail result. Never leak the old blob into it.
    this.#disposeSpeakingMedia()
    return { state: outcome.state, advanced: outcome.advanced, feedback: outcome.feedback }
  }

  async playSpeakingUpgradeRecording(): Promise<GrowthSpeakingMediaViewModel> {
    const context = await this.#requireSpeakingMedia(); context.view = await context.session.playRecording(); this.#emitSpeakingMedia(context); return this.#toSpeakingMediaView(context.itemId, context.view)
  }
  async playSpeakingUpgradeReference(): Promise<GrowthSpeakingMediaViewModel> {
    const context = await this.#requireSpeakingMedia(); context.view = await context.session.playReference(); this.#emitSpeakingMedia(context); return this.#toSpeakingMediaView(context.itemId, context.view)
  }
  async retrySpeakingUpgradeRecognition(): Promise<GrowthSpeakingMediaViewModel> {
    const context = await this.#requireSpeakingMedia(); await context.session.retryRecognition(); context.view = context.session.current(); this.#emitSpeakingMedia(context); return this.#toSpeakingMediaView(context.itemId, context.view)
  }
  async recordSpeakingUpgradeAgain(): Promise<GrowthSpeakingMediaViewModel> {
    const context = await this.#requireSpeakingMedia(); context.view = await context.session.recordAgain(); this.#emitSpeakingMedia(context); return this.#toSpeakingMediaView(context.itemId, context.view)
  }
  exitSpeakingUpgradeSession(): void { this.#disposeSpeakingMedia() }

  recoverCorruptGrowthOnly(): Promise<LearningEngineState> {
    return this.#engineStates.resetCorruptGrowthOnly()
  }

  async #requireState(): Promise<LearningEngineState> {
    const state = await this.#engineStates.load()
    if (!state?.growth) throw new TypeError('Growth state is unavailable.')
    return state
  }

  #requireAdapters(): GrowthUpgradeAdapters {
    if (!this.#adapters) throw new TypeError('Growth domain adapters are not configured.')
    return this.#adapters
  }

  async #requireSpeakingMedia(): Promise<ManagedSpeakingMedia> {
    const state = await this.#requireState()
    const test = state.growth!.domains.speaking.upgradeTest
    const level = state.growth!.domains.speaking.currentLevelOrdinal + 1
    const itemId = test?.itemIds[test.answers.length]
    if (!test || !itemId) throw new TypeError('No saved speaking upgrade item is available.')
    if (!this.#speakingMedia || this.#speakingMedia.itemId !== itemId || this.#speakingMedia.level !== level) {
      this.#disposeSpeakingMedia()
      const session = this.#createSpeakingMedia({ adapter: this.#requireAdapters().speaking, itemId, expectedDifficultyLevel: R17_GROWTH_DIFFICULTIES[level]! })
      const context: ManagedSpeakingMedia = { itemId, level, session, view: null, unsubscribe: () => undefined }
      context.unsubscribe = session.subscribe((view) => { context.view = view; this.#emitSpeakingMedia(context) })
      this.#speakingMedia = context
      context.view = await session.initialize()
    }
    if (!this.#speakingMedia.view) this.#speakingMedia.view = await this.#speakingMedia.session.initialize()
    return this.#speakingMedia
  }

  #toSpeakingMediaView(itemId: string, view: SpeakingGrowthUpgradeMediaView): GrowthSpeakingMediaViewModel {
    return { itemId, prompt: view.prompt, status: view.status, recordingAvailable: view.recordingAvailable, referenceText: view.referenceText, recognition: view.recognition, submission: view.submission, message: view.message, busy: view.busy, retryable: view.retryable }
  }
  #emitSpeakingMedia(context: ManagedSpeakingMedia): void {
    if (!context.view) return
    const view = this.#toSpeakingMediaView(context.itemId, context.view)
    this.#sessionListeners.forEach((listener) => listener(view))
  }
  #disposeSpeakingMedia(): void {
    const context = this.#speakingMedia
    if (!context) return
    context.unsubscribe(); context.session.dispose(); this.#speakingMedia = null
  }

  async #sessionView(
    growth: GrowthState,
    domain: AbilityDomain,
    index: number,
    feedback: GrowthUpgradeFeedback | null,
  ): Promise<GrowthUpgradeSessionViewModel> {
    const test = growth.domains[domain].upgradeTest
    if (!test) throw new TypeError('No saved upgrade test is available.')
    const itemId = test.itemIds[index]
    if (!itemId) throw new TypeError('Saved upgrade test has no remaining item.')
    const level = growth.domains[domain].currentLevelOrdinal + 1
    const adapters = this.#requireAdapters()
    const question: GrowthUpgradeQuestionPayload = domain === 'vocabulary'
      ? { domain, question: await adapters.vocabulary.resolve({ domain, itemId, expectedDifficultyLevel: R17_GROWTH_DIFFICULTIES[level]! }) }
      : domain === 'listening'
        ? { domain, question: await adapters.listening.resolve({ domain, itemId, expectedDifficultyLevel: R17_GROWTH_DIFFICULTIES[level]! }) }
        : { domain, question: await adapters.speaking.resolve({ domain, itemId, expectedDifficultyLevel: R17_GROWTH_DIFFICULTIES[level]!, recordingExists: false }) }
    return {
      domain, targetLevelOrdinal: level, targetLevelLabel: R17_GROWTH_LEVEL_LABELS[level]!,
      index, total: 10, itemId, score: test.score, draft: test.answers[index]?.draft ?? null,
      question, feedback, busy: false, error: null, retryable: false, canExit: true,
    }
  }

  async #score(answer: GrowthUpgradeSubmitInput, itemId: string, level: number): Promise<GrowthUpgradeFeedback> {
    const adapters = this.#requireAdapters()
    const expectedDifficultyLevel = R17_GROWTH_DIFFICULTIES[level]!
    if (answer.domain === 'vocabulary') return { domain: 'vocabulary', submission: await adapters.vocabulary.submit({ domain: 'vocabulary', itemId, expectedDifficultyLevel, selectedOptionId: answer.selectedOptionId }) }
    if (answer.domain === 'listening') return { domain: 'listening', submission: await adapters.listening.submit({ domain: 'listening', itemId, expectedDifficultyLevel, response: answer.response }) }
    return { domain: 'speaking', submission: await adapters.speaking.submit({ domain: 'speaking', itemId, expectedDifficultyLevel, recognition: answer.recognition, recording: answer.recording }) }
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
