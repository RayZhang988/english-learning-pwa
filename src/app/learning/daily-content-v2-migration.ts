import type { AppDatabase, DatabaseRecord } from '../../storage/indexed-db/AppDatabase.ts'
import { appDatabase } from '../../storage/indexed-db/AppDatabase.ts'
import { createRecordId } from '../../storage/record-id.ts'
import {
  createWrongAnswerLibraryState,
  assertWrongAnswerLibraryState,
  migrateDailyGrowthEvidence,
  type DailyGrowthEvidenceMigrationV1,
  type DailyGrowthEvidenceMigrationV2,
  type DailyGrowthIdentityMigrationEntry,
  type DailyGrowthTargetIdentity,
  type WrongAnswerLibraryState,
  type WrongAnswerRecord,
} from '../../learning-engine/index.ts'
import { assertPortableValue } from '../../storage/portable-value.ts'

export const DAILY_CONTENT_MIGRATION_NAMESPACE = 'app.daily-content-migration'
export const DAILY_CONTENT_MIGRATION_KEY = 'daily-level-v1-to-v2-complete'
export const DAILY_CONTENT_MIGRATION_VERSION = 'daily-level-v1-to-v2-complete'
export const WRONG_ANSWER_IDENTITY_MIGRATION_VERSION = 'review-content-daily-v1-to-daily-v2'
export const DAILY_GROWTH_EVIDENCE_KEY = 'growth-evidence'
export const DAILY_CONTENT_MIGRATION_BACKUP_NAMESPACE = 'app.daily-content-migration-backup'

const ENGINE_ID = createRecordId('learning.engine', 'current-state')
const ACTIVE_PLAN_ID = createRecordId('app.learning-runtime', 'active-plan')
const WRONG_ANSWER_ID = createRecordId('app.wrong-answer-library', 'library-v1')
const MIGRATION_ID = createRecordId(DAILY_CONTENT_MIGRATION_NAMESPACE, DAILY_CONTENT_MIGRATION_KEY)
const EVIDENCE_ID = createRecordId(DAILY_CONTENT_MIGRATION_NAMESPACE, DAILY_GROWTH_EVIDENCE_KEY)

type ReviewDisposition = 'exact-equivalent' | 'retired' | 'unchanged'
interface ReviewIdentityMigrationEntry {
  readonly sourceAlias: string
  readonly sourceReviewContentId: string
  readonly originalQuestionType: string
  readonly disposition: ReviewDisposition
  readonly targetAlias?: string
  readonly targetReviewContentId?: string
}

export interface FrozenWrongAnswerRecord {
  readonly record: WrongAnswerRecord
  readonly reason: 'content-retired'
  readonly frozenAt: string
}

export interface DailyContentMigrationState {
  readonly schemaVersion: 1
  readonly migrationVersion: typeof DAILY_CONTENT_MIGRATION_VERSION
  readonly status: 'completed'
  readonly completedAt: string
  readonly frozenWrongAnswers: readonly FrozenWrongAnswerRecord[]
  readonly retiredDailyRoundItemIds: readonly string[]
}

