import assert from 'node:assert/strict'
import fs from 'node:fs'

const packageIndex = JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json', 'utf8'))
const items = packageIndex.lessonFiles.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).lessons)
  .flatMap((lesson) => lesson.learningUnits.filter((unit) => unit.domain === 'vocabulary').flatMap((unit) => unit.activity.items.map((item) => ({ ...item, unit }))))
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
const difficulty = (item) => item.growthDifficultyLevel ?? item.unit.difficultyLevel
const batch = items.filter((item) => item.id.startsWith('r17-daily-p3c-'))
const preserved4A = items.filter((item) => item.id.startsWith('r17-daily-p3a-'))
const preserved4B = items.filter((item) => item.id.startsWith('r17-daily-p3b-'))
assert.equal(batch.length, 62)
assert.equal(preserved4A.length, 62)
assert.equal(preserved4B.length, 62)
assert.equal(items.filter((item) => difficulty(item) === 0).length, 200)
assert.equal(items.filter((item) => difficulty(item) === .5).length, 200)
assert.equal(items.filter((item) => difficulty(item) === 1).length, 200)
assert.equal(items.filter((item) => difficulty(item) === 1.5).length, 200)
for (const prefix of ['p3a', 'p3b']) {
  for (let index = 1; index <= 62; index += 1) {
    const sequence = String(index).padStart(3, '0')
    assert.equal(items.find((item) => item.id === `r17-daily-${prefix}-${sequence}`)?.dailyKnowledgeId, `daily-knowledge-v1:${prefix}:${sequence}`)
  }
}
for (const item of batch) {
  assert.equal(item.growthDifficultyLevel, 1.5)
  assert.match(item.dailyKnowledgeId, /^daily-knowledge-v1:p3c:[0-9]{3}$/)
  assert.ok(item.term.trim() && item.meaningZh.trim() && item.exampleEn.trim() && item.exampleZh.trim())
  assert.ok(!/[；;/／]/u.test(item.meaningZh))
  assert.ok(normalize(item.exampleEn).includes(normalize(item.term)))
  assert.equal(items.filter((candidate) => normalize(candidate.term) === normalize(item.term)).length, 1)
  assert.ok(!('sceneKnowledgeId' in item) && !('sceneId' in item))
}
console.log('R17 daily primary-3 4C content quality verified')
