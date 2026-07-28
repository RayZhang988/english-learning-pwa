import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const writeMode = process.argv.includes('--write')

function absolute(relativePath) {
  return path.join(root, relativePath)
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(absolute(relativePath), 'utf8'))
}

function fail(message) {
  throw new Error(message)
}

function assert(condition, message) {
  if (!condition) {
    fail(message)
  }
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

const packageIndexPath = 'content/curriculum/package-index.v1.json'
const rulesPath =
  'content/curriculum/duration-baseline-authoring.v1.json'
const extensionIndexPath =
  'content/curriculum/listening-exercise-extension-index.v1.json'

const packageIndex = readJson(packageIndexPath)
const rules = readJson(rulesPath)
const extensionIndex = readJson(extensionIndexPath)
const lessonDocuments = packageIndex.lessonFiles.map((relativePath) => ({
  relativePath,
  document: readJson(relativePath),
}))
const lessons = lessonDocuments.flatMap(({ document }) => document.lessons)
const extensionBundles = extensionIndex.exerciseBundleFiles.map(readJson)
const extensionLessons = extensionBundles.flatMap((bundle) => bundle.lessons)
const extensionByContentRef = new Map(
  extensionLessons.map((lesson) => [lesson.baseContentRef, lesson]),
)

assert(
  rules.schemaVersion === 1 &&
    rules.documentType === 'duration-baseline-authoring-rules' &&
    rules.rulesVersion === '1.0.0' &&
    rules.courseId === packageIndex.courseId &&
    rules.packageVersion === packageIndex.packageVersion,
  'Duration baseline authoring rules do not match the released package.',
)

function regexMatches(text, pattern) {
  return text.match(new RegExp(pattern, 'g')) ?? []
}

function nominalUtteranceSeconds(text) {
  const tts = rules.nominalTts
  const wordUnits = regexMatches(text, tts.wordUnitPattern).length
  const minorPunctuation =
    regexMatches(text, tts.minorPunctuationPattern).length
  const terminalPunctuation =
    regexMatches(text, tts.terminalPunctuationPattern).length
  return Math.max(
    tts.minimumUtteranceSeconds,
    wordUnits * tts.secondsPerWordUnit +
      minorPunctuation * tts.secondsPerMinorPunctuation +
      terminalPunctuation * tts.secondsPerTerminalPunctuation,
  )
}

function calculateContentBaselineSeconds(baseline) {
  const rawSeconds =
    baseline.fixedSeconds +
    baseline.itemCount * baseline.secondsPerItem +
    baseline.activeAudioSeconds *
      baseline.expectedAudioPlaythroughs +
    baseline.interactionStepCount *
      baseline.secondsPerInteractionStep
  return Math.round(
    Math.min(
      baseline.maximumSeconds,
      Math.max(baseline.minimumSeconds, rawSeconds),
    ),
  )
}

function vocabularySceneQuestionCount(lesson) {
  const quizzes = lesson.sceneQuiz.filter(
    (quiz) => quiz.domain === 'vocabulary',
  )
  assert(
    quizzes.length === 1,
    `${lesson.lessonId} must contain one vocabulary scene quiz.`,
  )
  const quiz = quizzes[0]
  if (quiz.format === 'single-choice') {
    return 1
  }
  assert(
    quiz.format === 'intent-matching' &&
      Array.isArray(quiz.pairs) &&
      quiz.pairs.length > 0,
    `${quiz.id} has an unsupported vocabulary scene quiz shape.`,
  )
  return quiz.pairs.length
}

function listeningSceneQuiz(lesson) {
  const quizzes = lesson.sceneQuiz.filter(
    (quiz) => quiz.domain === 'listening',
  )
  assert(
    quizzes.length === 1 &&
      quizzes[0].format === 'single-choice' &&
      typeof quizzes[0].audioText === 'string',
    `${lesson.lessonId} must contain one listening audio scene quiz.`,
  )
  return quizzes[0]
}

function baselineFromRule(rule, contentType, input) {
  return {
    schemaVersion: 1,
    contentType,
    fixedSeconds: rule.fixedSeconds,
    itemCount: input.itemCount,
    secondsPerItem: rule.secondsPerItem,
    activeAudioSeconds: input.activeAudioSeconds,
    expectedAudioPlaythroughs: rule.expectedAudioPlaythroughs,
    interactionStepCount:
      input.itemCount * rule.interactionStepsPerItem,
    secondsPerInteractionStep: rule.secondsPerInteractionStep,
    minimumSeconds: rule.minimumSeconds,
    maximumSeconds: rule.maximumSeconds,
  }
}

function resolveExtensionAudioText(exercise, listeningUnit) {
  const source = exercise.audioSource
  if (source.sourceType === 'tts-text') {
    assert(
      source.locale === 'en-US' &&
        typeof source.ttsText === 'string' &&
        source.ttsText.length > 0,
      `${exercise.exerciseId} has invalid TTS text.`,
    )
    return source.ttsText
  }
  assert(
    source.sourceType === 'transcript-line' &&
      source.locale === 'en-US' &&
      source.baseContentRef === listeningUnit.contentRef &&
      Number.isInteger(source.lineIndex),
    `${exercise.exerciseId} has an invalid transcript reference.`,
  )
  const line = listeningUnit.activity.transcript[source.lineIndex]
  assert(
    line?.text === source.expectedText,
    `${exercise.exerciseId} transcript text has drifted.`,
  )
  return source.expectedText
}

const expectedByUnitId = new Map()
const vocabularyRegistry = new Set()

for (const lesson of lessons) {
  const unitsByDomain = new Map(
    lesson.learningUnits.map((unit) => [unit.domain, unit]),
  )
  assert(
    unitsByDomain.size === 3 &&
      unitsByDomain.has('vocabulary') &&
      unitsByDomain.has('listening') &&
      unitsByDomain.has('speaking'),
    `${lesson.lessonId} must contain exactly three domain units.`,
  )

  const vocabulary = unitsByDomain.get('vocabulary')
  const vocabularyRule = rules.modules.vocabulary
  const reviewItemIds = vocabulary.activity.reviewItemIds ?? []
  for (const reviewItemId of reviewItemIds) {
    assert(
      vocabularyRegistry.has(reviewItemId),
      `${vocabulary.learningUnitId} references unavailable review item ${reviewItemId}.`,
    )
  }
  const trainingItemIds = new Set([
    ...reviewItemIds,
    ...vocabulary.activity.items.map((item) => item.id),
  ])
  const vocabularyItemCount =
    trainingItemIds.size + vocabularySceneQuestionCount(lesson)
  const vocabularyContentType =
    vocabularyRule.contentTypeByActivity[vocabulary.activity.type]
  assert(
    typeof vocabularyContentType === 'string',
    `${vocabulary.learningUnitId} has an unsupported vocabulary activity.`,
  )
  expectedByUnitId.set(
    vocabulary.learningUnitId,
    baselineFromRule(
      vocabularyRule,
      vocabularyContentType,
      {
        itemCount: vocabularyItemCount,
        activeAudioSeconds: vocabularyRule.activeAudioSeconds,
      },
    ),
  )
  for (const item of vocabulary.activity.items) {
    assert(
      !vocabularyRegistry.has(item.id),
      `Duplicate vocabulary item ${item.id}.`,
    )
    vocabularyRegistry.add(item.id)
  }

  const listening = unitsByDomain.get('listening')
  const listeningRule = rules.modules.listening
  const extensionLesson = extensionByContentRef.get(listening.contentRef)
  assert(
    extensionLesson?.listeningUnitId === listening.learningUnitId,
    `${listening.learningUnitId} has no matching listening extension.`,
  )
  const exercises = extensionLesson.exercises
  const exerciseTypes = new Set(exercises.map((exercise) => exercise.type))
  assert(
    exercises.length === 3 &&
      exerciseTypes.has('word-discrimination') &&
      exerciseTypes.has('short-sentence-choice') &&
      exerciseTypes.has('keyword-dictation'),
    `${listening.learningUnitId} must contain all three extension exercises.`,
  )
  const passageText = listening.activity.transcript
    .map((line) => line.text)
    .join(rules.nominalTts.transcriptJoiner)
  assert(
    listening.activity.transcript.length > 0 &&
      listening.activity.checks.length > 0,
    `${listening.learningUnitId} has no transcript or core checks.`,
  )
  const extensionAudioSeconds = exercises.reduce(
    (total, exercise) =>
      total +
      nominalUtteranceSeconds(
        resolveExtensionAudioText(exercise, listening),
      ),
    0,
  )
  const sceneQuiz = listeningSceneQuiz(lesson)
  const activeAudioSeconds = Math.round(
    nominalUtteranceSeconds(passageText) *
      listening.activity.checks.length +
      extensionAudioSeconds +
      nominalUtteranceSeconds(sceneQuiz.audioText),
  )
  const listeningItemCount =
    exercises.length + listening.activity.checks.length + 1
  expectedByUnitId.set(
    listening.learningUnitId,
    baselineFromRule(
      listeningRule,
      listeningRule.contentType,
      {
        itemCount: listeningItemCount,
        activeAudioSeconds,
      },
    ),
  )

  const speaking = unitsByDomain.get('speaking')
  const speakingRule = rules.modules.speaking
  const speakingContentType =
    speakingRule.contentTypeByActivity[speaking.activity.type]
  assert(
    typeof speakingContentType === 'string' &&
      speaking.activity.prompts.length > 0,
    `${speaking.learningUnitId} has an unsupported speaking activity.`,
  )
  expectedByUnitId.set(
    speaking.learningUnitId,
    baselineFromRule(
      speakingRule,
      speakingContentType,
      {
        itemCount: speaking.activity.prompts.length,
        activeAudioSeconds: speakingRule.activeAudioSeconds,
      },
    ),
  )
}

assert(
  lessons.length === 28 && expectedByUnitId.size === 84,
  `Expected 28 lessons and 84 baselines, received ${lessons.length} and ${expectedByUnitId.size}.`,
)
assert(
  extensionByContentRef.size === 28,
  `Expected 28 listening extension lessons, received ${extensionByContentRef.size}.`,
)

function formatBaselineField(baseline, indent) {
  const lines = JSON.stringify(baseline, null, 2).split('\n')
  return [
    `${indent}"durationBaseline": ${lines[0]}`,
    ...lines.slice(1).map((line) => `${indent}${line}`),
  ].join('\n') + ','
}

function insertMissingBaselines(relativePath, document) {
  let source = fs.readFileSync(absolute(relativePath), 'utf8')
  let inserted = 0
  for (const lesson of document.lessons) {
    for (const unit of lesson.learningUnits) {
      if (unit.durationBaseline !== undefined) {
        continue
      }
      const expected = expectedByUnitId.get(unit.learningUnitId)
      assert(
        expected !== undefined,
        `No computed baseline for ${unit.learningUnitId}.`,
      )
      const identity = `"learningUnitId": "${unit.learningUnitId}"`
      const identityIndex = source.indexOf(identity)
      assert(
        identityIndex >= 0,
        `Cannot locate ${unit.learningUnitId} in ${relativePath}.`,
      )
      const nextIdentityIndex = source.indexOf(
        '"learningUnitId":',
        identityIndex + identity.length,
      )
      const unitEnd =
        nextIdentityIndex >= 0 ? nextIdentityIndex : source.length
      const unitSource = source.slice(identityIndex, unitEnd)
      const estimatedMatch =
        /^(\s*)"estimatedSeconds":\s*\d+,$/m.exec(unitSource)
      assert(
        estimatedMatch !== null,
        `Cannot locate estimatedSeconds for ${unit.learningUnitId}.`,
      )
      const lineStart = identityIndex + estimatedMatch.index
      const lineEnd = source.indexOf('\n', lineStart)
      assert(
        lineEnd >= 0,
        `Cannot locate insertion point for ${unit.learningUnitId}.`,
      )
      const insertion =
        '\n' +
        formatBaselineField(expected, estimatedMatch[1])
      source =
        source.slice(0, lineEnd) +
        insertion +
        source.slice(lineEnd)
      inserted += 1
    }
  }
  if (inserted > 0) {
    fs.writeFileSync(absolute(relativePath), source)
  }
  return inserted
}

if (writeMode) {
  const inserted = lessonDocuments.reduce(
    (total, { relativePath, document }) =>
      total + insertMissingBaselines(relativePath, document),
    0,
  )
  console.log(
    JSON.stringify(
      {
        mode: 'write',
        inserted,
        lessonFiles: lessonDocuments.length,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

const observedBaselines = []
for (const { relativePath, document } of lessonDocuments) {
  for (const lesson of document.lessons) {
    for (const unit of lesson.learningUnits) {
      const expected = expectedByUnitId.get(unit.learningUnitId)
      assert(
        unit.durationBaseline !== undefined,
        `${unit.learningUnitId} is missing durationBaseline.`,
      )
      assert(
        deepEqual(unit.durationBaseline, expected),
        `${unit.learningUnitId} durationBaseline has drifted from authored content facts.`,
      )
      const baseline = unit.durationBaseline
      const numericFields = [
        'fixedSeconds',
        'itemCount',
        'secondsPerItem',
        'activeAudioSeconds',
        'expectedAudioPlaythroughs',
        'interactionStepCount',
        'secondsPerInteractionStep',
        'minimumSeconds',
        'maximumSeconds',
      ]
      for (const field of numericFields) {
        assert(
          typeof baseline[field] === 'number' &&
            Number.isFinite(baseline[field]) &&
            baseline[field] >= 0,
          `${unit.learningUnitId}.${field} must be finite and non-negative.`,
        )
      }
      assert(
        Number.isInteger(baseline.itemCount) &&
          Number.isInteger(baseline.interactionStepCount) &&
          baseline.itemCount > 0 &&
          baseline.minimumSeconds > 0 &&
          baseline.maximumSeconds >= baseline.minimumSeconds,
        `${unit.learningUnitId} has an invalid count or clamp range.`,
      )
      observedBaselines.push({
        relativePath,
        lessonId: lesson.lessonId,
        learningUnitId: unit.learningUnitId,
        domain: unit.domain,
        seconds: calculateContentBaselineSeconds(baseline),
      })
    }
  }
}

const secondsByDomain = Object.fromEntries(
  ['vocabulary', 'listening', 'speaking'].map((domain) => [
    domain,
    observedBaselines
      .filter((entry) => entry.domain === domain)
      .map((entry) => entry.seconds),
  ]),
)
for (const [domain, values] of Object.entries(secondsByDomain)) {
  assert(
    values.length === 28 && new Set(values).size > 1,
    `${domain} baselines do not vary with authored content volume.`,
  )
}
assert(
  observedBaselines.some((entry) => entry.seconds !== 900) &&
    !observedBaselines.every((entry) => entry.seconds === 900),
  'Structured baselines still reproduce the legacy fixed 900 seconds.',
)

const firstDay = lessons
  .find((lesson) => lesson.recommendedDay === 1)
  .learningUnits.map((unit) => {
    const baseline = expectedByUnitId.get(unit.learningUnitId)
    return {
      domain: unit.domain,
      seconds: calculateContentBaselineSeconds(baseline),
    }
  })
assert(
  firstDay.length === 3 &&
    firstDay.every((entry) => entry.seconds !== 900) &&
    new Set(firstDay.map((entry) => entry.seconds)).size === 3,
  'First-day baselines remain a mechanical 900-second equal split.',
)

const durationTotals = Object.fromEntries(
  Object.entries(secondsByDomain).map(([domain, values]) => [
    domain,
    values.reduce((total, seconds) => total + seconds, 0),
  ]),
)
durationTotals.allUnits = Object.values(durationTotals).reduce(
  (total, seconds) => total + seconds,
  0,
)

assert(
  packageIndex.durationBaselinePolicyFile === rulesPath,
  'Package index does not expose the authoring rules file.',
)
assert(
  deepEqual(packageIndex.durationBaselineTotals, {
    learningUnits: 84,
    vocabularySeconds: durationTotals.vocabulary,
    listeningSeconds: durationTotals.listening,
    speakingSeconds: durationTotals.speaking,
    allUnitsSeconds: durationTotals.allUnits,
  }),
  'Package index duration baseline totals have drifted.',
)
assert(
  packageIndex.learningCandidateProjection.staticFields.includes(
    'durationBaseline',
  ),
  'Package projection does not declare durationBaseline.',
)

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      rulesVersion: rules.rulesVersion,
      lessonFiles: lessonDocuments.length,
      lessons: lessons.length,
      learningUnits: observedBaselines.length,
      listeningExtensionLessons: extensionByContentRef.size,
      ranges: Object.fromEntries(
        Object.entries(secondsByDomain).map(([domain, values]) => [
          domain,
          {
            minimum: Math.min(...values),
            maximum: Math.max(...values),
            distinct: new Set(values).size,
          },
        ]),
      ),
      firstDay,
      totals: durationTotals,
    },
    null,
    2,
  ),
)
