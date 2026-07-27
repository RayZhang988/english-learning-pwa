import {
  correctTravelVocabularyOptionIdR1,
  sampleTravelVocabularyStagePlansR1,
  validateTravelVocabularyBankR1,
} from './travel-vocabulary-bank.ts'
import {
  estimateTravelVocabularyStageR1,
  TRAVEL_VOCABULARY_SAMPLE_SIZE_PER_STAGE_R1,
  TRAVEL_VOCABULARY_TOTAL_STAGES_R1,
} from './travel-vocabulary-model.ts'
import type {
  RandomSourceR1,
  TravelVocabularyAssessmentSessionR1,
  TravelVocabularyBankR1,
  TravelVocabularyDraftAnswerR1,
  TravelVocabularyQuestionPlanR1,
  TravelVocabularyStageResultR1,
} from './travel-vocabulary-types.ts'

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${field} must be a valid ISO timestamp`)
  }
  return parsed
}

function currentStagePlan(
  session: TravelVocabularyAssessmentSessionR1,
) {
  const plan = session.stagePlans[session.currentStageIndex]
  if (!plan) {
    throw new TypeError('Travel vocabulary current stage is unavailable')
  }
  return plan
}

function questionInCurrentStage(
  session: TravelVocabularyAssessmentSessionR1,
  questionId: string,
): TravelVocabularyQuestionPlanR1 {
  if (session.status !== 'in-progress') {
    throw new TypeError('Travel vocabulary assessment is completed')
  }
  const question = currentStagePlan(session).questions.find(
    (candidate) => candidate.id === questionId,
  )
  if (!question) {
    throw new TypeError(
      `Question ${questionId} is not in the current stage`,
    )
  }
  if (session.completedStages.length > session.currentStageIndex) {
    throw new TypeError('The current travel vocabulary stage is locked')
  }
  return question
}

export function createTravelVocabularyAssessmentSessionR1(input: {
  readonly id: string
  readonly startedAt: string
  readonly bank: TravelVocabularyBankR1
  readonly random: RandomSourceR1
  readonly recentWordIds?: readonly string[]
}): TravelVocabularyAssessmentSessionR1 {
  if (input.id.trim().length === 0) {
    throw new TypeError('Travel vocabulary assessment id cannot be empty')
  }
  parseTimestamp(input.startedAt, 'startedAt')
  validateTravelVocabularyBankR1(input.bank)
  return {
    schemaVersion: 3,
    assessmentKind: 'staged-travel-vocabulary',
    id: input.id,
    bankId: input.bank.id,
    startedAt: input.startedAt,
    status: 'in-progress',
    currentStageIndex: 0,
    currentQuestionIndex: 0,
    stagePlans: sampleTravelVocabularyStagePlansR1({
      bank: input.bank,
      random: input.random,
      recentWordIds: input.recentWordIds,
    }),
    draftAnswers: {},
    completedStages: [],
  }
}

export function navigateTravelVocabularyQuestionR1(input: {
  readonly session: TravelVocabularyAssessmentSessionR1
  readonly questionIndex: number
}): TravelVocabularyAssessmentSessionR1 {
  if (
    input.session.status !== 'in-progress' ||
    input.session.completedStages.length >
      input.session.currentStageIndex
  ) {
    throw new TypeError('The current travel vocabulary stage is not editable')
  }
  if (
    !Number.isInteger(input.questionIndex) ||
    input.questionIndex < 0 ||
    input.questionIndex >=
      TRAVEL_VOCABULARY_SAMPLE_SIZE_PER_STAGE_R1
  ) {
    throw new RangeError('questionIndex must be between 0 and 29')
  }
  return {
    ...input.session,
    currentQuestionIndex: input.questionIndex,
  }
}

export function answerTravelVocabularyQuestionR1(input: {
  readonly session: TravelVocabularyAssessmentSessionR1
  readonly questionId: string
  readonly answer:
    | { readonly kind: 'choice'; readonly optionId: string }
    | { readonly kind: 'uncertain' }
}): TravelVocabularyAssessmentSessionR1 {
  const question = questionInCurrentStage(
    input.session,
    input.questionId,
  )
  let draft: TravelVocabularyDraftAnswerR1
  if (input.answer.kind === 'choice') {
    const optionId = input.answer.optionId
    if (
      !question.options.some(
        (option) => option.id === optionId,
      )
    ) {
      throw new TypeError(
        `Option ${optionId} does not belong to ${question.id}`,
      )
    }
    draft = {
      questionId: question.id,
      kind: 'choice',
      optionId,
    }
  } else {
    draft = {
      questionId: question.id,
      kind: 'uncertain',
      optionId: null,
    }
  }
  return {
    ...input.session,
    draftAnswers: {
      ...input.session.draftAnswers,
      [question.id]: draft,
    },
  }
}

export function clearTravelVocabularyAnswerR1(input: {
  readonly session: TravelVocabularyAssessmentSessionR1
  readonly questionId: string
}): TravelVocabularyAssessmentSessionR1 {
  questionInCurrentStage(input.session, input.questionId)
  const next = { ...input.session.draftAnswers }
  Reflect.deleteProperty(next, input.questionId)
  return {
    ...input.session,
    draftAnswers: next,
  }
}

export function canSubmitTravelVocabularyStageR1(
  session: TravelVocabularyAssessmentSessionR1,
): boolean {
  if (
    session.status !== 'in-progress' ||
    session.completedStages.length > session.currentStageIndex
  ) {
    return false
  }
  const plan = currentStagePlan(session)
  return plan.questions.every(
    (question) => session.draftAnswers[question.id] !== undefined,
  )
}

export function submitTravelVocabularyStageR1(input: {
  readonly session: TravelVocabularyAssessmentSessionR1
  readonly bank: TravelVocabularyBankR1
  readonly submittedAt: string
}): {
  readonly session: TravelVocabularyAssessmentSessionR1
  readonly result: TravelVocabularyStageResultR1
} {
  parseTimestamp(input.submittedAt, 'submittedAt')
  validateTravelVocabularyBankR1(input.bank)
  if (input.session.bankId !== input.bank.id) {
    throw new TypeError('Travel vocabulary session bank is incompatible')
  }
  if (!canSubmitTravelVocabularyStageR1(input.session)) {
    throw new TypeError(
      'All 30 questions must be answered before stage submission',
    )
  }
  const plan = currentStagePlan(input.session)
  const stage = input.bank.stages[input.session.currentStageIndex]
  if (!stage || stage.id !== plan.stageId) {
    throw new TypeError('Travel vocabulary stage plan is incompatible')
  }
  const responses = plan.questions.map((question) => {
    const draft = input.session.draftAnswers[question.id]
    if (!draft) {
      throw new TypeError(`Missing draft answer for ${question.id}`)
    }
    const correctOptionId = correctTravelVocabularyOptionIdR1({
      bank: input.bank,
      question,
    })
    const answer =
      draft.kind === 'uncertain'
        ? 'uncertain'
        : draft.optionId === correctOptionId
          ? 'correct'
          : 'incorrect'
    return {
      questionId: question.id,
      wordId: question.wordId,
      selectedOptionId: draft.optionId,
      answer,
    } as const
  })
  const correctCount = responses.filter(
    (response) => response.answer === 'correct',
  ).length
  const incorrectCount = responses.filter(
    (response) => response.answer === 'incorrect',
  ).length
  const uncertainCount = responses.filter(
    (response) => response.answer === 'uncertain',
  ).length
  const result = estimateTravelVocabularyStageR1({
    stageId: stage.id,
    stageOrder: stage.order,
    stageLabel: stage.label,
    representativeWordCount: stage.representativeWordCount,
    correctCount,
    incorrectCount,
    uncertainCount,
    submittedAt: input.submittedAt,
    responses,
  })
  const completedStages = [...input.session.completedStages, result]
  const finalStage =
    input.session.currentStageIndex ===
    TRAVEL_VOCABULARY_TOTAL_STAGES_R1 - 1
  return {
    session: {
      ...input.session,
      status: finalStage ? 'completed' : 'in-progress',
      completedStages,
      draftAnswers: {},
    },
    result,
  }
}

export function continueTravelVocabularyStageR1(
  session: TravelVocabularyAssessmentSessionR1,
): TravelVocabularyAssessmentSessionR1 {
  if (session.status === 'completed') {
    throw new TypeError('Travel vocabulary assessment is completed')
  }
  if (
    session.completedStages.length !==
    session.currentStageIndex + 1
  ) {
    throw new TypeError('The current stage has not been submitted')
  }
  return {
    ...session,
    currentStageIndex: session.currentStageIndex + 1,
    currentQuestionIndex: 0,
    draftAnswers: {},
  }
}

export function sampledTravelVocabularyWordIdsR1(
  session: TravelVocabularyAssessmentSessionR1,
): readonly string[] {
  return session.stagePlans.flatMap((stage) =>
    stage.questions.map((question) => question.wordId),
  )
}