interface MigrationBundle {
  readonly growthMappings: readonly DailyGrowthIdentityMigrationEntry[]
  readonly targets: readonly DailyGrowthTargetIdentity[]
  readonly reviewMappings: readonly ReviewIdentityMigrationEntry[]
  readonly releasedItemIds: ReadonlySet<string>
  readonly releasedCandidates: ReadonlyMap<string, { readonly itemId: string; readonly knowledgePointId: string; readonly semanticCategoryId: string }>
  readonly itemIdMappings: ReadonlyMap<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface ReleasedDailyCandidateIdentity { readonly itemId: string; readonly knowledgePointId: string; readonly semanticCategoryId: string }
export interface DailyContentMigrationResources {
  readonly growthMigration: unknown
  readonly wrongAnswerMigration: unknown
  readonly targetBatches: readonly unknown[]
  readonly releasedCandidates: readonly ReleasedDailyCandidateIdentity[]
  readonly releasedReviewAliases: Readonly<Record<string, { readonly reviewContentId: string; readonly originalQuestionType: string }>>
}

function strictBundle(resources: DailyContentMigrationResources): MigrationBundle {
  const growth = resources.growthMigration as { migrationVersion?: unknown; totals?: { sourceEntries?: unknown }; entries?: unknown }
  if (growth.migrationVersion !== DAILY_CONTENT_MIGRATION_VERSION || growth.totals?.sourceEntries !== 3005 || !Array.isArray(growth.entries) || growth.entries.length !== 3005) throw new TypeError('Daily growth identity mapping is incomplete.')
  const review = resources.wrongAnswerMigration as { mappingVersion?: unknown; totals?: { sourceAliases?: unknown; exactEquivalent?: unknown; retired?: unknown; unchanged?: unknown }; entries?: unknown }
  if (review.mappingVersion !== WRONG_ANSWER_IDENTITY_MIGRATION_VERSION || review.totals?.sourceAliases !== 11540 || review.totals.exactEquivalent !== 2280 || review.totals.retired !== 6735 || review.totals.unchanged !== 2525 || !Array.isArray(review.entries) || review.entries.length !== 11540) throw new TypeError('Wrong-answer identity mapping is incomplete.')
  const levels = resources.targetBatches as readonly { readonly records: readonly { readonly dailyKnowledgeId: string; readonly levelId: string }[] }[]
  if (levels.length !== 7 || levels.some((batch) => !Array.isArray(batch.records))) throw new TypeError('Daily v2 target batches are incomplete.')
  const levelOrder = ['kindergarten', 'primary-1', 'primary-2', 'primary-3', 'primary-4', 'primary-5', 'primary-6', 'junior-1', 'junior-2', 'junior-3', 'senior-1', 'senior-2', 'senior-3', 'cet-4-reference', 'cet-6-reference']
  const targets = levels.flatMap((batch) => batch.records.map((row) => ({ dailyKnowledgeId: row.dailyKnowledgeId, levelOrdinal: levelOrder.indexOf(row.levelId) })))
  if (targets.length !== 3000 || targets.some((target) => target.levelOrdinal < 0) || new Set(targets.map((target) => target.dailyKnowledgeId)).size !== 3000) throw new TypeError('Daily v2 target identities are incomplete.')
  const reviewMappings = review.entries as unknown as readonly ReviewIdentityMigrationEntry[]
  const reviewKeys = new Set<string>()
  const itemIdMappings = new Map<string, string>()
  const dispositions: Record<ReviewDisposition, number> = { 'exact-equivalent': 0, retired: 0, unchanged: 0 }
  for (const entry of reviewMappings) {
    const key = `${entry.sourceReviewContentId}::${entry.originalQuestionType}`
    if (reviewKeys.has(key)) throw new TypeError('Wrong-answer identity mapping has duplicate sources.')
    reviewKeys.add(key)
    if (!Object.hasOwn(dispositions, entry.disposition)) throw new TypeError('Wrong-answer identity migration disposition is invalid.')
    dispositions[entry.disposition] += 1
    const transferable = entry.disposition === 'exact-equivalent' || entry.disposition === 'unchanged'
    if (transferable !== Boolean(entry.targetReviewContentId && entry.targetAlias)) throw new TypeError('Wrong-answer migration target contradicts its disposition.')
    if (transferable) {
      const target = resources.releasedReviewAliases[entry.targetAlias!]
      if (!target || target.reviewContentId !== entry.targetReviewContentId || target.originalQuestionType !== entry.originalQuestionType) throw new TypeError('Wrong-answer migration target is not released in v2.')
    }
    if (entry.sourceAlias.startsWith('daily:') && entry.targetAlias?.startsWith('daily:')) itemIdMappings.set(entry.sourceAlias.slice(6), entry.targetAlias.slice(6))
  }
  if (dispositions['exact-equivalent'] !== 2280 || dispositions.retired !== 6735 || dispositions.unchanged !== 2525 || Object.keys(resources.releasedReviewAliases).length !== 11525) throw new TypeError('Wrong-answer migration disposition totals are invalid.')
  const releasedById = new Map(resources.releasedCandidates.map((candidate) => [candidate.itemId, candidate]))
  if (resources.releasedCandidates.some((candidate) => !candidate.itemId || !candidate.knowledgePointId || !candidate.semanticCategoryId)) throw new TypeError('Released v2 semantic identities are incomplete.')
  const released = new Set(releasedById.keys())
  if (released.size !== 10913) throw new TypeError('Released v2 supply identities are incomplete.')
  for (const target of itemIdMappings.values()) if (!released.has(target)) throw new TypeError('Mapped supply identity is not released in v2.')
  return { growthMappings: growth.entries as unknown as readonly DailyGrowthIdentityMigrationEntry[], targets, reviewMappings, releasedItemIds: released, releasedCandidates: releasedById, itemIdMappings }
}

function mergeWrongAnswer(left: WrongAnswerRecord | undefined, right: WrongAnswerRecord): WrongAnswerRecord {
  if (!left) return right
  const sources = [...new Set([...left.sources, ...right.sources])]
  return {
    ...right,
    status: left.status === 'active' || right.status === 'active' ? 'active' : 'history',
    incorrectCount: left.incorrectCount + right.incorrectCount,
    consecutiveReviewCorrect: Math.min(left.consecutiveReviewCorrect, right.consecutiveReviewCorrect) as 0 | 1 | 2,
    lastIncorrectAt: left.lastIncorrectAt > right.lastIncorrectAt ? left.lastIncorrectAt : right.lastIncorrectAt,
    lastReviewAttemptAt: [left.lastReviewAttemptAt, right.lastReviewAttemptAt].filter((value): value is string => value !== null).sort().at(-1) ?? null,
    movedToHistoryAt: null,
    sources,
  }
}

function migrateWrongAnswers(state: WrongAnswerLibraryState, mappings: readonly ReviewIdentityMigrationEntry[], now: string): { state: WrongAnswerLibraryState; frozen: readonly FrozenWrongAnswerRecord[] } {
  assertWrongAnswerLibraryState(state)
  const byIdentity = new Map(mappings.map((entry) => [`${entry.sourceReviewContentId}::${entry.originalQuestionType}`, entry]))
  const records: Record<string, WrongAnswerRecord> = {}
  const frozen: FrozenWrongAnswerRecord[] = []
  for (const record of Object.values(state.records)) {
    const mapping = byIdentity.get(`${record.reviewContentId}::${record.originalQuestionType}`)
    if (!mapping) throw new TypeError('Stored wrong answer has no content identity migration.')
    if (mapping.disposition === 'retired') {
      frozen.push({ record, reason: 'content-retired', frozenAt: now })
      continue
    }
    const reviewContentId = mapping.targetReviewContentId!
    const recordId = `${reviewContentId}::${record.originalQuestionType}`
    const migrated = { ...record, reviewContentId, recordId }
    records[recordId] = mergeWrongAnswer(records[recordId], migrated)
  }
  const activeRound = state.activeRound === null ? null : { ...state.activeRound, status: 'failed' as const, failure: 'identity-drift' as const }
  const next = { ...state, records, activeRound }
  assertWrongAnswerLibraryState(next)
  return { state: next, frozen }
}

function migrateRound(round: unknown, bundle: MigrationBundle, retired: Set<string>): unknown {
  if (!isRecord(round) || !Array.isArray(round.order)) return undefined
  const order = round.order as unknown[]
  const mapped = order.map((id) => typeof id === 'string' ? bundle.itemIdMappings.get(id) ?? (bundle.releasedItemIds.has(id) ? id : null) : null)
  if (mapped.some((id) => id === null) || new Set(mapped).size !== mapped.length) {
    for (const id of order) if (typeof id === 'string' && !bundle.releasedItemIds.has(id)) retired.add(id)
    return undefined
  }
  const mapIdentity = (value: unknown) => {
    if (!isRecord(value) || typeof value.itemId !== 'string') return null
    const itemId = bundle.itemIdMappings.get(value.itemId) ?? (bundle.releasedItemIds.has(value.itemId) ? value.itemId : null)
    const candidate = itemId ? bundle.releasedCandidates.get(itemId) : undefined
    return candidate ? { ...value, ...candidate } : null
  }
  const history = Array.isArray(round.shortTermHistory) ? round.shortTermHistory.map(mapIdentity).filter((value) => value !== null) : undefined
  const audit = Array.isArray(round.orderAudit) ? round.orderAudit.map(mapIdentity) : undefined
  if (audit?.some((value) => value === null)) return undefined
  const excluded = Array.isArray(round.shortTermExcludedItemIds)
    ? round.shortTermExcludedItemIds.map((id) => typeof id === 'string' ? bundle.itemIdMappings.get(id) ?? (bundle.releasedItemIds.has(id) ? id : null) : null).filter((id): id is string => id !== null)
    : []
  return {
    ...round,
    order: mapped,
    shortTermExcludedItemIds: [...new Set(excluded)],
    ...(history ? { shortTermHistory: history } : {}),
    ...(audit ? { orderAudit: audit } : {}),
  }
}

function migrateTrainingState(training: unknown, bundle: MigrationBundle, retired: Set<string>): unknown {
  if (!isRecord(training)) return training
  const supplyRound = migrateRound(training.supplyRound, bundle, retired)
  const mapId = (id: unknown) => typeof id === 'string' ? bundle.itemIdMappings.get(id) ?? (bundle.releasedItemIds.has(id) ? id : null) : null
  const completed = Array.isArray(training.completedItemIds) ? training.completedItemIds.map(mapId).filter((id): id is string => id !== null) : []
  const excluded = Array.isArray(training.excludeItemIds) ? training.excludeItemIds.map(mapId).filter((id): id is string => id !== null) : undefined
  const nextCursor = mapId(training.nextSupplyCursor)
  const { supplyRound: _oldRound, ...base } = training
  return {
    ...base,
    ...(Array.isArray(training.completedItemIds) ? { completedItemIds: [...new Set(completed)] } : {}),
    ...(excluded ? { excludeItemIds: [...new Set(excluded)] } : {}),
    nextSupplyCursor: nextCursor,
    ...(supplyRound === undefined ? {} : { supplyRound }),
    ...('contentExhausted' in training ? { contentExhausted: supplyRound === undefined ? null : training.contentExhausted } : {}),
  }
}

function migrateActivePlan(value: unknown, bundle: MigrationBundle, retired: Set<string>): unknown {
  if (!isRecord(value) || !isRecord(value.activePlan) || !Array.isArray(value.activePlan.tasks)) return value
  return { ...value, activePlan: { ...value.activePlan, tasks: value.activePlan.tasks.map((execution) => isRecord(execution) && execution.training ? { ...execution, training: migrateTrainingState(execution.training, bundle, retired) } : execution) } }
}

function migrateEngine(value: unknown, bundle: MigrationBundle, retired: Set<string>): unknown {
  if (!isRecord(value)) throw new TypeError('Learning engine state is invalid during daily-content migration.')
  const extra = isRecord(value.extraTraining) && isRecord(value.extraTraining.sessions)
    ? { ...value.extraTraining, sessions: Object.fromEntries(Object.entries(value.extraTraining.sessions).map(([id, session]) => [id, isRecord(session) ? { ...session, ...migrateTrainingState(session, bundle, retired) as object } : session])) }
    : value.extraTraining
  const recent = isRecord(value.recentTrainingItemIds) ? Object.fromEntries(Object.entries(value.recentTrainingItemIds).map(([bucket, ids]) => [bucket, Array.isArray(ids) ? [...new Set(ids.map((id) => bundle.itemIdMappings.get(String(id)) ?? (bundle.releasedItemIds.has(String(id)) ? String(id) : null)).filter((id): id is string => id !== null))].slice(-12) : ids])) : value.recentTrainingItemIds
  const semantic = isRecord(value.recentTrainingSemanticHistory) ? Object.fromEntries(Object.entries(value.recentTrainingSemanticHistory).map(([bucket, entries]) => [bucket, Array.isArray(entries) ? entries.flatMap((entry) => { if (!isRecord(entry) || typeof entry.itemId !== 'string') return []; const itemId = bundle.itemIdMappings.get(entry.itemId) ?? (bundle.releasedItemIds.has(entry.itemId) ? entry.itemId : null); const candidate = itemId ? bundle.releasedCandidates.get(itemId) : undefined; return candidate ? [candidate] : [] }).slice(-12) : entries])) : value.recentTrainingSemanticHistory
  return {
    ...value,
    ...(extra === undefined ? {} : { extraTraining: extra }),
    ...(recent === undefined ? {} : { recentTrainingItemIds: recent }),
    ...(semantic === undefined ? {} : { recentTrainingSemanticHistory: semantic }),
  }
}

function databaseRecord(namespace: string, key: string, value: unknown, now: string): DatabaseRecord {
  assertPortableValue(value)
  return { id: createRecordId(namespace, key), namespace, key, value, schemaVersion: 1, updatedAt: now }
}

function completedMigration(value: unknown): DailyContentMigrationState {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.migrationVersion !== DAILY_CONTENT_MIGRATION_VERSION || value.status !== 'completed' || typeof value.completedAt !== 'string' || !Array.isArray(value.frozenWrongAnswers) || !Array.isArray(value.retiredDailyRoundItemIds)) throw new TypeError('Stored daily-content migration checkpoint is corrupt.')
  return value as unknown as DailyContentMigrationState
}

