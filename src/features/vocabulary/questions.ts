import { VocabularyError } from './errors.ts'
import type {
  VocabularyItem,
  VocabularyQuestion,
  VocabularyQuestionOption,
  VocabularyQuestionType,
  VocabularySceneQuiz,
  VocabularyTrainingUnit,
  VocabularySupplyVariantId,
} from './types.ts'

const ITEM_QUESTION_TYPES: readonly VocabularyQuestionType[] = [
  'term-to-meaning',
  'meaning-to-term',
  'example-comprehension',
]

function hashText(value: string): number {
  let hash = 2_166_136_261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function deterministicOrder<T>(
  values: readonly T[],
  seed: string,
  identity: (value: T) => string,
): readonly T[] {
  return [...values].sort((left, right) => {
    const leftHash = hashText(`${seed}:${identity(left)}`)
    const rightHash = hashText(`${seed}:${identity(right)}`)
    return leftHash - rightHash || identity(left).localeCompare(identity(right))
  })
}

function uniqueItemsByLabel(
  correctItem: VocabularyItem,
  items: readonly VocabularyItem[],
  labelFor: (item: VocabularyItem) => string,
): readonly VocabularyItem[] {
  const seen = new Set<string>()
  const result: VocabularyItem[] = []

  for (const item of [correctItem, ...items]) {
    const label = labelFor(item).trim()
    if (!label || seen.has(label)) {
      continue
    }
    seen.add(label)
    result.push(item)
  }

  return result
}

function itemOptions(
  questionId: string,
  correctItem: VocabularyItem,
  pool: readonly VocabularyItem[],
  labelFor: (item: VocabularyItem) => string,
): {
  readonly options: readonly VocabularyQuestionOption[]
  readonly correctOptionId: string
} {
  const candidates = uniqueItemsByLabel(correctItem, pool, labelFor)
  const distractors = deterministicOrder(
    candidates.filter((item) => item.id !== correctItem.id),
    `${questionId}:distractors`,
    (item) => item.id,
  ).slice(0, 3)

  if (distractors.length < 2) {
    throw new VocabularyError(
      'question-options-insufficient',
      `Question ${questionId} requires at least two distinct distractors.`,
    )
  }

  const selectedItems = [correctItem, ...distractors]
  const orderedItems = deterministicOrder(
    selectedItems,
    `${questionId}:options`,
    (item) => item.id,
  )
  const options = orderedItems.map((item) => ({
    id: `${questionId}:item:${item.id}`,
    label: labelFor(item),
  }))

  return {
    options,
    correctOptionId: `${questionId}:item:${correctItem.id}`,
  }
}

function buildItemQuestion(
  unit: VocabularyTrainingUnit,
  item: VocabularyItem,
  itemIndex: number,
  pool: readonly VocabularyItem[],
): VocabularyQuestion {
  const type = ITEM_QUESTION_TYPES[itemIndex % ITEM_QUESTION_TYPES.length]
  const questionId = `${unit.learningUnitId}:${type}:${item.id}`

  if (type === 'meaning-to-term') {
    const { options, correctOptionId } = itemOptions(
      questionId,
      item,
      pool,
      (candidate) => candidate.term,
    )
    return {
      id: questionId,
      type,
      instructionZh: '根据中文义回忆英文表达',
      prompt: item.meaningZh,
      promptLocale: 'zh-CN',
      partOfSpeech: item.partOfSpeech,
      options,
      correctOptionId,
      exampleEn: item.exampleEn,
      explanationZh: item.exampleZh,
      errorTag: 'form-recall',
    }
  }

  const { options, correctOptionId } = itemOptions(
    questionId,
    item,
    pool,
    (candidate) => candidate.meaningZh,
  )

  if (type === 'example-comprehension') {
    return {
      id: questionId,
      type,
      instructionZh: '根据原课程例句判断目标表达的含义',
      prompt: item.exampleEn,
      promptLocale: 'en-US',
      partOfSpeech: item.partOfSpeech,
      options,
      correctOptionId,
      exampleEn: item.exampleEn,
      explanationZh: item.exampleZh,
      errorTag: 'meaning-recall',
    }
  }

  return {
    id: questionId,
    type,
    instructionZh: '选择正确的中文含义',
    prompt: item.term,
    promptLocale: 'en-US',
    partOfSpeech: item.partOfSpeech,
    options,
    correctOptionId,
    exampleEn: item.exampleEn,
    explanationZh: item.exampleZh,
    errorTag: 'meaning-recall',
  }
}

/** Builds one stable supply item without inventing a new question format. */
export function buildVocabularySupplyQuestion(
  itemId: string,
  item: VocabularyItem,
  distractors: readonly VocabularyItem[],
  variantId: VocabularySupplyVariantId,
): VocabularyQuestion {
  const type: VocabularyQuestionType =
    variantId === 'meaning-to-term-choice'
      ? 'meaning-to-term'
      : variantId === 'example-gap-choice'
        ? 'example-comprehension'
        : 'term-to-meaning'
  const questionId = `supply:${itemId}:${type}`
  if (type === 'meaning-to-term') {
    const { options, correctOptionId } = itemOptions(questionId, item, distractors, (candidate) => candidate.term)
    return { id: questionId, type, instructionZh: '根据中文义回忆英文表达', prompt: item.meaningZh, promptLocale: 'zh-CN', partOfSpeech: item.partOfSpeech, options, correctOptionId, exampleEn: item.exampleEn, explanationZh: item.exampleZh, errorTag: 'form-recall' }
  }
  const { options, correctOptionId } = itemOptions(questionId, item, distractors, (candidate) => candidate.meaningZh)
  if (type === 'example-comprehension') {
    return { id: questionId, type, instructionZh: '根据原课程例句判断目标表达的含义', prompt: item.exampleEn, promptLocale: 'en-US', partOfSpeech: item.partOfSpeech, options, correctOptionId, exampleEn: item.exampleEn, explanationZh: item.exampleZh, errorTag: 'meaning-recall' }
  }
  return { id: questionId, type, instructionZh: '选择正确的中文含义', prompt: item.term, promptLocale: 'en-US', partOfSpeech: item.partOfSpeech, options, correctOptionId, exampleEn: item.exampleEn, explanationZh: item.exampleZh, errorTag: 'meaning-recall' }
}

function quizOptions(
  questionId: string,
  labels: readonly string[],
  correctIndex: number,
): {
  readonly options: readonly VocabularyQuestionOption[]
  readonly correctOptionId: string
} {
  if (
    labels.length < 2 ||
    new Set(labels).size !== labels.length ||
    !Number.isInteger(correctIndex) ||
    correctIndex < 0 ||
    correctIndex >= labels.length
  ) {
    throw new VocabularyError(
      'content-invalid',
      `Scene quiz ${questionId} has invalid options.`,
    )
  }

  return {
    options: labels.map((label, index) => ({
      id: `${questionId}:option:${index}`,
      label,
    })),
    correctOptionId: `${questionId}:option:${correctIndex}`,
  }
}

function buildSceneQuestions(
  unit: VocabularyTrainingUnit,
  quiz: VocabularySceneQuiz,
): readonly VocabularyQuestion[] {
  if (quiz.format === 'single-choice') {
    const questionId = `${unit.learningUnitId}:scene-word-choice:${quiz.id}`
    const { options, correctOptionId } = quizOptions(
      questionId,
      quiz.options,
      quiz.correctOptionIndex,
    )
    return [{
      id: questionId,
      type: 'scene-word-choice',
      instructionZh: '根据场景选择正确表达',
      prompt: quiz.promptZh,
      promptLocale: 'zh-CN',
      partOfSpeech: null,
      options,
      correctOptionId,
      exampleEn: null,
      explanationZh: quiz.rationaleZh,
      errorTag: 'word-choice',
    }]
  }

  const answers = quiz.pairs.map((pair) => pair.answer)
  return quiz.pairs.map((pair, pairIndex) => {
    const questionId =
      `${unit.learningUnitId}:scene-word-choice:${quiz.id}:${pairIndex}`
    const { options, correctOptionId } = quizOptions(
      questionId,
      answers,
      pairIndex,
    )
    return {
      id: questionId,
      type: 'scene-word-choice' as const,
      instructionZh: quiz.promptZh,
      prompt: pair.intentZh,
      promptLocale: 'zh-CN' as const,
      partOfSpeech: null,
      options,
      correctOptionId,
      exampleEn: pair.answer,
      explanationZh: quiz.rationaleZh,
      errorTag: 'word-choice' as const,
    }
  })
}

export function buildVocabularyQuestions(
  unit: VocabularyTrainingUnit,
): readonly VocabularyQuestion[] {
  const pool = [...unit.reviewItems, ...unit.items]
  const seenItems = new Set<string>()
  const trainingItems = pool.filter((item) => {
    if (seenItems.has(item.id)) {
      return false
    }
    seenItems.add(item.id)
    return true
  })

  if (trainingItems.length < 3) {
    throw new VocabularyError(
      'question-options-insufficient',
      `Vocabulary unit ${unit.learningUnitId} needs at least three items.`,
    )
  }

  const itemQuestions = trainingItems.map((item, index) =>
    buildItemQuestion(unit, item, index, trainingItems),
  )
  const questions = [
    ...itemQuestions,
    ...buildSceneQuestions(unit, unit.sceneQuiz),
  ]
  const coveredTypes = new Set(questions.map((question) => question.type))

  for (const requiredType of [
    ...ITEM_QUESTION_TYPES,
    'scene-word-choice',
  ] as const) {
    if (!coveredTypes.has(requiredType)) {
      throw new VocabularyError(
        'content-invalid',
        `Vocabulary unit ${unit.learningUnitId} cannot cover ${requiredType}.`,
      )
    }
  }

  return questions
}

export function judgeVocabularyAnswer(
  question: VocabularyQuestion,
  selectedOptionId: string,
): boolean {
  if (!question.options.some((option) => option.id === selectedOptionId)) {
    throw new VocabularyError(
      'session-transition-invalid',
      `Option ${selectedOptionId} does not belong to ${question.id}.`,
    )
  }
  return selectedOptionId === question.correctOptionId
}
