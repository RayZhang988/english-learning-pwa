import fs from 'node:fs'
import { auditDailyLevelQuality } from './audit-daily-level-quality.v2.mjs'

const writeMode = process.argv.includes('--write')
const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'))
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
const normalizeZh = (value) => value.trim().replace(/\s+/g, '')
const assert = (condition, message) => { if (!condition) throw new Error(`Batch B: ${message}`) }

const batchA = read('content/curriculum/daily-level-content-batch-a.v2.json')
const content = read('content/curriculum/daily-level-content-batch-b.v2.json')
const migration = read('content/curriculum/daily-level-identity-migration-batch-b.v1.json')
const rubric = read('content/curriculum/daily-level-rubric.v2.json')
const packageIndex = read('content/curriculum/package-index.v1.json')
const releasedAll = packageIndex.lessonFiles.flatMap((file) => read(file).lessons).flatMap((lesson) =>
  lesson.learningUnits.filter((unit) => unit.domain === 'vocabulary').flatMap((unit) => unit.activity.items.map((item) => ({ ...item, difficulty:item.growthDifficultyLevel ?? unit.difficultyLevel }))),
)
const released = releasedAll.filter((item) => item.difficulty >= 2 && item.difficulty <= 4.5)
const releasedLaterLevels = releasedAll.filter((item) => item.difficulty >= 5)

assert(content.releaseStatus === 'candidate-not-deployable-until-batch-c', 'partial content must not identify itself as deployable.')
assert(content.records.length === 1200, `expected 1200 records, got ${content.records.length}`)
assert(new Set(content.records.map((row) => row.dailyKnowledgeId)).size === 1200, 'dailyKnowledgeId values are not unique.')
assert(new Set(content.records.map((row) => normalize(row.term))).size === 1200, 'English forms are not unique across Batch B.')
assert(new Set([...batchA.records, ...content.records].map((row) => normalize(row.term))).size === 2000, 'Batch A and B share an English form.')
assert(content.records.every((row) => row.dailyKnowledgeId.startsWith('daily-knowledge-v2:')), 'a candidate uses the old identity namespace.')
assert(content.records.every((row) => row.authoring?.contentReviewStatus === 'candidate-reviewed' && row.authoring.travelUse === 'daily-travel-independent'), 'authoring metadata is incomplete.')
const unnatural = /\b(legal options|available remedies|next formal step|official terms|preserve my rights|reasoned decision|documented resolution|authority and time limit|qualifies for compensation|appropriate authority|please document why|provide written details about|explain how .* affects my itinerary|tell me what evidence is required for|before i finalize my travel plans)\b/iu
assert(content.records.every((row) => !unnatural.test(row.term)), 'legalistic or mechanical language remains.')
const tooEasyForIntermediate = /\b(refund appear on my card|when my ride arrives|room away from the elevator|boarding pass for the new flight|get off at the next stop|table away from the kitchen|pass on the airport train|pick me up at the side entrance|receipt for the refund|printed copy for the border officer|table for two|this in my size|exchange it for another size|connect to wi-fi|make an international call|bring this on the plane|help with my boarding pass|move me to another room)\b/iu
assert(content.records.filter((row) => row.growthDifficultyLevel >= 4).every((row) => !tooEasyForIntermediate.test(row.term)), 'elementary survival language remains in an intermediate level.')

const audit = auditDailyLevelQuality([...batchA.records, ...content.records].map((row) => ({ ...row, difficulty:row.growthDifficultyLevel })), rubric)
const batchLevels = audit.levels.slice(4, 10)
assert(batchLevels.every((level) => level.metrics.count === 200 && level.violations.length === 0), `rubric violations remain: ${batchLevels.flatMap((level) => level.violations).join(', ')}`)
assert(audit.crossLevelDuplicateForms.length === 0, 'cross-level English forms remain across A and B.')
for (let index = 1; index < batchLevels.length; index += 1) {
  const previous = batchLevels[index - 1].metrics
  const current = batchLevels[index].metrics
  assert(current.averageTokens > previous.averageTokens, `${batchLevels[index].id} average token count does not increase.`)
  assert(current.completeUtteranceRatio > previous.completeUtteranceRatio, `${batchLevels[index].id} functional-utterance ratio does not increase.`)
  assert(current.wordRatio < previous.wordRatio, `${batchLevels[index].id} word ratio does not decline.`)
}
assert(batchLevels.every((level) => level.metrics.maximumOpeningCluster <= 6), 'an opening-four-token cluster exceeds six items.')
assert(batchLevels.every((level) => level.metrics.maximumSkeletonCluster <= 8), 'a sentence skeleton cluster exceeds eight items.')

