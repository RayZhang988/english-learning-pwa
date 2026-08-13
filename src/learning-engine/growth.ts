import type { AbilityDomain } from './contracts.ts'

export const GROWTH_SCHEMA_VERSION = 2 as const
export const GROWTH_MAX_LEVEL_ORDINAL = 14 as const
export const GROWTH_REQUIRED_SESSIONS = 5 as const
export const GROWTH_REQUIRED_SCORED_ITEMS = 50 as const
export const GROWTH_REQUIRED_ACCURACY = 0.8 as const
export const GROWTH_UPGRADE_TEST_ITEM_COUNT = 10 as const
export const GROWTH_UPGRADE_TEST_PASS_COUNT = 8 as const
export const GROWTH_FAILED_TEST_COOLDOWN_SESSIONS = 2 as const

export type GrowthTrainingSource = 'daily-training' | 'extra-training'

export interface GrowthTrainingSession {
  readonly eventId: string
  readonly source: GrowthTrainingSource
  readonly sessionId: string
  readonly domain: AbilityDomain
  readonly levelOrdinal: number
  readonly correctCount: number
  readonly incorrectCount: number
  readonly localDate: string
  readonly completedAt: string
}

export interface GrowthUpgradeTestSnapshot {
  readonly schemaVersion: 2
  readonly testId: string
  readonly seed: number
  readonly itemIds: readonly string[]
  /**
   * 04 never interprets a course answer.  The domain runtime supplies the
   * scored boolean and may retain its serializable draft/feedback so a reload
   * resumes the same visible question without recreating it.
   */
  readonly answers: readonly GrowthUpgradeAnswerSnapshot[]
  readonly score: { readonly correctCount: number; readonly answeredCount: number }
  readonly startedAt: string
}

export interface GrowthUpgradeAnswerSnapshot {
  readonly itemId: string
  readonly draft: string | null
  readonly feedback: { readonly correct: boolean; readonly answeredAt: string }
}

export interface DomainGrowthState {
  readonly currentLevelOrdinal: number
  readonly levelScoredItemCount: number
  readonly eligibleSessionCount: number
  readonly sessions: readonly GrowthTrainingSession[]
  readonly processedEventIds: readonly string[]
  readonly upgradeTest: GrowthUpgradeTestSnapshot | null
  readonly retryAvailableAfterEligibleSessionCount: number | null
}

export interface GrowthState {
  readonly schemaVersion: 2
  readonly domains: Readonly<Record<AbilityDomain, DomainGrowthState>>
}

export type GrowthEligibility = {
  readonly status: 'eligible' | 'ineligible' | 'cooling-down' | 'highest-level' | 'test-in-progress'
  readonly progressPercent: number
  readonly recentSessionCount: number
  readonly levelScoredItemCount: number
  readonly recentAccuracyPercent: number | null
  readonly remainingCooldownSessions: number
}

export interface StartGrowthUpgradeTestInput {
  readonly eventId: string
  readonly domain: AbilityDomain
  readonly seed: number
  readonly candidateItemIds: readonly string[]
  readonly startedAt: string
}

export interface SubmitGrowthUpgradeAnswerInput {
  readonly eventId: string
  readonly domain: AbilityDomain
  readonly index: number
  readonly correct: boolean
  readonly answeredAt: string
  /** Opaque, JSON-safe display state owned by the answering runtime. */
  readonly draft?: string | null
}

/** The narrow R17 event boundary. Training tests, review and scenes have no event type here. */
export type GrowthEvent =
  | { readonly type: 'learning.growth.training.completed.v1'; readonly payload: GrowthTrainingSession }
  | { readonly type: 'learning.growth.upgrade-test.started.v1'; readonly payload: StartGrowthUpgradeTestInput }
  | { readonly type: 'learning.growth.upgrade-test.answer.recorded.v1'; readonly payload: SubmitGrowthUpgradeAnswerInput }

const DOMAINS: readonly AbilityDomain[] = ['vocabulary', 'listening', 'speaking']

function blankDomain(): DomainGrowthState {
  return {
    currentLevelOrdinal: 0,
    levelScoredItemCount: 0,
    eligibleSessionCount: 0,
    sessions: [],
    processedEventIds: [],
    upgradeTest: null,
    retryAvailableAfterEligibleSessionCount: null,
  }
}

export function createGrowthState(): GrowthState {
  return {
    schemaVersion: GROWTH_SCHEMA_VERSION,
    domains: { vocabulary: blankDomain(), listening: blankDomain(), speaking: blankDomain() },
  }
}

/**
 * Schema 1 predates persisted answer drafts and score snapshots.  It can be
 * upgraded without changing its ordered content IDs or scored answers.  A
 * malformed legacy value is deliberately rejected rather than guessed.
 */
