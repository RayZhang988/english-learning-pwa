import assert from 'node:assert/strict'
import fs from 'node:fs'

const packageIndex = JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json', 'utf8'))
const lessons = packageIndex.lessonFiles.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).lessons)
const items = lessons.flatMap((lesson) => lesson.learningUnits.filter((unit) => unit.domain === 'vocabulary').flatMap((unit) => unit.activity.items.map((item) => ({ ...item, unit }))))
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
const difficultyOf = (item) => item.growthDifficultyLevel ?? item.unit.difficultyLevel
const batch = items.filter((item) => item.id.startsWith('r17-daily-p2a-'))
const priorPrimaryOne = items.filter((item) => /^r17-daily-p1[abc]-/.test(item.id))
const allowedChineseSynonymMeaningWhitelist = new Map()

assert.equal(batch.length, 62, 'Primary 2 3A must contain exactly 62 daily knowledge points.')
assert.equal(items.filter((item) => difficultyOf(item) === 0).length, 200, 'Kindergarten must remain closed at 200.')
assert.equal(items.filter((item) => difficultyOf(item) === .5).length, 200, 'Primary 1 must remain closed at 200.')
assert.equal(items.filter((item) => difficultyOf(item) === 1).length, 75, 'Primary 2 must contain 13 preserved points plus this 62-point batch.')
assert.equal(priorPrimaryOne.length, 195, 'All primary-1 batch identities must remain present.')
for (const prefix of ['p1a', 'p1b', 'p1c']) for (let index = 1; index <= 65; index += 1) {
  const sequence = String(index).padStart(3, '0')
  const preserved = priorPrimaryOne.find((item) => item.id === `r17-daily-${prefix}-${sequence}`)
  assert.equal(preserved?.dailyKnowledgeId, `daily-knowledge-v1:${prefix}:${sequence}`, `${prefix} identity ${sequence} drifted.`)
}
assert.equal(new Set(batch.map((item) => item.id)).size, 62)
for (const item of batch) {
  assert.equal(item.growthDifficultyLevel, 1, `${item.id} is not primary-2 difficulty.`)
  assert.match(item.dailyKnowledgeId, /^daily-knowledge-v1:p2a:[0-9]{3}$/)
  assert.ok(item.term.trim() && item.meaningZh.trim() && item.partOfSpeech.trim())
  assert.ok(!/[；;/／]/u.test(item.meaningZh) || allowedChineseSynonymMeaningWhitelist.has(item.id), `${item.id} combines Chinese concepts.`)
  assert.ok(normalize(item.exampleEn).includes(normalize(item.term)), `${item.id} example does not contain its target.`)
  assert.ok(item.exampleZh.trim())
  assert.ok(!('sceneKnowledgeId' in item) && !('sceneId' in item), `${item.id} leaks a scene identity.`)
  assert.equal(items.filter((candidate) => normalize(candidate.term) === normalize(item.term)).length, 1, `${item.id} duplicates a daily knowledge point after article/number normalization.`)
}
console.log('R17 daily primary-2 3A content quality verified')
