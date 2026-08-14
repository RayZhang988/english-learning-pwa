import type { ReadonlyDataSource } from '../../core/index.ts'
import { buildVocabularySupplyQuestion, judgeVocabularyAnswer } from './questions.ts'
import { VocabularyError } from './errors.ts'
import type {
  VocabularyAnswerFeedback,
  VocabularyCatalog,
  VocabularyQuestion,
  VocabularyQuestionOption,
  VocabularyQuestionType,
  VocabularySupplyItem,
} from './types.ts'

type SupplyIndex = { readonly schemaVersion: 1; readonly candidates: readonly unknown[] }

export interface VocabularyGrowthUpgradeQuestionView {
  readonly itemId: string
  readonly type: VocabularyQuestionType
  readonly instructionZh: string
  readonly prompt: string
  readonly promptLocale: 'en-US' | 'zh-CN'
  readonly partOfSpeech: string | null
  readonly options: readonly VocabularyQuestionOption[]
}

export interface VocabularyGrowthUpgradeSubmission {
  readonly itemId: string
  readonly scorable: true
  readonly correct: boolean
  readonly feedback: VocabularyAnswerFeedback
}

export interface VocabularyGrowthUpgradeAdapter {
  resolve(input: {
    readonly domain: string
    readonly itemId: string
    readonly expectedDifficultyLevel: number
  }): Promise<VocabularyGrowthUpgradeQuestionView>
  submit(input: {
    readonly domain: string
    readonly itemId: string
    readonly expectedDifficultyLevel: number
    readonly selectedOptionId: string
  }): Promise<VocabularyGrowthUpgradeSubmission>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function supplyItemFor(
  catalog: VocabularyCatalog,
  domain: string,
  itemId: string,
  expectedDifficultyLevel: number,
): VocabularySupplyItem {
  if (domain !== 'vocabulary') {
    throw new VocabularyError('task-incompatible', 'Vocabulary growth adapter requires vocabulary domain.')
  }
  const index = catalog.trainingSupplyIndex
  if (!isRecord(index) || index.schemaVersion !== 1 || !Array.isArray(index.candidates)) {
    throw new VocabularyError('content-invalid', 'Released vocabulary supply index is unavailable.')
  }
  const candidate = (index as SupplyIndex).candidates.find((value) =>
    isRecord(value) && value.itemId === itemId,
  )
  if (!isRecord(candidate) || candidate.domain !== 'vocabulary' || candidate.targetModuleId !== 'vocabulary' || !isRecord(candidate.source) || candidate.source.sourceType !== 'vocabulary-item') {
    throw new VocabularyError('content-reference-missing', 'Requested item is not a released daily vocabulary item.')
  }
  if (candidate.difficultyLevel !== expectedDifficultyLevel) {
    throw new VocabularyError('task-incompatible', 'Requested vocabulary item does not match the target growth level.')
  }
  const source = candidate.source
  if (typeof candidate.learningUnitId !== 'string' || typeof candidate.contentRef !== 'string' ||
    typeof candidate.knowledgePointId !== 'string' || candidate.knowledgePointId.trim().length === 0 ||
    typeof candidate.semanticCategoryId !== 'string' || candidate.semanticCategoryId.trim().length === 0 ||
    typeof source.sourceId !== 'string' || !Array.isArray(source.distractorItemIds) || !source.distractorItemIds.every((id) => typeof id === 'string') || !['term-to-meaning-choice', 'meaning-to-term-choice', 'example-gap-choice'].includes(String(source.variantId))) {
    throw new VocabularyError('content-invalid', 'Released vocabulary growth item is malformed.')
  }
  const item = catalog.getItem(source.sourceId)
  const distractors = source.distractorItemIds.map((id) => catalog.getItem(id))
  if (!item || distractors.some((value) => !value)) {
    throw new VocabularyError('content-reference-missing', 'Released vocabulary growth item references unavailable content.')
  }
  return {
    itemId,
    knowledgePointId: candidate.knowledgePointId,
    semanticCategoryId: candidate.semanticCategoryId,
    learningUnitId: candidate.learningUnitId,
    contentRef: candidate.contentRef,
    difficultyLevel: candidate.difficultyLevel as number,
    tags: Array.isArray(candidate.tags) ? candidate.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    source: {
      sourceType: 'vocabulary-item',
      sourceId: source.sourceId,
      variantId: source.variantId as VocabularySupplyItem['source']['variantId'],
      distractorItemIds: source.distractorItemIds,
    },
  }
}

function questionFor(catalog: VocabularyCatalog, domain: string, itemId: string, expectedDifficultyLevel: number): VocabularyQuestion {
  const supply = supplyItemFor(catalog, domain, itemId, expectedDifficultyLevel)
  const item = catalog.getItem(supply.source.sourceId)!
  const distractors = supply.source.distractorItemIds.map((id) => catalog.getItem(id)!)
  return buildVocabularySupplyQuestion(supply.itemId, item, distractors, supply.source.variantId)
}

function publicQuestion(question: VocabularyQuestion, itemId: string): VocabularyGrowthUpgradeQuestionView {
  return {
    itemId,
    type: question.type,
    instructionZh: question.instructionZh,
    prompt: question.prompt,
    promptLocale: question.promptLocale,
    partOfSpeech: question.partOfSpeech,
    options: question.options,
  }
}

/**
 * Stateless adapter for R17 upgrade tests. It resolves one already-selected
 * released daily supply item; it does not emit training, mastery, R7, or
 * wrong-answer events. 01 persists the attempt index and outcome atomically.
 */
export function createVocabularyGrowthUpgradeAdapter(
  contentSource: ReadonlyDataSource<VocabularyCatalog>,
): VocabularyGrowthUpgradeAdapter {
  return {
    async resolve(input) {
      const catalog = await contentSource.load()
      return publicQuestion(questionFor(catalog, input.domain, input.itemId, input.expectedDifficultyLevel), input.itemId)
    },
    async submit(input) {
      const catalog = await contentSource.load()
      const question = questionFor(catalog, input.domain, input.itemId, input.expectedDifficultyLevel)
      const correct = judgeVocabularyAnswer(question, input.selectedOptionId)
      const answer = question.options.find((option) => option.id === question.correctOptionId)
      if (!answer) throw new VocabularyError('content-invalid', 'Vocabulary growth question has no correct option.')
      return {
        itemId: input.itemId,
        scorable: true,
        correct,
        feedback: {
          correct,
          title: correct ? '回答正确' : '需要再看一次',
          description: correct ? '这个表达已完成一次正确提取。' : `正确答案：${answer.label}`,
          exampleEn: question.exampleEn,
          explanationZh: question.explanationZh,
        },
      }
    },
  }
}
