import assert from 'node:assert/strict'
import fs from 'node:fs'

const packageIndex = JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json', 'utf8'))
const lessons = packageIndex.lessonFiles.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).lessons)
const items = lessons.flatMap((lesson) => lesson.learningUnits
  .filter((unit) => unit.domain === 'vocabulary')
  .flatMap((unit) => unit.activity.items))
const batch = items.filter((item) => item.id.startsWith('r17-daily-k1a-'))
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()

assert.equal(batch.length, 75)
assert.equal(new Set(batch.map((item) => item.id)).size, 75)
assert.equal(new Set(batch.map((item) => `${normalize(item.term)}|${item.meaningZh.replace(/\s+/g, '')}`)).size, 75)
assert.equal(new Set(batch.map((item) => normalize(item.term))).size, 75)
for (const item of batch) {
  assert.equal(item.growthDifficultyLevel, 0, `${item.id} is not kindergarten difficulty.`)
  assert.match(item.dailyKnowledgeId, /^daily-knowledge-v1:k1a:[0-9]{3}$/)
  assert.ok(item.term.trim() && item.meaningZh.trim() && item.partOfSpeech.trim())
  assert.ok(normalize(item.exampleEn).includes(normalize(item.term)), `${item.id} example does not contain its target.`)
  assert.ok(item.exampleZh.trim())
  assert.ok(!('sceneKnowledgeId' in item) && !('sceneId' in item), `${item.id} leaks a scene identity.`)
}
for (const item of batch) {
  const key = `${normalize(item.term)}|${item.meaningZh.replace(/\s+/g, '')}`
  assert.equal(items.filter((candidate) => `${normalize(candidate.term)}|${candidate.meaningZh.replace(/\s+/g, '')}` === key).length, 1, `${item.id} duplicates an existing daily knowledge point.`)
}
console.log('R17 daily kindergarten 1A content quality verified')
