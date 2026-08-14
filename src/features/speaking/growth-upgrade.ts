import type { ReadonlyDataSource } from '../../core/index.ts'
import { SpeakingError } from './errors.ts'
import { matchSpeakingText } from './matching.ts'
import { resolveSpeakingSupplyPrompt } from './supply.ts'
import type { SpeakingCatalog, SpeakingRecognitionOutcome, SpeakingSupplyItem, SpeakingTextMatch } from './types.ts'

export interface SpeakingGrowthUpgradePromptView {
  readonly itemId: string
  readonly kind: 'fixed-response' | 'open-prompt'
  readonly partnerLine: string
  readonly cueZh: string
  /** Available only after a recording exists; avoids pre-answer leakage. */
  readonly referenceText: string | null
  readonly recording: { readonly allowReferencePlaybackAfterRecording: true }
}

export type SpeakingGrowthUpgradeSubmission =
  | {
      readonly itemId: string
      readonly scorable: true
      readonly correct: boolean
      readonly retryable: false
      readonly recording: { readonly recordingId: string; readonly durationMs: number }
      readonly contentMatch: { readonly state: 'recognized'; readonly match: SpeakingTextMatch; readonly targetText: string; readonly targetTranslationZh: string }
    }
  | {
      readonly itemId: string
      readonly scorable: false
      readonly correct: null
      readonly retryable: true
      readonly recording: { readonly recordingId: string; readonly durationMs: number }
      readonly contentMatch: { readonly state: 'unscorable'; readonly targetText: string; readonly targetTranslationZh: string; readonly message: string }
    }

export interface SpeakingGrowthUpgradeAdapter {
  resolve(input: { readonly domain: string; readonly itemId: string; readonly expectedDifficultyLevel: number; readonly recordingExists?: boolean }): Promise<SpeakingGrowthUpgradePromptView>
  submit(input: { readonly domain: string; readonly itemId: string; readonly expectedDifficultyLevel: number; readonly recognition: SpeakingRecognitionOutcome; readonly recording: { readonly recordingId: string; readonly durationMs: number } }): Promise<SpeakingGrowthUpgradeSubmission>
}

type SupplyIndex = { readonly schemaVersion: 1; readonly candidates: readonly unknown[] }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

function supplyItemFor(catalog: SpeakingCatalog, domain: string, itemId: string, expectedDifficultyLevel: number): SpeakingSupplyItem {
  if (domain !== 'speaking') throw new SpeakingError('task-incompatible', 'Speaking growth adapter requires speaking domain.')
  const index = catalog.trainingSupplyIndex
  if (!isRecord(index) || index.schemaVersion !== 1 || !Array.isArray(index.candidates)) throw new SpeakingError('content-invalid', 'Released speaking supply index is unavailable.')
  const value = (index as SupplyIndex).candidates.find((candidate) => isRecord(candidate) && candidate.itemId === itemId)
  if (!isRecord(value) || value.domain !== 'speaking' || value.targetModuleId !== 'speaking' || !isRecord(value.source) || !['speaking-prompt', 'speaking-scene-quiz'].includes(String(value.source.sourceType))) throw new SpeakingError('content-reference-missing', 'Requested item is not a released daily speaking item.')
  if (value.difficultyLevel !== expectedDifficultyLevel) throw new SpeakingError('task-incompatible', 'Requested speaking item does not match the target growth level.')
  if (typeof value.learningUnitId !== 'string' || typeof value.contentRef !== 'string' ||
    typeof value.knowledgePointId !== 'string' || value.knowledgePointId.trim().length === 0 ||
    typeof value.semanticCategoryId !== 'string' || value.semanticCategoryId.trim().length === 0 ||
    typeof value.source.sourceId !== 'string' || !['activity-prompt', 'scene-fixed-response'].includes(String(value.source.variantId))) throw new SpeakingError('content-invalid', 'Released speaking growth item is malformed.')
  return { itemId, knowledgePointId: value.knowledgePointId, semanticCategoryId: value.semanticCategoryId, learningUnitId: value.learningUnitId, contentRef: value.contentRef, difficultyLevel: value.difficultyLevel as number, tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : [], source: { sourceType: value.source.sourceType as SpeakingSupplyItem['source']['sourceType'], sourceId: value.source.sourceId, variantId: value.source.variantId as SpeakingSupplyItem['source']['variantId'] } }
}

function resolvedFor(catalog: SpeakingCatalog, domain: string, itemId: string, expectedDifficultyLevel: number) {
  const item = supplyItemFor(catalog, domain, itemId, expectedDifficultyLevel)
  return { item, ...resolveSpeakingSupplyPrompt(catalog, item) }
}

/** Stable-item adapter. Media capture remains owned by the existing 08 runtime; this adapter evaluates its final recognition outcome only. */
export function createSpeakingGrowthUpgradeAdapter(contentSource: ReadonlyDataSource<SpeakingCatalog>): SpeakingGrowthUpgradeAdapter {
  return {
    async resolve(input) {
      const catalog = await contentSource.load(); const { item, unit, prompt } = resolvedFor(catalog, input.domain, input.itemId, input.expectedDifficultyLevel)
      return { itemId: item.itemId, kind: unit.activityType === 'fixed-response' ? 'fixed-response' : 'open-prompt', partnerLine: prompt.partnerLine, cueZh: prompt.cueZh, referenceText: input.recordingExists ? prompt.modelAnswer : null, recording: { allowReferencePlaybackAfterRecording: true } }
    },
    async submit(input) {
      const catalog = await contentSource.load(); const { item, prompt } = resolvedFor(catalog, input.domain, input.itemId, input.expectedDifficultyLevel)
      const recording = { recordingId: input.recording.recordingId, durationMs: Math.max(0, Math.floor(input.recording.durationMs)) }
      if (input.recognition.status === 'failed') return { itemId: item.itemId, scorable: false, correct: null, retryable: true, recording, contentMatch: { state: 'unscorable', targetText: prompt.modelAnswer, targetTranslationZh: prompt.modelAnswerTranslationZh, message: input.recognition.message } }
      const match = matchSpeakingText(input.recognition.transcript, prompt.acceptedAnswers)
      return { itemId: item.itemId, scorable: true, correct: match.level === 'match' || match.level === 'close', retryable: false, recording, contentMatch: { state: 'recognized', match, targetText: prompt.modelAnswer, targetTranslationZh: prompt.modelAnswerTranslationZh } }
    },
  }
}
