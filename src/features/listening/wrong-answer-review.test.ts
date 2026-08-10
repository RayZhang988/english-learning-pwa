import { describe, expect, it } from 'vitest'
import reviewIndex from '../../../content/curriculum/review-content-index.v1.json'
import trainingSupplyIndex from '../../../content/curriculum/training-supply-index.v1.json'
import packageIndex from '../../../content/curriculum/package-index.v1.json'
import manifest from '../../../content/curriculum/survival-travel-american-4w.v1.json'
import extensionIndex from '../../../content/curriculum/listening-exercise-extension-index.v1.json'
import exercises from '../../../content/lessons/survival-travel-american-4w/listening-exercises.v1.json'
import bilingualChoiceOptions from '../../../content/lessons/survival-travel-american-4w/listening-choice-bilingual-options.v1.json'
import week1 from '../../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import { createListeningCatalog } from './content.ts'
import { resolveListeningWrongAnswerReviewItem } from './wrong-answer-review.ts'
import { ListeningWrongAnswerReviewRuntime } from './wrong-answer-review.ts'
import type { ListeningSpeechCallbacks, ListeningSpeechPort } from './speech-synthesis.ts'

const catalog = createListeningCatalog({ packageIndex, manifest, extensionIndex, trainingSupplyIndex,
  lessonsByPath: Object.fromEntries(packageIndex.lessonFiles.map((path, index) => [path, [week1, week2, week3, week4][index]! ])),
  exerciseBundlesByPath: { [extensionIndex.exerciseBundleFiles[0]!]: exercises }, bilingualChoiceOptions })
const candidates = trainingSupplyIndex.candidates as readonly Record<string, unknown>[]
const aliases = Object.entries(reviewIndex.aliases as unknown as Record<string, { reviewContentId: string; originalQuestionType: string; domain: string; source: { itemId: string } }>)
  .filter(([key, value]) => key.startsWith('daily:') && value.domain === 'listening')

