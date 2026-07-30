import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../../', import.meta.url)
const readJson = async (relativePath) =>
  JSON.parse(await readFile(new URL(relativePath, root), 'utf8'))

const index = await readJson('content/curriculum/scene-vocabulary-question-bank-index.v1.json')
const bank = await readJson(index.questionBankFile)

const expectedScenes = [
  ['airport-flight', 'airport'],
  ['airport-flight', 'on-plane'],
  ['airport-flight', 'immigration'],
  ['airport-flight', 'baggage-claim'],
  ['airport-flight', 'customs-inspection'],
  ['airport-flight', 'currency-exchange'],
  ['airport-flight', 'airport-transport'],
  ['city-transport', 'taxi'],
  ['city-transport', 'public-transport'],
  ['city-transport', 'car-rental'],
  ['stay-dining', 'hotel'],
  ['stay-dining', 'restaurant'],
  ['shopping-sightseeing', 'shopping'],
  ['shopping-sightseeing', 'sightseeing'],
  ['help-connectivity', 'asking-for-help'],
  ['help-connectivity', 'restroom'],
  ['help-connectivity', 'connectivity'],
  ['health', 'medical-pharmacy'],
]

assert.equal(index.schemaVersion, 1)
assert.equal(index.documentType, 'scene-vocabulary-question-bank-index')
assert.equal(index.contentVersion, '1.0.0')
assert.equal(index.bankId, 'r13b-travel-scene-vocabulary')
assert.equal(bank.schemaVersion, 1)
assert.equal(bank.documentType, 'scene-vocabulary-question-bank')
assert.equal(bank.contentVersion, '1.0.0')
assert.deepEqual(bank.interaction, {
  promptZh: '这个词是什么意思？',
  targetPlayback: 'tap-highlighted-target-only',
  sentenceTranslationAllowed: false,
})
assert.equal(bank.scenes.length, expectedScenes.length)
assert.deepEqual(
  Object.keys(bank).sort(),
  [
    'schemaVersion',
    'documentType',
    'contentVersion',
    'bankId',
    'baseCourseId',
    'targetLocale',
    'supportLocale',
    'interaction',
    'scenes',
  ].sort(),
)

const seenQuestionIds = new Set()
const seenSourceIds = new Set()
let questionCount = 0
const highFrequencySceneIds = new Set(index.coverage.highFrequencySceneIds)

for (const [position, scene] of bank.scenes.entries()) {
  const [categoryId, sceneId] = expectedScenes[position]
  assert.equal(scene.categoryId, categoryId)
  assert.equal(scene.sceneId, sceneId)
  assert.deepEqual(
    Object.keys(scene).sort(),
    ['sceneId', 'categoryId', 'titleZh', 'questions'].sort(),
  )
  assert.equal(
    scene.questions.length,
    highFrequencySceneIds.has(scene.sceneId)
      ? index.coverage.highFrequencyQuestionsPerScene
      : index.coverage.standardQuestionsPerScene,
  )
  const sceneTargets = new Set()
  for (const question of scene.questions) {
    questionCount += 1
    assert.match(question.questionId, new RegExp(`^r13(?:b|c)-vocabulary-${sceneId}-q[0-9]{2}$`))
    assert.ok(!seenQuestionIds.has(question.questionId), `Duplicate question ${question.questionId}.`)
    seenQuestionIds.add(question.questionId)
    assert.deepEqual(
      Object.keys(question).sort(),
      [
        'questionId',
        'sentenceEn',
        'targetText',
        'targetOccurrence',
        'correctMeaningZh',
        'distractorMeaningsZh',
        'source',
      ].sort(),
    )
    assert.equal(question.targetOccurrence, 1)
    const normalizedTarget = question.targetText.toLocaleLowerCase('en-US').replace(/[‐‑–—]/gu, '-').replace(/[-\s]+/gu, ' ').trim()
    assert.ok(!sceneTargets.has(normalizedTarget), `${question.questionId} repeats target ${normalizedTarget}.`)
    sceneTargets.add(normalizedTarget)
    assert.doesNotMatch(question.sentenceEn, /[\u3400-\u9fff]/u)
    assert.match(question.targetText, /^\S(?:.*\S)?$/u)
    const occurrences = question.sentenceEn
      .toLocaleLowerCase('en-US')
      .split(question.targetText.toLocaleLowerCase('en-US')).length - 1
    assert.equal(occurrences, 1, `${question.questionId} has no stable unique target span.`)
    assert.ok(question.correctMeaningZh.trim())
    assert.equal(question.distractorMeaningsZh.length, 3)
    assert.equal(new Set(question.distractorMeaningsZh).size, 3)
    assert.ok(!question.distractorMeaningsZh.includes(question.correctMeaningZh), `${question.questionId} repeats its correct answer as a distractor.`)
    assert.deepEqual(question.source, {
      kind: 'project-authored-controlled-text',
      sourceId: question.source.sourceId,
      rights: 'original-project-content',
    })
    assert.match(question.source.sourceId, new RegExp(`^r13b-source-${sceneId}-q[0-9]{2}$|^r13c-[a-z0-9-]+(?:-q)?[0-9]{2}$`))
    assert.ok(!seenSourceIds.has(question.source.sourceId), `Duplicate source ${question.source.sourceId}.`)
    seenSourceIds.add(question.source.sourceId)
  }
}

assert.equal(questionCount, index.coverage.questionCount)
assert.equal(seenQuestionIds.size, 612)
assert.equal(seenSourceIds.size, 612)

console.log(JSON.stringify({status: 'passed', scenes: bank.scenes.length, questions: questionCount, interaction: bank.interaction}, null, 2))
