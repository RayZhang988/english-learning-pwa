import assert from 'node:assert/strict'
import fs from 'node:fs'

const packageIndex = JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json', 'utf8'))
const lessons = packageIndex.lessonFiles.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).lessons)
const items = lessons.flatMap((lesson) => lesson.learningUnits
  .filter((unit) => unit.domain === 'vocabulary')
  .flatMap((unit) => unit.activity.items))
const batch = items.filter((item) => item.id.startsWith('r17-daily-k1c-'))
const kindergartenBatches = items.filter((item) => /^r17-daily-k1[abc]-/.test(item.id))
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
const allowedChineseSynonymMeaningWhitelist = new Map()

assert.equal(batch.length, 50, 'Kindergarten 1C must contain exactly 50 daily knowledge points.')
assert.equal(kindergartenBatches.length, 200, 'All kindergarten batches must contain exactly 200 stable identities.')
assert.equal(new Set(kindergartenBatches.map((item) => item.id)).size, 200)
for (const item of batch) {
  assert.equal(item.growthDifficultyLevel, 0, `${item.id} is not kindergarten difficulty.`)
  assert.match(item.dailyKnowledgeId, /^daily-knowledge-v1:k1c:[0-9]{3}$/)
  assert.ok(item.term.trim() && item.meaningZh.trim() && item.partOfSpeech.trim())
  assert.ok(
    !/[；;/／]/u.test(item.meaningZh) || allowedChineseSynonymMeaningWhitelist.has(item.id),
    `${item.id} combines Chinese concepts without an explicit reviewed synonym whitelist.`,
  )
  assert.ok(normalize(item.exampleEn).includes(normalize(item.term)), `${item.id} example does not contain its target.`)
  assert.ok(item.exampleZh.trim())
  assert.ok(!('sceneKnowledgeId' in item) && !('sceneId' in item), `${item.id} leaks a scene identity.`)
  assert.equal(items.filter((candidate) => normalize(candidate.term) === normalize(item.term)).length, 1, `${item.id} reuses an existing daily term.`)
}
console.log('R17 daily kindergarten 1C content quality verified')
