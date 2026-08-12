import type { AbilityDomain } from './contracts.ts'

export const GROWTH_SCHEMA_VERSION = 1 as const
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
  readonly schemaVersion: 1
  readonly testId: string
  readonly seed: number
  readonly itemIds: readonly string[]
  readonly answers: readonly boolean[]
  readonly startedAt: string
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
  readonly schemaVersion: 1
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
}

/** The narrow R17 event boundary. Training tests, review and scenes have no event type here. */
export type GrowthEvent =
  | { readonly type: 'learning.growth.training.completed.v1'; readonly payload: GrowthTrainingSession }
  | { readonly type: 'learning.growth.upgrade-test.started.v1'; readonly payload: StartGrowthUpgradeTestInput }
  | { readonly type: 'learning.growth.upgrade-test.answer.recorded.v1'; readonly payload: SubmitGrowthUpgradeAnswerInput }

const DOMAINS: readonly AbilityDomain[] = ['vocabulary', 'listening', 'speaking']
const MAX_SESSIONS = 100
const MAX_EVENTS = 500

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

/** Old engine records start safely: no inherited progress, eligibility or test. */
export function migrateGrowthState(value: unknown): GrowthState {
  if (value === undefined) return createGrowthState()
  assertGrowthState(value)
  return value
}

/**
 * Strict portable-state guard used at the repository boundary. Legacy engine
 * records may omit `growth`; callers migrate those records by adding the safe
 * zero-progress state returned by createGrowthState().
 */
export function assertGrowthState(value: unknown): asserts value is GrowthState {
  if (typeof value !== 'object' || value === null || (value as { schemaVersion?: unknown }).schemaVersion !== 1) throw new TypeError('growth state is invalid')
  const domains = (value as { domains?: unknown }).domains
  if (typeof domains !== 'object' || domains === null) throw new TypeError('growth domains are invalid')
  for (const domain of DOMAINS) {
    const entry = (domains as Record<string, unknown>)[domain]
    if (typeof entry !== 'object' || entry === null) throw new TypeError('growth domain is invalid')
    const record = entry as Record<string, unknown>
    if (!Number.isInteger(record.currentLevelOrdinal) || (record.currentLevelOrdinal as number) < 0 || (record.currentLevelOrdinal as number) > GROWTH_MAX_LEVEL_ORDINAL || !Number.isInteger(record.levelScoredItemCount) || (record.levelScoredItemCount as number) < 0 || !Number.isInteger(record.eligibleSessionCount) || (record.eligibleSessionCount as number) < 0 || !Array.isArray(record.sessions) || !Array.isArray(record.processedEventIds) || new Set(record.processedEventIds).size !== record.processedEventIds.length || record.processedEventIds.some((id) => typeof id !== 'string')) throw new TypeError('growth domain fields are invalid')
    for (const session of record.sessions) assertSession(session as GrowthTrainingSession)
    const test = record.upgradeTest
    if (test !== null && test !== undefined) {
      if (typeof test !== 'object' || (test as { schemaVersion?: unknown }).schemaVersion !== 1 || !Array.isArray((test as { itemIds?: unknown }).itemIds) || !Array.isArray((test as { answers?: unknown }).answers) || (test as { itemIds: unknown[] }).itemIds.length !== GROWTH_UPGRADE_TEST_ITEM_COUNT || (test as { answers: unknown[] }).answers.length >= GROWTH_UPGRADE_TEST_ITEM_COUNT || (test as { answers: unknown[] }).answers.some((answer) => typeof answer !== 'boolean')) throw new TypeError('growth upgrade test is invalid')
    }
  }
}

function assertTimestamp(value: string, name: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be an ISO timestamp`)
}

function assertSession(session: GrowthTrainingSession): void {
  if (!session.eventId.trim() || !session.sessionId.trim()) throw new TypeError('growth session identity is required')
  if (!DOMAINS.includes(session.domain)) throw new TypeError('growth session domain is invalid')
  if (!Number.isInteger(session.levelOrdinal) || session.levelOrdinal < 0 || session.levelOrdinal > GROWTH_MAX_LEVEL_ORDINAL) throw new RangeError('growth session levelOrdinal is invalid')
  if (!Number.isInteger(session.correctCount) || !Number.isInteger(session.incorrectCount) || session.correctCount < 0 || session.incorrectCount < 0 || session.correctCount + session.incorrectCount === 0) throw new RangeError('growth session requires at least one scored item')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session.localDate)) throw new TypeError('growth session localDate is invalid')
  assertTimestamp(session.completedAt, 'growth session completedAt')
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
  const progressPercent = Math.min(100, Math.floor(Math.min(
    domain.levelScoredItemCount / GROWTH_REQUIRED_SCORED_ITEMS,
    recent.length / GROWTH_REQUIRED_SESSIONS,
    (accuracy ?? 0) / GROWTH_REQUIRED_ACCURACY,
  ) * 100))
  const remainingCooldownSessions = domain.retryAvailableAfterEligibleSessionCount === null ? 0 : Math.max(0, domain.retryAvailableAfterEligibleSessionCount - domain.eligibleSessionCount)
  const common = { progressPercent, recentSessionCount: recent.length, levelScoredItemCount: domain.levelScoredItemCount, recentAccuracyPercent: accuracy === null ? null : Math.round(accuracy * 100), remainingCooldownSessions }
  if (domain.currentLevelOrdinal === GROWTH_MAX_LEVEL_ORDINAL) return { status: 'highest-level', ...common }
  if (domain.upgradeTest !== null) return { status: 'test-in-progress', ...common }
  if (remainingCooldownSessions > 0) return { status: 'cooling-down', ...common }
  if (progressPercent === 100 && accuracy !== null && accuracy >= GROWTH_REQUIRED_ACCURACY) return { status: 'eligible', ...common }
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
  const sessions = [...current.sessions, session].sort(sessionOrder).slice(-MAX_SESSIONS)
  const currentLevel = session.levelOrdinal === current.currentLevelOrdinal
  return replaceDomain(state, session.domain, {
    ...current,
    sessions,
    processedEventIds: [...current.processedEventIds, session.eventId].slice(-MAX_EVENTS),
    levelScoredItemCount: current.levelScoredItemCount + (currentLevel ? scored(session) : 0),
    eligibleSessionCount: current.eligibleSessionCount + (currentLevel ? 1 : 0),
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
  return replaceDomain(state, input.domain, { ...current, processedEventIds: [...current.processedEventIds, input.eventId].slice(-MAX_EVENTS), upgradeTest: { schemaVersion: 1, testId: input.eventId, seed: input.seed, itemIds, answers: [], startedAt: input.startedAt } })
}

export function submitGrowthUpgradeAnswer(state: GrowthState, input: SubmitGrowthUpgradeAnswerInput): GrowthState {
  const current = state.domains[input.domain]
  if (current.processedEventIds.includes(input.eventId)) return state
  assertTimestamp(input.answeredAt, 'upgrade-test answeredAt')
  const test = current.upgradeTest
  if (test === null || input.index !== test.answers.length || input.index < 0 || input.index >= test.itemIds.length) throw new TypeError('upgrade-test answer is out of order')
  const answers = [...test.answers, input.correct]
  const events = [...current.processedEventIds, input.eventId].slice(-MAX_EVENTS)
  if (answers.length < GROWTH_UPGRADE_TEST_ITEM_COUNT) return replaceDomain(state, input.domain, { ...current, processedEventIds: events, upgradeTest: { ...test, answers } })
  const passed = answers.filter(Boolean).length >= GROWTH_UPGRADE_TEST_PASS_COUNT
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
