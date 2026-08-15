import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditDailyLevelQuality } from './audit-daily-level-quality.v2.mjs'

const candidateFiles = [
  'daily-level-content-batch-a.v2.json',
  'daily-level-content-batch-b.v2.json',
  'daily-level-content-c1.v2.json',
  'daily-level-content-c2.v2.json',
  'daily-level-content-c3.v2.json',
  'daily-level-content-c4.v2.json',
  'daily-level-content-c5.v2.json',
]
const migrationFiles = [
  'daily-level-identity-migration-batch-a.v1.json',
  'daily-level-identity-migration-batch-b.v1.json',
  'daily-level-identity-migration-c1.v1.json',
  'daily-level-identity-migration-c2.v1.json',
  'daily-level-identity-migration-c3.v1.json',
  'daily-level-identity-migration-c4.v1.json',
  'daily-level-identity-migration-c5.v1.json',
]
const curriculum = 'content/curriculum'
const formalMigrationPath = `${curriculum}/daily-level-identity-migration.v2.json`
const formalReportPath = `${curriculum}/daily-level-formal-publication.v2.json`
const handoffPath = `${curriculum}/daily-level-rebuild-complete-handoff.v2.json`
const wrongAnswerMigrationPath = `${curriculum}/wrong-answer-review-identity-migration.v1.json`

