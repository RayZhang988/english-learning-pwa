import fs from 'node:fs'

const writeMode = process.argv.includes('--write')
const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'))
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
const normalizeZh = (value) => value.trim().replace(/\s+/g, '')
const tokens = (value) => normalize(value).split(' ').filter(Boolean)
function fingerprint(value) { let hash = 0x811c9dc5; for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 0x01000193) } return (hash >>> 0).toString(16).padStart(8, '0') }
function released() {
  const index = read('content/curriculum/package-index.v1.json')
  return index.lessonFiles.flatMap((file) => read(file).lessons).flatMap((lesson) => lesson.learningUnits.filter((unit) => unit.domain === 'vocabulary').flatMap((unit) => unit.activity.items.map((item) => ({ ...item, difficulty: item.growthDifficultyLevel ?? unit.difficultyLevel }))))
}

const groups = {
  ...read('content/curriculum/daily-level-c4-three-topics.source.v2.json'),
  ...read('content/curriculum/daily-level-c4-two-topics.source.v2.json'),
}
const expectedTopics = ['cross-border-document-continuity', 'accommodation-transport-solution-comparison', 'medical-insurance-care-continuity', 'travel-service-exception-appeal', 'complex-payment-resolution']
if (Object.keys(groups).sort().join('|') !== [...expectedTopics].sort().join('|')) throw new Error('C4 topic set mismatch.')
if (Object.values(groups).some((rows) => rows.length !== 40)) throw new Error('Every C4 topic must contain 40 reviewed rows.')

const earlierFiles = ['daily-level-content-batch-a.v2.json', 'daily-level-content-batch-b.v2.json', 'daily-level-content-c1.v2.json', 'daily-level-content-c2.v2.json', 'daily-level-content-c3.v2.json']
const earlier = earlierFiles.flatMap((file) => read(`content/curriculum/${file}`).records)
const rows = expectedTopics.flatMap((topic) => groups[topic].map((row) => ({ ...row, topic })))
if (rows.length !== 200) throw new Error(`C4 expected 200 rows, got ${rows.length}`)
if (rows.some((row) => tokens(row.term).length > 16)) throw new Error(`C4 over-token: ${rows.find((row) => tokens(row.term).length > 16).term}`)
if (new Set([...earlier, ...rows].map((row) => normalize(row.term))).size !== 2800) throw new Error('C4 overlaps earlier levels or itself.')
const records = rows.map((row, index) => {
  const form = normalize(row.term)
  return {
    sourceItemId: `qa-r17-003-c4:${String(index + 1).padStart(3, '0')}`,
    dailyKnowledgeId: `daily-knowledge-v2:phrase:${fingerprint(`${form}|${normalizeZh(row.meaningZh)}`)}`,
    levelId: 'cet-4-reference', labelZh: '大学四级', growthDifficultyLevel: 7,
    term: row.term, meaningZh: row.meaningZh, partOfSpeech: 'advanced-functional-utterance', exampleEn: row.term, exampleZh: row.meaningZh,
    authoring: { lexicalFrequencyBand: 'advanced', abstractionBand: 'abstract-risk-or-policy', surfaceType: 'advanced-functional-utterance', grammarFeatures: ['constraints-exceptions-evidence-and-resolution'], travelUse: 'advanced-practical-travel-resolution', topic: row.topic, contentReviewStatus: 'candidate-reviewed', levelClaim: 'project-travel-english-reference-not-official-cet4' },
  }
})
const old = released().filter((row) => row.difficulty === 7)
const byContent = new Map(records.map((row) => [`${normalize(row.term)}|${normalizeZh(row.meaningZh)}`, row]))
const entries = old.map((source) => {
  const target = byContent.get(`${normalize(source.term)}|${normalizeZh(source.meaningZh)}`)
  return target ? { sourceDailyKnowledgeId: source.dailyKnowledgeId ?? `legacy-daily-source-v1:${source.id}`, sourceItemId: source.id, disposition: 'equivalent', targetDailyKnowledgeId: target.dailyKnowledgeId, evidenceTransferAllowed: true } : { sourceDailyKnowledgeId: source.dailyKnowledgeId ?? `legacy-daily-source-v1:${source.id}`, sourceItemId: source.id, disposition: 'retired', evidenceTransferAllowed: false }
})
const mapped = new Set(entries.flatMap((entry) => entry.targetDailyKnowledgeId ? [entry.targetDailyKnowledgeId] : []))
const content = { schemaVersion: 1, documentType: 'daily-level-content-batch', contentVersion: '2.0.0-c4', identityVersion: 'daily-knowledge-v2', releaseStatus: 'candidate-not-deployable-until-c5', levelClaim: 'project-travel-english-reference-not-official-cet4', levels: [{ id: 'cet-4-reference', labelZh: '大学四级', recordCount: 200 }], records }
const migration = { schemaVersion: 1, documentType: 'daily-level-identity-migration', migrationVersion: 'daily-level-v1-to-v2-c4', releaseStatus: 'candidate', sourceIdentityVersion: 'daily-knowledge-v1', targetIdentityVersion: 'daily-knowledge-v2', sourceRecordCount: old.length, canonicalTargetCount: 200, entries, newIdentities: records.filter((row) => !mapped.has(row.dailyKnowledgeId)).map((row) => row.dailyKnowledgeId) }
for (const [path, value] of [['content/curriculum/daily-level-content-c4.v2.json', content], ['content/curriculum/daily-level-identity-migration-c4.v1.json', migration]]) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  if (writeMode) fs.writeFileSync(path, serialized)
  else if (fs.readFileSync(path, 'utf8') !== serialized) throw new Error(`${path} stale`)
}
console.log(`C4 authored: ${records.length}; retired ${entries.filter((row) => row.disposition === 'retired').length}.`)
