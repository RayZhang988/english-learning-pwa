import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const writeMode = process.argv.includes('--write')
const outputPath = 'content/curriculum/r17-knowledge-capacity-audit.v2.json'
const packageIndexPath = 'content/curriculum/package-index.v1.json'
const sceneIndexPath = 'content/curriculum/scene-vocabulary-question-bank-index.v1.json'
const DAILY_TARGET = 3000
const SCENE_TARGET = 3300
const coreSceneIds = new Set([
  'airport',
  'public-transport',
  'hotel',
  'restaurant',
  'shopping',
  'medical-pharmacy',
])

const levels = [
  ['kindergarten', '幼儿园', 0, 0.5], ['primary-1', '一年级', 0.5, 1],
  ['primary-2', '二年级', 1, 1.5], ['primary-3', '三年级', 1.5, 2],
  ['primary-4', '四年级', 2, 2.5], ['primary-5', '五年级', 2.5, 3],
  ['primary-6', '六年级', 3, 3.5], ['junior-1', '初一', 3.5, 4],
  ['junior-2', '初二', 4, 4.5], ['junior-3', '初三', 4.5, 5],
  ['senior-1', '高一', 5, 5.5], ['senior-2', '高二', 5.5, 6],
  ['senior-3', '高三', 6, 7], ['cet-4-reference', '大学四级', 7, 8],
  ['cet-6-reference', '大学六级', 8, null],
].map(([id, labelZh, minimumDifficulty, maximumDifficultyExclusive], ordinal) => ({
  ordinal, id, labelZh, minimumDifficulty, maximumDifficultyExclusive,
}))

function read(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
}

function fail(message) {
  throw new Error(`R17 unified knowledge audit: ${message}`)
}

function normalizedEnglish(value) {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
}

function normalizedChinese(value) {
  return value.trim().replace(/\s+/g, '')
}

function lexicalKind(english) {
  return normalizedEnglish(english).includes(' ') ? 'phrase' : 'word'
}

