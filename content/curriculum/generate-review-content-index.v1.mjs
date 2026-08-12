import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const writeMode = process.argv.includes('--write')
const supplyPath = 'content/curriculum/training-supply-index.v1.json'
const sceneIndexPath = 'content/curriculum/scene-vocabulary-question-bank-index.v1.json'
const outputPath = 'content/curriculum/review-content-index.v1.json'

const absolute = (relative) => path.join(root, relative)
const readJson = (relative) => JSON.parse(fs.readFileSync(absolute(relative), 'utf8'))
const assert = (condition, message) => { if (!condition) throw new Error(message) }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}

function fingerprint(value) {
  const text = JSON.stringify(canonical(value))
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `review-content-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/** IDs locate a released source; they are not scored content.  Removing them
 * here is what permits byte-for-byte equivalent questions from later banks to
 * share one wrong-answer identity without allowing a target word alone to do
 * so.  Text, choices, answers, audio text/locale and every interaction field
 * remain in the fingerprint. */
function scoredContent(value) {
  if (Array.isArray(value)) return value.map(scoredContent)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => ![
      'id',
      'exerciseId',
      'segmentId',
      'sourceId',
      'baseContentRef',
      'learningUnitId',
      // R16 feedback copy is not part of the scored English answer. Keeping it
      // out prevents a translation-only correction from invalidating an
      // existing wrong-answer identity.
      'modelAnswerTranslationZh',
    ].includes(key))
    .map(([key, child]) => [key, scoredContent(child)]))
}

function sourceMaps() {
  const packageIndex = readJson('content/curriculum/package-index.v1.json')
  const lessons = packageIndex.lessonFiles.flatMap((file) => readJson(file).lessons)
  const vocabulary = new Map()
  const listeningExtension = new Map()
  const listeningCore = new Map()
  const listeningQuiz = new Map()
  const speakingPrompt = new Map()
  const speakingQuiz = new Map()
  for (const lesson of lessons) {
    const units = Object.fromEntries(lesson.learningUnits.map((unit) => [unit.domain, unit]))
    for (const item of units.vocabulary.activity.items) vocabulary.set(item.id, item)
    for (const check of units.listening.activity.checks) listeningCore.set(check.id, { check, transcript: units.listening.activity.transcript })
    for (const prompt of units.speaking.activity.prompts) speakingPrompt.set(prompt.id, prompt)
    for (const quiz of lesson.sceneQuiz) {
      if (quiz.domain === 'listening') listeningQuiz.set(quiz.id, quiz)
      if (quiz.domain === 'speaking') speakingQuiz.set(quiz.id, quiz)
    }
  }
  const extensionIndex = readJson('content/curriculum/listening-exercise-extension-index.v1.json')
  for (const file of extensionIndex.exerciseBundleFiles) {
    for (const lesson of readJson(file).lessons) for (const exercise of lesson.exercises) listeningExtension.set(exercise.exerciseId, exercise)
  }
  const sceneIndex = readJson(sceneIndexPath)
  const sceneBank = readJson(sceneIndex.questionBankFile)
  const sceneVocabulary = new Map(sceneBank.scenes.flatMap((scene) => scene.questions.map((question) => [question.questionId, { sceneId: scene.sceneId, categoryId: scene.categoryId, question }])))
  return { vocabulary, listeningExtension, listeningCore, listeningQuiz, speakingPrompt, speakingQuiz, sceneVocabulary, sceneIndex, sceneBank }
}

function dailyEntry(candidate, maps) {
  const source = candidate.source
  let originalQuestionType
  let scored
  if (source.sourceType === 'vocabulary-item') {
    const item = maps.vocabulary.get(source.sourceId)
    assert(item, `${candidate.itemId} refers to missing vocabulary item ${source.sourceId}`)
    const distractors = source.distractorItemIds.map((id) => maps.vocabulary.get(id))
    assert(distractors.every(Boolean), `${candidate.itemId} has a missing vocabulary distractor`)
    originalQuestionType = `vocabulary-${source.variantId}`
    scored = { variantId: source.variantId, item, distractors }
  } else if (source.sourceType === 'listening-extension') {
    const exercise = maps.listeningExtension.get(source.sourceId)
    assert(exercise, `${candidate.itemId} refers to missing listening exercise ${source.sourceId}`)
    originalQuestionType = `listening-${source.variantId}`
    scored = exercise
  } else if (source.sourceType === 'listening-core-check') {
    const value = maps.listeningCore.get(source.sourceId)
    assert(value, `${candidate.itemId} refers to missing listening check ${source.sourceId}`)
    originalQuestionType = 'listening-full-transcript-detail-choice'
    scored = value
  } else if (source.sourceType === 'listening-scene-quiz') {
    const quiz = maps.listeningQuiz.get(source.sourceId)
    assert(quiz, `${candidate.itemId} refers to missing listening scene quiz ${source.sourceId}`)
    originalQuestionType = 'listening-scene-audio-single-choice'
    scored = quiz
  } else if (source.sourceType === 'speaking-prompt') {
    const prompt = maps.speakingPrompt.get(source.sourceId)
    assert(prompt, `${candidate.itemId} refers to missing speaking prompt ${source.sourceId}`)
    originalQuestionType = 'speaking-activity-prompt'
    // Preserve accepted answers verbatim: match/close/partial/different is a
    // module rule, not a new pronunciation score invented by this index.
    scored = prompt
  } else if (source.sourceType === 'speaking-scene-quiz') {
    const quiz = maps.speakingQuiz.get(source.sourceId)
    assert(quiz, `${candidate.itemId} refers to missing speaking scene quiz ${source.sourceId}`)
    originalQuestionType = 'speaking-scene-fixed-response'
    scored = quiz
  } else throw new Error(`${candidate.itemId} has unsupported source type ${source.sourceType}`)
  const canonicalPayload = { originalQuestionType, scored: scoredContent(scored) }
  return {
    reviewContentId: fingerprint(canonicalPayload),
    canonicalPayload,
    originalQuestionType,
    domain: candidate.domain,
    source: { kind: 'daily-supply', itemId: candidate.itemId, sourceType: source.sourceType, sourceId: source.sourceId, variantId: source.variantId, contentRef: candidate.contentRef },
  }
}

function sceneEntry(questionId, maps) {
  const value = maps.sceneVocabulary.get(questionId)
  assert(value, `Missing scene vocabulary question ${questionId}`)
  const originalQuestionType = 'scene-vocabulary-meaning-choice'
  const canonicalPayload = { originalQuestionType, interaction: maps.sceneBank.interaction, question: scoredContent(value.question) }
  return {
    reviewContentId: fingerprint(canonicalPayload),
    canonicalPayload,
    originalQuestionType,
    domain: 'vocabulary',
    source: { kind: 'scene-vocabulary-bank', bankId: maps.sceneBank.bankId, contentVersion: maps.sceneBank.contentVersion, questionId, categoryId: value.categoryId, sceneId: value.sceneId },
  }
}

function expectedIndex() {
  const maps = sourceMaps()
  const supply = readJson(supplyPath)
  const packageIndex = readJson('content/curriculum/package-index.v1.json')
  assert(packageIndex.reviewContentIndexFile === outputPath, 'Package index does not publish the review-content index.')
  assert(packageIndex.reviewContentIndexSchemaFile === 'content/curriculum/review-content-index.schema.v1.json', 'Package index does not publish the review-content schema.')
  assert(
    supply.totals.allCandidates === supply.candidates.length && supply.candidates.length >= 864,
    'Released daily candidate totals are invalid.',
  )
  assert(maps.sceneIndex.coverage.questionCount === 612 && maps.sceneVocabulary.size === 612, 'R13-D requires exactly 612 released scene questions.')
  const entries = [
    ...supply.candidates.map((candidate) => dailyEntry(candidate, maps)),
    ...[...maps.sceneVocabulary.keys()].sort().map((questionId) => sceneEntry(questionId, maps)),
  ]
  const aliases = {}
  const identities = {}
  const fingerprintPayloads = new Map()
  for (const entry of entries) {
    const alias = entry.source.kind === 'daily-supply' ? `daily:${entry.source.itemId}` : `scene:${entry.source.bankId}@${entry.source.contentVersion}:${entry.source.questionId}`
    assert(!aliases[alias], `Duplicate review alias ${alias}`)
    aliases[alias] = { reviewContentId: entry.reviewContentId, originalQuestionType: entry.originalQuestionType, domain: entry.domain, source: entry.source }
    const key = `${entry.reviewContentId}::${entry.originalQuestionType}`
    // A 32-bit hash collision must fail the release rather than silently
    // merging two questions.  The fingerprint is only an opaque stable ID,
    // never a permission to weaken content equivalence.
    const payload = JSON.stringify(canonical(entry.canonicalPayload))
    const existingPayload = fingerprintPayloads.get(key)
    if (existingPayload !== undefined) assert(existingPayload === payload, `Review content hash collision for ${key}`)
    else fingerprintPayloads.set(key, payload)
    const prior = identities[key]
    if (prior) prior.aliases.push(alias)
    else identities[key] = { reviewContentId: entry.reviewContentId, originalQuestionType: entry.originalQuestionType, domain: entry.domain, aliases: [alias] }
  }
  const byDomainQuestionType = {}
  for (const value of Object.values(aliases)) {
    const key = `${value.domain}:${value.originalQuestionType}`
    byDomainQuestionType[key] = (byDomainQuestionType[key] ?? 0) + 1
  }
  const shared = Object.values(identities).filter((identity) => identity.aliases.length > 1).length
  return {
    schemaVersion: 1,
    documentType: 'review-content-index',
    contentVersion: '1.0.0',
    identityVersion: 'review-content-v1-fnv1a32',
    sources: {
      dailySupply: { file: supplyPath, supplyVersion: supply.supplyVersion, candidateCount: supply.candidates.length },
      sceneVocabulary: { indexFile: sceneIndexPath, bankId: maps.sceneBank.bankId, contentVersion: maps.sceneBank.contentVersion, questionCount: maps.sceneVocabulary.size },
    },
    canonicalization: {
      algorithm: 'canonical-json-sorted-keys + FNV-1a-32',
      identityInput: 'originalQuestionType plus complete scored content; source IDs, item IDs, playbackContentId and variantFamilyId are excluded',
      listening: 'The scored question is primary; audio source text and required playback fields are included when present. playbackContentId alone is never an identity.',
      speaking: 'Prompt/quiz fields including modelAnswer and acceptedAnswers are preserved; this does not define pronunciation scoring.',
    },
    totals: { dailyAliases: supply.candidates.length, sceneAliases: maps.sceneVocabulary.size, allAliases: entries.length, uniqueCanonicalContents: Object.keys(identities).length, crossSourceSharedCanonicalContents: shared, byDomainQuestionType },
    aliases,
    identities,
  }
}

const expected = expectedIndex()
if (writeMode) fs.writeFileSync(absolute(outputPath), `${JSON.stringify(expected, null, 2)}\n`)
else {
  const actual = readJson(outputPath)
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${outputPath} has drifted; run node ${path.relative(root, fileURLToPath(import.meta.url))} --write`)
}
console.log(`review-content index valid: ${expected.totals.allAliases} aliases, ${expected.totals.uniqueCanonicalContents} canonical contents, ${expected.totals.crossSourceSharedCanonicalContents} shared`)
