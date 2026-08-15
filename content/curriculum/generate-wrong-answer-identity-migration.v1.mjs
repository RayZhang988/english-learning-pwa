import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const curriculum = 'content/curriculum'
const sourcePath = `${curriculum}/wrong-answer-review-identity-source.v1.json`
const targetPath = `${curriculum}/review-content-index.v1.json`
export const outputPath = `${curriculum}/wrong-answer-review-identity-migration.v1.json`
const read = (root, relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const digest = (value) => `sha256-${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
const assert = (condition, message) => { if (!condition) throw new Error(`wrong-answer identity migration: ${message}`) }

function aliases(root, manifestPath) {
  const manifest = read(root, manifestPath)
  return manifest.aliases ?? Object.assign({}, ...manifest.shards.map((shard) => read(root, shard.path).aliases))
}

export function generateWrongAnswerIdentityMigration(root) {
  const source = read(root, sourcePath)
  const target = aliases(root, targetPath)
  const dailyMigration = read(root, `${curriculum}/daily-level-identity-migration.v2.json`)
  const candidates = [
    'daily-level-content-batch-a.v2.json', 'daily-level-content-batch-b.v2.json',
    'daily-level-content-c1.v2.json', 'daily-level-content-c2.v2.json', 'daily-level-content-c3.v2.json',
    'daily-level-content-c4.v2.json', 'daily-level-content-c5.v2.json',
  ].flatMap((file) => read(root, `${curriculum}/${file}`).records)
  const targetItemByKnowledge = new Map(candidates.map((record) => [record.dailyKnowledgeId, record.sourceItemId]))
  const migrationBySource = new Map(dailyMigration.entries.map((entry) => [entry.sourceItemId, entry]))
  const targetBySourceAndType = new Map(Object.entries(target).map(([alias, entry]) => [`${entry.source.sourceId}\0${entry.originalQuestionType}`, { alias, ...entry }]))
  const entries = Object.entries(source.aliases).sort(([left], [right]) => left.localeCompare(right)).map(([sourceAlias, old]) => {
    if (old.domain !== 'vocabulary' || old.source.kind !== 'daily-supply') {
      const current = target[sourceAlias]
      assert(current && current.reviewContentId === old.reviewContentId && current.originalQuestionType === old.originalQuestionType, `${sourceAlias} unchanged identity is missing`)
      return { sourceAlias, sourceReviewContentId: old.reviewContentId, originalQuestionType: old.originalQuestionType, disposition: 'unchanged', targetAlias: sourceAlias, targetReviewContentId: current.reviewContentId }
    }
    const migration = migrationBySource.get(old.source.sourceId)
    assert(migration, `${sourceAlias} has no daily identity migration fact`)
    if (!migration.evidenceTransferAllowed) return { sourceAlias, sourceReviewContentId: old.reviewContentId, originalQuestionType: old.originalQuestionType, disposition: 'retired' }
    const targetItem = targetItemByKnowledge.get(migration.targetDailyKnowledgeId)
    const current = targetBySourceAndType.get(`${targetItem}\0${old.originalQuestionType}`)
    assert(current, `${sourceAlias} has no same-question-type target`)
    return { sourceAlias, sourceReviewContentId: old.reviewContentId, originalQuestionType: old.originalQuestionType, disposition: 'exact-equivalent', targetAlias: current.alias, targetReviewContentId: current.reviewContentId }
  })
  assert(entries.length === Object.keys(source.aliases).length, 'source coverage is incomplete')
  assert(new Set(entries.map((entry) => entry.sourceAlias)).size === entries.length, 'source aliases are duplicated')
  assert(entries.filter((entry) => entry.disposition === 'exact-equivalent').length === 760 * 3, 'equivalent vocabulary aliases must cover 760 identities across three question types')
  assert(entries.filter((entry) => entry.disposition === 'retired').length === 2245 * 3, 'retired vocabulary aliases must cover 2245 identities across three question types')
  const result = {
    schemaVersion: 1,
    documentType: 'wrong-answer-review-identity-migration',
    mappingVersion: 'review-content-daily-v1-to-daily-v2',
    sourceIdentityVersion: source.identityVersion,
    targetIdentityVersion: read(root, targetPath).identityVersion,
    sourceDigest: digest(source.aliases),
    targetDigest: digest(target),
    rules: { equivalent: 'strict-english-chinese-answer-equivalence-and-same-question-type', retired: 'freeze-without-rewrite', unchanged: 'scene-and-non-daily-identities-retain-review-content-id' },
    totals: {
      sourceAliases: entries.length,
      exactEquivalent: entries.filter((entry) => entry.disposition === 'exact-equivalent').length,
      retired: entries.filter((entry) => entry.disposition === 'retired').length,
      unchanged: entries.filter((entry) => entry.disposition === 'unchanged').length,
    },
    entries,
  }
  fs.writeFileSync(path.join(root, outputPath), `${JSON.stringify(result)}\n`)
  return result
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = generateWrongAnswerIdentityMigration(path.resolve(process.cwd()))
  console.log(JSON.stringify(result.totals, null, 2))
}
