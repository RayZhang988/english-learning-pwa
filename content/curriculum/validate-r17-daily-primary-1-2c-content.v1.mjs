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
const batch = items.filter((item) => item.id.startsWith('r17-daily-p1c-'))
const primaryOne = items.filter((item) => difficultyOf(item) === 0.5)
const kindergarten = items.filter((item) => difficultyOf(item) === 0)
const priorBatches = items.filter((item) => /^r17-daily-p1[ab]-/.test(item.id))
const expectedUntouched = new Map([[1, 13], [1.5, 14], [2, 35], [2.5, 32], [3, 37], [3.5, 10], [4, 4], [4.5, 4], [5, 9], [5.5, 0], [6, 0], [7, 0], [8, 0]])
const allowedChineseSynonymMeaningWhitelist = new Map()

assert.equal(batch.length, 65, 'Primary 1 2C must contain exactly 65 daily knowledge points.')
assert.equal(primaryOne.length, 200, 'Primary 1 must be closed at 200 knowledge points.')
assert.equal(kindergarten.length, 200, 'Kindergarten must remain closed at 200 knowledge points.')
assert.equal(priorBatches.length, 130, '2A and 2B identities must remain present.')
for (const prefix of ['p1a', 'p1b']) {
  for (let index = 1; index <= 65; index += 1) {
    const sequence = String(index).padStart(3, '0')
    const preserved = priorBatches.find((item) => item.id === `r17-daily-${prefix}-${sequence}`)
    assert.equal(preserved?.dailyKnowledgeId, `daily-knowledge-v1:${prefix}:${sequence}`, `${prefix} identity ${sequence} drifted.`)
  }
}
for (const [difficulty, count] of expectedUntouched) {
  assert.equal(items.filter((item) => difficultyOf(item) === difficulty).length, count, `Difficulty ${difficulty} changed outside primary-1.`)
}
assert.equal(new Set(batch.map((item) => item.id)).size, 65)
assert.equal(new Set(batch.map((item) => normalize(item.term))).size, 65)
for (const item of batch) {
  assert.equal(item.growthDifficultyLevel, 0.5, `${item.id} is not primary-1 difficulty.`)
  assert.match(item.dailyKnowledgeId, /^daily-knowledge-v1:p1c:[0-9]{3}$/)
  assert.ok(item.term.trim() && item.meaningZh.trim() && item.partOfSpeech.trim())
  assert.ok(!/[；;/／]/u.test(item.meaningZh) || allowedChineseSynonymMeaningWhitelist.has(item.id), `${item.id} combines Chinese concepts.`)
  assert.ok(normalize(item.exampleEn).includes(normalize(item.term)), `${item.id} example does not contain its target.`)
  assert.ok(item.exampleZh.trim())
  assert.ok(!('sceneKnowledgeId' in item) && !('sceneId' in item), `${item.id} leaks a scene identity.`)
  assert.equal(items.filter((candidate) => normalize(candidate.term) === normalize(item.term)).length, 1, `${item.id} duplicates a daily knowledge point after article/number normalization.`)
}
console.log('R17 daily primary-1 2C content quality verified')
