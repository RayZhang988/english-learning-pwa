import type { LearningTask } from '../../learning-engine/index.ts'
import { VocabularyError } from './errors.ts'
import type {
  VocabularyCatalog,
  VocabularyContentDocuments,
  VocabularyIntentMatchingQuiz,
  VocabularyItem,
  VocabularySceneQuiz,
  VocabularySingleChoiceQuiz,
  VocabularyTrainingUnit,
} from './types.ts'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new VocabularyError(
      'content-invalid',
      `${label} must be an object.`,
    )
  }
  return value
}

function requireString(record: UnknownRecord, key: string, label: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new VocabularyError(
      'content-invalid',
      `${label}.${key} must be a non-empty string.`,
    )
  }
  return value
}

function requireNumber(record: UnknownRecord, key: string, label: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new VocabularyError(
      'content-invalid',
      `${label}.${key} must be a finite number.`,
    )
  }
  return value
}

function requireArray(record: UnknownRecord, key: string, label: string): unknown[] {
  const value = record[key]
  if (!Array.isArray(value)) {
    throw new VocabularyError(
      'content-invalid',
      `${label}.${key} must be an array.`,
    )
  }
  return value
}

function requireStringArray(
  record: UnknownRecord,
  key: string,
  label: string,
): readonly string[] {
  const value = requireArray(record, key, label)
  if (value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new VocabularyError(
      'content-invalid',
      `${label}.${key} must contain only non-empty strings.`,
    )
  }
  return value as readonly string[]
}

