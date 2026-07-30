import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const fragmentUrl = new URL('./transport-commerce.v1.json', import.meta.url)
const fragment = JSON.parse(await readFile(fragmentUrl, 'utf8'))

const expectedCounts = new Map([
  ['taxi', 21],
  ['public-transport', 42],
  ['car-rental', 21],
  ['hotel', 42],
  ['restaurant', 42],
  ['shopping', 42],
  ['sightseeing', 21],
])

const normalizeTarget = (value) =>
  value
    .toLocaleLowerCase('en-US')
    .replace(/[‐‑–—]/gu, '-')
    .replace(/[-\s]+/gu, ' ')
    .trim()

const targetMatchesOnce = (sentence, target) => {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const matches = sentence.match(new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'giu'))
  return matches?.length === 1
}

assert.equal(fragment.schemaVersion, 1)
assert.equal(fragment.documentType, 'r13c-scene-vocabulary-candidate-fragment')
assert.equal(fragment.contentVersion, '1.0.0')
assert.equal(fragment.fragmentId, 'r13c-transport-commerce')
assert.equal(fragment.status, 'unintegrated-content-candidate')
assert.equal(fragment.baseQuestionBank, 'scene-vocabulary-questions.v1.json')
assert.deepEqual(fragment.sourcePolicy, {
  kind: 'project-authored-controlled-text',
  rights: 'original-project-content',
  sceneBasis: '美国旅行者在城市交通、住宿、餐饮、消费和观光中的高频现场沟通',
})
assert.deepEqual(fragment.scenes.map(({ sceneId }) => sceneId), [...expectedCounts.keys()])

const questionIds = new Set()
const sourceIds = new Set()
let total = 0

for (const scene of fragment.scenes) {
  assert.equal(scene.categoryId, scene.sceneId === 'taxi' || scene.sceneId === 'public-transport' || scene.sceneId === 'car-rental' ? 'city-transport' : scene.sceneId === 'hotel' || scene.sceneId === 'restaurant' ? 'stay-dining' : 'shopping-sightseeing')
  assert.ok(scene.titleZh)
  assert.equal(scene.questions.length, expectedCounts.get(scene.sceneId))
  const sceneTargets = new Set()

  for (const question of scene.questions) {
    total += 1
    assert.match(question.questionId, new RegExp(`^r13c-vocabulary-${scene.sceneId}-q[0-9]{2}$`))
    assert.ok(!questionIds.has(question.questionId), `Duplicate question ID: ${question.questionId}`)
    questionIds.add(question.questionId)
    assert.equal(question.targetOccurrence, 1)
    assert.ok(question.sentenceEn.trim())
    assert.doesNotMatch(question.sentenceEn, /[\u3400-\u9fff]/u)
    assert.ok(targetMatchesOnce(question.sentenceEn, question.targetText), `${question.questionId} does not contain exactly one standalone target span.`)
    const normalizedTarget = normalizeTarget(question.targetText)
    assert.ok(!sceneTargets.has(normalizedTarget), `${scene.sceneId} repeats target: ${normalizedTarget}`)
    sceneTargets.add(normalizedTarget)
    assert.ok(question.correctMeaningZh.trim())
    assert.equal(question.distractorMeaningsZh.length, 3)
    assert.equal(new Set(question.distractorMeaningsZh).size, 3)
    assert.ok(!question.distractorMeaningsZh.includes(question.correctMeaningZh), `${question.questionId} uses its answer as a distractor.`)
    assert.match(question.source.sourceId, new RegExp(`^r13c-source-${scene.sceneId}-q[0-9]{2}$`))
    assert.ok(question.source.sceneBasis.trim())
    assert.ok(!sourceIds.has(question.source.sourceId), `Duplicate source ID: ${question.source.sourceId}`)
    sourceIds.add(question.source.sourceId)
  }
}

assert.equal(total, 231)
assert.equal(questionIds.size, 231)
assert.equal(sourceIds.size, 231)

console.log(JSON.stringify({ status: 'passed', fragmentId: fragment.fragmentId, total, byScene: Object.fromEntries(expectedCounts) }, null, 2))
