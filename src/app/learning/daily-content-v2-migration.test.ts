import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../storage/indexed-db/AppDatabase.ts'
import { createRecordId } from '../../storage/record-id.ts'
import { createWrongAnswerLibraryState, type WrongAnswerRecord } from '../../learning-engine/index.ts'
import { releasedCatalogs } from '../../../tests/qa/fixtures/production-course.ts'
import { loadReleasedReviewContentIndex } from '../review-content-test-fixtures.ts'
import reviewMigration from '../../../content/curriculum/wrong-answer-review-identity-migration.v1.json'
import growthMigration from '../../../content/curriculum/daily-level-identity-migration.v2.json'
import batchA from '../../../content/curriculum/daily-level-content-batch-a.v2.json'
import batchB from '../../../content/curriculum/daily-level-content-batch-b.v2.json'
import c1 from '../../../content/curriculum/daily-level-content-c1.v2.json'
import c2 from '../../../content/curriculum/daily-level-content-c2.v2.json'
import c3 from '../../../content/curriculum/daily-level-content-c3.v2.json'
import c4 from '../../../content/curriculum/daily-level-content-c4.v2.json'
import c5 from '../../../content/curriculum/daily-level-content-c5.v2.json'
import {
  DAILY_CONTENT_MIGRATION_BACKUP_NAMESPACE,
  DAILY_CONTENT_MIGRATION_KEY,
  DAILY_CONTENT_MIGRATION_NAMESPACE,
  DAILY_GROWTH_EVIDENCE_KEY,
  DailyContentV2MigrationCoordinator,
} from './daily-content-v2-migration.ts'

const databases: AppDatabase[] = []
afterEach(async () => { await Promise.all(databases.splice(0).map((database) => database.delete())) })

function database(): AppDatabase {
  const value = new AppDatabase(`daily-content-migration-${crypto.randomUUID()}`)
  databases.push(value)
  return value
}

function releasedCandidates(): readonly { readonly itemId: string; readonly knowledgePointId: string; readonly semanticCategoryId: string }[] {
  const { vocabulary, listening, speaking } = releasedCatalogs()
  return [vocabulary, listening, speaking].flatMap((catalog) => (catalog.trainingSupplyIndex as { candidates: readonly { itemId: string; knowledgePointId: string; semanticCategoryId: string }[] }).candidates.map(({ itemId, knowledgePointId, semanticCategoryId }) => ({ itemId, knowledgePointId, semanticCategoryId })))
}

function coordinator(db: AppDatabase, candidates = releasedCandidates()) {
  return new DailyContentV2MigrationCoordinator({ database: db, loadResources: async () => ({ growthMigration, wrongAnswerMigration: reviewMigration, targetBatches: [batchA, batchB, c1, c2, c3, c4, c5], releasedCandidates: candidates, releasedReviewAliases: (await loadReleasedReviewContentIndex()).aliases }), now: () => '2026-08-15T02:00:00.000Z' })
}

function wrongRecord(reviewContentId: string, originalQuestionType: string): WrongAnswerRecord {
  return { schemaVersion: 1, recordId: `${reviewContentId}::${originalQuestionType}`, reviewContentId, originalQuestionType, domain: 'vocabulary', status: 'active', incorrectCount: 1, consecutiveReviewCorrect: 0, lastIncorrectAt: '2026-08-14T00:00:00.000Z', lastReviewAttemptAt: null, movedToHistoryAt: null, lastSource: 'daily-training', sources: ['daily-training'] }
}

async function put(db: AppDatabase, namespace: string, key: string, value: unknown) {
  await db.records.put({ id: createRecordId(namespace, key), namespace, key, value, schemaVersion: 1, updatedAt: '2026-08-14T00:00:00.000Z' })
}