function fingerprint(value) {
  let hash = 0x811c9dc5
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function identityId(namespace, { english, meaningZh }) {
  const form = normalizedEnglish(english)
  const sense = normalizedChinese(meaningZh)
  return `${namespace}:${lexicalKind(english)}:${fingerprint(`${form}|${sense}`)}`
}

function levelFor(difficulty) {
  const level = levels.find((candidate) =>
    difficulty >= candidate.minimumDifficulty &&
    (candidate.maximumDifficultyExclusive === null || difficulty < candidate.maximumDifficultyExclusive),
  )
  if (!level) fail(`difficulty ${difficulty} cannot map to a level`)
  return level
}

const packageIndex = read(packageIndexPath)
const lessons = packageIndex.lessonFiles.flatMap((file) => read(file).lessons)
const vocabularyItems = lessons.flatMap((lesson) => {
  const unit = lesson.learningUnits.find((candidate) => candidate.domain === 'vocabulary')
  if (!unit) fail(`${lesson.lessonId} has no vocabulary unit`)
  return unit.activity.items.map((item) => ({ ...item, unit }))
})
const sceneIndex = read(sceneIndexPath)
const sceneBank = read(sceneIndex.questionBankFile)
const sceneQuestions = sceneBank.scenes.flatMap((scene) =>
  scene.questions.map((question) => ({ ...question, sceneId: scene.sceneId, categoryId: scene.categoryId })),
)

if (vocabularyItems.length !== 1152) fail(`expected 1152 daily vocabulary sources after primary-5 6A, got ${vocabularyItems.length}`)
if (sceneQuestions.length !== 612) fail(`expected 612 current scene questions, got ${sceneQuestions.length}`)
if (sceneBank.scenes.length !== 18) fail(`expected 18 scenes, got ${sceneBank.scenes.length}`)

const sceneByForm = new Map()
for (const question of sceneQuestions) {
  const form = normalizedEnglish(question.targetText)
  const values = sceneByForm.get(form) ?? []
  values.push(question)
  sceneByForm.set(form, values)
}

const ambiguousSceneForms = [...sceneByForm.entries()]
  .filter(([, questions]) => new Set(questions.map((question) => normalizedChinese(question.correctMeaningZh))).size > 1)
  .map(([normalizedForm, questions]) => ({
    normalizedForm,
    meaningsZh: [...new Set(questions.map((question) => question.correctMeaningZh))].sort(),
    questionIds: questions.map((question) => question.questionId).sort(),
    treatment: 'split-by-sense',
  }))
  .sort((left, right) => left.normalizedForm.localeCompare(right.normalizedForm))

const sceneQuestionMappings = sceneQuestions
  .map((question) => ({
    questionId: question.questionId,
    sceneId: question.sceneId,
    sourceId: question.source.sourceId,
    lexicalKind: lexicalKind(question.targetText),
    lexicalForm: normalizedEnglish(question.targetText),
    meaningZh: question.correctMeaningZh,
    sceneKnowledgeId: identityId('scene-knowledge-v1', { english: question.targetText, meaningZh: question.correctMeaningZh }),
  }))
  .sort((left, right) => left.questionId.localeCompare(right.questionId))
const sceneIndependentKnowledgeCount = new Set(sceneQuestionMappings.map((row) => row.sceneKnowledgeId)).size

const dailyMappings = vocabularyItems
  .map((item) => ({
    sourceItemId: item.id,
    lexicalKind: lexicalKind(item.term),
    lexicalForm: normalizedEnglish(item.term),
    meaningZh: item.meaningZh,
    dailyKnowledgeId: identityId('daily-knowledge-v1', { english: item.term, meaningZh: item.meaningZh }),
    difficultyLevel: item.growthDifficultyLevel ?? item.unit.difficultyLevel,
    levelId: levelFor(item.growthDifficultyLevel ?? item.unit.difficultyLevel).id,
  }))
  .sort((left, right) => left.sourceItemId.localeCompare(right.sourceItemId))
const dailyCanonicalMappings = [...dailyMappings]
  .sort((left, right) =>
    left.difficultyLevel - right.difficultyLevel || left.sourceItemId.localeCompare(right.sourceItemId),
  )
  .filter((row, index, rows) =>
    rows.findIndex((candidate) => candidate.dailyKnowledgeId === row.dailyKnowledgeId) === index,
  )
const dailyForms = new Set(dailyMappings.map((row) => row.lexicalForm))
const sceneForms = new Set(sceneQuestionMappings.map((row) => row.lexicalForm))
const overlapForms = [...dailyForms].filter((form) => sceneForms.has(form)).sort()

const levelCapacity = levels.map((level) => {
  const current = dailyCanonicalMappings.filter((row) => row.levelId === level.id)
  const target = Math.floor(DAILY_TARGET / levels.length)
  return {
    ...level,
    currentDailyKnowledgePoints: new Set(current.map((row) => row.dailyKnowledgeId)).size,
    targetDailyKnowledgePoints: target,
    missingDailyKnowledgePoints: Math.max(0, target - new Set(current.map((row) => row.dailyKnowledgeId)).size),
  }
})

const sceneCapacityRows = sceneBank.scenes.map((scene) => {
  const targetRecordCount = coreSceneIds.has(scene.sceneId) ? 250 : 150
  const currentRecordCount = scene.questions.length
  const currentCanonicalKnowledgeCount = new Set(
    sceneQuestionMappings.filter((row) => row.sceneId === scene.sceneId).map((row) => row.sceneKnowledgeId),
  ).size
  return {
    sceneId: scene.sceneId,
    titleZh: scene.titleZh,
    categoryId: scene.categoryId,
    tier: coreSceneIds.has(scene.sceneId) ? 'core-250' : 'standard-150',
    currentRecordCount,
    currentIndependentKnowledgeCount: currentCanonicalKnowledgeCount,
    targetRecordCount,
    missingRecordCount: targetRecordCount - currentRecordCount,
  }
})

const audit = {
  schemaVersion: 2,
  documentType: 'r17-independent-content-capacity-audit',
  auditVersion: '2.0.0',
  source: { packageIndexPath, sceneIndexPath, dailyVocabularySourceCount: vocabularyItems.length, sceneQuestionCount: sceneQuestions.length },
  identityBoundary: {
    dailyIdentityVersion: 'daily-knowledge-v1',
    sceneIdentityVersion: 'scene-knowledge-v1',
    rule: 'Daily vocabulary and scene vocabulary are fully independent content spaces. They use distinct identity namespaces, separate progress, scores and mastery evidence. The same text is permitted in both spaces but never creates a shared reference.',
    sharedProgressOrMastery: false,
    sceneParticipatesInR17Growth: false,
    lexicalOverlapCreatesReference: false,
    wrongAnswerHandling: 'The unified wrong-answer library may retain a source label for traceability only; it does not merge content identities or mastery.',
    lexicalNormalization: 'lowercase en-US; punctuation and whitespace collapsed',
    phraseRule: 'A normalized English value containing a space is a phrase; otherwise it is a word.',
    homographRule: 'Same normalized English form with different Chinese senses is split within its own namespace. Across namespaces, matching text or sense remains independent.',
    migrationRule: 'Existing daily term+meaningZh and scene targetText+correctMeaningZh are mapped independently. Lexical overlap is reported only as a content-planning statistic.',
  },
  capacityTargets: {
    dailyKnowledgePoints: DAILY_TARGET,
    sceneVocabularyRecords: SCENE_TARGET,
    coreSceneRecordTarget: 250,
    standardSceneRecordTarget: 150,
    planningRule: 'Daily and scene targets are independently counted. Textual overlap does not reduce either target or create a shared identity.',
  },
  r17Scope: {
    includedDomains: ['daily-vocabulary', 'daily-listening', 'daily-speaking'],
    excluded: ['all scene-training records', 'scene progress', 'scene scores', 'scene mastery evidence'],
    rule: 'Only daily vocabulary capacity is calculated by this audit. Listening and speaking remain in R17 scope but are not expanded by this vocabulary capacity batch.',
  },
  current: {
    dailyKnowledgePointCount: dailyCanonicalMappings.length,
    dailyLexicalFormCount: dailyForms.size,
    sceneQuestionCount: sceneQuestions.length,
    sceneLexicalFormCount: sceneForms.size,
    sceneIndependentKnowledgeCount,
    sceneAmbiguousLexicalFormCount: ambiguousSceneForms.length,
    dailySourceRecordsIntersectingSceneLexicalForms: dailyMappings.filter((row) => sceneForms.has(row.lexicalForm)).length,
    dailySceneLexicalFormIntersectionCount: overlapForms.length,
    dailySceneLexicalFormIntersection: overlapForms,
  },
  sceneCapacity: {
    coreSceneIds: [...coreSceneIds].sort(),
    coreSceneCount: sceneCapacityRows.filter((row) => row.tier === 'core-250').length,
    standardSceneCount: sceneCapacityRows.filter((row) => row.tier === 'standard-150').length,
    targetRecordCount: SCENE_TARGET,
    currentRecordCount: sceneQuestions.length,
    missingRecordCount: SCENE_TARGET - sceneQuestions.length,
    scenes: sceneCapacityRows,
  },
  levelCapacity: {
    mappingVersion: 'r17-growth-difficulty-to-level-v1',
    allocation: 'Equal planning target of 200 daily knowledge points per user-facing level; actual production batches may rebalance only with a new mapping version.',
    levels: levelCapacity,
  },
  sceneQuestionMappings,
  ambiguousSceneForms,
  dailySourceMappings: dailyMappings,
  batchPlan: {
    batches: [
      { id: 'daily-vocabulary-foundation', scope: 'daily vocabulary', targetRecords: 600, acceptance: 'daily identity, travel relevance and 15-level mapping validated before each batch' },
      { id: 'daily-vocabulary-growth', scope: 'daily vocabulary', targetRecords: 1200, acceptance: 'same as foundation; no duplicate daily identity' },
      { id: 'daily-vocabulary-advanced-travel', scope: 'daily vocabulary', targetRecords: 1200, acceptance: 'risk handling, complex travel communication and advanced travel administration remain non-academic' },
      { id: 'scene-core-six', scope: 'airport/public transport/hotel/restaurant/shopping/medical-pharmacy', targetRecords: 1500, acceptance: '250 records per core scene; identities and progress remain scene-only' },
      { id: 'scene-standard-twelve', scope: 'remaining 12 travel scenes', targetRecords: 1800, acceptance: '150 records per scene; scene progress remains independent' },
    ],
    sequencing: 'Audit each batch before content generation; never use scene capacity to satisfy daily R17 capacity, or vice versa.',
  },
  gates: {
    travelRelevance: 'Every new word or practical phrase must be usable in travel, transit, accommodation, food, shopping, connectivity, safety, medical or travel administration.',
    homographSafety: 'Same normalized English form with different Chinese senses must be flagged and split within its own namespace.',
    noArtificialInflation: 'Inflection, capitalization, punctuation, spelling variants and alternate question surfaces do not count as a new knowledge point.',
  },
}

const serialized = `${JSON.stringify(audit, null, 2)}\n`
const absoluteOutput = path.join(root, outputPath)
if (writeMode) fs.writeFileSync(absoluteOutput, serialized)
else if (fs.readFileSync(absoluteOutput, 'utf8') !== serialized) fail(`${outputPath} is stale; run node ${fileURLToPath(import.meta.url)} --write`)

console.log(`R17 independent-content audit verified: ${audit.current.dailyKnowledgePointCount} daily points; ${audit.current.sceneQuestionCount} scene records; ${audit.current.sceneLexicalFormCount} scene lexical forms; ${audit.current.sceneIndependentKnowledgeCount} independent scene points`)
