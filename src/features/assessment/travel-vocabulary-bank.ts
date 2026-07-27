import type {
  PublicTravelVocabularyQuestionR1,
  RandomSourceR1,
  TravelVocabularyBankR1,
  TravelVocabularyCandidateR1,
  TravelVocabularyQuestionPlanR1,
  TravelVocabularyStagePlanR1,
} from './travel-vocabulary-types.ts'

const MINIMUM_CANDIDATES_PER_STAGE = 150
const OPTION_COUNT = 4

function assertRandomValue(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new TypeError('Random source must return a value in [0, 1)')
  }
  return value
}

function shuffled<T>(
  values: readonly T[],
  random: RandomSourceR1,
): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(assertRandomValue(random()) * (index + 1))
    const current = result[index]
    const replacement = result[target]
    if (current === undefined || replacement === undefined) {
      throw new TypeError('Cannot shuffle an incomplete collection')
    }
    result[index] = replacement
    result[target] = current
  }
  return result
}

function validateCandidate(
  candidate: TravelVocabularyCandidateR1,
  expectedStageId: TravelVocabularyCandidateR1['stageId'],
): void {
  if (
    candidate.stageId !== expectedStageId ||
    candidate.id !== `${expectedStageId}-${candidate.word}` ||
    !/^[a-z]+(?:-[a-z]+)?$/.test(candidate.word) ||
    candidate.meaningZh.trim().length === 0
  ) {
    throw new TypeError(
      `Invalid travel vocabulary candidate ${candidate.id}`,
    )
  }
}

export function validateTravelVocabularyBankR1(
  bank: TravelVocabularyBankR1,
): TravelVocabularyBankR1 {
  if (
    bank.id !== 'travel-vocabulary-zh-cn-r1-v1' ||
    bank.schemaVersion !== 3 ||
    bank.assessmentKind !== 'staged-travel-vocabulary' ||
    bank.dataVersion !== 'travel-vocabulary-pools-r1-v1' ||
    bank.estimationModelVersion !==
      'travel-vocabulary-estimation-r1-v1' ||
    bank.resultMappingVersion !==
      'travel-vocabulary-level-map-r1-v1' ||
    bank.locale !== 'en-US' ||
    bank.meaningLocale !== 'zh-CN' ||
    bank.sampleSizePerStage !== 30 ||
    bank.stages.length !== 5
  ) {
    throw new TypeError('Unsupported R1 travel vocabulary bank')
  }

  const globalIds = new Set<string>()
  const globalWords = new Set<string>()
  for (const [index, stage] of bank.stages.entries()) {
    if (
      stage.order !== index + 1 ||
      stage.candidates.length < MINIMUM_CANDIDATES_PER_STAGE ||
      stage.representativeWordCount < stage.candidates.length ||
      stage.label.trim().length === 0 ||
      stage.description.trim().length === 0
    ) {
      throw new TypeError(
        `Travel vocabulary stage ${stage.id} is incomplete`,
      )
    }
    const meanings = new Set<string>()
    for (const candidate of stage.candidates) {
      validateCandidate(candidate, stage.id)
      if (
        globalIds.has(candidate.id) ||
        globalWords.has(candidate.word)
      ) {
        throw new TypeError(
          `Duplicate travel vocabulary word ${candidate.word}`,
        )
      }
      if (meanings.has(candidate.meaningZh)) {
        throw new TypeError(
          `Duplicate Chinese meaning in ${stage.id}: ${candidate.meaningZh}`,
        )
      }
      globalIds.add(candidate.id)
      globalWords.add(candidate.word)
      meanings.add(candidate.meaningZh)
    }
  }
  return bank
}

