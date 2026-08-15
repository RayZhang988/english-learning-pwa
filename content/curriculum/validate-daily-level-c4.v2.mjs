import fs from 'node:fs'
import { auditDailyLevelQuality } from './audit-daily-level-quality.v2.mjs'
const writeMode = process.argv.includes('--write')
const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'))
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
const assert = (condition, message) => { if (!condition) throw new Error(`C4: ${message}`) }
const paths = ['daily-level-content-batch-a.v2.json', 'daily-level-content-batch-b.v2.json', 'daily-level-content-c1.v2.json', 'daily-level-content-c2.v2.json', 'daily-level-content-c3.v2.json', 'daily-level-content-c4.v2.json']
const parts = paths.map((path) => read(`content/curriculum/${path}`))
const records = parts.flatMap((part) => part.records)
const levelRows = parts[5].records
const migration = read('content/curriculum/daily-level-identity-migration-c4.v1.json')
assert(levelRows.length === 200 && new Set(records.map((row) => normalize(row.term))).size === 2800, 'A through C4 must contain 2800 unique English forms.')
assert(parts[5].levelClaim === 'project-travel-english-reference-not-official-cet4', 'must not claim official CET4 equivalence.')
assert(new Set(levelRows.map((row) => row.authoring.topic)).size === 5, 'must contain five reviewed topics.')
const banned = /\b(legal options|formal review|official terms|permits an exception in my case|travel companion.?s booking|before i finalize my travel plans|provide written details about|documented resolution)\b/iu
assert(levelRows.every((row) => !banned.test(row.term)), 'mechanical or legalistic language remains.')
const audit = auditDailyLevelQuality(records.map((row) => ({ ...row, difficulty: row.growthDifficultyLevel })), read('content/curriculum/daily-level-rubric.v2.json'))
const previous = audit.levels[12], level = audit.levels[13]
assert(level.violations.length === 0, `rubric violations: ${level.violations.join(', ')}`)
assert(audit.crossLevelDuplicateForms.length === 0, 'cross-level forms remain.')
assert(level.metrics.averageTokens > previous.metrics.averageTokens, 'C4 does not increase average language complexity.')
assert(level.metrics.maximumOpeningCluster <= 12 && level.metrics.maximumSkeletonCluster <= 8, 'template cluster exceeds rubric.')
assert(migration.entries.length === 200, 'migration must cover 200 old C4 rows.')
assert(migration.entries.filter((row) => row.disposition === 'equivalent').every((row) => row.evidenceTransferAllowed && row.targetDailyKnowledgeId), 'equivalent migration incomplete.')
assert(migration.entries.filter((row) => row.disposition === 'retired').every((row) => !row.evidenceTransferAllowed && !row.targetDailyKnowledgeId), 'retired migration transfers evidence.')
const report = { schemaVersion: 1, documentType: 'daily-level-batch-quality-audit', auditVersion: '2.0.0-c4', releaseStatus: 'candidate-blocked-until-c5', records: 200, combinedRecords: 2800, level: { id: level.id, labelZh: level.labelZh, metrics: level.metrics }, crossLevelDuplicateForms: 0, templateMaximums: { sharedOpeningFourTokens: level.metrics.maximumOpeningCluster, sharedSkeleton: level.metrics.maximumSkeletonCluster }, identityMigration: { sourceRecords: migration.entries.length, retired: migration.entries.filter((row) => row.disposition === 'retired').length, equivalent: migration.entries.filter((row) => row.disposition === 'equivalent').length, evidenceTransfers: migration.entries.filter((row) => row.evidenceTransferAllowed).length, newV2Identities: migration.newIdentities.length }, formalIndexesRegenerated: false }
const output = 'content/curriculum/daily-level-c4-quality-audit.v2.json', serialized = `${JSON.stringify(report, null, 2)}\n`
if (writeMode) fs.writeFileSync(output, serialized); else assert(fs.readFileSync(output, 'utf8') === serialized, `${output} stale`)
console.log(`C4 valid: 200 records; average ${level.metrics.averageTokens} tokens.`)
