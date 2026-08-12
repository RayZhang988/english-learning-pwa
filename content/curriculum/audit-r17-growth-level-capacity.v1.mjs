import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const outputPath = 'content/curriculum/r17-growth-level-capacity-audit.v1.json'
const supplyPath = 'content/curriculum/training-supply-index.v1.json'
const writeMode = process.argv.includes('--write')
const domains = ['vocabulary', 'listening', 'speaking']
const requiredQuestionTypes = {
  vocabulary: ['term-to-meaning-choice', 'meaning-to-term-choice', 'example-gap-choice'],
  listening: ['word-discrimination', 'short-sentence-choice', 'keyword-dictation', 'full-transcript-detail-choice', 'scene-audio-single-choice'],
  speaking: ['activity-prompt', 'scene-fixed-response'],
}

/**
 * R17 maps the existing internal 0–5.5 difficulty scale to the 15 user-facing
 * growth labels. It is intentionally monotonic, versioned, and does not claim
 * that the current travel course reaches advanced academic English.
 */
const levels = [
  ['kindergarten', '幼儿园', 0, 0.5], ['primary-1', '一年级', 0.5, 1],
  ['primary-2', '二年级', 1, 1.5], ['primary-3', '三年级', 1.5, 2],
  ['primary-4', '四年级', 2, 2.5], ['primary-5', '五年级', 2.5, 3],
  ['primary-6', '六年级', 3, 3.5], ['junior-1', '初一', 3.5, 4],
  ['junior-2', '初二', 4, 4.5], ['junior-3', '初三', 4.5, 5],
  ['senior-1', '高一', 5, 5.5], ['senior-2', '高二', 5.5, 6],
  ['senior-3', '高三', 6, 7], ['cet-4-reference', '大学四级', 7, 8],
  ['cet-6-reference', '大学六级', 8, null],
].map(([id, labelZh, minimumDifficulty, maximumDifficultyExclusive], ordinal) => ({
  ordinal, id, labelZh, minimumDifficulty, maximumDifficultyExclusive,
}))

function read(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
}
function fail(message) { throw new Error(`R17 growth capacity audit: ${message}`) }
function levelFor(difficulty) {
  const level = levels.find((candidate) => difficulty >= candidate.minimumDifficulty && (candidate.maximumDifficultyExclusive === null || difficulty < candidate.maximumDifficultyExclusive))
  if (!level) fail(`difficulty ${difficulty} cannot map to a growth level`)
  return level
}
function countBy(values, key) {
  return Object.fromEntries([...new Set(values.map(key))].sort().map((value) => [value, values.filter((entry) => key(entry) === value).length]))
}

const supply = read(supplyPath)
if (supply.schemaVersion !== 1 || !Array.isArray(supply.candidates)) fail('published supply index is invalid')
const candidates = supply.candidates.filter((candidate) => {
  if (!domains.includes(candidate.domain) || candidate.targetModuleId !== candidate.domain) return false
  if (!candidate.allowedModes?.includes('learn') || !candidate.itemId || !candidate.source?.sourceType || !candidate.source?.sourceId || !candidate.source?.variantId) return false
  return true
})
if (candidates.length !== supply.candidates.length) fail('supply index includes an ineligible candidate')
if (new Set(candidates.map((candidate) => candidate.itemId)).size !== candidates.length) fail('published candidate item identities are not unique')