assert(migration.sourceRecordCount === released.length && migration.entries.length === released.length, `migration does not cover all ${released.length} released Batch B source records.`)
assert(new Set(migration.entries.map((row) => row.sourceItemId)).size === released.length, 'migration source items are duplicated.')
assert(migration.entries.every((row) => typeof row.sourceDailyKnowledgeId === 'string' && row.sourceDailyKnowledgeId.length > 0), 'migration has an unresolved source identity.')
const contentById = new Map(content.records.map((row) => [row.dailyKnowledgeId, row]))
const oldById = new Map(released.map((row) => [row.id, row]))
for (const entry of migration.entries) {
  const old = oldById.get(entry.sourceItemId)
  assert(old, `unknown migration source ${entry.sourceItemId}`)
  if (entry.disposition.includes('equivalent')) {
    const target = contentById.get(entry.targetDailyKnowledgeId)
    assert(target, `unknown equivalent target ${entry.targetDailyKnowledgeId}`)
    assert(normalize(old.term) === normalize(target.term) && normalizeZh(old.meaningZh) === normalizeZh(target.meaningZh), `false equivalent mapping for ${entry.sourceItemId}`)
    assert(entry.evidenceTransferAllowed === true, `equivalent ${entry.sourceItemId} does not allow evidence transfer.`)
  } else {
    assert(entry.disposition === 'retired' && entry.evidenceTransferAllowed === false && !entry.targetDailyKnowledgeId, `retirement ${entry.sourceItemId} is unsafe.`)
  }
}

const dispositionCounts = Object.fromEntries(Object.entries(Object.groupBy(migration.entries, (row) => row.disposition)).map(([name, rows]) => [name, rows.length]))
const laterForms = new Set(releasedLaterLevels.map((row) => normalize(row.term)))
const pendingCrossBatchConflicts = content.records.filter((row) => laterForms.has(normalize(row.term))).map((row) => ({ dailyKnowledgeId:row.dailyKnowledgeId, term:row.term, levelId:row.levelId }))
const report = {
  schemaVersion:1,
  documentType:'daily-level-batch-quality-audit',
  auditVersion:'2.0.0-b',
  releaseStatus:'candidate-blocked-until-batch-c',
  records:1200,
  combinedRecordsWithBatchA:2000,
  levels:batchLevels.map((level) => ({ id:level.id, labelZh:level.labelZh, metrics:level.metrics })),
  crossLevelDuplicateFormsWithBatchA:0,
  templateMaximums:{ sharedOpeningFourTokens:Math.max(...batchLevels.map((level) => level.metrics.maximumOpeningCluster)), sharedSkeleton:Math.max(...batchLevels.map((level) => level.metrics.maximumSkeletonCluster)) },
  identityMigration:{ sourceRecords:released.length, ...dispositionCounts, newV2Identities:migration.newIdentities.length },
  remainingWork:{ batchC:'高一至大学六级，1000项', pendingCrossBatchConflictCount:pendingCrossBatchConflicts.length, pendingCrossBatchConflicts, formalIndexesRegenerated:false, reason:'R13-D review identity lock forbids replacing released aliases before complete v2 migration is integrated.' },
}
const output = 'content/curriculum/daily-level-batch-b-quality-audit.v2.json'
const serialized = `${JSON.stringify(report, null, 2)}\n`
if (writeMode) fs.writeFileSync(output, serialized)
else assert(fs.readFileSync(output, 'utf8') === serialized, `${output} is stale; run with --write.`)
console.log(`Batch B valid: 1200 records; ${dispositionCounts.equivalent ?? 0} retained; ${dispositionCounts['moved-equivalent'] ?? 0} reassigned; ${dispositionCounts.retired ?? 0} retired.`)