describe('QA-R17-003 production identity migration', () => {
  it('initializes a new user atomically without inventing historical growth evidence', async () => {
    const db = database()
    const result = await coordinator(db).run()
    expect(result).toMatchObject({ status: 'completed', frozenWrongAnswers: [], retiredDailyRoundItemIds: [] })
    const evidence = await db.records.get(createRecordId(DAILY_CONTENT_MIGRATION_NAMESPACE, DAILY_GROWTH_EVIDENCE_KEY))
    expect(evidence?.value).toEqual({ schemaVersion: 2, migrationVersion: 'daily-level-v1-to-v2-complete', activeEvidence: [], retiredEvidence: [] })
    expect(await db.records.get(createRecordId('app.wrong-answer-library', 'library-v1'))).toBeDefined()
  })

  it('migrates exact equivalents, freezes retired wrong answers, and never applies rewritten answers', async () => {
    const db = database()
    const exact = reviewMigration.entries.find((entry) => entry.disposition === 'exact-equivalent')!
    const retired = reviewMigration.entries.find((entry) => entry.disposition === 'retired')!
    const state = createWrongAnswerLibraryState()
    const exactRecord = wrongRecord(exact.sourceReviewContentId, exact.originalQuestionType)
    const retiredRecord = wrongRecord(retired.sourceReviewContentId, retired.originalQuestionType)
    await put(db, 'app.wrong-answer-library', 'library-v1', { ...state, records: { [exactRecord.recordId]: exactRecord, [retiredRecord.recordId]: retiredRecord } })
    const result = await coordinator(db).run()
    expect(result.frozenWrongAnswers).toHaveLength(1)
    expect(result.frozenWrongAnswers[0]?.record.reviewContentId).toBe(retired.sourceReviewContentId)
    const library = (await db.records.get(createRecordId('app.wrong-answer-library', 'library-v1')))!.value as { records: Record<string, WrongAnswerRecord> }
    expect(Object.values(library.records)).toEqual([expect.objectContaining({ reviewContentId: exact.targetReviewContentId, originalQuestionType: exact.originalQuestionType })])
    expect(Object.values(library.records).some((record) => record.reviewContentId === retired.sourceReviewContentId)).toBe(false)
  })

  it('preserves aggregate growth levels while migrating 222 same-level, 538 moved and 2245 retired evidence facts', async () => {
    const db = database()
    const equivalent = growthMigration.entries.find((entry) => entry.disposition === 'equivalent')!
    const moved = growthMigration.entries.find((entry) => entry.disposition === 'moved-equivalent')!
    const retired = growthMigration.entries.find((entry) => entry.disposition === 'retired')!
    const order = ['kindergarten', 'primary-1', 'primary-2', 'primary-3', 'primary-4', 'primary-5', 'primary-6', 'junior-1', 'junior-2', 'junior-3', 'senior-1', 'senior-2', 'senior-3', 'cet-4-reference', 'cet-6-reference']
    const levelById = new Map([batchA, batchB, c1, c2, c3, c4, c5].flatMap((batch) => batch.records.map((row) => [row.dailyKnowledgeId, order.indexOf(row.levelId)] as const)))
    const equivalentLevel = levelById.get(equivalent.targetDailyKnowledgeId!)!
    const movedTargetLevel = levelById.get(moved.targetDailyKnowledgeId!)!
    const targets = [
      { source: equivalent, level: equivalentLevel },
      { source: moved, level: movedTargetLevel === 0 ? 1 : 0 },
      { source: retired, level: 0 },
    ]
    await put(db, DAILY_CONTENT_MIGRATION_NAMESPACE, DAILY_GROWTH_EVIDENCE_KEY, { schemaVersion: 1, migrationVersion: 'daily-level-v1-to-v2-complete', evidence: targets.map(({ source, level }, index) => ({ evidenceId: `e${index}`, domain: 'vocabulary', dailyKnowledgeId: source.sourceDailyKnowledgeId, levelOrdinal: level, correctCount: 1, incorrectCount: 1 })) })
    await coordinator(db).run()
    const value = (await db.records.get(createRecordId(DAILY_CONTENT_MIGRATION_NAMESPACE, DAILY_GROWTH_EVIDENCE_KEY)))!.value as { activeEvidence: { countsTowardUpgradeWindow: boolean }[]; retiredEvidence: unknown[] }
    expect(value.activeEvidence).toHaveLength(2)
    expect(value.activeEvidence.map((entry) => entry.countsTowardUpgradeWindow).sort()).toEqual([false, true])
    expect(value.retiredEvidence).toHaveLength(1)
  })

  it('is idempotent across refresh and isolated between test databases', async () => {
    const first = database(); const second = database()
    const migration = coordinator(first)
    const once = await migration.run(); const twice = await migration.run()
    expect(twice).toEqual(once)
    expect(await second.records.get(createRecordId(DAILY_CONTENT_MIGRATION_NAMESPACE, DAILY_CONTENT_MIGRATION_KEY))).toBeUndefined()
  })

  it('moves only exact semantic history and retires an incompatible in-progress daily round without injecting old ids', async () => {
    const db = database()
    const exact = reviewMigration.entries.find((entry) => entry.disposition === 'exact-equivalent' && entry.sourceAlias.includes('vocabulary'))!
    const retired = reviewMigration.entries.find((entry) => entry.disposition === 'retired' && entry.sourceAlias.includes('vocabulary'))!
    const sourceItemId = exact.sourceAlias.slice(6)
    const retiredItemId = retired.sourceAlias.slice(6)
    const targetItemId = exact.targetAlias!.slice(6)
    await put(db, 'learning.engine', 'current-state', {
      schemaVersion: 1,
      progress: { schemaVersion: 1, profileId: 'p', domains: {}, lastReassessmentAt: null },
      reviewItems: {},
      recentTrainingItemIds: { 'vocabulary:learn:1': [sourceItemId, retiredItemId] },
      recentTrainingSemanticHistory: { 'vocabulary:learn:1': [{ itemId: sourceItemId, knowledgePointId: 'old', semanticCategoryId: 'old' }, { itemId: retiredItemId, knowledgePointId: 'retired', semanticCategoryId: 'retired' }] },
    })
    await put(db, 'app.learning-runtime', 'active-plan', { schemaVersion: 1, activePlan: { tasks: [{ task: { taskId: 't' }, training: { schemaVersion: 1, completedItemIds: [], nextSupplyCursor: retiredItemId, supplyRound: { schemaVersion: 2, order: [retiredItemId], candidateById: { [retiredItemId]: { itemId: retiredItemId, knowledgePointId: 'retired', semanticCategoryId: 'retired' } } }, contentExhausted: null } }] } })
    const result = await coordinator(db).run()
    expect(result.retiredDailyRoundItemIds).toContain(retiredItemId)
    const engine = (await db.records.get(createRecordId('learning.engine', 'current-state')))!.value as { recentTrainingItemIds: Record<string, string[]>; recentTrainingSemanticHistory: Record<string, { itemId: string; knowledgePointId: string }[]> }
    expect(engine.recentTrainingItemIds['vocabulary:learn:1']).toEqual([targetItemId])
    expect(engine.recentTrainingSemanticHistory['vocabulary:learn:1']?.[0]).toMatchObject({ itemId: targetItemId })
    expect(engine.recentTrainingSemanticHistory['vocabulary:learn:1']?.[0]?.knowledgePointId).not.toBe('old')
    const runtime = (await db.records.get(createRecordId('app.learning-runtime', 'active-plan')))!.value as { activePlan: { tasks: { training: Record<string, unknown> }[] } }
    expect(runtime.activePlan.tasks[0]?.training.supplyRound).toBeUndefined()
    expect(runtime.activePlan.tasks[0]?.training.nextSupplyCursor).toBeNull()
  })

  it('does not partially overwrite user data when mapping or released identities are missing', async () => {
    const db = database()
    await put(db, 'unrelated.user-data', 'keep', { value: 7 })
    const allCandidates = releasedCandidates()
    const removedId = allCandidates[100]!.itemId
    const missing = allCandidates.filter((candidate) => candidate.itemId !== removedId)
    await expect(coordinator(db, missing).run()).rejects.toThrow('Released v2 supply identities are incomplete')
    expect((await db.records.get(createRecordId('unrelated.user-data', 'keep')))?.value).toEqual({ value: 7 })
    expect(await db.records.get(createRecordId(DAILY_CONTENT_MIGRATION_NAMESPACE, DAILY_CONTENT_MIGRATION_KEY))).toBeUndefined()
    expect((await db.records.where('namespace').equals(DAILY_CONTENT_MIGRATION_BACKUP_NAMESPACE).count())).toBe(1)
  })
})
