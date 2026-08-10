import type { LearningTask } from '../../learning-engine/index.ts'
import { SpeakingError } from './errors.ts'
import type {
  SpeakingActivityType,
  SpeakingCatalog,
  SpeakingContentDocuments,
  SpeakingPrompt,
  SpeakingTrainingUnit,
} from './types.ts'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function record(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new SpeakingError(
      'content-invalid',
      `${label} must be an object.`,
    )
  }
  return value
}

function stringValue(
  value: UnknownRecord,
  key: string,
  label: string,
): string {
  const result = value[key]
  if (typeof result !== 'string' || result.trim().length === 0) {
    throw new SpeakingError(
      'content-invalid',
      `${label}.${key} must be a non-empty string.`,
    )
  }
  return result
}

function numberValue(
  value: UnknownRecord,
  key: string,
  label: string,
): number {
  const result = value[key]
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new SpeakingError(
      'content-invalid',
      `${label}.${key} must be a finite number.`,
    )
  }
  return result
}

function arrayValue(
  value: UnknownRecord,
  key: string,
  label: string,
): unknown[] {
  const result = value[key]
  if (!Array.isArray(result)) {
    throw new SpeakingError(
      'content-invalid',
      `${label}.${key} must be an array.`,
    )
  }
  return result
}

function stringArray(
  value: UnknownRecord,
  key: string,
  label: string,
): readonly string[] {
  const result = arrayValue(value, key, label)
  if (
    result.some(
      (entry) =>
        typeof entry !== 'string' || entry.trim().length === 0,
    )
  ) {
    throw new SpeakingError(
      'content-invalid',
      `${label}.${key} must contain non-empty strings.`,
    )
  }
  return result as readonly string[]
}

function assertDocument(
  value: UnknownRecord,
  documentType: string,
  label: string,
): void {
  if (value.schemaVersion !== 1) {
    throw new SpeakingError(
      'content-version-unsupported',
      `${label} uses an unsupported schemaVersion.`,
    )
  }
  if (value.documentType !== documentType) {
    throw new SpeakingError(
      'content-invalid',
      `${label} must be a ${documentType} document.`,
    )
  }
  if (value.packageVersion !== '1.0.0') {
    throw new SpeakingError(
      'content-version-unsupported',
      `${label} uses an unsupported packageVersion.`,
    )
  }
}

function parsePrompt(value: unknown, label: string): SpeakingPrompt {
  const prompt = record(value, label)
  const modelAnswer = stringValue(prompt, 'modelAnswer', label)
  const acceptedAnswers = stringArray(prompt, 'acceptedAnswers', label)
  if (acceptedAnswers.length === 0) {
    throw new SpeakingError(
      'content-invalid',
      `${label}.acceptedAnswers cannot be empty.`,
    )
  }
  if (!acceptedAnswers.includes(modelAnswer)) {
    throw new SpeakingError(
      'content-invalid',
      `${label}.modelAnswer must be in acceptedAnswers.`,
    )
  }
  return {
    id: stringValue(prompt, 'id', label),
    cueZh: stringValue(prompt, 'cueZh', label),
    partnerLine: stringValue(prompt, 'partnerLine', label),
    modelAnswer,
    modelAnswerTranslationZh: stringValue(
      prompt,
      'modelAnswerTranslationZh',
      label,
    ),
    acceptedAnswers,
    requiredConcepts: stringArray(prompt, 'requiredConcepts', label),
  }
}

/** Scene quizzes do not declare a separate partner line. The released Chinese
 * scenario prompt is therefore shown verbatim in both required session fields;
 * no English dialogue or answer is invented here. */
function parseScenePrompt(value: unknown, label: string): SpeakingPrompt {
  const scene = record(value, label)
  if (scene.domain !== 'speaking' || scene.format !== 'fixed-response') {
    throw new SpeakingError(
      'content-invalid',
      `${label} is not a fixed-response speaking scene quiz.`,
    )
  }
  const cueZh = stringValue(scene, 'promptZh', label)
  const modelAnswer = stringValue(scene, 'modelAnswer', label)
  const acceptedAnswers = stringArray(scene, 'acceptedAnswers', label)
  if (!acceptedAnswers.includes(modelAnswer)) {
    throw new SpeakingError(
      'content-invalid',
      `${label}.modelAnswer must be in acceptedAnswers.`,
    )
  }
  return {
    id: stringValue(scene, 'id', label),
    cueZh,
    partnerLine: cueZh,
    modelAnswer,
    modelAnswerTranslationZh: stringValue(
      scene,
      'modelAnswerTranslationZh',
      label,
    ),
    acceptedAnswers,
    requiredConcepts: stringArray(scene, 'requiredConcepts', label),
  }
}

function activityType(
  value: string,
  label: string,
): SpeakingActivityType {
  if (value === 'fixed-response' || value === 'guided-roleplay') {
    return value
  }
  throw new SpeakingError(
    'content-invalid',
    `${label}.type is not a supported speaking activity.`,
  )
}

