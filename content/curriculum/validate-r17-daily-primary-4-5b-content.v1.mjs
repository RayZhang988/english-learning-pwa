import assert from 'node:assert/strict'
import fs from 'node:fs'

const index = JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json', 'utf8'))
const items = index.lessonFiles.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).lessons).flatMap((lesson) => lesson.learningUnits.filter((unit) => unit.domain === 'vocabulary').flatMap((unit) => unit.activity.items.map((item) => ({ ...item, unit }))))
const difficulty = (item) => item.growthDifficultyLevel ?? item.unit.difficultyLevel
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
const batch = items.filter((item) => item.id.startsWith('r17-daily-p4b-'))
const preserved5A = items.filter((item) => item.id.startsWith('r17-daily-p4a-'))
assert.equal(batch.length, 55)
assert.equal(preserved5A.length, 55)
assert.equal(items.filter((item) => difficulty(item) === 0).length, 200)
assert.equal(items.filter((item) => difficulty(item) === .5).length, 200)
assert.equal(items.filter((item) => difficulty(item) === 1).length, 200)
assert.equal(items.filter((item) => difficulty(item) === 1.5).length, 200)
assert.equal(items.filter((item) => difficulty(item) === 2).length, 145)
for (const item of batch) {
  assert.equal(item.growthDifficultyLevel, 2)
  assert.match(item.dailyKnowledgeId, /^daily-knowledge-v1:p4b:[0-9]{3}$/)
  assert.ok(item.term.trim() && item.meaningZh.trim() && item.exampleEn.trim() && item.exampleZh.trim())
  assert.ok(!/[；;/／]/u.test(item.meaningZh))
  assert.ok(normalize(item.exampleEn).includes(normalize(item.term)))
  assert.equal(items.filter((candidate) => normalize(candidate.term) === normalize(item.term)).length, 1)
  assert.ok(!('sceneKnowledgeId' in item) && !('sceneId' in item))
}
console.log('R17 daily primary-4 5B content quality verified')
