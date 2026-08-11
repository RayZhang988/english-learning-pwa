import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const curriculumDirectory = new URL('./', import.meta.url)
const lessonDirectory = new URL(
  '../lessons/survival-travel-american-4w/',
  curriculumDirectory,
)

const allowedAnswerTypes = new Set([
  'place-name',
  'surname',
  'number',
  'time',
  'manner-or-short-phrase',
  'product-description',
  'reservation-details',
  'allergy-information',
  'payment-method',
  'direction-and-distance',
  'transfer-instruction',
  'ticket-details',
  'size-or-condition',
  'checkout-time',
  'device-problem',
  'gate-code',
  'availability-time',
  'room-number',
  'gate-and-time',
])

const allowedInputFormats = new Set([
  'english-words',
  'digits',
  'clock-time',
  'gate-code',
  'room-number',
])

function normalized(value) {
  return value
    .toLocaleLowerCase('en-US')
    .replace(/[\s\p{P}]+/gu, ' ')
    .trim()
}

function answerFragments(exercise) {
  return [
    ...exercise.targetKeywords,
    exercise.standardAnswer,
    ...exercise.acceptedAnswers,
  ]
    .map(normalized)
    .filter((fragment) => fragment.length >= 3)
}

const bundle = JSON.parse(
  await readFile(new URL('listening-exercises.v1.json', lessonDirectory), 'utf8'),
)
let dictationCount = 0

for (const lesson of bundle.lessons) {
  for (const exercise of lesson.exercises) {
    if (exercise.type !== 'keyword-dictation') continue
    dictationCount += 1

    assert.ok(
      exercise.answerGuidance && typeof exercise.answerGuidance === 'object',
      `${exercise.exerciseId} is missing answerGuidance.`,
    )
    const guidance = exercise.answerGuidance
    assert.deepEqual(
      Object.keys(guidance).sort(),
      ['answerType', 'guidanceZh', 'acceptedInputFormats'].sort(),
      `${exercise.exerciseId} answerGuidance shape drifted.`,
    )
    assert.ok(
      allowedAnswerTypes.has(guidance.answerType),
      `${exercise.exerciseId} has an unsupported answerType.`,
    )
    assert.equal(typeof guidance.guidanceZh, 'string')
    assert.ok(
      guidance.guidanceZh.trim().length >= 8,
      `${exercise.exerciseId} guidanceZh is too short to guide a learner.`,
    )
    assert.ok(Array.isArray(guidance.acceptedInputFormats))
    assert.ok(
      guidance.acceptedInputFormats.length > 0,
      `${exercise.exerciseId} declares no accepted input format.`,
    )
    assert.equal(
      new Set(guidance.acceptedInputFormats).size,
      guidance.acceptedInputFormats.length,
      `${exercise.exerciseId} repeats an input format.`,
    )
    for (const inputFormat of guidance.acceptedInputFormats) {
      assert.ok(
        allowedInputFormats.has(inputFormat),
        `${exercise.exerciseId} has unsupported input format ${inputFormat}.`,
      )
    }

    const normalizedGuidance = normalized(guidance.guidanceZh)
    for (const answerFragment of answerFragments(exercise)) {
      assert.ok(
        !normalizedGuidance.includes(answerFragment),
        `${exercise.exerciseId} guidance leaks answer text: ${answerFragment}.`,
      )
    }
  }
}

assert.ok(dictationCount > 0, 'No keyword-dictation exercises found.')
console.log(JSON.stringify({ status: 'passed', keywordDictation: dictationCount }))