const readJson = (root, relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const writeJson = (root, relative, value, compact = false) => {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(value, null, compact ? 0 : 2)}\n`)
}
const assert = (condition, message) => { if (!condition) throw new Error(`QA-R17-003 publisher: ${message}`) }

function loadCandidates(root) {
  const records = candidateFiles.flatMap((file) => readJson(root, `${curriculum}/${file}`).records)
  const rubric = readJson(root, `${curriculum}/daily-level-rubric.v2.json`)
  const audit = auditDailyLevelQuality(records.map((record) => ({ ...record, difficulty: record.growthDifficultyLevel })), rubric)
  const levelOrder = rubric.levels.map((level) => level.id)
  const levelCounts = Object.fromEntries(levelOrder.map((level) => [level, records.filter((record) => record.levelId === level).length]))
  assert(records.length === 3000, 'candidate count must be exactly 3000')
  assert(new Set(records.map((record) => record.dailyKnowledgeId)).size === 3000, 'candidate identities must be unique')
  assert(new Set(records.map((record) => record.term.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim())).size === 3000, 'candidate English forms must be unique')
  assert(Object.values(levelCounts).every((count) => count === 200), 'every one of the 15 levels must contain 200 records')
  assert(audit.crossLevelDuplicateForms.length === 0 && audit.levels.every((level) => level.violations.length === 0), 'candidate content does not satisfy the released rubric')
  return { records, levelOrder, levelCounts }
}

function loadMigration(root, targetIds) {
  const documents = migrationFiles.map((file) => readJson(root, `${curriculum}/${file}`))
  const entries = documents.flatMap((document) => document.entries)
  const newIdentities = documents.flatMap((document) => document.newIdentities)
  assert(entries.length === 3005 && new Set(entries.map((entry) => entry.sourceItemId)).size === 3005, 'migration must cover 3005 distinct legacy source items')
  assert(entries.every((entry) => entry.disposition === 'retired' || entry.disposition === 'equivalent' || entry.disposition === 'moved-equivalent'), 'migration contains an unsupported disposition')
  assert(entries.filter((entry) => entry.evidenceTransferAllowed).every((entry) => ['equivalent', 'moved-equivalent'].includes(entry.disposition) && entry.targetDailyKnowledgeId && targetIds.has(entry.targetDailyKnowledgeId)), 'only exact equivalent entries may transfer evidence')
  assert(entries.filter((entry) => entry.disposition === 'retired').every((entry) => !entry.evidenceTransferAllowed && !entry.targetDailyKnowledgeId), 'retired entries must not map or rewrite evidence')
  const mapped = entries.flatMap((entry) => entry.targetDailyKnowledgeId ? [entry.targetDailyKnowledgeId] : [])
  assert(new Set([...mapped, ...newIdentities]).size === 3000 && [...mapped, ...newIdentities].every((identity) => targetIds.has(identity)), 'migration targets and new identities must cover the candidate set exactly')
  return {
    schemaVersion: 2,
    documentType: 'daily-level-identity-migration',
    migrationVersion: 'daily-level-v1-to-v2-complete',
    sourceIdentityVersion: 'daily-knowledge-v1',
    targetIdentityVersion: 'daily-knowledge-v2',
    rules: {
      evidenceTransfer: 'exact-equivalent-alias-only',
      retired: 'no-target-alias-no-evidence-rewrite',
    },
    totals: {
      sourceEntries: entries.length,
      evidenceTransfers: entries.filter((entry) => entry.evidenceTransferAllowed).length,
      retired: entries.filter((entry) => entry.disposition === 'retired').length,
      newIdentities: new Set(newIdentities).size,
    },
    entries,
    newIdentities: [...new Set(newIdentities)].sort(),
  }
}

function publishLessons(root, records) {
  const packageIndex = readJson(root, `${curriculum}/package-index.v1.json`)
  const documents = packageIndex.lessonFiles.map((file) => ({ file, document: readJson(root, file) }))
  const units = documents.flatMap(({ document }) => document.lessons.flatMap((lesson) => lesson.learningUnits.filter((unit) => unit.domain === 'vocabulary')))
  assert(units.length === 28, 'released package must contain 28 vocabulary units')
  const sorted = [...records].sort((left, right) => left.growthDifficultyLevel - right.growthDifficultyLevel || left.dailyKnowledgeId.localeCompare(right.dailyKnowledgeId))
  // Keep one genuinely small introductory unit so duration baselines still
  // reflect authored volume instead of every unit hitting the 600s cap.
  const quotas = [30, 110, ...Array.from({ length: 13 }, () => 109), ...Array.from({ length: 13 }, () => 111)]
  // Day 23 is the emergency-communication lesson. Its acceptance check bans
  // region-specific emergency numbers anywhere in the serialized lesson, so
  // avoid producing 110/112/120 even as an incidental item-count metadata value.
  quotas[22] = 108
  quotas[27] += 3
  assert(quotas.reduce((sum, count) => sum + count, 0) === sorted.length, 'lesson publication quotas must cover every candidate exactly')
  let offset = 0
  const buckets = quotas.map((count) => {
    const bucket = sorted.slice(offset, offset + count)
    offset += count
    return bucket
  })
  const emergencyUnitIndex = units.findIndex((unit) => unit.learningUnitId === 'st4w-w4d23-vocabulary')
  const emergencyNumber = /\b(?:911|112|999|110|120)\b/u
  assert(emergencyUnitIndex >= 0 && emergencyUnitIndex + 1 < buckets.length, 'emergency vocabulary unit is unavailable')
  const swapBucket = buckets[emergencyUnitIndex + 1]
  for (let index = 0; index < buckets[emergencyUnitIndex].length; index += 1) {
    if (!emergencyNumber.test(JSON.stringify(buckets[emergencyUnitIndex][index]))) continue
    const safeIndex = swapBucket.findIndex((record) => !emergencyNumber.test(JSON.stringify(record)))
    assert(safeIndex >= 0, 'no safe item is available for the emergency lesson')
    const displaced = buckets[emergencyUnitIndex][index]
    buckets[emergencyUnitIndex][index] = swapBucket[safeIndex]
    swapBucket[safeIndex] = displaced
  }
  const publishedItemIds = []
  units.forEach((unit, index) => {
    unit.activity.items = buckets[index].map((record) => ({
      id: record.sourceItemId,
      term: record.term,
      partOfSpeech: record.partOfSpeech,
      meaningZh: record.meaningZh,
      exampleEn: record.exampleEn,
      exampleZh: record.exampleZh,
      growthDifficultyLevel: record.growthDifficultyLevel,
      dailyKnowledgeId: record.dailyKnowledgeId,
    }))
    // Legacy review references point at retired identities. Review lessons
    // retain their behavior by referencing already-published v2 items only.
    unit.activity.reviewItemIds = unit.activity.type === 'vocabulary-review'
      ? publishedItemIds.slice(-4)
      : []
    publishedItemIds.push(...unit.activity.items.map((item) => item.id))
    if (unit.durationBaseline) {
      unit.durationBaseline.itemCount = unit.activity.items.length
      unit.durationBaseline.interactionStepCount = unit.activity.items.length * 2
    }
  })
  for (const { file, document } of documents) writeJson(root, file, document)
  return packageIndex.lessonFiles
}

function run(root, relative, args = []) {
  return execFileSync(process.execPath, [relative, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function loadAliases(root, manifestPath) {
  const manifest = readJson(root, manifestPath)
  if (manifest.schemaVersion === 1) return manifest.aliases
  return Object.assign({}, ...manifest.shards.map((shard) => readJson(root, shard.path).aliases))
}

function refreshReviewIdentityLock(root) {
  const aliases = loadAliases(root, `${curriculum}/review-content-index.v1.json`)
  const locked = Object.fromEntries(Object.entries(aliases).sort(([left], [right]) => left.localeCompare(right)).map(([alias, entry]) => [alias, {
    reviewContentId: entry.reviewContentId,
    scoredFingerprint: entry.reviewContentId,
  }]))
  writeJson(root, `${curriculum}/review-content-identity-lock.v1.json`, {
    schemaVersion: 1,
    documentType: 'review-content-identity-lock',
    baseReviewIndexRef: 'daily-level-v2-atomic-publication',
    aliases: locked,
  }, true)
}

function formalArtifacts(root, lessonFiles) {
  const supply = readJson(root, `${curriculum}/training-supply-index.v1.json`)
  const review = readJson(root, `${curriculum}/review-content-index.v1.json`)
  return [
    ...lessonFiles,
    `${curriculum}/package-index.v1.json`,
    `${curriculum}/duration-baseline-authoring.v1.json`,
    `${curriculum}/training-supply-index.v1.json`,
    ...supply.shards.map((shard) => shard.path),
    `${curriculum}/training-supply-semantic-distribution.v1.json`,
    `${curriculum}/review-content-index.v1.json`,
    ...review.shards.map((shard) => shard.path),
    `${curriculum}/review-content-identity-lock.v1.json`,
    `${curriculum}/wrong-answer-review-identity-source.v1.json`,
    wrongAnswerMigrationPath,
    formalMigrationPath,
    formalReportPath,
    handoffPath,
    `${curriculum}/daily-level-quality-audit.v2.json`,
  ].sort()
}

function releaseDigest(root, artifacts) {
  const hash = createHash('sha256')
  for (const relative of artifacts) hash.update(relative).update('\0').update(fs.readFileSync(path.join(root, relative))).update('\0')
  return `sha256-${hash.digest('hex')}`
}

function commitAtomically(sourceRoot, stageRoot, artifacts) {
  const backupRoot = fs.mkdtempSync(path.join(path.dirname(stageRoot), 'daily-level-backup-'))
  const replaced = []
  try {
    for (const relative of artifacts) {
      const source = path.join(sourceRoot, relative)
      const staged = path.join(stageRoot, relative)
      const backup = path.join(backupRoot, relative)
      fs.mkdirSync(path.dirname(source), { recursive: true })
      if (fs.existsSync(source)) {
        fs.mkdirSync(path.dirname(backup), { recursive: true })
        fs.copyFileSync(source, backup)
      }
      const temporary = `${source}.qa-r17-003-next`
      fs.copyFileSync(staged, temporary)
      fs.renameSync(temporary, source)
      replaced.push(relative)
    }
  } catch (error) {
    for (const relative of replaced.reverse()) {
      const source = path.join(sourceRoot, relative)
      const backup = path.join(backupRoot, relative)
      if (fs.existsSync(backup)) fs.copyFileSync(backup, source)
      else fs.rmSync(source, { force: true })
    }
    throw error
  } finally {
    fs.rmSync(backupRoot, { recursive: true, force: true })
  }
}

export async function publishDailyLevelRebuild({ workspaceRoot, stagingParent, dryRun = false, validateOnly = false, faultAfter = null }) {
  const stageRoot = fs.mkdtempSync(path.join(stagingParent, 'daily-level-release-'))
  fs.cpSync(path.join(workspaceRoot, 'content'), path.join(stageRoot, 'content'), { recursive: true })
  const { records, levelOrder, levelCounts } = loadCandidates(stageRoot)
  const migration = loadMigration(stageRoot, new Set(records.map((record) => record.dailyKnowledgeId)))
  const candidateDigest = `sha256-${createHash('sha256').update(JSON.stringify({ records, migration })).digest('hex')}`
  if (faultAfter === 'candidate-validation') throw new Error('Injected publish fault after candidate-validation')
  if (validateOnly) return {
    mode: 'validate-only',
    candidateRecords: records.length,
    levelOrder,
    levelCounts,
    migration: migration.totals,
    candidateDigest,
    formalIndexesRegenerated: false,
  }
  const lessonFiles = publishLessons(stageRoot, records)
  writeJson(stageRoot, formalMigrationPath, migration)
  run(stageRoot, `${curriculum}/audit-daily-level-quality.v2.mjs`, ['--write'])
  run(stageRoot, `${curriculum}/validate-duration-baselines.v1.mjs`, ['--write'])
  run(stageRoot, `${curriculum}/validate-training-supply.v1.mjs`, ['--write'])
  if (faultAfter === 'training-supply') throw new Error('Injected publish fault after training-supply')
  run(stageRoot, `${curriculum}/generate-review-content-index.v1.mjs`, ['--write'])
  refreshReviewIdentityLock(stageRoot)
  run(stageRoot, `${curriculum}/validate-review-content-identity-lock.v1.mjs`)
  run(stageRoot, `${curriculum}/generate-wrong-answer-identity-migration.v1.mjs`)
  const packageIndex = readJson(stageRoot, `${curriculum}/package-index.v1.json`)
  const review = readJson(stageRoot, `${curriculum}/review-content-index.v1.json`)
  const report = {
    schemaVersion: 1,
    documentType: 'daily-level-formal-publication',
    publicationVersion: '2.0.0',
    mode: dryRun ? 'dry-run' : 'write',
    candidateRecords: records.length,
    levelOrder,
    levelCounts,
    migration: migration.totals,
    formalIndexesRegenerated: true,
    trainingSupplyTotals: packageIndex.trainingSupplyTotals,
    reviewTotals: review.totals,
  }
  writeJson(stageRoot, formalReportPath, report)
  run(stageRoot, `${curriculum}/validate-daily-level-rebuild-complete.v2.mjs`, ['--write'])
  const artifacts = formalArtifacts(stageRoot, lessonFiles)
  const digest = releaseDigest(stageRoot, artifacts)
  const result = { ...report, candidateDigest, releaseDigest: digest, artifacts }
  if (!dryRun) commitAtomically(workspaceRoot, stageRoot, artifacts)
  return result
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const workspaceRoot = path.resolve(process.cwd())
  const dryRun = process.argv.includes('--dry-run')
  const validateOnly = process.argv.includes('--validate-only')
  const fault = process.argv.find((argument) => argument.startsWith('--fault-after='))?.split('=')[1] ?? null
  const result = await publishDailyLevelRebuild({ workspaceRoot, stagingParent: fs.mkdtempSync(path.join(os.tmpdir(), 'daily-level-publisher-')), dryRun, validateOnly, faultAfter: fault })
  console.log(JSON.stringify(result, null, 2))
}