export function migrateGrowthState(value: unknown): GrowthState {
  if (value === undefined) return createGrowthState()
  if (isRecord(value) && value.schemaVersion === 1) return migrateV1GrowthState(value)
  assertGrowthState(value)
  return value
}

/**
 * Strict portable-state guard used at the repository boundary. Legacy engine
 * records may omit `growth`; callers migrate those records by adding the safe
 * zero-progress state returned by createGrowthState().
 */
export function assertGrowthState(value: unknown): asserts value is GrowthState {
  if (!isRecord(value) || value.schemaVersion !== GROWTH_SCHEMA_VERSION) throw new TypeError('growth state is invalid')
  const domains = (value as { domains?: unknown }).domains
  if (typeof domains !== 'object' || domains === null) throw new TypeError('growth domains are invalid')
  for (const domain of DOMAINS) {
    const entry = (domains as Record<string, unknown>)[domain]
    if (typeof entry !== 'object' || entry === null) throw new TypeError('growth domain is invalid')
    const record = entry as Record<string, unknown>
    if (!Number.isInteger(record.currentLevelOrdinal) || (record.currentLevelOrdinal as number) < 0 || (record.currentLevelOrdinal as number) > GROWTH_MAX_LEVEL_ORDINAL || !Number.isInteger(record.levelScoredItemCount) || (record.levelScoredItemCount as number) < 0 || !Number.isInteger(record.eligibleSessionCount) || (record.eligibleSessionCount as number) < 0 || !Array.isArray(record.sessions) || !Array.isArray(record.processedEventIds) || new Set(record.processedEventIds).size !== record.processedEventIds.length || record.processedEventIds.some((id) => typeof id !== 'string' || id.trim().length === 0) || (record.retryAvailableAfterEligibleSessionCount !== null && (!Number.isInteger(record.retryAvailableAfterEligibleSessionCount) || (record.retryAvailableAfterEligibleSessionCount as number) < 0))) throw new TypeError('growth domain fields are invalid')
    for (const session of record.sessions) {
      assertSession(session as GrowthTrainingSession)
      if ((session as GrowthTrainingSession).domain !== domain) throw new TypeError('growth session is stored under the wrong domain')
    }
    const test = record.upgradeTest
    if (test === undefined) throw new TypeError('growth upgrade test is required')
    if (test !== null) assertUpgradeTest(test)
  }
}

