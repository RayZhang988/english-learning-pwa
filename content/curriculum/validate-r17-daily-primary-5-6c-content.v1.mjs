import assert from 'node:assert/strict'
import fs from 'node:fs'
const index = JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json', 'utf8'))
const items = index.lessonFiles.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).lessons).flatMap((lesson) => lesson.learningUnits.filter((unit) => unit.domain === 'vocabulary').flatMap((unit) => unit.activity.items.map((item) => ({ ...item, unit }))))
const difficulty = (item) => item.growthDifficultyLevel ?? item.unit.difficultyLevel
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
const batch = items.filter((item) => item.id.startsWith('r17-daily-p5c-'))
assert.equal(batch.length, 56)
for (const level of [0, .5, 1, 1.5, 2, 2.5]) assert.equal(items.filter((item) => difficulty(item) === level).length, 200)
assert.equal(items.filter((item) => difficulty(item) === 3).length, 37)
for (const prefix of ['p5a', 'p5b']) assert.equal(items.filter((item) => item.id.startsWith(`r17-daily-${prefix}-`)).length, 56)
for (const item of batch) {
  assert.equal(item.growthDifficultyLevel, 2.5)
  assert.match(item.dailyKnowledgeId, /^daily-knowledge-v1:p5c:[0-9]{3}$/)
  assert.ok(item.term.trim() && item.meaningZh.trim() && item.exampleEn.trim() && item.exampleZh.trim())
  assert.ok(!/[；;/／]/u.test(item.meaningZh))
  assert.ok(normalize(item.exampleEn).includes(normalize(item.term)))
  assert.equal(items.filter((candidate) => normalize(candidate.term) === normalize(item.term)).length, 1)
  assert.ok(!('sceneKnowledgeId' in item) && !('sceneId' in item))
}
console.log('R17 daily primary-5 6C content quality verified')
