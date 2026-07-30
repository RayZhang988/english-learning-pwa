import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const writeMode = process.argv.includes('--write')
const curriculumDirectory = new URL('./', import.meta.url)
const lessonDirectory = new URL(
  '../lessons/survival-travel-american-4w/',
  curriculumDirectory,
)
const exerciseUrl = new URL('listening-exercises.v1.json', lessonDirectory)
const bilingualUrl = new URL(
  'listening-choice-bilingual-options.v1.json',
  lessonDirectory,
)
const generatedIdPattern = /-r11-ss-0[12]$/u

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'))
}

function orderedOptions(transcript, correctIndex, day, slot) {
  const distractorIndices = []
  for (
    let offset = 1;
    distractorIndices.length < 2;
    offset += 1
  ) {
    const index = (correctIndex + offset) % transcript.length
    if (index !== correctIndex) {
      distractorIndices.push(index)
    }
  }
  const correctPosition = (day + slot) % 3
  const sourceIndices = [...distractorIndices]
  sourceIndices.splice(correctPosition, 0, correctIndex)
  return {
    correctOptionId: ['a', 'b', 'c'][correctPosition],
    sourceIndices,
  }
}

function generatedForLesson(extensionLesson, sourceLesson) {
  const listening = sourceLesson.learningUnits.find(
    (unit) => unit.domain === 'listening',
  )
  assert.ok(listening, `${sourceLesson.lessonId} has no listening unit.`)
  assert.equal(extensionLesson.listeningUnitId, listening.learningUnitId)
  assert.equal(extensionLesson.baseContentRef, listening.contentRef)

  const transcript = listening.activity.transcript
  assert.ok(transcript.length >= 5)
  const existingLineIndices = new Set(
    extensionLesson.exercises
      .filter(
        (exercise) =>
          exercise.audioSource.sourceType === 'transcript-line',
      )
      .map((exercise) => exercise.audioSource.lineIndex),
  )
  const available = transcript
    .map((_, index) => index)
    .filter((index) => !existingLineIndices.has(index))
  assert.ok(
    available.length >= 2,
    `${sourceLesson.lessonId} has insufficient unused transcript lines.`,
  )
  const selected = [available[0], available.at(-1)]
  const exercises = []
  const bilingualQuestions = []

  for (const [offset, lineIndex] of selected.entries()) {
    const slot = offset + 1
    const exerciseId =
      `st4w-w${Math.ceil(sourceLesson.recommendedDay / 7)}` +
      `d${sourceLesson.recommendedDay}-r11-ss-0${slot}`
    const { correctOptionId, sourceIndices } = orderedOptions(
      transcript,
      lineIndex,
      sourceLesson.recommendedDay,
      slot,
    )
    const optionIds = ['a', 'b', 'c']
    exercises.push({
      exerciseId,
      type: 'short-sentence-choice',
      audioSource: {
        sourceType: 'transcript-line',
        segmentId: `seg-${exerciseId}`,
        locale: 'en-US',
        baseContentRef: listening.contentRef,
        lineIndex,
        expectedText: transcript[lineIndex].text,
      },
      promptZh: '你听到的是哪句话？',
      options: sourceIndices.map((sourceIndex, index) => ({
        optionId: optionIds[index],
        text: transcript[sourceIndex].translationZh,
      })),
      correctOptionId,
      playbackPolicy: {
        allowSegmentSelection: false,
        allowRepeat: true,
        allowedRates: [0.75, 1, 1.25],
      },
      rationaleZh:
        `音频中的句子是“${transcript[lineIndex].translationZh}”。`,
    })
    bilingualQuestions.push({
      questionId: exerciseId,
      sourceKind: 'listening-extension',
      options: sourceIndices.map((sourceIndex, index) => ({
        optionId: optionIds[index],
        textEn: transcript[sourceIndex].text,
        translationZh: transcript[sourceIndex].translationZh,
      })),
    })
  }

  return { exercises, bilingualQuestions }
}

const [exerciseBundle, bilingual, ...weeks] = await Promise.all([
  readJson(exerciseUrl),
  readJson(bilingualUrl),
  ...[1, 2, 3, 4].map((week) =>
    readJson(new URL(`week-${week}.v1.json`, lessonDirectory)),
  ),
])
const sourceLessons = weeks.flatMap((week) => week.lessons)
const sourceById = new Map(
  sourceLessons.map((lesson) => [lesson.lessonId, lesson]),
)
const generatedBilingual = []

for (const extensionLesson of exerciseBundle.lessons) {
  const sourceLesson = sourceById.get(extensionLesson.lessonId)
  assert.ok(sourceLesson, `Unknown extension lesson ${extensionLesson.lessonId}.`)
  extensionLesson.exercises = extensionLesson.exercises.filter(
    (exercise) => !generatedIdPattern.test(exercise.exerciseId),
  )
  const generated = generatedForLesson(extensionLesson, sourceLesson)
  extensionLesson.exercises.push(...generated.exercises)
  generatedBilingual.push(...generated.bilingualQuestions)
}

exerciseBundle.extensionVersion = '1.1.0'
bilingual.contentVersion = '1.1.0'
bilingual.questions = bilingual.questions.filter(
  (question) => !generatedIdPattern.test(question.questionId),
)
bilingual.questions.push(...generatedBilingual)

assert.equal(exerciseBundle.lessons.length, 28)
assert.equal(generatedBilingual.length, 56)
assert.equal(
  exerciseBundle.lessons.flatMap((lesson) => lesson.exercises).length,
  140,
)

if (writeMode) {
  await Promise.all([
    writeFile(exerciseUrl, `${JSON.stringify(exerciseBundle, null, 2)}\n`),
    writeFile(bilingualUrl, `${JSON.stringify(bilingual, null, 2)}\n`),
  ])
}

console.log(
  JSON.stringify(
    {
      status: writeMode ? 'written' : 'validated',
      generatedExercises: 56,
      totalExercises: 140,
      choiceQuestions: bilingual.questions.length,
    },
    null,
    2,
  ),
)