function parseSpeakingUnit(
  value: unknown,
  lessonId: string,
  scenePrompts: readonly SpeakingPrompt[],
): SpeakingTrainingUnit {
  const unit = record(value, `${lessonId}.speakingUnit`)
  if (unit.domain !== 'speaking') {
    throw new SpeakingError(
      'content-invalid',
      `${lessonId} speaking unit has the wrong domain.`,
    )
  }
  const learningUnitId = stringValue(
    unit,
    'learningUnitId',
    `${lessonId}.speakingUnit`,
  )
  const activity = record(
    unit.activity,
    `${learningUnitId}.activity`,
  )
  const prompts = arrayValue(
    activity,
    'prompts',
    `${learningUnitId}.activity`,
  ).map((prompt, index) =>
    parsePrompt(prompt, `${learningUnitId}.prompts[${index}]`),
  )
  if (prompts.length === 0) {
    throw new SpeakingError(
      'content-invalid',
      `${learningUnitId} must contain at least one speaking prompt.`,
    )
  }
  const promptIds = prompts.map((prompt) => prompt.id)
  if (new Set(promptIds).size !== promptIds.length) {
    throw new SpeakingError(
      'content-invalid',
      `${learningUnitId} contains duplicate prompt ids.`,
    )
  }
  return {
    learningUnitId,
    contentRef: stringValue(
      unit,
      'contentRef',
      `${lessonId}.speakingUnit`,
    ),
    difficultyLevel: numberValue(
      unit,
      'difficultyLevel',
      `${lessonId}.speakingUnit`,
    ),
    estimatedSeconds: numberValue(
      unit,
      'estimatedSeconds',
      `${lessonId}.speakingUnit`,
    ),
    tags: stringArray(unit, 'tags', `${lessonId}.speakingUnit`),
    activityType: activityType(
      stringValue(activity, 'type', `${learningUnitId}.activity`),
      `${learningUnitId}.activity`,
    ),
    instructionsZh: stringValue(
      activity,
      'instructionsZh',
      `${learningUnitId}.activity`,
    ),
    prompts,
    scenePrompts,
  }
}

export function createSpeakingCatalog(
  documents: SpeakingContentDocuments,
): SpeakingCatalog {
  const packageIndex = record(
    documents.packageIndex,
    'packageIndex',
  )
  const manifest = record(documents.manifest, 'manifest')
  assertDocument(packageIndex, 'content-package-index', 'packageIndex')
  assertDocument(manifest, 'curriculum-manifest', 'manifest')
  if (
    packageIndex.courseId !== 'survival-travel-american-4w' ||
    manifest.courseId !== 'survival-travel-american-4w'
  ) {
    throw new SpeakingError(
      'content-version-unsupported',
      'Speaking only supports the released survival travel course.',
    )
  }
  const lessonFiles = stringArray(
    packageIndex,
    'lessonFiles',
    'packageIndex',
  )
  const manifestLessonFiles = stringArray(
    manifest,
    'lessonFiles',
    'manifest',
  )
  if (
    lessonFiles.length !== manifestLessonFiles.length ||
    lessonFiles.some(
      (path, index) => path !== manifestLessonFiles[index],
    )
  ) {
    throw new SpeakingError(
      'content-reference-missing',
      'Package index and manifest lesson file lists do not match.',
    )
  }

  const units: SpeakingTrainingUnit[] = []
  const learningUnitIds = new Set<string>()
  const contentRefs = new Set<string>()
  for (const path of lessonFiles) {
    const lessonWeek = record(
      documents.lessonsByPath[path],
      `lessonsByPath[${path}]`,
    )
    assertDocument(lessonWeek, 'lesson-week', path)
    for (const [index, lessonValue] of arrayValue(
      lessonWeek,
      'lessons',
      path,
    ).entries()) {
      const lesson = record(lessonValue, `${path}.lessons[${index}]`)
      const lessonId = stringValue(
        lesson,
        'lessonId',
        `${path}.lessons[${index}]`,
      )
      const speakingValue = arrayValue(
        lesson,
        'learningUnits',
        lessonId,
      ).find(
        (unit) => isRecord(unit) && unit.domain === 'speaking',
      )
      if (!speakingValue) {
        throw new SpeakingError(
          'content-reference-missing',
          `${lessonId} has no speaking learning unit.`,
        )
      }
      const scenePrompts = arrayValue(
        lesson,
        'sceneQuiz',
        lessonId,
      )
        .filter((scene) => isRecord(scene) && scene.domain === 'speaking')
        .map((scene, sceneIndex) =>
          parseScenePrompt(scene, `${lessonId}.sceneQuiz[${sceneIndex}]`),
        )
      const scenePromptIds = scenePrompts.map((prompt) => prompt.id)
      if (new Set(scenePromptIds).size !== scenePromptIds.length) {
        throw new SpeakingError(
          'content-invalid',
          `${lessonId} contains duplicate speaking scene quiz ids.`,
        )
      }
      const unit = parseSpeakingUnit(
        speakingValue,
        lessonId,
        scenePrompts,
      )
      if (
        learningUnitIds.has(unit.learningUnitId) ||
        contentRefs.has(unit.contentRef)
      ) {
        throw new SpeakingError(
          'content-invalid',
          `Duplicate speaking unit identity: ${unit.learningUnitId}.`,
        )
      }
      learningUnitIds.add(unit.learningUnitId)
      contentRefs.add(unit.contentRef)
      units.push(unit)
    }
  }

  const byContentRef = new Map(
    units.map((unit) => [unit.contentRef, unit]),
  )
  return {
    schemaVersion: 1,
    packageVersion: '1.0.0',
    courseId: 'survival-travel-american-4w',
    units,
    trainingSupplyIndex: documents.trainingSupplyIndex,
    getUnit: (contentRef) => byContentRef.get(contentRef),
  }
}

export function resolveSpeakingTask(
  catalog: SpeakingCatalog,
  task: LearningTask,
): SpeakingTrainingUnit {
  if (
    task.schemaVersion !== 1 ||
    task.domain !== 'speaking' ||
    task.targetModuleId !== 'speaking'
  ) {
    throw new SpeakingError(
      'task-incompatible',
      'Speaking only accepts speaking learning tasks.',
    )
  }
  const unit = catalog.getUnit(task.contentRef)
  if (!unit || unit.learningUnitId !== task.learningUnitId) {
    throw new SpeakingError(
      'content-reference-missing',
      'Speaking task does not match a released speaking unit.',
    )
  }
  return unit
}