const targetLevels = levels.slice(1)
const domainsAudit = Object.fromEntries(domains.map((domain) => {
  const domainCandidates = candidates.filter((candidate) => candidate.domain === domain)
  return [domain, {
    uniqueScorableItemCount: domainCandidates.length,
    uniqueSourcePromptCount: new Set(domainCandidates.map((candidate) => `${candidate.source.sourceType}:${candidate.source.sourceId}`)).size,
    questionTypes: countBy(domainCandidates, (candidate) => candidate.source.variantId),
  levels: levels.map((level) => {
      const atLevel = domainCandidates.filter((candidate) => levelFor(candidate.difficultyLevel).ordinal === level.ordinal)
      const questionTypes = countBy(atLevel, (candidate) => candidate.source.variantId)
      return {
        ...level,
        isUpgradeTarget: level.ordinal > 0,
        uniqueScorableItemCount: atLevel.length,
        uniqueSourcePromptCount: new Set(atLevel.map((candidate) => `${candidate.source.sourceType}:${candidate.source.sourceId}`)).size,
        questionTypes,
        missingQuestionTypes: requiredQuestionTypes[domain].filter((type) => questionTypes[type] === undefined),
        minimumUpgradeTestCapacity: level.ordinal === 0 ? 0 : 10,
        recommendedShortTermDedupCapacity: 20,
        missingForUpgradeTest: level.ordinal === 0 ? 0 : Math.max(0, 10 - new Set(atLevel.map((candidate) => `${candidate.source.sourceType}:${candidate.source.sourceId}`)).size),
        missingForRecommendedDedup: Math.max(0, 20 - new Set(atLevel.map((candidate) => `${candidate.source.sourceType}:${candidate.source.sourceId}`)).size),
        status: level.ordinal === 0 ? 'starting-level-not-an-upgrade-target' : new Set(atLevel.map((candidate) => `${candidate.source.sourceType}:${candidate.source.sourceId}`)).size >= 20 ? 'recommended-capacity-met' : new Set(atLevel.map((candidate) => `${candidate.source.sourceType}:${candidate.source.sourceId}`)).size >= 10 ? 'minimum-only' : 'blocked',
      }
    }),
  }]
}))

const audit = {
  schemaVersion: 1,
  documentType: 'r17-growth-level-capacity-audit',
  auditVersion: '1.0.0',
  source: { supplyPath, supplyVersion: supply.supplyVersion, totalPublishedCandidates: candidates.length },
  scope: {
    included: 'Only published continuous daily/R6 learn-mode candidates with a stable itemId and scoreable source identity.',
    excluded: [
      'R13 dedicated scene training bank (612 questions)',
      'R13-D wrong-answer review records',
      'trainingTest=30 data and test-only snapshots',
      'unscorable practice, drafts and duplicated item identities',
    ],
    constraintsChecked: ['travel-English course scope', 'listening R9 bilingual-choice source types retained', 'listening R10 keyword-dictation source type retained', 'speaking prompts retain original media/recognition contract'],
  },
  mapping: { mappingVersion: 'r17-growth-difficulty-to-level-v1', monotonic: true, levels },
  capacityPolicy: { upgradeTestItems: 10, recommendedShortTermDedupItems: 20, identityRule: 'Upgrade capacity is counted by sourceType+sourceId, not merely candidate itemId. Vocabulary variants of the same source word are distinct exercises but cannot inflate a ten-question upgrade test.', rationale: 'Ten unique source prompts are required to run the upgrade test; twenty avoids immediately reusing half the same test pool on a near-term retry.', requiredQuestionTypes },
  domains: domainsAudit,
  conclusion: {
    readyForAllFifteenLevels: false,
    blocker: 'The released travel course only covers internal difficulty 0.5–5.5 (roughly pre-A1/A1 to B1). It cannot honestly supply senior-2, senior-3, CET-4 or CET-6 upgrade tests, and vocabulary has no current 5.5 candidate for senior-2.',
  },
}

const serialized = `${JSON.stringify(audit, null, 2)}\n`
const absoluteOutput = path.join(root, outputPath)
if (writeMode) fs.writeFileSync(absoluteOutput, serialized)
else if (fs.readFileSync(absoluteOutput, 'utf8') !== serialized) fail(`${outputPath} is stale; run node ${fileURLToPath(import.meta.url)} --write`)

console.log(`R17 audit verified: ${candidates.length} published candidates across ${domains.join(', ')}`)
