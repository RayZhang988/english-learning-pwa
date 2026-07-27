import { placementBankV1 } from '../../../content/assessment/placement-bank.v1.ts'
import { vocabularyPlacementBankV2 } from '../../../content/assessment/placement-bank.v2.ts'
import {
  correctTravelVocabularyOptionIdR1,
  validateTravelVocabularyBankR1,
} from './travel-vocabulary-bank.ts'
import {
  estimateTravelVocabularyStageR1,
  TRAVEL_VOCABULARY_TOTAL_STAGES_R1,
} from './travel-vocabulary-model.ts'
import { buildTravelVocabularyAbilityProfileR1 } from './travel-vocabulary-profile.ts'
import { parseAssessmentRuntimeSnapshot } from './snapshot.ts'
import { parseVocabularyAssessmentRuntimeSnapshotV2 } from './vocabulary-snapshot.ts'
import type {
  AbilityProfileR1,
  LegacyTravelAssessmentSourceR1,
  TravelVocabularyAssessmentRuntimeSnapshotR1,
  TravelVocabularyAssessmentSessionR1,
  TravelVocabularyBankR1,
  TravelVocabularyDraftAnswerR1,
  TravelVocabularyQuestionPlanR1,
  TravelVocabularyStagePlanR1,
  TravelVocabularyStageResultR1,
} from './travel-vocabulary-types.ts'

type UnknownRecord = Record<string, unknown>

function invalid(message: string): never {
  throw new TypeError(
    `Invalid R1 travel vocabulary snapshot: ${message}`,
  )
}

function record(value: unknown, field: string): UnknownRecord {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    invalid(`${field} must be an object`)
  }
  return value as UnknownRecord
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid(`${field} must be a non-empty string`)
  }
  return value
}

function timestamp(value: unknown, field: string): string {
  const result = string(value, field)
  if (!Number.isFinite(Date.parse(result))) {
    invalid(`${field} must be a valid ISO timestamp`)
  }
  return result
}

