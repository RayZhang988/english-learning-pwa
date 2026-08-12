import assert from 'node:assert/strict'
import fs from 'node:fs'

const packageIndex = JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json', 'utf8'))
const lessons = packageIndex.lessonFiles.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).lessons)
const items = lessons.flatMap((lesson) => lesson.learningUnits.filter((unit) => unit.domain === 'vocabulary').flatMap((unit) => unit.activity.items.map((item) => ({ ...item, unit }))))
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/\b(a|an|the|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
const difficultyOf = (item) => item.growthDifficultyLevel ?? item.unit.difficultyLevel
const batch = items.filter((item) => item.id.startsWith('r17-daily-p2b-'))
const primary2A = items.filter((item) => item.id.startsWith('r17-daily-p2a-'))
const allowedChineseSynonymMeaningWhitelist = new Map()
assert.equal(batch.length, 62, 'Primary 2 3B must contain exactly 62 daily knowledge points.')
assert.equal(items.filter((item) => difficultyOf(item) === 0).length, 200)
assert.equal(items.filter((item) => difficultyOf(item) === .5).length, 200)
assert.equal(items.filter((item) => difficultyOf(item) === 1).length, 137)
assert.equal(primary2A.length, 62, '3A identities must remain present.')
for (let index = 1; index <= 62; index += 1) { const sequence = String(index).padStart(3, '0'); const preserved = primary2A.find((item) => item.id === `r17-daily-p2a-${sequence}`); assert.equal(preserved?.dailyKnowledgeId, `daily-knowledge-v1:p2a:${sequence}`, `3A identity ${sequence} drifted.`) }
for (const item of batch) {
  assert.equal(item.growthDifficultyLevel, 1)
  assert.match(item.dailyKnowledgeId, /^daily-knowledge-v1:p2b:[0-9]{3}$/)
  assert.ok(item.term.trim() && item.meaningZh.trim() && item.partOfSpeech.trim())
  assert.ok(!/[；;/／]/u.test(item.meaningZh) || allowedChineseSynonymMeaningWhitelist.has(item.id), `${item.id} combines Chinese concepts.`)
  assert.ok(normalize(item.exampleEn).includes(normalize(item.term)), `${item.id} example does not contain its target.`)
  assert.ok(item.exampleZh.trim())
  assert.ok(!('sceneKnowledgeId' in item) && !('sceneId' in item), `${item.id} leaks a scene identity.`)
  assert.equal(items.filter((candidate) => normalize(candidate.term) === normalize(item.term)).length, 1, `${item.id} duplicates a daily knowledge point.`)
}
console.log('R17 daily primary-2 3B content quality verified')
