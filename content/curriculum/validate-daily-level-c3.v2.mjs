import fs from 'node:fs'
import { auditDailyLevelQuality } from './audit-daily-level-quality.v2.mjs'

const writeMode = process.argv.includes('--write')
const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'))
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
const assert = (condition, message) => { if (!condition) throw new Error(`C3: ${message}`) }
const paths = ['daily-level-content-batch-a.v2.json', 'daily-level-content-batch-b.v2.json', 'daily-level-content-c1.v2.json', 'daily-level-content-c2.v2.json', 'daily-level-content-c3.v2.json']
const parts = paths.map((path) => read(`content/curriculum/${path}`))
const records = parts.flatMap((part) => part.records)
const levelRows = parts[4].records
const rubric = read('content/curriculum/daily-level-rubric.v2.json')
const migration = read('content/curriculum/daily-level-identity-migration-c3.v1.json')
assert(levelRows.length === 200, 'must contain 200 records.')
assert(new Set(records.map((row) => normalize(row.term))).size === 2600, 'A through C3 must contain 2600 unique English forms.')
assert(new Set(levelRows.map((row) => row.authoring.topic)).size === 5, 'must contain five reviewed topics.')
for (const topic of ['complex-rebooking-disruption', 'accommodation-dispute-alternative', 'transport-connection-safety', 'medical-medication-insurance', 'payment-document-tracing']) {
  assert(levelRows.filter((row) => row.authoring.topic === topic).length === 40, `${topic} must contain 40 records.`)
}
const banned = /\b(legal options|formal review|official terms|permits an exception in my case|travel companion.?s booking|before i finalize my travel plans|provide written details about|affects my itinerary|documented resolution)\b/iu
assert(levelRows.every((row) => !banned.test(row.term)), 'mechanical or legalistic language remains.')
const audit = auditDailyLevelQuality(records.map((row) => ({ ...row, difficulty: row.growthDifficultyLevel })), rubric)
const previous = audit.levels[11]
const level = audit.levels[12]
assert(level.violations.length === 0, `rubric violations: ${level.violations.join(', ')}`)
assert(audit.crossLevelDuplicateForms.length === 0, 'cross-level forms remain.')
assert(level.metrics.averageTokens > previous.metrics.averageTokens, 'C3 does not increase average language complexity.')
assert(level.metrics.maximumOpeningCluster <= 12 && level.metrics.maximumSkeletonCluster <= 8, 'template cluster exceeds rubric.')
assert(migration.entries.length === 200, 'migration must cover 200 old C3 rows.')
assert(migration.entries.every((row) => ['retired', 'equivalent'].includes(row.disposition)), 'migration disposition invalid.')
assert(migration.entries.filter((row) => row.disposition === 'equivalent').every((row) => row.evidenceTransferAllowed && row.targetDailyKnowledgeId), 'equivalent migration is incomplete.')
assert(migration.entries.filter((row) => row.disposition === 'retired').every((row) => !row.evidenceTransferAllowed && !row.targetDailyKnowledgeId), 'retired migration transfers evidence.')
const dispositions = Object.fromEntries(Object.entries(Object.groupBy(migration.entries, (row) => row.disposition)).map(([key, values]) => [key, values.length]))
const report = {
  schemaVersion: 1,
  documentType: 'daily-level-batch-quality-audit',
  auditVersion: '2.0.0-c3',
  releaseStatus: 'candidate-blocked-until-c4-c5',
  records: 200,
  combinedRecords: 2600,
  level: { id: level.id, labelZh: level.labelZh, metrics: level.metrics },
  topics: Object.fromEntries(['complex-rebooking-disruption', 'accommodation-dispute-alternative', 'transport-connection-safety', 'medical-medication-insurance', 'payment-document-tracing'].map((topic) => [topic, levelRows.filter((row) => row.authoring.topic === topic).length])),
  crossLevelDuplicateForms: 0,
  templateMaximums: { sharedOpeningFourTokens: level.metrics.maximumOpeningCluster, sharedSkeleton: level.metrics.maximumSkeletonCluster },
  identityMigration: { sourceRecords: migration.entries.length, dispositions, evidenceTransfers: migration.entries.filter((row) => row.evidenceTransferAllowed).length, newV2Identities: migration.newIdentities.length },
  formalIndexesRegenerated: false,
}
const output = 'content/curriculum/daily-level-c3-quality-audit.v2.json'
const serialized = `${JSON.stringify(report, null, 2)}\n`
if (writeMode) fs.writeFileSync(output, serialized)
else assert(fs.readFileSync(output, 'utf8') === serialized, `${output} stale`)
console.log(`C3 valid: 200 records; average ${level.metrics.averageTokens} tokens.`)