describe('released R13-D listening review aliases', () => {
  it('has exactly 253 unique listening aliases, each resolving to its released original type', () => {
    expect(aliases).toHaveLength(253)
    const itemIds = new Set<string>()
    const identities = new Set<string>()
    const types = new Set<string>()
    for (const [, alias] of aliases) {
      expect(itemIds.has(alias.source.itemId)).toBe(false)
      itemIds.add(alias.source.itemId)
      expect(identities.has(`${alias.reviewContentId}::${alias.originalQuestionType}`)).toBe(false)
      identities.add(`${alias.reviewContentId}::${alias.originalQuestionType}`)
      const item = candidates.find((candidate) => candidate.itemId === alias.source.itemId)
      expect(item).toBeDefined()
      const resolved = resolveListeningWrongAnswerReviewItem(catalog, item as never, alias)
      expect(resolved.identity).toMatchObject({ reviewContentId: alias.reviewContentId, originalQuestionType: alias.originalQuestionType })
      types.add(alias.originalQuestionType)
    }
    expect(types).toEqual(new Set([
      'listening-word-discrimination', 'listening-short-sentence-choice', 'listening-keyword-dictation',
      'listening-full-transcript-detail-choice', 'listening-scene-audio-single-choice',
    ]))
  })

  it.each([
    'listening-word-discrimination', 'listening-short-sentence-choice', 'listening-keyword-dictation',
    'listening-full-transcript-detail-choice', 'listening-scene-audio-single-choice',
  ])('persists and restores the released %s review snapshot', async (type) => {
    const alias = aliases.find(([, value]) => value.originalQuestionType === type)?.[1]
    if (!alias) throw new Error(`Missing released ${type} alias`)
    const item = candidates.find((candidate) => candidate.itemId === alias.source.itemId)!
    const resolved = resolveListeningWrongAnswerReviewItem(catalog, item as never, alias)
    let saved: import('./wrong-answer-review.ts').ListeningWrongAnswerReviewSnapshot | undefined
    const speech: ListeningSpeechPort = { capabilities: () => ({ supported: true, voicesKnown: true, enUsVoiceAvailable: true, localEnUsVoiceCount: 1, pauseResumeAvailable: true, supportedRates: [0.75, 1, 1.25] }), voices: () => [{ id: 'neutral', locale: 'en-US', localService: true }], speak: (_request, callbacks: ListeningSpeechCallbacks) => { callbacks.onStart?.(); callbacks.onEnd?.() }, cancel: () => {}, pause: () => {}, resume: () => {}, isPaused: () => false, isSpeaking: () => false }
    const record = { schemaVersion: 1 as const, recordId: `${alias.reviewContentId}::${type}`, reviewContentId: alias.reviewContentId, originalQuestionType: type, domain: 'listening' as const, status: 'active' as const, incorrectCount: 1, consecutiveReviewCorrect: 0 as const, lastIncorrectAt: '2026-08-03T00:00:00.000Z', lastReviewAttemptAt: null, movedToHistoryAt: null, lastSource: 'daily-training' as const, sources: ['daily-training'] as const }
    const base = { record, speech, resolve: async () => resolved, submitReviewEvidence: async () => {}, onSnapshot: async (snapshot: import('./wrong-answer-review.ts').ListeningWrongAnswerReviewSnapshot) => { saved = snapshot }, now: () => '2026-08-03T00:00:00.000Z', createId: () => 'review-event' }
    const first = new ListeningWrongAnswerReviewRuntime(base); await first.initialize(); first.setRate(0.75); await new Promise((resolve) => setTimeout(resolve, 0))
    if (resolved.question.type === 'keyword-dictation') await first.changeDictation(resolved.question.acceptedAnswers[0]!); else await first.select(resolved.question.correctOptionId)
    await first.togglePlayback(); await first.submit()
    const restored = new ListeningWrongAnswerReviewRuntime({ ...base, restoredSnapshot: saved! }); const snapshot = await restored.initialize()
    expect(snapshot.question.id).toBe(resolved.question.id); expect(snapshot.answer?.correct).toBe(true); expect(snapshot.phase).toBe('feedback')
    expect(snapshot.playback.rate).toBe(0.75); if (resolved.question.type === 'keyword-dictation') expect(snapshot.answer?.response).toBe(resolved.question.acceptedAnswers[0])
    expect((await restored.advance()).phase).toBe('completed')
  })
  it('merges a late player callback after submit without reverting feedback', async () => {
    const alias = aliases.find(([, value]) => value.originalQuestionType === 'listening-word-discrimination')![1]
    const resolved = resolveListeningWrongAnswerReviewItem(catalog, candidates.find((candidate) => candidate.itemId === alias.source.itemId)! as never, alias)
    let callbacks: ListeningSpeechCallbacks | null = null
    const speech: ListeningSpeechPort = { capabilities: () => ({ supported: true, voicesKnown: true, enUsVoiceAvailable: true, localEnUsVoiceCount: 1, pauseResumeAvailable: true, supportedRates: [0.75, 1, 1.25] }), voices: () => [{ id: 'neutral', locale: 'en-US', localService: true }], speak: (_request, next) => { callbacks = next }, cancel: () => {}, pause: () => {}, resume: () => {}, isPaused: () => false, isSpeaking: () => false }
    const runtime = new ListeningWrongAnswerReviewRuntime({ record: { schemaVersion: 1, recordId: 'late-callback', reviewContentId: alias.reviewContentId, originalQuestionType: alias.originalQuestionType, domain: 'listening', status: 'active', incorrectCount: 1, consecutiveReviewCorrect: 0, lastIncorrectAt: '2026-08-03T00:00:00.000Z', lastReviewAttemptAt: null, movedToHistoryAt: null, lastSource: 'daily-training', sources: ['daily-training'] }, speech, resolve: async () => resolved, submitReviewEvidence: async () => {} })
    if (resolved.question.type === 'keyword-dictation') throw new Error('Expected choice alias')
    await runtime.initialize(); await runtime.togglePlayback(); (callbacks as unknown as ListeningSpeechCallbacks | null)?.onStart?.(); (callbacks as unknown as ListeningSpeechCallbacks | null)?.onEnd?.(); await new Promise((resolve) => setTimeout(resolve, 0)); await runtime.select(resolved.question.correctOptionId); await runtime.submit()
    ;(callbacks as unknown as ListeningSpeechCallbacks | null)?.onStart?.(); (callbacks as unknown as ListeningSpeechCallbacks | null)?.onEnd?.(); await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runtime.currentSnapshot?.phase).toBe('feedback')
    expect(runtime.currentSnapshot?.answer?.correct).toBe(true)
  })
})
