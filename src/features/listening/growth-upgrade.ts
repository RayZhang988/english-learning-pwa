import type { ReadonlyDataSource } from '../../core/index.ts'
import { judgeListeningAnswer } from './answers.ts'
import { ListeningError } from './errors.ts'
import { resolveListeningSupplyQuestion } from './supply.ts'
import type {
  ListeningAnswerFeedback,
  ListeningCatalog,
  ListeningDictationAnswerGuidance,
  ListeningPlaybackPolicy,
  ListeningQuestion,
  ListeningSegment,
  ListeningSupplyItem,
  ListeningTranscriptLine,
} from './types.ts'

export interface ListeningGrowthUpgradePlaybackView {
  readonly segments: readonly ListeningSegment[]
  readonly primarySegmentId: string
  readonly policy: ListeningPlaybackPolicy
}

export type ListeningGrowthUpgradeQuestionView =
  | {
      readonly kind: 'single-choice'
      readonly prompt: string
      readonly options: readonly { readonly id: string; readonly label: string }[]
    }
  | {
      readonly kind: 'keyword-dictation'
      readonly prompt: string
      readonly requirements: {
        readonly countLabel: string
        readonly orderLabel: string
        readonly formatLabel: string
      }
      readonly answerGuidance: ListeningDictationAnswerGuidance
    }

export interface ListeningGrowthUpgradeQuestion {
  readonly itemId: string
  readonly playback: ListeningGrowthUpgradePlaybackView
  readonly question: ListeningGrowthUpgradeQuestionView
}

export interface ListeningGrowthUpgradeSubmission {
  readonly itemId: string
  readonly scorable: true
  readonly correct: boolean
  readonly feedback: ListeningAnswerFeedback
  readonly disclosure: {
    readonly transcript: readonly ListeningTranscriptLine[]
    readonly rationaleZh: string
    readonly choiceTranslations?: readonly { readonly id: string; readonly label: string; readonly translationZh: string | undefined }[]
    readonly dictationReview?: {
      readonly response: string
      readonly standardAnswer: string
      readonly targetKeywords: readonly string[]
    }
  }
}

export interface ListeningGrowthUpgradeAdapter {
  resolve(input: { readonly domain: string; readonly itemId: string; readonly expectedDifficultyLevel: number }): Promise<ListeningGrowthUpgradeQuestion>
  submit(input: { readonly domain: string; readonly itemId: string; readonly expectedDifficultyLevel: number; readonly response: string }): Promise<ListeningGrowthUpgradeSubmission>
}

type SupplyIndex = { readonly schemaVersion: 1; readonly candidates: readonly unknown[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function supplyItemFor(catalog: ListeningCatalog, domain: string, itemId: string, expectedDifficultyLevel: number): ListeningSupplyItem {
  if (domain !== 'listening') throw new ListeningError('task-incompatible', 'Listening growth adapter requires listening domain.')
  const index = catalog.trainingSupplyIndex
  if (!isRecord(index) || index.schemaVersion !== 1 || !Array.isArray(index.candidates)) throw new ListeningError('content-invalid', 'Released listening supply index is unavailable.')
  const candidate = (index as SupplyIndex).candidates.find((value) => isRecord(value) && value.itemId === itemId)
  if (!isRecord(candidate) || candidate.domain !== 'listening' || candidate.targetModuleId !== 'listening' || !isRecord(candidate.source) || !['listening-extension', 'listening-core-check', 'listening-scene-quiz'].includes(String(candidate.source.sourceType))) {
    throw new ListeningError('content-reference-missing', 'Requested item is not a released daily listening item.')
  }
  if (candidate.difficultyLevel !== expectedDifficultyLevel) throw new ListeningError('task-incompatible', 'Requested listening item does not match the target growth level.')
  if (typeof candidate.learningUnitId !== 'string' || typeof candidate.contentRef !== 'string' ||
    typeof candidate.knowledgePointId !== 'string' || typeof candidate.semanticCategoryId !== 'string' ||
    typeof candidate.playbackContentId !== 'string' || typeof candidate.source.sourceId !== 'string' || typeof candidate.source.variantId !== 'string') {
    throw new ListeningError('content-invalid', 'Released listening growth item is malformed.')
  }
  return {
    itemId,
    learningUnitId: candidate.learningUnitId,
    contentRef: candidate.contentRef,
    difficultyLevel: candidate.difficultyLevel as number,
    tags: Array.isArray(candidate.tags) ? candidate.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    knowledgePointId: candidate.knowledgePointId,
    semanticCategoryId: candidate.semanticCategoryId,
    playbackContentId: candidate.playbackContentId,
    source: {
      sourceType: candidate.source.sourceType as ListeningSupplyItem['source']['sourceType'],
      sourceId: candidate.source.sourceId,
      variantId: candidate.source.variantId,
    },
  }
}

function resolvedFor(catalog: ListeningCatalog, domain: string, itemId: string, expectedDifficultyLevel: number) {
  const item = supplyItemFor(catalog, domain, itemId, expectedDifficultyLevel)
  return { item, ...resolveListeningSupplyQuestion(catalog, item) }
}

function publicQuestion(question: ListeningQuestion): ListeningGrowthUpgradeQuestionView {
  if (question.type === 'keyword-dictation') {
    return {
      kind: 'keyword-dictation', prompt: question.promptZh,
      requirements: {
        countLabel: `需要填写 ${question.targetKeywords.length} 项关键信息。`,
        orderLabel: question.targetKeywords.length === 1 ? '只有 1 项，不涉及先后顺序。' : '必须按照音频中出现的顺序填写。',
        formatLabel: '输入一条英文短语，用空格连接；连接词可以省略，大小写和句末标点不影响判定。',
      },
      answerGuidance: question.answerGuidance,
    }
  }
  return { kind: 'single-choice', prompt: question.promptZh, options: question.options.map((option) => ({ id: option.id, label: option.label })) }
}

function feedback(question: ListeningQuestion, correct: boolean): ListeningAnswerFeedback {
  return { correct, title: correct ? '听对了' : '再听一遍重点', description: correct ? '答案与音频信息一致。' : '本题已记录，查看原文和解释后继续。', rationaleZh: question.rationaleZh }
}

/** Resolves a stable, already-selected daily item without emitting normal-training events. */
export function createListeningGrowthUpgradeAdapter(contentSource: ReadonlyDataSource<ListeningCatalog>): ListeningGrowthUpgradeAdapter {
  return {
    async resolve(input) {
      const catalog = await contentSource.load(); const { item, question } = resolvedFor(catalog, input.domain, input.itemId, input.expectedDifficultyLevel)
      return { itemId: item.itemId, playback: { segments: question.segments, primarySegmentId: question.primarySegmentId, policy: question.playbackPolicy }, question: publicQuestion(question) }
    },
    async submit(input) {
      const catalog = await contentSource.load(); const { item, unit, question } = resolvedFor(catalog, input.domain, input.itemId, input.expectedDifficultyLevel)
      const correct = judgeListeningAnswer(question, input.response)
      const disclosure: ListeningGrowthUpgradeSubmission['disclosure'] = {
        transcript: unit.transcript, rationaleZh: question.rationaleZh,
        ...(question.type === 'keyword-dictation'
          ? { dictationReview: { response: input.response, standardAnswer: question.standardAnswer, targetKeywords: question.targetKeywords } }
          : { choiceTranslations: question.options.map((option) => ({ id: option.id, label: option.label, translationZh: option.translationZh })) }),
      }
      return { itemId: item.itemId, scorable: true, correct, feedback: feedback(question, correct), disclosure }
    },
  }
}