function assertTimestamp(value: string, name: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be an ISO timestamp`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertSession(session: GrowthTrainingSession): void {
  if (!session.eventId.trim() || !session.sessionId.trim()) throw new TypeError('growth session identity is required')
  if (!DOMAINS.includes(session.domain) || (session.source !== 'daily-training' && session.source !== 'extra-training')) throw new TypeError('growth session source/domain is invalid')
  if (!Number.isInteger(session.levelOrdinal) || session.levelOrdinal < 0 || session.levelOrdinal > GROWTH_MAX_LEVEL_ORDINAL) throw new RangeError('growth session levelOrdinal is invalid')
  if (!Number.isInteger(session.correctCount) || !Number.isInteger(session.incorrectCount) || session.correctCount < 0 || session.incorrectCount < 0 || session.correctCount + session.incorrectCount === 0) throw new RangeError('growth session requires at least one scored item')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session.localDate)) throw new TypeError('growth session localDate is invalid')
  assertTimestamp(session.completedAt, 'growth session completedAt')
}

function assertUpgradeTest(value: unknown): asserts value is GrowthUpgradeTestSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 2 || typeof value.testId !== 'string' || value.testId.trim().length === 0 || !Number.isInteger(value.seed) || !Array.isArray(value.itemIds) || value.itemIds.length !== GROWTH_UPGRADE_TEST_ITEM_COUNT || new Set(value.itemIds).size !== value.itemIds.length || value.itemIds.some((id) => typeof id !== 'string' || id.trim().length === 0) || !Array.isArray(value.answers) || value.answers.length >= GROWTH_UPGRADE_TEST_ITEM_COUNT || !isRecord(value.score)) throw new TypeError('growth upgrade test is invalid')
  assertTimestamp(String(value.startedAt), 'upgrade-test startedAt')
  for (const [index, answer] of value.answers.entries()) {
    if (!isRecord(answer) || answer.itemId !== value.itemIds[index] || (answer.draft !== null && typeof answer.draft !== 'string') || !isRecord(answer.feedback) || typeof answer.feedback.correct !== 'boolean') throw new TypeError('growth upgrade answer is invalid')
    assertTimestamp(String(answer.feedback.answeredAt), 'upgrade-test answeredAt')
  }
  const correctCount = value.answers.filter((answer) => (answer as GrowthUpgradeAnswerSnapshot).feedback.correct).length
  if (value.score.correctCount !== correctCount || value.score.answeredCount !== value.answers.length) throw new TypeError('growth upgrade score is invalid')
}

function migrateV1GrowthState(value: Record<string, unknown>): GrowthState {
  const domains = value.domains
  if (!isRecord(domains)) throw new TypeError('legacy growth domains are invalid')
  const migrated = {} as Record<AbilityDomain, DomainGrowthState>
  for (const domain of DOMAINS) {
    const entry = domains[domain]
    if (!isRecord(entry)) throw new TypeError('legacy growth domain is invalid')
    const oldTest = entry.upgradeTest
    let upgradeTest: GrowthUpgradeTestSnapshot | null = null
    if (oldTest !== null && oldTest !== undefined) {
      if (!isRecord(oldTest) || oldTest.schemaVersion !== 1 || !Array.isArray(oldTest.itemIds) || oldTest.itemIds.some((itemId) => typeof itemId !== 'string') || !Array.isArray(oldTest.answers) || oldTest.answers.some((answer) => typeof answer !== 'boolean')) throw new TypeError('legacy growth upgrade test is invalid')
      const itemIds = oldTest.itemIds as string[]
      const answers = oldTest.answers.map((answer, index) => ({ itemId: itemIds[index]!, draft: null, feedback: { correct: answer as boolean, answeredAt: String(oldTest.startedAt) } }))
      upgradeTest = { schemaVersion: 2, testId: String(oldTest.testId), seed: Number(oldTest.seed), itemIds, answers, score: { correctCount: answers.filter((answer) => answer.feedback.correct).length, answeredCount: answers.length }, startedAt: String(oldTest.startedAt) }
    }
    migrated[domain] = { ...entry as unknown as DomainGrowthState, upgradeTest }
  }
  const state: GrowthState = { schemaVersion: 2, domains: migrated }
  assertGrowthState(state)
  return state
}

function sessionKey(session: GrowthTrainingSession): string { return `${session.source}:${session.sessionId}` }
function sessionOrder(a: GrowthTrainingSession, b: GrowthTrainingSession): number {
  return Date.parse(a.completedAt) - Date.parse(b.completedAt) || a.eventId.localeCompare(b.eventId)
}
function scored(session: GrowthTrainingSession): number { return session.correctCount + session.incorrectCount }

function replaceDomain(state: GrowthState, domain: AbilityDomain, next: DomainGrowthState): GrowthState {
  return { ...state, domains: { ...state.domains, [domain]: next } }
}

function computeEligibility(domain: DomainGrowthState): GrowthEligibility {
  const eligibleSessions = domain.sessions.filter((entry) => entry.levelOrdinal === domain.currentLevelOrdinal)
  const recent = eligibleSessions.slice(-GROWTH_REQUIRED_SESSIONS)
  const correct = recent.reduce((sum, item) => sum + item.correctCount, 0)
  const count = recent.reduce((sum, item) => sum + scored(item), 0)
  const accuracy = count === 0 ? null : correct / count
  // Progress is deliberately independent from accuracy and session cadence:
  // it is simply the current-level scored-evidence accumulation, capped at 50.
  const progressPercent = Math.min(100, Math.floor(domain.levelScoredItemCount / GROWTH_REQUIRED_SCORED_ITEMS * 100))
  const remainingCooldownSessions = domain.retryAvailableAfterEligibleSessionCount === null ? 0 : Math.max(0, domain.retryAvailableAfterEligibleSessionCount - domain.eligibleSessionCount)
  const common = { progressPercent, recentSessionCount: recent.length, levelScoredItemCount: domain.levelScoredItemCount, recentAccuracyPercent: accuracy === null ? null : Math.round(accuracy * 100), remainingCooldownSessions }
  if (domain.currentLevelOrdinal === GROWTH_MAX_LEVEL_ORDINAL) return { status: 'highest-level', ...common }
  if (domain.upgradeTest !== null) return { status: 'test-in-progress', ...common }
  if (remainingCooldownSessions > 0) return { status: 'cooling-down', ...common }
  if (recent.length >= GROWTH_REQUIRED_SESSIONS && progressPercent === 100 && accuracy !== null && accuracy >= GROWTH_REQUIRED_ACCURACY) return { status: 'eligible', ...common }
  return { status: 'ineligible', ...common }
}

export function getGrowthEligibility(state: GrowthState, domain: AbilityDomain): GrowthEligibility { return computeEligibility(state.domains[domain]) }

export function applyGrowthTrainingCompleted(state: GrowthState, session: GrowthTrainingSession): GrowthState {
  assertSession(session)
  const current = state.domains[session.domain]
  if (current.processedEventIds.includes(session.eventId)) return state
  const existing = current.sessions.find((entry) => sessionKey(entry) === sessionKey(session))
  if (existing !== undefined) {
    if (JSON.stringify(existing) !== JSON.stringify(session)) throw new TypeError('growth session identity conflicts with stored data')
    return state
  }
  const sessions = [...current.sessions, session].sort(sessionOrder)
  if (session.levelOrdinal !== current.currentLevelOrdinal) throw new TypeError('growth session level does not match current level')
  return replaceDomain(state, session.domain, {
    ...current,
    sessions,
    processedEventIds: [...current.processedEventIds, session.eventId],
    levelScoredItemCount: current.levelScoredItemCount + scored(session),
    eligibleSessionCount: current.eligibleSessionCount + 1,
  })
}

function seededShuffle(values: readonly string[], seed: number): readonly string[] {
  let state = seed >>> 0
  const next = () => { state = (state * 1664525 + 1013904223) >>> 0; return state }
  const shuffled = [...values]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = next() % (index + 1)
    ;[shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!]
  }
  return shuffled
}

export function startGrowthUpgradeTest(state: GrowthState, input: StartGrowthUpgradeTestInput): GrowthState {
  const current = state.domains[input.domain]
  if (current.processedEventIds.includes(input.eventId)) return state
  if (!Number.isFinite(input.seed) || !Number.isInteger(input.seed)) throw new TypeError('upgrade-test seed must be an integer')
  assertTimestamp(input.startedAt, 'upgrade-test startedAt')
  const unique = [...new Set(input.candidateItemIds)]
  if (unique.length !== input.candidateItemIds.length || unique.some((id) => !id.trim()) || unique.length < GROWTH_UPGRADE_TEST_ITEM_COUNT) throw new TypeError('upgrade-test requires at least ten unique candidate items')
  if (computeEligibility(current).status !== 'eligible') throw new TypeError('upgrade-test is not eligible')
  const itemIds = seededShuffle(unique, input.seed).slice(0, GROWTH_UPGRADE_TEST_ITEM_COUNT)
  return replaceDomain(state, input.domain, { ...current, processedEventIds: [...current.processedEventIds, input.eventId], upgradeTest: { schemaVersion: 2, testId: input.eventId, seed: input.seed, itemIds, answers: [], score: { correctCount: 0, answeredCount: 0 }, startedAt: input.startedAt } })
}

export function submitGrowthUpgradeAnswer(state: GrowthState, input: SubmitGrowthUpgradeAnswerInput): GrowthState {
  const current = state.domains[input.domain]
  if (current.processedEventIds.includes(input.eventId)) return state
  assertTimestamp(input.answeredAt, 'upgrade-test answeredAt')
  const test = current.upgradeTest
  if (test === null || input.index !== test.answers.length || input.index < 0 || input.index >= test.itemIds.length) throw new TypeError('upgrade-test answer is out of order')
  if (input.draft !== undefined && input.draft !== null && typeof input.draft !== 'string') throw new TypeError('upgrade-test draft is invalid')
  const answers = [...test.answers, { itemId: test.itemIds[input.index]!, draft: input.draft ?? null, feedback: { correct: input.correct, answeredAt: input.answeredAt } }]
  const score = { correctCount: test.score.correctCount + (input.correct ? 1 : 0), answeredCount: answers.length }
  const events = [...current.processedEventIds, input.eventId]
  if (answers.length < GROWTH_UPGRADE_TEST_ITEM_COUNT) return replaceDomain(state, input.domain, { ...current, processedEventIds: events, upgradeTest: { ...test, answers, score } })
  const passed = score.correctCount >= GROWTH_UPGRADE_TEST_PASS_COUNT
  return replaceDomain(state, input.domain, passed ? {
    ...current, processedEventIds: events, currentLevelOrdinal: current.currentLevelOrdinal + 1, levelScoredItemCount: 0, eligibleSessionCount: 0, upgradeTest: null, retryAvailableAfterEligibleSessionCount: null,
  } : {
    ...current, processedEventIds: events, upgradeTest: null,
    retryAvailableAfterEligibleSessionCount: current.eligibleSessionCount + GROWTH_FAILED_TEST_COOLDOWN_SESSIONS,
  })
}

export function applyGrowthEvent(state: GrowthState, event: GrowthEvent): GrowthState {
  if (event.type === 'learning.growth.training.completed.v1') return applyGrowthTrainingCompleted(state, event.payload)
  if (event.type === 'learning.growth.upgrade-test.started.v1') return startGrowthUpgradeTest(state, event.payload)
  return submitGrowthUpgradeAnswer(state, event.payload)
}
