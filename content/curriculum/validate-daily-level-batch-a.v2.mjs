import fs from 'node:fs'
import { auditDailyLevelQuality } from './audit-daily-level-quality.v2.mjs'

const writeMode = process.argv.includes('--write')
const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'))
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
const normalizeZh = (value) => value.trim().replace(/\s+/g, '')
const assert = (condition, message) => { if (!condition) throw new Error(`Batch A: ${message}`) }

const content = read('content/curriculum/daily-level-content-batch-a.v2.json')
const migration = read('content/curriculum/daily-level-identity-migration-batch-a.v1.json')
const rubric = read('content/curriculum/daily-level-rubric.v2.json')
const packageIndex = read('content/curriculum/package-index.v1.json')
const released = packageIndex.lessonFiles.flatMap((file) => read(file).lessons).flatMap((lesson) =>
  lesson.learningUnits.filter((unit) => unit.domain === 'vocabulary').flatMap((unit) => unit.activity.items.map((item) => ({ ...item, difficulty:item.growthDifficultyLevel ?? unit.difficultyLevel }))),
).filter((item) => item.difficulty <= 1.5)
const releasedLaterLevels = packageIndex.lessonFiles.flatMap((file) => read(file).lessons).flatMap((lesson) =>
  lesson.learningUnits.filter((unit) => unit.domain === 'vocabulary').flatMap((unit) => unit.activity.items.map((item) => ({ ...item, difficulty:item.growthDifficultyLevel ?? unit.difficultyLevel }))),
).filter((item) => item.difficulty > 1.5)

assert(content.releaseStatus === 'candidate-not-deployable-until-batches-b-and-c', 'partial content must not identify itself as deployable.')
assert(content.records.length === 800, `expected 800 records, got ${content.records.length}`)
assert(new Set(content.records.map((row) => row.dailyKnowledgeId)).size === 800, 'dailyKnowledgeId values are not unique.')
assert(new Set(content.records.map((row) => normalize(row.term))).size === 800, 'English forms are not unique across Batch A.')
assert(content.records.every((row) => row.dailyKnowledgeId.startsWith('daily-knowledge-v2:')), 'a candidate uses the old identity namespace.')
assert(content.records.every((row) => row.authoring?.contentReviewStatus === 'candidate-reviewed' && row.authoring.travelUse === 'daily-travel-survival'), 'authoring metadata is incomplete.')

const audit = auditDailyLevelQuality(content.records.map((row) => ({ ...row, difficulty:row.growthDifficultyLevel })), rubric)
const batchLevels = audit.levels.slice(0, 4)
assert(batchLevels.every((level) => level.violations.length === 0), `rubric violations remain: ${batchLevels.flatMap((level) => level.violations).join(', ')}`)
assert(audit.crossLevelDuplicateForms.length === 0, 'cross-level English forms remain.')
assert(batchLevels[0].excluded.length === 0, 'kindergarten exclusions remain.')

assert(migration.sourceRecordCount === 800 && migration.entries.length === 800, 'migration does not cover every released Batch A source record.')
assert(new Set(migration.entries.map((row) => row.sourceItemId)).size === 800, 'migration source items are duplicated.')
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
  auditVersion:'2.0.0-a',
  releaseStatus:'candidate-blocked-until-batches-b-and-c',
  records:800,
  levels:batchLevels.map((level) => ({ id:level.id, labelZh:level.labelZh, metrics:level.metrics })),
  crossLevelDuplicateForms:0,
  templateMaximums:{ sharedOpeningFourTokens:Math.max(...batchLevels.map((level) => level.metrics.maximumOpeningCluster)), sharedSkeleton:Math.max(...batchLevels.map((level) => level.metrics.maximumSkeletonCluster)) },
  identityMigration:{ sourceRecords:800, ...dispositionCounts, newV2Identities:migration.newIdentities.length },
  remainingWork:{ batchB:'四年级至初三，1200项', batchC:'高一至大学六级，1000项', pendingCrossBatchConflictCount:pendingCrossBatchConflicts.length, pendingCrossBatchConflicts, formalIndexesRegenerated:false, reason:'R13-D review identity lock forbids replacing released aliases before complete v2 migration is integrated.' },
}
const output = 'content/curriculum/daily-level-batch-a-quality-audit.v2.json'
const serialized = `${JSON.stringify(report, null, 2)}\n`
if (writeMode) fs.writeFileSync(output, serialized)
else assert(fs.readFileSync(output, 'utf8') === serialized, `${output} is stale; run with --write.`)
console.log(`Batch A valid: 800 records; ${dispositionCounts.equivalent ?? 0} retained; ${dispositionCounts['moved-equivalent'] ?? 0} reassigned; ${dispositionCounts.retired ?? 0} retired.`)
