import assert from 'node:assert/strict'
import fs from 'node:fs'

const packageIndex = JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json', 'utf8'))
const lessons = packageIndex.lessonFiles.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).lessons)
const items = lessons.flatMap((lesson) => lesson.learningUnits
  .filter((unit) => unit.domain === 'vocabulary')
  .flatMap((unit) => unit.activity.items.map((item) => ({ ...item, unit }))))
const normalize = (value) => value.toLocaleLowerCase('en-US')
  .replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim()
const difficultyOf = (item) => item.growthDifficultyLevel ?? item.unit.difficultyLevel
const batch = items.filter((item) => item.id.startsWith('r17-daily-p1b-'))
const primaryOne = items.filter((item) => difficultyOf(item) === 0.5)
const kindergarten = items.filter((item) => difficultyOf(item) === 0)
const primaryOne2A = items.filter((item) => item.id.startsWith('r17-daily-p1a-'))
const allowedChineseSynonymMeaningWhitelist = new Map()

assert.equal(batch.length, 65, 'Primary 1 2B must contain exactly 65 daily knowledge points.')
assert.equal(primaryOne.length, 135, 'Primary 1 must contain 5 preserved points plus 2A and 2B.')
assert.equal(kindergarten.length, 200, 'Kindergarten must remain closed at 200 points.')
assert.equal(primaryOne2A.length, 65, '2A identities must remain present.')
for (let index = 1; index <= 65; index += 1) {
  const sequence = String(index).padStart(3, '0')
  const preserved = primaryOne2A.find((item) => item.id === `r17-daily-p1a-${sequence}`)
  assert.equal(preserved?.dailyKnowledgeId, `daily-knowledge-v1:p1a:${sequence}`, `2A identity ${sequence} drifted.`)
}
assert.equal(new Set(batch.map((item) => item.id)).size, 65)
assert.equal(new Set(batch.map((item) => normalize(item.term))).size, 65)
for (const item of batch) {
  assert.equal(item.growthDifficultyLevel, 0.5, `${item.id} is not primary-1 difficulty.`)
  assert.match(item.dailyKnowledgeId, /^daily-knowledge-v1:p1b:[0-9]{3}$/)
  assert.ok(item.term.trim() && item.meaningZh.trim() && item.partOfSpeech.trim())
  assert.ok(!/[；;/／]/u.test(item.meaningZh) || allowedChineseSynonymMeaningWhitelist.has(item.id), `${item.id} combines Chinese concepts.`)
  assert.ok(normalize(item.exampleEn).includes(normalize(item.term)), `${item.id} example does not contain its target.`)
  assert.ok(item.exampleZh.trim())
  assert.ok(!('sceneKnowledgeId' in item) && !('sceneId' in item), `${item.id} leaks a scene identity.`)
  assert.equal(items.filter((candidate) => normalize(candidate.term) === normalize(item.term)).length, 1, `${item.id} duplicates a daily knowledge point after article/number normalization.`)
}
console.log('R17 daily primary-1 2B content quality verified')
