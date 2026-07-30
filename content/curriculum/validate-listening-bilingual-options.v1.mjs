import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const curriculumDirectory = new URL('./', import.meta.url)
const lessonDirectory = new URL(
  '../lessons/survival-travel-american-4w/',
  curriculumDirectory,
)

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'))
}

const extension = await readJson(
  new URL('listening-exercises.v1.json', lessonDirectory),
)
const bilingual = await readJson(
  new URL(
    'listening-choice-bilingual-options.v1.json',
    lessonDirectory,
  ),
)
const weeks = await Promise.all(
  [1, 2, 3, 4].map((week) =>
    readJson(new URL(`week-${week}.v1.json`, lessonDirectory)),
  ),
)

const expected = new Map()

function addExpected(questionId, sourceKind, optionIds) {
  assert.ok(!expected.has(questionId), `Duplicate source question ${questionId}.`)
  expected.set(questionId, { sourceKind, optionIds })
}

for (const lesson of extension.lessons) {
  for (const exercise of lesson.exercises) {
    if (!Array.isArray(exercise.options)) continue
    addExpected(
      exercise.exerciseId,
      'listening-extension',
      exercise.options.map((option) => option.optionId),
    )
  }
}

for (const week of weeks) {
  for (const lesson of week.lessons) {
    const listening = lesson.learningUnits.find(
      (unit) => unit.domain === 'listening',
    )
    assert.ok(listening, `${lesson.lessonId} omits its listening unit.`)
    for (const check of listening.activity.checks) {
      addExpected(
        check.id,
        'listening-core-check',
        check.options.map((_, index) => `${check.id}:option:${index}`),
      )
    }
    for (const quiz of lesson.sceneQuiz.filter(
      (item) => item.domain === 'listening',
    )) {
      addExpected(
        quiz.id,
        'listening-scene-quiz',
        quiz.options.map((_, index) => `${quiz.id}:option:${index}`),
      )
    }
  }
}

assert.equal(bilingual.schemaVersion, 1)
assert.equal(
  bilingual.documentType,
  'listening-choice-bilingual-options',
)
assert.equal(bilingual.contentVersion, '1.0.0')
assert.equal(bilingual.courseId, 'survival-travel-american-4w')
assert.equal(bilingual.targetLocale, 'en-US')
assert.equal(bilingual.supportLocale, 'zh-CN')
assert.ok(Array.isArray(bilingual.questions))

const seenQuestions = new Set()
let optionCount = 0
for (const question of bilingual.questions) {
  const source = expected.get(question.questionId)
  assert.ok(source, `Unknown bilingual question ${question.questionId}.`)
  assert.ok(
    !seenQuestions.has(question.questionId),
    `Duplicate bilingual question ${question.questionId}.`,
  )
  seenQuestions.add(question.questionId)
  assert.equal(question.sourceKind, source.sourceKind)
  assert.ok(Array.isArray(question.options))
  assert.deepEqual(
    question.options.map((option) => option.optionId),
    source.optionIds,
    `${question.questionId} option identities drifted.`,
  )
  for (const option of question.options) {
    optionCount += 1
    assert.equal(typeof option.textEn, 'string')
    assert.equal(typeof option.translationZh, 'string')
    assert.ok(option.textEn.trim(), `${option.optionId} has empty English.`)
    assert.ok(
      option.translationZh.trim(),
      `${option.optionId} has empty Chinese.`,
    )
    assert.doesNotMatch(
      option.textEn,
      /[\u3400-\u9fff]/u,
      `${option.optionId} leaks Chinese into the English choice.`,
    )
    assert.notEqual(
      option.textEn.trim().toLocaleLowerCase('en-US'),
      option.translationZh.trim().toLocaleLowerCase('en-US'),
      `${option.optionId} does not explain the English choice in Chinese.`,
    )
  }
}

assert.equal(seenQuestions.size, expected.size)
assert.equal(seenQuestions.size, 169)
assert.equal(optionCount, 507)

console.log(
  JSON.stringify(
    {
      status: 'passed',
      choiceQuestions: seenQuestions.size,
      bilingualOptions: optionCount,
    },
    null,
    2,
  ),
)