function integer(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid(`${field} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function finite(
  value: unknown,
  field: string,
  minimum = 0,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum
  ) {
    invalid(`${field} must be a finite number >= ${minimum}`)
  }
  return value
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function questionPlan(input: {
  readonly value: unknown
  readonly bank: TravelVocabularyBankR1
  readonly stageIndex: number
  readonly questionIndex: number
}): TravelVocabularyQuestionPlanR1 {
  const label =
    `session.stagePlans[${input.stageIndex}].questions[${input.questionIndex}]`
  const source = record(input.value, label)
  const stage = input.bank.stages[input.stageIndex]
  if (!stage || source.stageId !== stage.id) {
    invalid(`${label}.stageId is incompatible`)
  }
  const wordId = string(source.wordId, `${label}.wordId`)
  const candidate = stage.candidates.find(
    (item) => item.id === wordId,
  )
  if (
    !candidate ||
    source.id !== `question-${wordId}` ||
    source.word !== candidate.word ||
    'scoring' in source
  ) {
    invalid(`${label} does not match its bank word`)
  }
  if (!Array.isArray(source.options) || source.options.length !== 4) {
    invalid(`${label}.options must contain four choices`)
  }
  const optionIds = new Set<string>()
  const optionTexts = new Set<string>()
  const options = source.options.map((value, index) => {
    const option = record(value, `${label}.options[${index}]`)
    const id = string(option.id, `${label}.options[${index}].id`)
    const text = string(
      option.text,
      `${label}.options[${index}].text`,
    )
    if (
      id !== `choice-${index + 1}` ||
      optionIds.has(id) ||
      optionTexts.has(text)
    ) {
      invalid(`${label}.options are invalid`)
    }
    optionIds.add(id)
    optionTexts.add(text)
    return { id, text }
  })
  if (!optionTexts.has(candidate.meaningZh)) {
    invalid(`${label} omits the target meaning`)
  }
  return {
    id: source.id as string,
    stageId: stage.id,
    wordId,
    word: candidate.word,
    options,
  }
}

function stagePlans(
  value: unknown,
  bank: TravelVocabularyBankR1,
): readonly TravelVocabularyStagePlanR1[] {
  if (!Array.isArray(value) || value.length !== 5) {
    invalid('session.stagePlans must contain five stages')
  }
  const sampledWordIds = new Set<string>()
  return value.map((candidate, stageIndex) => {
    const source = record(
      candidate,
      `session.stagePlans[${stageIndex}]`,
    )
    const stage = bank.stages[stageIndex]
    if (!stage || source.stageId !== stage.id) {
      invalid(`session.stagePlans[${stageIndex}] is incompatible`)
    }
    if (
      !Array.isArray(source.questions) ||
      source.questions.length !== 30
    ) {
      invalid(
        `session.stagePlans[${stageIndex}] must contain 30 questions`,
      )
    }
    const questions = source.questions.map((question, questionIndex) =>
      questionPlan({
        value: question,
        bank,
        stageIndex,
        questionIndex,
      }),
    )
    for (const question of questions) {
      if (sampledWordIds.has(question.wordId)) {
        invalid('session.stagePlans contains duplicate words')
      }
      sampledWordIds.add(question.wordId)
    }
    return { stageId: stage.id, questions }
  })
}

function stageResult(input: {
  readonly value: unknown
  readonly bank: TravelVocabularyBankR1
  readonly plan: TravelVocabularyStagePlanR1
  readonly stageIndex: number
}): TravelVocabularyStageResultR1 {
  const label = `session.completedStages[${input.stageIndex}]`
  const source = record(input.value, label)
  const stage = input.bank.stages[input.stageIndex]
  if (
    !stage ||
    source.stageId !== stage.id ||
    source.stageOrder !== stage.order ||
    source.stageLabel !== stage.label ||
    source.representativeWordCount !== stage.representativeWordCount
  ) {
    invalid(`${label} identity is incompatible`)
  }
  const submittedAt = timestamp(
    source.submittedAt,
    `${label}.submittedAt`,
  )
  if (
    !Array.isArray(source.responses) ||
    source.responses.length !== 30
  ) {
    invalid(`${label}.responses must contain 30 answers`)
  }
  const responses = source.responses.map((value, index) => {
    const response = record(
      value,
      `${label}.responses[${index}]`,
    )
    const question = input.plan.questions[index]
    if (
      !question ||
      response.questionId !== question.id ||
      response.wordId !== question.wordId
    ) {
      invalid(`${label}.responses[${index}] is out of order`)
    }
    const selectedOptionId =
      response.selectedOptionId === null
        ? null
        : string(
            response.selectedOptionId,
            `${label}.responses[${index}].selectedOptionId`,
          )
    const validSelected =
      selectedOptionId === null ||
      question.options.some(
        (option) => option.id === selectedOptionId,
      )
    if (!validSelected) {
      invalid(`${label}.responses[${index}] has an invalid choice`)
    }
    const correctOptionId = correctTravelVocabularyOptionIdR1({
      bank: input.bank,
      question,
    })
    const expectedAnswer =
      selectedOptionId === null
        ? 'uncertain'
        : selectedOptionId === correctOptionId
          ? 'correct'
          : 'incorrect'
    if (response.answer !== expectedAnswer) {
      invalid(`${label}.responses[${index}] has fabricated scoring`)
    }
    return {
      questionId: question.id,
      wordId: question.wordId,
      selectedOptionId,
      answer: expectedAnswer,
    } as const
  })
  const expected = estimateTravelVocabularyStageR1({
    stageId: stage.id,
    stageOrder: stage.order,
    stageLabel: stage.label,
    representativeWordCount: stage.representativeWordCount,
    correctCount: responses.filter(
      (response) => response.answer === 'correct',
    ).length,
    incorrectCount: responses.filter(
      (response) => response.answer === 'incorrect',
    ).length,
    uncertainCount: responses.filter(
      (response) => response.answer === 'uncertain',
    ).length,
    submittedAt,
    responses,
  })
  if (!jsonEqual(source, expected)) {
    invalid(`${label} does not match its response evidence`)
  }
  return expected
}

function draftAnswers(input: {
  readonly value: unknown
  readonly currentPlan: TravelVocabularyStagePlanR1
}): Readonly<Record<string, TravelVocabularyDraftAnswerR1>> {
  const source = record(input.value, 'session.draftAnswers')
  const parsed: Record<string, TravelVocabularyDraftAnswerR1> = {}
  for (const [questionId, value] of Object.entries(source)) {
    const answer = record(
      value,
      `session.draftAnswers.${questionId}`,
    )
    const question = input.currentPlan.questions.find(
      (candidate) => candidate.id === questionId,
    )
    if (!question || answer.questionId !== questionId) {
      invalid(`session.draftAnswers.${questionId} is stale`)
    }
    if (answer.kind === 'uncertain') {
      if (answer.optionId !== null) {
        invalid(`session.draftAnswers.${questionId} is invalid`)
      }
      parsed[questionId] = {
        questionId,
        kind: 'uncertain',
        optionId: null,
      }
    } else if (
      answer.kind === 'choice' &&
      typeof answer.optionId === 'string' &&
      question.options.some(
        (option) => option.id === answer.optionId,
      )
    ) {
      parsed[questionId] = {
        questionId,
        kind: 'choice',
        optionId: answer.optionId,
      }
    } else {
      invalid(`session.draftAnswers.${questionId} is invalid`)
    }
  }
  return parsed
}

function session(
  value: unknown,
  bank: TravelVocabularyBankR1,
): TravelVocabularyAssessmentSessionR1 {
  const source = record(value, 'session')
  if (
    source.schemaVersion !== 3 ||
    source.assessmentKind !== 'staged-travel-vocabulary' ||
    source.bankId !== bank.id
  ) {
    invalid('session identity is incompatible')
  }
  const id = string(source.id, 'session.id')
  const startedAt = timestamp(source.startedAt, 'session.startedAt')
  if (
    source.status !== 'in-progress' &&
    source.status !== 'completed'
  ) {
    invalid('session.status is unsupported')
  }
  const currentStageIndex = integer(
    source.currentStageIndex,
    'session.currentStageIndex',
    0,
    4,
  )
  const currentQuestionIndex = integer(
    source.currentQuestionIndex,
    'session.currentQuestionIndex',
    0,
    29,
  )
  const plans = stagePlans(source.stagePlans, bank)
  if (!Array.isArray(source.completedStages)) {
    invalid('session.completedStages must be an array')
  }
  if (
    source.completedStages.length >
    Math.min(5, currentStageIndex + 1)
  ) {
    invalid('session.completedStages exceeds current progress')
  }
  const completedStages = source.completedStages.map(
    (result, stageIndex) => {
      const plan = plans[stageIndex]
      if (!plan) {
        invalid('session.completedStages has no matching plan')
      }
      return stageResult({
        value: result,
        bank,
        plan,
        stageIndex,
      })
    },
  )
  const currentPlan = plans[currentStageIndex]
  if (!currentPlan) {
    invalid('session current stage plan is missing')
  }
  const drafts = draftAnswers({
    value: source.draftAnswers,
    currentPlan,
  })
  if (
    source.status === 'completed' &&
    (currentStageIndex !== 4 ||
      completedStages.length !==
        TRAVEL_VOCABULARY_TOTAL_STAGES_R1 ||
      Object.keys(drafts).length !== 0)
  ) {
    invalid('completed session is inconsistent')
  }
  if (
    source.status === 'in-progress' &&
    completedStages.length < currentStageIndex
  ) {
    invalid('in-progress session skipped a stage')
  }
  return {
    schemaVersion: 3,
    assessmentKind: 'staged-travel-vocabulary',
    id,
    bankId: bank.id,
    startedAt,
    status: source.status,
    currentStageIndex,
    currentQuestionIndex,
    stagePlans: plans,
    draftAnswers: drafts,
    completedStages,
  }
}

function profile(input: {
  readonly value: unknown
  readonly session: TravelVocabularyAssessmentSessionR1
  readonly bank: TravelVocabularyBankR1
  readonly activeElapsedMs: number
}): AbilityProfileR1 {
  const source = record(input.value, 'profile')
  const completedAt = timestamp(source.completedAt, 'profile.completedAt')
  const expected = buildTravelVocabularyAbilityProfileR1({
    session: input.session,
    bank: input.bank,
    completedAt,
    durationSeconds: input.activeElapsedMs / 1000,
  })
  if (!jsonEqual(source, expected)) {
    invalid('profile does not match completed R1 evidence')
  }
  return expected
}

function legacySource(
  value: unknown,
): LegacyTravelAssessmentSourceR1 | null {
  if (value === null) {
    return null
  }
  const source = record(value, 'legacySource')
  if (source.kind === 'assessment-runtime-v1') {
    return {
      kind: 'assessment-runtime-v1',
      snapshot: parseAssessmentRuntimeSnapshot(
        source.snapshot,
        placementBankV1,
      ),
    }
  }
  if (source.kind === 'adaptive-vocabulary-runtime-v2') {
    return {
      kind: 'adaptive-vocabulary-runtime-v2',
      snapshot: parseVocabularyAssessmentRuntimeSnapshotV2(
        source.snapshot,
        vocabularyPlacementBankV2,
      ),
    }
  }
  invalid('legacySource.kind is unsupported')
}

export function parseTravelVocabularyRuntimeSnapshotR1(
  value: unknown,
  bank: TravelVocabularyBankR1,
): TravelVocabularyAssessmentRuntimeSnapshotR1 {
  validateTravelVocabularyBankR1(bank)
  const source = record(value, 'snapshot')
  if (
    source.schemaVersion !== 3 ||
    source.assessmentKind !== 'staged-travel-vocabulary' ||
    source.bankId !== bank.id
  ) {
    invalid('snapshot identity is incompatible')
  }
  if (
    source.lifecycle !== 'intro' &&
    source.lifecycle !== 'active' &&
    source.lifecycle !== 'stage-summary' &&
    source.lifecycle !== 'paused' &&
    source.lifecycle !== 'completed'
  ) {
    invalid('lifecycle is unsupported')
  }
  if (
    source.resumeTo !== null &&
    source.resumeTo !== 'active' &&
    source.resumeTo !== 'stage-summary'
  ) {
    invalid('resumeTo is unsupported')
  }
  const updatedAt = timestamp(source.updatedAt, 'updatedAt')
  const activeElapsedMs = finite(
    source.activeElapsedMs,
    'activeElapsedMs',
  )
  const parsedSession = session(source.session, bank)
  const parsedLegacy = legacySource(source.legacySource)
  if (
    source.migrationNotice !== null &&
    source.migrationNotice !==
      'legacy-measurement-incompatible-new-sample-required'
  ) {
    invalid('migrationNotice is unsupported')
  }
  if (
    (parsedLegacy === null) !== (source.migrationNotice === null)
  ) {
    invalid('legacy source and migration notice must agree')
  }

  if (source.lifecycle === 'intro') {
    if (
      parsedSession.status !== 'in-progress' ||
      parsedSession.currentStageIndex !== 0 ||
      parsedSession.completedStages.length !== 0 ||
      Object.keys(parsedSession.draftAnswers).length !== 0 ||
      source.resumeTo !== null ||
      source.profile !== null
    ) {
      invalid('intro lifecycle is inconsistent')
    }
  } else if (source.lifecycle === 'active') {
    if (
      parsedSession.status !== 'in-progress' ||
      parsedSession.completedStages.length !==
        parsedSession.currentStageIndex ||
      source.resumeTo !== null ||
      source.profile !== null
    ) {
      invalid('active lifecycle is inconsistent')
    }
  } else if (source.lifecycle === 'stage-summary') {
    if (
      parsedSession.status !== 'in-progress' ||
      parsedSession.completedStages.length !==
        parsedSession.currentStageIndex + 1 ||
      Object.keys(parsedSession.draftAnswers).length !== 0 ||
      source.resumeTo !== null ||
      source.profile !== null
    ) {
      invalid('stage-summary lifecycle is inconsistent')
    }
  } else if (source.lifecycle === 'paused') {
    const expectedCompleted =
      source.resumeTo === 'stage-summary'
        ? parsedSession.currentStageIndex + 1
        : parsedSession.currentStageIndex
    if (
      parsedSession.status !== 'in-progress' ||
      source.resumeTo === null ||
      parsedSession.completedStages.length !== expectedCompleted ||
      source.profile !== null
    ) {
      invalid('paused lifecycle is inconsistent')
    }
  } else if (
    parsedSession.status !== 'completed' ||
    source.resumeTo !== null ||
    source.profile === null
  ) {
    invalid('completed lifecycle is inconsistent')
  }

  const parsedProfile =
    source.profile === null
      ? null
      : profile({
          value: source.profile,
          session: parsedSession,
          bank,
          activeElapsedMs,
        })
  return structuredClone({
    schemaVersion: 3,
    assessmentKind: 'staged-travel-vocabulary',
    bankId: bank.id,
    lifecycle: source.lifecycle,
    resumeTo: source.resumeTo,
    session: parsedSession,
    activeElapsedMs,
    profile: parsedProfile,
    legacySource: parsedLegacy,
    migrationNotice: source.migrationNotice,
    updatedAt,
  } as TravelVocabularyAssessmentRuntimeSnapshotR1)
}
