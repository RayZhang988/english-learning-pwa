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
  TravelVocabularyCompletionReasonR1,
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
    completionReason: null,
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

function assertEditableCurrentStage(
  session: TravelVocabularyAssessmentSessionR1,
): void {
  if (
    session.status !== 'in-progress' ||
    session.completedStages.length > session.currentStageIndex
  ) {
    throw new TypeError('The current travel vocabulary stage is not editable')
  }
}

export function navigateTravelVocabularyQuestionR1(input: {
  readonly session: TravelVocabularyAssessmentSessionR1
  readonly questionIndex: number
}): TravelVocabularyAssessmentSessionR1 {
  assertEditableCurrentStage(input.session)
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

export function advanceTravelVocabularyQuestionR1(input: {
  readonly session: TravelVocabularyAssessmentSessionR1
}): TravelVocabularyAssessmentSessionR1 {
  assertEditableCurrentStage(input.session)
  if (
    input.session.currentQuestionIndex >=
    TRAVEL_VOCABULARY_SAMPLE_SIZE_PER_STAGE_R1 - 1
  ) {
    throw new RangeError('The current question is already the final question')
  }
  const plan = currentStagePlan(input.session)
  const currentQuestion =
    plan.questions[input.session.currentQuestionIndex]
  if (!currentQuestion) {
    throw new TypeError('Travel vocabulary current question is unavailable')
  }
  const session =
    input.session.draftAnswers[currentQuestion.id] === undefined
      ? answerTravelVocabularyQuestionR1({
          session: input.session,
          questionId: currentQuestion.id,
          answer: { kind: 'uncertain' },
        })
      : input.session
  return {
    ...session,
    currentQuestionIndex: session.currentQuestionIndex + 1,
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
  return (
    session.status === 'in-progress' &&
    session.completedStages.length === session.currentStageIndex
  )
}

export function fillUnansweredTravelVocabularyStageR1(
  session: TravelVocabularyAssessmentSessionR1,
): TravelVocabularyAssessmentSessionR1 {
  assertEditableCurrentStage(session)
  const plan = currentStagePlan(session)
  const draftAnswers = { ...session.draftAnswers }
  for (const question of plan.questions) {
    if (draftAnswers[question.id] === undefined) {
      draftAnswers[question.id] = {
        questionId: question.id,
        kind: 'uncertain',
        optionId: null,
      }
    }
  }
  return {
    ...session,
    draftAnswers,
  }
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
    throw new TypeError('The current travel vocabulary stage cannot be submitted')
  }
  const completedDraftSession =
    fillUnansweredTravelVocabularyStageR1(input.session)
  const plan = currentStagePlan(completedDraftSession)
  const stage = input.bank.stages[completedDraftSession.currentStageIndex]
  if (!stage || stage.id !== plan.stageId) {
    throw new TypeError('Travel vocabulary stage plan is incompatible')
  }
  const responses = plan.questions.map((question) => {
    const draft = completedDraftSession.draftAnswers[question.id]
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
  const completedStages = [...completedDraftSession.completedStages, result]
  const finalStage =
    completedDraftSession.currentStageIndex ===
    TRAVEL_VOCABULARY_TOTAL_STAGES_R1 - 1
  return {
    session: {
      ...completedDraftSession,
      status: finalStage ? 'completed' : 'in-progress',
      completionReason: finalStage ? 'all-stages-completed' : null,
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
    completionReason: null,
  }
}

function effectiveCompletionReason(
  session: TravelVocabularyAssessmentSessionR1,
): TravelVocabularyCompletionReasonR1 | null {
  if (session.completionReason !== undefined) {
    return session.completionReason
  }
  return session.status === 'completed' ? 'all-stages-completed' : null
}

export function finishTravelVocabularyRemainingUnknownR1(input: {
  readonly session: TravelVocabularyAssessmentSessionR1
  readonly bank: TravelVocabularyBankR1
  readonly submittedAt: string
}): TravelVocabularyAssessmentSessionR1 {
  parseTimestamp(input.submittedAt, 'submittedAt')
  validateTravelVocabularyBankR1(input.bank)
  if (input.session.bankId !== input.bank.id) {
    throw new TypeError('Travel vocabulary session bank is incompatible')
  }
  const existingReason = effectiveCompletionReason(input.session)
  if (input.session.status === 'completed') {
    if (existingReason === 'remaining-marked-unknown') {
      return input.session
    }
    throw new TypeError(
      'A normally completed travel vocabulary assessment cannot be changed',
    )
  }

  let session = input.session
  if (session.completedStages.length === session.currentStageIndex) {
    session = submitTravelVocabularyStageR1({
      session,
      bank: input.bank,
      submittedAt: input.submittedAt,
    }).session
  } else if (
    session.completedStages.length !== session.currentStageIndex + 1
  ) {
    throw new TypeError('Travel vocabulary stage progress is inconsistent')
  }

  while (
    session.completedStages.length <
    TRAVEL_VOCABULARY_TOTAL_STAGES_R1
  ) {
    session = continueTravelVocabularyStageR1(session)
    session = submitTravelVocabularyStageR1({
      session,
      bank: input.bank,
      submittedAt: input.submittedAt,
    }).session
  }

  return {
    ...session,
    status: 'completed',
    completionReason: 'remaining-marked-unknown',
  }
}

export function sampledTravelVocabularyWordIdsR1(
  session: TravelVocabularyAssessmentSessionR1,
): readonly string[] {
  return session.stagePlans.flatMap((stage) =>
    stage.questions.map((question) => question.wordId),
  )
}
