import assert from 'node:assert/strict'
import fs from 'node:fs'

const packageIndex = JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json', 'utf8'))
const items = packageIndex.lessonFiles.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).lessons)
  .flatMap((lesson) => lesson.learningUnits.filter((unit) => unit.domain === 'vocabulary')
    .flatMap((unit) => unit.activity.items.map((item) => ({ ...item, unit }))))
const difficulty = (item) => item.growthDifficultyLevel ?? item.unit.difficultyLevel
const additions = items.filter((item) => item.id.startsWith('r17-daily-j3-'))
assert.equal(additions.length, 197)
// Four released source items map to three canonical junior-3 knowledge points;
// 197 new independent points therefore produce 201 source rows and 200 canonical rows.
assert.equal(items.filter((item) => difficulty(item) === 4.5).length, 201)
for (const item of additions) {
  assert.equal(item.growthDifficultyLevel, 4.5)
  assert.match(item.dailyKnowledgeId, /^daily-knowledge-v1:j3:[0-9]{3}$/)
  assert.ok(item.term && item.meaningZh && item.exampleEn && item.exampleZh)
  assert.ok(!/[；;/／]/u.test(item.meaningZh))
}
console.log('R17 junior-3 10 verified')