function assertVersionedDocument(
  document: UnknownRecord,
  documentType: string,
  label: string,
): void {
  if (document.schemaVersion !== 1) {
    throw new VocabularyError(
      'content-version-unsupported',
      `${label} uses an unsupported schemaVersion.`,
    )
  }
  if (document.documentType !== documentType) {
    throw new VocabularyError(
      'content-invalid',
      `${label} must be a ${documentType} document.`,
    )
  }
  if (document.packageVersion !== '1.0.0') {
    throw new VocabularyError(
      'content-version-unsupported',
      `${label} uses an unsupported packageVersion.`,
    )
  }
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function parseItem(value: unknown, label: string): VocabularyItem {
  const item = requireRecord(value, label)
  return {
    id: requireString(item, 'id', label),
    term: requireString(item, 'term', label),
    partOfSpeech: requireString(item, 'partOfSpeech', label),
    meaningZh: requireString(item, 'meaningZh', label),
    exampleEn: requireString(item, 'exampleEn', label),
    exampleZh: requireString(item, 'exampleZh', label),
  }
}

function parseSingleChoiceQuiz(
  quiz: UnknownRecord,
  label: string,
): VocabularySingleChoiceQuiz {
  const options = requireStringArray(quiz, 'options', label)
  const correctOptionIndex = requireNumber(
    quiz,
    'correctOptionIndex',
    label,
  )
  if (
    !Number.isInteger(correctOptionIndex) ||
    correctOptionIndex < 0 ||
    correctOptionIndex >= options.length
  ) {
    throw new VocabularyError(
      'content-invalid',
      `${label}.correctOptionIndex is outside the option range.`,
    )
  }
  return {
    id: requireString(quiz, 'id', label),
    format: 'single-choice',
    promptZh: requireString(quiz, 'promptZh', label),
    options,
    correctOptionIndex,
    rationaleZh: requireString(quiz, 'rationaleZh', label),
  }
}

function parseIntentMatchingQuiz(
  quiz: UnknownRecord,
  label: string,
): VocabularyIntentMatchingQuiz {
  const pairs = requireArray(quiz, 'pairs', label).map((value, index) => {
    const pair = requireRecord(value, `${label}.pairs[${index}]`)
    return {
      intentZh: requireString(
        pair,
        'intentZh',
        `${label}.pairs[${index}]`,
      ),
      answer: requireString(
        pair,
        'answer',
        `${label}.pairs[${index}]`,
      ),
    }
  })
  if (pairs.length < 2) {
    throw new VocabularyError(
      'content-invalid',
      `${label}.pairs must contain at least two entries.`,
    )
  }
  return {
    id: requireString(quiz, 'id', label),
    format: 'intent-matching',
    promptZh: requireString(quiz, 'promptZh', label),
    pairs,
    rationaleZh: requireString(quiz, 'rationaleZh', label),
  }
}

function parseSceneQuiz(value: unknown, label: string): VocabularySceneQuiz {
  const quiz = requireRecord(value, label)
  if (quiz.domain !== 'vocabulary') {
    throw new VocabularyError(
      'content-invalid',
      `${label}.domain must be vocabulary.`,
    )
  }
  if (quiz.format === 'single-choice') {
    return parseSingleChoiceQuiz(quiz, label)
  }
  if (quiz.format === 'intent-matching') {
    return parseIntentMatchingQuiz(quiz, label)
  }
  throw new VocabularyError(
    'activity-unsupported',
    `${label} uses unsupported vocabulary quiz format ${String(quiz.format)}.`,
  )
}

function parseTrainingUnit(
  value: unknown,
  sceneQuiz: VocabularySceneQuiz,
  itemRegistry: ReadonlyMap<string, VocabularyItem>,
  label: string,
): VocabularyTrainingUnit {
  const unit = requireRecord(value, label)
  if (unit.domain !== 'vocabulary') {
    throw new VocabularyError(
      'content-invalid',
      `${label}.domain must be vocabulary.`,
    )
  }
  const difficultyLevel = requireNumber(unit, 'difficultyLevel', label)
  const estimatedSeconds = requireNumber(unit, 'estimatedSeconds', label)
  if (
    difficultyLevel < 0 ||
    difficultyLevel > 12 ||
    !Number.isInteger(estimatedSeconds) ||
    estimatedSeconds <= 0
  ) {
    throw new VocabularyError(
      'content-invalid',
      `${label} has invalid difficulty or duration.`,
    )
  }

  const activity = requireRecord(unit.activity, `${label}.activity`)
  if (
    activity.type !== 'vocabulary-set' &&
    activity.type !== 'vocabulary-review'
  ) {
    throw new VocabularyError(
      'activity-unsupported',
      `${label} uses unsupported activity type ${String(activity.type)}.`,
    )
  }
  const items = requireArray(activity, 'items', `${label}.activity`).map(
    (item, index) => parseItem(item, `${label}.activity.items[${index}]`),
  )
  const reviewItems =
    activity.type === 'vocabulary-review'
      ? requireStringArray(
          activity,
          'reviewItemIds',
          `${label}.activity`,
        ).map((itemId) => {
          const item = itemRegistry.get(itemId)
          if (!item) {
            throw new VocabularyError(
              'content-reference-missing',
              `${label} references unavailable earlier item ${itemId}.`,
            )
          }
          return item
        })
      : []

  return {
    learningUnitId: requireString(unit, 'learningUnitId', label),
    contentRef: requireString(unit, 'contentRef', label),
    difficultyLevel,
    estimatedSeconds,
    tags: requireStringArray(unit, 'tags', label),
    activityType: activity.type,
    instructionsZh: requireString(
      activity,
      'instructionsZh',
      `${label}.activity`,
    ),
    items,
    reviewItems,
    sceneQuiz,
  }
}

export function createVocabularyCatalog(
  documents: VocabularyContentDocuments,
): VocabularyCatalog {
  const packageIndex = requireRecord(
    documents.packageIndex,
    'packageIndex',
  )
  assertVersionedDocument(
    packageIndex,
    'content-package-index',
    'packageIndex',
  )
  const courseId = requireString(packageIndex, 'courseId', 'packageIndex')
  const manifestFile = requireString(
    packageIndex,
    'manifestFile',
    'packageIndex',
  )
  const lessonFiles = requireStringArray(
    packageIndex,
    'lessonFiles',
    'packageIndex',
  )

  const manifest = requireRecord(documents.manifest, 'manifest')
  assertVersionedDocument(
    manifest,
    'curriculum-manifest',
    'manifest',
  )
  if (
    manifestFile.length === 0 ||
    requireString(manifest, 'courseId', 'manifest') !== courseId ||
    !sameStrings(
      requireStringArray(manifest, 'lessonFiles', 'manifest'),
      lessonFiles,
    )
  ) {
    throw new VocabularyError(
      'content-invalid',
      'Package index and curriculum manifest do not describe the same course.',
    )
  }

  const itemRegistry = new Map<string, VocabularyItem>()
  const unitIds = new Set<string>()
  const contentRefs = new Set<string>()
  const units: VocabularyTrainingUnit[] = []

  lessonFiles.forEach((lessonFile, fileIndex) => {
    const rawLessonDocument = documents.lessonsByPath[lessonFile]
    if (rawLessonDocument === undefined) {
      throw new VocabularyError(
        'content-reference-missing',
        `Package lesson file is missing: ${lessonFile}`,
      )
    }
    const lessonDocument = requireRecord(
      rawLessonDocument,
      `lessonFiles[${fileIndex}]`,
    )
    assertVersionedDocument(
      lessonDocument,
      'lesson-week',
      `lessonFiles[${fileIndex}]`,
    )
    if (requireString(lessonDocument, 'courseId', lessonFile) !== courseId) {
      throw new VocabularyError(
        'content-invalid',
        `${lessonFile} belongs to a different course.`,
      )
    }

    requireArray(lessonDocument, 'lessons', lessonFile).forEach(
      (rawLesson, lessonIndex) => {
        const lessonLabel = `${lessonFile}.lessons[${lessonIndex}]`
        const lesson = requireRecord(rawLesson, lessonLabel)
        const vocabularyUnits = requireArray(
          lesson,
          'learningUnits',
          lessonLabel,
        ).filter(
          (value) => isRecord(value) && value.domain === 'vocabulary',
        )
        const vocabularyQuizzes = requireArray(
          lesson,
          'sceneQuiz',
          lessonLabel,
        ).filter(
          (value) => isRecord(value) && value.domain === 'vocabulary',
        )

        if (vocabularyUnits.length !== 1 || vocabularyQuizzes.length !== 1) {
          throw new VocabularyError(
            'content-invalid',
            `${lessonLabel} must contain one vocabulary unit and quiz.`,
          )
        }

        const sceneQuiz = parseSceneQuiz(
          vocabularyQuizzes[0],
          `${lessonLabel}.sceneQuiz[vocabulary]`,
        )
        const unit = parseTrainingUnit(
          vocabularyUnits[0],
          sceneQuiz,
          itemRegistry,
          `${lessonLabel}.learningUnits[vocabulary]`,
        )
        if (
          unitIds.has(unit.learningUnitId) ||
          contentRefs.has(unit.contentRef)
        ) {
          throw new VocabularyError(
            'content-invalid',
            `Duplicate vocabulary unit identity: ${unit.learningUnitId}`,
          )
        }
        for (const item of unit.items) {
          if (itemRegistry.has(item.id)) {
            throw new VocabularyError(
              'content-invalid',
              `Duplicate vocabulary item identity: ${item.id}`,
            )
          }
          itemRegistry.set(item.id, item)
        }
        unitIds.add(unit.learningUnitId)
        contentRefs.add(unit.contentRef)
        units.push(unit)
      },
    )
  })

  const expectedVocabularyUnits = isRecord(packageIndex.totals)
    ? packageIndex.totals.vocabularyUnits
    : undefined
  if (
    typeof expectedVocabularyUnits !== 'number' ||
    units.length !== expectedVocabularyUnits
  ) {
    throw new VocabularyError(
      'content-invalid',
      'Parsed vocabulary unit count does not match the package index.',
    )
  }

  const unitMap = new Map(units.map((unit) => [unit.contentRef, unit]))
  return {
    schemaVersion: 1,
    packageVersion: '1.0.0',
    courseId,
    units,
    getUnit(contentRef) {
      return unitMap.get(contentRef)
    },
  }
}

export function resolveVocabularyTask(
  catalog: VocabularyCatalog,
  task: LearningTask,
): VocabularyTrainingUnit {
  if (
    task.schemaVersion !== 1 ||
    task.domain !== 'vocabulary' ||
    task.targetModuleId !== 'vocabulary'
  ) {
    throw new VocabularyError(
      'task-incompatible',
      'The learning task is not a vocabulary v1 task.',
    )
  }
  const unit = catalog.getUnit(task.contentRef)
  if (!unit) {
    throw new VocabularyError(
      'content-reference-missing',
      `Vocabulary contentRef cannot be resolved: ${task.contentRef}`,
    )
  }
  if (
    task.learningUnitId !== unit.learningUnitId ||
    task.difficultyLevel !== unit.difficultyLevel ||
    task.estimatedSeconds !== unit.estimatedSeconds ||
    !sameStrings(task.tags, unit.tags)
  ) {
    throw new VocabularyError(
      'task-incompatible',
      `Learning task ${task.taskId} does not match its course unit.`,
    )
  }
  return unit
}
