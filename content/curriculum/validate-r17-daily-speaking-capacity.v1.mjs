import assert from 'node:assert/strict'
import fs from 'node:fs'

const packageIndex = JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json', 'utf8'))
const manifest = JSON.parse(fs.readFileSync('content/curriculum/training-supply-index.v1.json', 'utf8'))
const candidates = manifest.shards.flatMap((shard) => JSON.parse(fs.readFileSync(shard.path, 'utf8')).candidates)
const levels = [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8]
const prompts = packageIndex.lessonFiles.flatMap((path) => JSON.parse(fs.readFileSync(path, 'utf8')).lessons)
  .flatMap((lesson) => lesson.learningUnits.filter((unit) => unit.domain === 'speaking').flatMap((unit) => unit.activity.prompts))
const additions = prompts.filter((prompt) => prompt.id.startsWith('r17-speaking-'))
assert.equal(additions.length, 778, 'R17 speaking additions must be stable and complete.')
for (const level of levels) {
  assert.equal(candidates.filter((candidate) => candidate.domain === 'speaking' && candidate.difficultyLevel === level).length, 60, `speaking level ${level}`)
}
const core = new Set()
for (const prompt of additions) {
  assert.ok(prompt.cueZh?.trim() && prompt.partnerLine?.trim() && prompt.modelAnswer?.trim() && prompt.modelAnswerTranslationZh?.trim())
  assert.ok(Array.isArray(prompt.acceptedAnswers) && prompt.acceptedAnswers.includes(prompt.modelAnswer))
  assert.ok(Array.isArray(prompt.requiredConcepts) && prompt.requiredConcepts.length > 0)
  const fingerprint = `${prompt.partnerLine}\u0000${prompt.modelAnswer}`.toLowerCase()
  assert.ok(!core.has(fingerprint), `duplicate speaking target: ${prompt.id}`)
  core.add(fingerprint)
}
console.log(JSON.stringify({ status: 'passed', prompts: 900, additions: additions.length }, null, 2))
