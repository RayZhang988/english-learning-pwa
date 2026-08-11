import type { LearningTask } from '../../learning-engine/index.ts'
import { ListeningError } from './errors.ts'
import type {
  ListeningCatalog,
  ListeningChoiceOption,
  ListeningContentDocuments,
  ListeningDictationAnswerGuidance,
  ListeningDictationAnswerType,
  ListeningDictationInputFormat,
  ListeningKeywordDictationQuestion,
  ListeningNormalizationHints,
  ListeningPlaybackPolicy,
  ListeningPlaybackRate,
  ListeningQuestion,
  ListeningSegment,
  ListeningTrainingUnit,
  ListeningTranscriptLine,
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
    throw new ListeningError(
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
    throw new ListeningError(
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
    throw new ListeningError(
      'content-invalid',
      `${label}.${key} must be a finite number.`,
    )
  }
  return result
}

function booleanValue(
  value: UnknownRecord,
  key: string,
  label: string,
): boolean {
  const result = value[key]
  if (typeof result !== 'boolean') {
    throw new ListeningError(
      'content-invalid',
      `${label}.${key} must be boolean.`,
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
    throw new ListeningError(
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
    throw new ListeningError(
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
    throw new ListeningError(
      'content-version-unsupported',
      `${label} uses an unsupported schemaVersion.`,
    )
  }
  if (value.documentType !== documentType) {
    throw new ListeningError(
      'content-invalid',
      `${label} must be a ${documentType} document.`,
    )
  }
}

function uniqueStrings(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new ListeningError(
      'content-invalid',
      `${label} contains duplicate identifiers.`,
    )
  }
}

const dictationAnswerTypes = new Set<ListeningDictationAnswerType>([
  'place-name', 'surname', 'number', 'time', 'manner-or-short-phrase',
  'product-description', 'reservation-details', 'allergy-information',
  'payment-method', 'direction-and-distance', 'transfer-instruction',
  'ticket-details', 'size-or-condition', 'checkout-time', 'device-problem',
  'gate-code', 'availability-time', 'room-number', 'gate-and-time',
])

const dictationInputFormats = new Set<ListeningDictationInputFormat>([
  'english-words', 'digits', 'clock-time', 'gate-code', 'room-number',
])

function normalizedGuidanceText(value: string): string {
  return value
    .toLocaleLowerCase('en-US')
    .replace(/[\s\p{P}]+/gu, ' ')
    .trim()
}

function parseDictationAnswerGuidance(
  value: UnknownRecord,
  label: string,
  answerFragments: readonly string[],
): ListeningDictationAnswerGuidance {
  const guidance = record(value.answerGuidance, `${label}.answerGuidance`)
  const keys = Object.keys(guidance).sort()
  const expectedKeys = [
    'acceptedInputFormats',
    'answerType',
    'guidanceZh',
  ]
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new ListeningError(
      'content-invalid',
      `${label}.answerGuidance must use the published guidance fields only.`,
    )
  }
  const answerType = stringValue(
    guidance,
    'answerType',
    `${label}.answerGuidance`,
  )
  if (!dictationAnswerTypes.has(answerType as ListeningDictationAnswerType)) {
    throw new ListeningError(
      'content-invalid',
      `${label}.answerGuidance.answerType is unsupported.`,
    )
  }
  const guidanceZh = stringValue(
    guidance,
    'guidanceZh',
    `${label}.answerGuidance`,
  )
  const formats = stringArray(
    guidance,
    'acceptedInputFormats',
    `${label}.answerGuidance`,
  )
  if (
    formats.length === 0 ||
    new Set(formats).size !== formats.length ||
    formats.some(
      (format) =>
        !dictationInputFormats.has(format as ListeningDictationInputFormat),
    )
  ) {
    throw new ListeningError(
      'content-invalid',
      `${label}.answerGuidance.acceptedInputFormats is unsupported.`,
    )
  }
  const normalizedGuidance = normalizedGuidanceText(guidanceZh)
  if (
    answerFragments
      .map(normalizedGuidanceText)
      .filter((fragment) => fragment.length >= 3)
      .some((fragment) => normalizedGuidance.includes(fragment))
  ) {
    throw new ListeningError(
      'content-invalid',
      `${label}.answerGuidance must not reveal an answer.`,
    )
  }
  return {
    answerType: answerType as ListeningDictationAnswerType,
    guidanceZh,
    acceptedInputFormats: formats as readonly ListeningDictationInputFormat[],
  }
}

interface CoreListeningData {
  readonly unit: Omit<ListeningTrainingUnit, 'questions'>
  readonly checks: readonly UnknownRecord[]
  readonly sceneQuiz: UnknownRecord
}

function parseTranscript(
  activity: UnknownRecord,
  learningUnitId: string,
): readonly ListeningTranscriptLine[] {
  return arrayValue(activity, 'transcript', learningUnitId).map(
    (value, index) => {
      const line = record(value, `${learningUnitId}.transcript[${index}]`)
      return {
        id: `${learningUnitId}:line:${index}`,
        speaker: stringValue(
          line,
          'speaker',
          `${learningUnitId}.transcript[${index}]`,
        ),
        text: stringValue(
          line,
          'text',
          `${learningUnitId}.transcript[${index}]`,
        ),
        translationZh: stringValue(
          line,
          'translationZh',
          `${learningUnitId}.transcript[${index}]`,
        ),
      }
    },
  )
}

function parseCoreLessons(
  documents: ListeningContentDocuments,
  lessonFiles: readonly string[],
): Map<string, CoreListeningData> {
  const byContentRef = new Map<string, CoreListeningData>()
  for (const path of lessonFiles) {
    const lessonWeek = record(
      documents.lessonsByPath[path],
      `lessonsByPath[${path}]`,
    )
    assertDocument(lessonWeek, 'lesson-week', path)
    if (lessonWeek.packageVersion !== '1.0.0') {
      throw new ListeningError(
        'content-version-unsupported',
        `${path} uses an unsupported packageVersion.`,
      )
    }
    for (const [lessonIndex, lessonValue] of arrayValue(
      lessonWeek,
      'lessons',
      path,
    ).entries()) {
      const lesson = record(lessonValue, `${path}.lessons[${lessonIndex}]`)
      const lessonId = stringValue(
        lesson,
        'lessonId',
        `${path}.lessons[${lessonIndex}]`,
      )
      const listeningUnitValue = arrayValue(
        lesson,
        'learningUnits',
        lessonId,
      ).find(
        (value) =>
          isRecord(value) && value.domain === 'listening',
      )
      if (!listeningUnitValue) {
        throw new ListeningError(
          'content-reference-missing',
          `${lessonId} has no listening learning unit.`,
        )
      }
      const unitValue = record(
        listeningUnitValue,
        `${lessonId}.listeningUnit`,
      )
      const learningUnitId = stringValue(
        unitValue,
        'learningUnitId',
        lessonId,
      )
      const contentRef = stringValue(
        unitValue,
        'contentRef',
        lessonId,
      )
      const activity = record(
        unitValue.activity,
        `${learningUnitId}.activity`,
      )
      const activityType = stringValue(
        activity,
        'type',
        `${learningUnitId}.activity`,
      )
      if (
        ![
          'listening-dialogue',
          'listening-narrative',
          'listening-announcement',
        ].includes(activityType)
      ) {
        throw new ListeningError(
          'content-invalid',
          `${learningUnitId} has an unsupported listening activity.`,
        )
      }
      const transcript = parseTranscript(activity, learningUnitId)
      const sceneQuiz = arrayValue(
        lesson,
        'sceneQuiz',
        lessonId,
      ).find(
        (value) =>
          isRecord(value) && value.domain === 'listening',
      )
      if (!sceneQuiz) {
        throw new ListeningError(
          'content-reference-missing',
          `${lessonId} has no listening scene quiz.`,
        )
      }
      if (byContentRef.has(contentRef)) {
        throw new ListeningError(
          'content-invalid',
          `Duplicate listening contentRef ${contentRef}.`,
        )
      }
      byContentRef.set(contentRef, {
        unit: {
          learningUnitId,
          contentRef,
          difficultyLevel: numberValue(
            unitValue,
            'difficultyLevel',
            learningUnitId,
          ),
          estimatedSeconds: numberValue(
            unitValue,
            'estimatedSeconds',
            learningUnitId,
          ),
          tags: stringArray(unitValue, 'tags', learningUnitId),
          activityType:
            activityType as ListeningTrainingUnit['activityType'],
          titleZh: stringValue(
            activity,
            'titleZh',
            `${learningUnitId}.activity`,
          ),
          transcript,
        },
        checks: arrayValue(
          activity,
          'checks',
          `${learningUnitId}.activity`,
        ).map((value, index) =>
          record(value, `${learningUnitId}.checks[${index}]`),
        ),
        sceneQuiz: record(sceneQuiz, `${lessonId}.sceneQuiz`),
      })
    }
  }
  return byContentRef
}

function parsePolicy(
  value: unknown,
  label: string,
): ListeningPlaybackPolicy {
  const policy = record(value, label)
  const rates = arrayValue(policy, 'allowedRates', label)
  if (
    rates.length === 0 ||
    rates.some(
      (rate) => rate !== 0.75 && rate !== 1 && rate !== 1.25,
    )
  ) {
    throw new ListeningError(
      'content-invalid',
      `${label}.allowedRates contains an unsupported speed.`,
    )
  }
  uniqueStrings(rates.map(String), `${label}.allowedRates`)
  return {
    allowSegmentSelection: booleanValue(
      policy,
      'allowSegmentSelection',
      label,
    ),
    allowRepeat: booleanValue(policy, 'allowRepeat', label),
    allowedRates: rates as readonly ListeningPlaybackRate[],
    sequenceMode: 'current-segment',
  }
}

function parseOptions(
  value: UnknownRecord,
  label: string,
): readonly ListeningChoiceOption[] {
  const options = arrayValue(value, 'options', label).map(
    (optionValue, index) => {
      const option = record(
        optionValue,
        `${label}.options[${index}]`,
      )
      return {
        id: stringValue(
          option,
          'optionId',
          `${label}.options[${index}]`,
        ),
        label: stringValue(
          option,
          'text',
          `${label}.options[${index}]`,
        ),
      }
    },
  )
  uniqueStrings(
    options.map((option) => option.id),
    `${label}.options`,
  )
  return options
}

function parseBilingualChoiceOptions(
  value: unknown,
): ReadonlyMap<string, readonly ListeningChoiceOption[]> {
  const document = record(value, 'bilingual listening choice options')
  assertDocument(
    document,
    'listening-choice-bilingual-options',
    'bilingual listening choice options',
  )
  if (
    document.contentVersion !== '1.1.0' ||
    document.courseId !== 'survival-travel-american-4w' ||
    document.targetLocale !== 'en-US' ||
    document.supportLocale !== 'zh-CN'
  ) {
    throw new ListeningError(
      'content-version-unsupported',
      'The bilingual listening choice options are incompatible.',
    )
  }
  const result = new Map<string, readonly ListeningChoiceOption[]>()
  for (const [questionIndex, questionValue] of arrayValue(
    document,
    'questions',
    'bilingual listening choice options',
  ).entries()) {
    const label = `bilingual question[${questionIndex}]`
    const question = record(questionValue, label)
    const questionId = stringValue(question, 'questionId', label)
    if (result.has(questionId)) {
      throw new ListeningError(
        'content-invalid',
        `Duplicate bilingual listening question ${questionId}.`,
      )
    }
    const options = arrayValue(question, 'options', label).map(
      (optionValue, optionIndex) => {
        const optionLabel = `${label}.options[${optionIndex}]`
        const option = record(optionValue, optionLabel)
        return {
          id: stringValue(option, 'optionId', optionLabel),
          label: stringValue(option, 'textEn', optionLabel),
          translationZh: stringValue(
            option,
            'translationZh',
            optionLabel,
          ),
        }
      },
    )
    if (options.length < 2) {
      throw new ListeningError(
        'content-invalid',
        `${questionId} has too few bilingual choices.`,
      )
    }
    uniqueStrings(
      options.map((option) => option.id),
      `${questionId}.bilingualOptions`,
    )
    result.set(questionId, options)
  }
  return result
}

function applyBilingualChoiceOptions(
  question: ListeningQuestion,
  bilingualByQuestionId: ReadonlyMap<
    string,
    readonly ListeningChoiceOption[]
  >,
): ListeningQuestion {
  if (question.type === 'keyword-dictation') {
    return question
  }
  const bilingual = bilingualByQuestionId.get(question.id)
  if (
    !bilingual ||
    bilingual.length !== question.options.length ||
    bilingual.some(
      (option, index) => option.id !== question.options[index]?.id,
    )
  ) {
    throw new ListeningError(
      'content-reference-missing',
      `Listening question ${question.id} has no exact bilingual option set.`,
    )
  }
  return {
    ...question,
    options: bilingual,
  }
}

function resolveExtensionSegment(
  sourceValue: unknown,
  coreByRef: ReadonlyMap<string, CoreListeningData>,
  label: string,
): ListeningSegment {
  const source = record(sourceValue, label)
  const sourceType = stringValue(source, 'sourceType', label)
  const id = stringValue(source, 'segmentId', label)
  if (source.locale !== 'en-US') {
    throw new ListeningError(
      'content-invalid',
      `${label}.locale must be en-US.`,
    )
  }
  if (sourceType === 'tts-text') {
    return {
      id,
      locale: 'en-US',
      text: stringValue(source, 'ttsText', label),
      label: '练习片段',
      speaker: null,
    }
  }
  if (sourceType !== 'transcript-line') {
    throw new ListeningError(
      'content-invalid',
      `${label}.sourceType is unsupported.`,
    )
  }
  const contentRef = stringValue(source, 'baseContentRef', label)
  const core = coreByRef.get(contentRef)
  const lineIndex = numberValue(source, 'lineIndex', label)
  if (!Number.isInteger(lineIndex) || lineIndex < 0) {
    throw new ListeningError(
      'content-invalid',
      `${label}.lineIndex must be a non-negative integer.`,
    )
  }
  const line = core?.unit.transcript[lineIndex]
  const expectedText = stringValue(source, 'expectedText', label)
  if (!line || line.text !== expectedText) {
    throw new ListeningError(
      'content-reference-missing',
      `${label} does not match its referenced transcript line.`,
    )
  }
  return {
    id,
    locale: 'en-US',
    text: line.text,
    label: line.speaker ? `${line.speaker} 的句子` : '课文句子',
    speaker: line.speaker,
  }
}

interface ParsedExtensionExercise {
  readonly value: UnknownRecord
  readonly id: string
  readonly type:
    | 'word-discrimination'
    | 'short-sentence-choice'
    | 'keyword-dictation'
  readonly segment: ListeningSegment
  readonly policy: ListeningPlaybackPolicy
}

function parseExtensionExercises(
  bundle: UnknownRecord,
  coreByRef: ReadonlyMap<string, CoreListeningData>,
): Map<string, readonly ParsedExtensionExercise[]> {
  const byContentRef = new Map<
    string,
    readonly ParsedExtensionExercise[]
  >()
  for (const [lessonIndex, lessonValue] of arrayValue(
    bundle,
    'lessons',
    'listening exercise bundle',
  ).entries()) {
    const lesson = record(
      lessonValue,
      `extension.lessons[${lessonIndex}]`,
    )
    const contentRef = stringValue(
      lesson,
      'baseContentRef',
      `extension.lessons[${lessonIndex}]`,
    )
    const core = coreByRef.get(contentRef)
    if (
      !core ||
      core.unit.learningUnitId !==
        stringValue(
          lesson,
          'listeningUnitId',
          `extension.lessons[${lessonIndex}]`,
        )
    ) {
      throw new ListeningError(
        'content-reference-missing',
        `Extension lesson cannot resolve ${contentRef}.`,
      )
    }
    const exercises = arrayValue(
      lesson,
      'exercises',
      contentRef,
    ).map((exerciseValue, exerciseIndex): ParsedExtensionExercise => {
      const label = `${contentRef}.exercises[${exerciseIndex}]`
      const value = record(exerciseValue, label)
      const type = stringValue(value, 'type', label)
      if (
        type !== 'word-discrimination' &&
        type !== 'short-sentence-choice' &&
        type !== 'keyword-dictation'
      ) {
        throw new ListeningError(
          'content-invalid',
          `${label}.type is unsupported.`,
        )
      }
      return {
        value,
        id: stringValue(value, 'exerciseId', label),
        type: type as ParsedExtensionExercise['type'],
        segment: resolveExtensionSegment(
          value.audioSource,
          coreByRef,
          `${label}.audioSource`,
        ),
        policy: parsePolicy(
          value.playbackPolicy,
          `${label}.playbackPolicy`,
        ),
      }
    })
    uniqueStrings(
      exercises.map((exercise) => exercise.id),
      `${contentRef}.exercises`,
    )
    uniqueStrings(
      exercises.map((exercise) => exercise.segment.id),
      `${contentRef}.segments`,
    )
    if (
      new Set(exercises.map((exercise) => exercise.type)).size !== 3
    ) {
      throw new ListeningError(
        'content-invalid',
        `${contentRef} must provide each extension exercise type once.`,
      )
    }
    byContentRef.set(contentRef, exercises)
  }
  return byContentRef
}

function extensionQuestion(
  exercise: ParsedExtensionExercise,
  allSegments: readonly ListeningSegment[],
): ListeningQuestion {
  const value = exercise.value
  const segments = exercise.policy.allowSegmentSelection
    ? allSegments
    : [exercise.segment]
  const common = {
    id: exercise.id,
    promptZh: stringValue(value, 'promptZh', exercise.id),
    primarySegmentId: exercise.segment.id,
    segments,
    playbackPolicy: exercise.policy,
    rationaleZh: stringValue(value, 'rationaleZh', exercise.id),
  }
  if (exercise.type === 'keyword-dictation') {
    const hints = record(
      value.normalizationHints,
      `${exercise.id}.normalizationHints`,
    )
    if (
      hints.trim !== true ||
      hints.collapseWhitespace !== true ||
      hints.normalizeApostrophes !== true ||
      hints.stripTerminalPunctuation !== true ||
      hints.caseFoldLocale !== 'en-US'
    ) {
      throw new ListeningError(
        'content-invalid',
        `${exercise.id} has unsupported normalization hints.`,
      )
    }
    const normalizationHints: ListeningNormalizationHints = {
      trim: true,
      caseFoldLocale: 'en-US',
      collapseWhitespace: true,
      normalizeApostrophes: true,
      stripTerminalPunctuation: true,
    }
    const standardAnswer = stringValue(
      value,
      'standardAnswer',
      exercise.id,
    )
    const acceptedAnswers = stringArray(
      value,
      'acceptedAnswers',
      exercise.id,
    )
    if (!acceptedAnswers.includes(standardAnswer)) {
      throw new ListeningError(
        'content-invalid',
        `${exercise.id} omits its standard answer.`,
      )
    }
    const targetKeywords = stringArray(
      value,
      'targetKeywords',
      exercise.id,
    )
    const answerGuidance = parseDictationAnswerGuidance(
      value,
      exercise.id,
      [...targetKeywords, standardAnswer, ...acceptedAnswers],
    )
    const question: ListeningKeywordDictationQuestion = {
      ...common,
      type: 'keyword-dictation',
      targetKeywords,
      standardAnswer,
      acceptedAnswers,
      normalizationHints,
      answerGuidance,
      errorTag: 'detail-missed',
    }
    return question
  }
  const options = parseOptions(value, exercise.id)
  const correctOptionId = stringValue(
    value,
    'correctOptionId',
    exercise.id,
  )
  if (!options.some((option) => option.id === correctOptionId)) {
    throw new ListeningError(
      'content-invalid',
      `${exercise.id} cannot resolve its correctOptionId.`,
    )
  }
  return {
    ...common,
    type: exercise.type,
    options,
    correctOptionId,
    errorTag:
      exercise.type === 'word-discrimination'
        ? 'sound-discrimination'
        : 'detail-missed',
  }
}

function coreCheckQuestions(
  core: CoreListeningData,
): readonly ListeningQuestion[] {
  const passageSegments: readonly ListeningSegment[] =
    core.unit.transcript.map((line, index) => ({
      id: `${core.unit.learningUnitId}:passage:${index}`,
      locale: 'en-US',
      text: line.text,
      label: line.speaker
        ? `${line.speaker} 的句子`
        : `第 ${index + 1} 句`,
      speaker: line.speaker,
    }))
  const primaryPassageSegment = passageSegments[0]
  if (!primaryPassageSegment) {
    throw new ListeningError(
      'content-invalid',
      `${core.unit.learningUnitId} has no transcript lines.`,
    )
  }
  const questions = core.checks.map((check, index) => {
    const id = stringValue(check, 'id', `check[${index}]`)
    const options = stringArray(check, 'options', id).map(
      (label, optionIndex) => ({
        id: `${id}:option:${optionIndex}`,
        label,
      }),
    )
    const correctIndex = numberValue(
      check,
      'correctOptionIndex',
      id,
    )
    if (
      !Number.isInteger(correctIndex) ||
      correctIndex < 0 ||
      correctIndex >= options.length
    ) {
      throw new ListeningError(
        'content-invalid',
        `${id} has an invalid correctOptionIndex.`,
      )
    }
    const skill = stringValue(check, 'skill', id)
    if (!['gist', 'detail', 'inference', 'sequence'].includes(skill)) {
      throw new ListeningError(
        'content-invalid',
        `${id} has an unsupported listening skill.`,
      )
    }
    return {
      id,
      type: 'core-information' as const,
      promptZh: stringValue(check, 'promptZh', id),
      primarySegmentId: primaryPassageSegment.id,
      segments: passageSegments,
      playbackPolicy: {
        allowSegmentSelection: true,
        allowRepeat: true,
        allowedRates: [0.75, 1, 1.25] as const,
        sequenceMode: 'all-segments' as const,
      },
      options,
      correctOptionId: options[correctIndex].id,
      rationaleZh: stringValue(check, 'rationaleZh', id),
      errorTag:
        skill === 'inference'
          ? ('inference' as const)
          : ('detail-missed' as const),
    }
  })
  const quiz = core.sceneQuiz
  const quizId = stringValue(quiz, 'id', 'listening scene quiz')
  if (quiz.format !== 'single-choice') {
    throw new ListeningError(
      'content-invalid',
      `${quizId} must be single-choice.`,
    )
  }
  const quizOptions = stringArray(quiz, 'options', quizId).map(
    (label, index) => ({
      id: `${quizId}:option:${index}`,
      label,
    }),
  )
  const quizCorrectIndex = numberValue(
    quiz,
    'correctOptionIndex',
    quizId,
  )
  if (
    !Number.isInteger(quizCorrectIndex) ||
    quizCorrectIndex < 0 ||
    quizCorrectIndex >= quizOptions.length
  ) {
    throw new ListeningError(
      'content-invalid',
      `${quizId} has an invalid correctOptionIndex.`,
    )
  }
  const quizSegment: ListeningSegment = {
    id: `${quizId}:audio`,
    locale: 'en-US',
    text: stringValue(quiz, 'audioText', quizId),
    label: '场景测验',
    speaker: null,
  }
  return [
    ...questions,
    {
      id: quizId,
      type: 'scene-comprehension',
      promptZh: stringValue(quiz, 'promptZh', quizId),
      primarySegmentId: quizSegment.id,
      segments: [quizSegment],
      playbackPolicy: {
        allowSegmentSelection: false,
        allowRepeat: true,
        allowedRates: [0.75, 1, 1.25] as const,
        sequenceMode: 'current-segment' as const,
      },
      options: quizOptions,
      correctOptionId: quizOptions[quizCorrectIndex].id,
      rationaleZh: stringValue(quiz, 'rationaleZh', quizId),
      errorTag: 'detail-missed',
    },
  ]
}

export function createListeningCatalog(
  documents: ListeningContentDocuments,
): ListeningCatalog {
  const packageIndex = record(
    documents.packageIndex,
    'content package index',
  )
  assertDocument(packageIndex, 'content-package-index', 'package index')
  if (
    packageIndex.packageVersion !== '1.0.0' ||
    packageIndex.courseId !== 'survival-travel-american-4w'
  ) {
    throw new ListeningError(
      'content-version-unsupported',
      'The listening module only supports the released core package 1.0.0.',
    )
  }
  const lessonFiles = stringArray(
    packageIndex,
    'lessonFiles',
    'package index',
  )
  const manifest = record(documents.manifest, 'curriculum manifest')
  assertDocument(manifest, 'curriculum-manifest', 'curriculum manifest')
  if (
    manifest.packageVersion !== '1.0.0' ||
    manifest.courseId !== packageIndex.courseId
  ) {
    throw new ListeningError(
      'content-version-unsupported',
      'The curriculum manifest does not match the core package.',
    )
  }
  const coreByRef = parseCoreLessons(documents, lessonFiles)
  const bilingualByQuestionId = parseBilingualChoiceOptions(
    documents.bilingualChoiceOptions,
  )
  const usedBilingualQuestionIds = new Set<string>()

  const extensionIndex = record(
    documents.extensionIndex,
    'listening extension index',
  )
  assertDocument(
    extensionIndex,
    'listening-exercise-extension-index',
    'listening extension index',
  )
  if (
    extensionIndex.extensionId !==
      'survival-travel-american-listening-exercises' ||
    extensionIndex.extensionVersion !== '1.2.0' ||
    extensionIndex.basePackageVersion !== '1.0.0' ||
    extensionIndex.baseCourseId !== packageIndex.courseId
  ) {
    throw new ListeningError(
      'content-version-unsupported',
      'The listening exercise extension is incompatible.',
    )
  }
  const bundlePaths = stringArray(
    extensionIndex,
    'exerciseBundleFiles',
    'listening extension index',
  )
  const extensionByRef = new Map<
    string,
    readonly ParsedExtensionExercise[]
  >()
  for (const path of bundlePaths) {
    const bundle = record(
      documents.exerciseBundlesByPath[path],
      `exerciseBundlesByPath[${path}]`,
    )
    assertDocument(
      bundle,
      'listening-exercise-extension',
      path,
    )
    if (
      bundle.extensionVersion !== '1.2.0' ||
      bundle.basePackageVersion !== '1.0.0'
    ) {
      throw new ListeningError(
        'content-version-unsupported',
        `${path} uses an unsupported extension version.`,
      )
    }
    for (const [contentRef, exercises] of parseExtensionExercises(
      bundle,
      coreByRef,
    )) {
      if (extensionByRef.has(contentRef)) {
        throw new ListeningError(
          'content-invalid',
          `Duplicate extension lesson for ${contentRef}.`,
        )
      }
      extensionByRef.set(contentRef, exercises)
    }
  }

  const units: ListeningTrainingUnit[] = []
  const questionIds = new Set<string>()
  const segmentsById = new Map<string, string>()
  for (const [contentRef, core] of coreByRef) {
    const exercises = extensionByRef.get(contentRef)
    if (!exercises) {
      throw new ListeningError(
        'content-reference-missing',
        `No listening extension exercises for ${contentRef}.`,
      )
    }
    const allSegments = exercises.map((exercise) => exercise.segment)
    const questions = [
      ...exercises.map((exercise) =>
        extensionQuestion(exercise, allSegments),
      ),
      ...coreCheckQuestions(core),
    ].map((question) => {
      const bilingual = applyBilingualChoiceOptions(
        question,
        bilingualByQuestionId,
      )
      if (bilingual.type !== 'keyword-dictation') {
        usedBilingualQuestionIds.add(bilingual.id)
      }
      return bilingual
    })
    for (const question of questions) {
      if (questionIds.has(question.id)) {
        throw new ListeningError(
          'content-invalid',
          `Duplicate listening question ${question.id}.`,
        )
      }
      questionIds.add(question.id)
      for (const segment of question.segments) {
        const existingText = segmentsById.get(segment.id)
        if (existingText !== undefined && existingText !== segment.text) {
          throw new ListeningError(
            'content-invalid',
            `Listening segment ${segment.id} resolves to conflicting text.`,
          )
        }
        segmentsById.set(segment.id, segment.text)
      }
    }
    units.push({ ...core.unit, questions })
  }
  if (units.length !== coreByRef.size || units.length !== extensionByRef.size) {
    throw new ListeningError(
      'content-reference-missing',
      'Core lessons and listening extension lessons are not one-to-one.',
    )
  }
  if (usedBilingualQuestionIds.size !== bilingualByQuestionId.size) {
    const unused = [...bilingualByQuestionId.keys()].find(
      (questionId) => !usedBilingualQuestionIds.has(questionId),
    )
    throw new ListeningError(
      'content-invalid',
      `Bilingual listening choices contain an unused question: ${unused ?? 'unknown'}.`,
    )
  }
  const byContentRef = new Map(
    units.map((unit) => [unit.contentRef, unit]),
  )
  return {
    schemaVersion: 1,
    packageVersion: '1.0.0',
    extensionVersion: '1.2.0',
    courseId: packageIndex.courseId as string,
    units,
    trainingSupplyIndex: documents.trainingSupplyIndex,
    getUnit(contentRef: string) {
      return byContentRef.get(contentRef)
    },
  }
}

export function resolveListeningTask(
  catalog: ListeningCatalog,
  task: LearningTask,
): ListeningTrainingUnit {
  if (
    task.schemaVersion !== 1 ||
    task.domain !== 'listening' ||
    task.targetModuleId !== 'listening'
  ) {
    throw new ListeningError(
      'task-incompatible',
      'The listening catalog only accepts listening v1 tasks.',
    )
  }
  const unit = catalog.getUnit(task.contentRef)
  if (!unit || unit.learningUnitId !== task.learningUnitId) {
    throw new ListeningError(
      'content-reference-missing',
      `No listening unit matches ${task.contentRef}.`,
    )
  }
  return unit
}