function selectStageCandidates(input: {
  readonly candidates: readonly TravelVocabularyCandidateR1[]
  readonly recentWordIds: ReadonlySet<string>
  readonly sampleSize: number
  readonly random: RandomSourceR1
}): readonly TravelVocabularyCandidateR1[] {
  const fresh = shuffled(
    input.candidates.filter(
      (candidate) => !input.recentWordIds.has(candidate.id),
    ),
    input.random,
  )
  const recent = shuffled(
    input.candidates.filter(
      (candidate) => input.recentWordIds.has(candidate.id),
    ),
    input.random,
  )
  return [...fresh, ...recent].slice(0, input.sampleSize)
}

function buildQuestion(input: {
  readonly target: TravelVocabularyCandidateR1
  readonly stageCandidates: readonly TravelVocabularyCandidateR1[]
  readonly random: RandomSourceR1
}): TravelVocabularyQuestionPlanR1 {
  const distractors = shuffled(
    input.stageCandidates.filter(
      (candidate) =>
        candidate.id !== input.target.id &&
        candidate.meaningZh !== input.target.meaningZh,
    ),
    input.random,
  ).slice(0, OPTION_COUNT - 1)
  if (distractors.length !== OPTION_COUNT - 1) {
    throw new TypeError(
      `Not enough distractors for ${input.target.id}`,
    )
  }
  const meanings = shuffled(
    [input.target, ...distractors].map(
      (candidate) => candidate.meaningZh,
    ),
    input.random,
  )
  return {
    id: `question-${input.target.id}`,
    stageId: input.target.stageId,
    wordId: input.target.id,
    word: input.target.word,
    options: meanings.map((text, index) => ({
      id: `choice-${index + 1}`,
      text,
    })),
  }
}

export function sampleTravelVocabularyStagePlansR1(input: {
  readonly bank: TravelVocabularyBankR1
  readonly random: RandomSourceR1
  readonly recentWordIds?: readonly string[]
}): readonly TravelVocabularyStagePlanR1[] {
  const bank = validateTravelVocabularyBankR1(input.bank)
  const recentWordIds = new Set(input.recentWordIds ?? [])
  const plans = bank.stages.map((stage) => {
    const selected = selectStageCandidates({
      candidates: stage.candidates,
      recentWordIds,
      sampleSize: bank.sampleSizePerStage,
      random: input.random,
    })
    if (selected.length !== bank.sampleSizePerStage) {
      throw new TypeError(`Stage ${stage.id} cannot provide 30 questions`)
    }
    return {
      stageId: stage.id,
      questions: selected.map((target) =>
        buildQuestion({
          target,
          stageCandidates: stage.candidates,
          random: input.random,
        }),
      ),
    }
  })
  const sampledIds = plans.flatMap((stage) =>
    stage.questions.map((question) => question.wordId),
  )
  if (
    sampledIds.length !== 150 ||
    new Set(sampledIds).size !== sampledIds.length
  ) {
    throw new TypeError('R1 sampled questions must be globally unique')
  }
  return plans
}

export function toPublicTravelVocabularyQuestionR1(
  question: TravelVocabularyQuestionPlanR1,
): PublicTravelVocabularyQuestionR1 {
  return {
    id: question.id,
    stageId: question.stageId,
    kind: 'choice',
    prompt: '请选择最接近的中文释义',
    word: question.word,
    options: question.options,
  }
}

export function correctTravelVocabularyOptionIdR1(input: {
  readonly bank: TravelVocabularyBankR1
  readonly question: TravelVocabularyQuestionPlanR1
}): string {
  const candidate = input.bank.stages
    .flatMap((stage) => stage.candidates)
    .find((item) => item.id === input.question.wordId)
  if (!candidate || candidate.word !== input.question.word) {
    throw new TypeError(
      `Question ${input.question.id} does not match the R1 bank`,
    )
  }
  const correct = input.question.options.find(
    (option) => option.text === candidate.meaningZh,
  )
  if (!correct) {
    throw new TypeError(
      `Question ${input.question.id} has no correct Chinese meaning`,
    )
  }
  return correct.id
}