export class DailyContentV2MigrationCoordinator {
  readonly #database: AppDatabase
  readonly #loadResources: () => Promise<DailyContentMigrationResources>
  readonly #now: () => string
  constructor(options: { readonly database?: AppDatabase; readonly loadResources: () => Promise<DailyContentMigrationResources>; readonly now?: () => string }) {
    this.#database = options.database ?? appDatabase
    this.#loadResources = options.loadResources
    this.#now = options.now ?? (() => new Date().toISOString())
  }

  async run(): Promise<DailyContentMigrationState> {
    const existing = await this.#database.records.get(MIGRATION_ID)
    if (existing) return completedMigration(existing.value)
    const now = this.#now()
    try {
      const bundle = strictBundle(await this.#loadResources())
      return await this.#database.transaction('rw', this.#database.records, async () => {
        const repeated = await this.#database.records.get(MIGRATION_ID)
        if (repeated) return completedMigration(repeated.value)
        const [engineRecord, planRecord, wrongRecord, evidenceRecord] = await Promise.all([ENGINE_ID, ACTIVE_PLAN_ID, WRONG_ANSWER_ID, EVIDENCE_ID].map((id) => this.#database.records.get(id)))
        const retired = new Set<string>()
        const engine = engineRecord ? migrateEngine(engineRecord.value, bundle, retired) : undefined
        const plan = planRecord ? migrateActivePlan(planRecord.value, bundle, retired) : undefined
        const wrong = migrateWrongAnswers(wrongRecord ? wrongRecord.value as WrongAnswerLibraryState : createWrongAnswerLibraryState(), bundle.reviewMappings, now)
        const legacyEvidence: DailyGrowthEvidenceMigrationV1 | DailyGrowthEvidenceMigrationV2 = evidenceRecord
          ? evidenceRecord.value as DailyGrowthEvidenceMigrationV1 | DailyGrowthEvidenceMigrationV2
          : { schemaVersion: 1, migrationVersion: DAILY_CONTENT_MIGRATION_VERSION, evidence: [] }
        const evidence = migrateDailyGrowthEvidence({ state: legacyEvidence, expectedMigrationVersion: DAILY_CONTENT_MIGRATION_VERSION, mappings: bundle.growthMappings, targetIdentities: bundle.targets })
        const state: DailyContentMigrationState = { schemaVersion: 1, migrationVersion: DAILY_CONTENT_MIGRATION_VERSION, status: 'completed', completedAt: now, frozenWrongAnswers: wrong.frozen, retiredDailyRoundItemIds: [...retired].sort() }
        if (engineRecord) await this.#database.records.put({ ...engineRecord, value: engine, updatedAt: now })
        if (planRecord) await this.#database.records.put({ ...planRecord, value: plan, updatedAt: now })
        await this.#database.records.put(databaseRecord('app.wrong-answer-library', 'library-v1', wrong.state, now))
        await this.#database.records.put(databaseRecord(DAILY_CONTENT_MIGRATION_NAMESPACE, DAILY_GROWTH_EVIDENCE_KEY, evidence, now))
        await this.#database.records.put(databaseRecord(DAILY_CONTENT_MIGRATION_NAMESPACE, DAILY_CONTENT_MIGRATION_KEY, state, now))
        return state
      })
    } catch (error) {
      const capturedAt = this.#now()
      const key = `failed-${capturedAt}-${crypto.randomUUID()}`
      const affectedRecords = await Promise.all([ENGINE_ID, ACTIVE_PLAN_ID, WRONG_ANSWER_ID, EVIDENCE_ID].map(async (id) => {
        const record = await this.#database.records.get(id)
        return record ? { namespace: record.namespace, key: record.key, schemaVersion: record.schemaVersion, updatedAt: record.updatedAt, value: record.value } : null
      }))
      await this.#database.records.put(databaseRecord(DAILY_CONTENT_MIGRATION_BACKUP_NAMESPACE, key, { schemaVersion: 1, capturedAt, reason: error instanceof Error ? error.message : 'unknown migration failure', affectedRecords }, capturedAt))
      throw error
    }
  }
}
