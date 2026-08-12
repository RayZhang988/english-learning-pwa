import { describe, expect, it } from 'vitest'
import { loadReleasedReviewContentIndex } from '../../app/review-content-test-fixtures.ts'
import trainingSupplyIndex from '../../../content/curriculum/training-supply-index.v1/listening.json'
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
import { resolveListeningSupplyQuestion } from './supply.ts'
import { resolveListeningWrongAnswerReviewItem } from './wrong-answer-review.ts'
import { ListeningWrongAnswerReviewRuntime } from './wrong-answer-review.ts'
import type { ListeningSpeechCallbacks, ListeningSpeechPort } from './speech-synthesis.ts'
import { assertWrongAnswerLibraryState, startWrongAnswerReviewRound, type WrongAnswerLibraryState, type WrongAnswerLibraryStateTransform, type WrongAnswerRecord } from '../../learning-engine/index.ts'

const catalog = createListeningCatalog({ packageIndex, manifest, extensionIndex, trainingSupplyIndex,
  lessonsByPath: Object.fromEntries(packageIndex.lessonFiles.map((path, index) => [path, [week1, week2, week3, week4][index]! ])),
  exerciseBundlesByPath: { [extensionIndex.exerciseBundleFiles[0]!]: exercises }, bilingualChoiceOptions })
const candidates = trainingSupplyIndex.candidates as readonly Record<string, unknown>[]
const reviewIndex = await loadReleasedReviewContentIndex()
const aliases = Object.entries(reviewIndex.aliases as unknown as Record<string, { reviewContentId: string; originalQuestionType: string; domain: string; source: { itemId: string } }>)
  .filter(([key, value]) => key.startsWith('daily:') && value.domain === 'listening')

class AtomicState {
  state: WrongAnswerLibraryState
  fail = false
  constructor(record: WrongAnswerRecord) {
    this.state = startWrongAnswerReviewRound({ schemaVersion: 1, records: { [record.recordId]: record }, processedEvidenceIds: [], activeRound: null }, { roundId: 'round-1', seed: 'seed-1', startedAt: '2026-08-03T00:00:00.000Z' })
  }
  async load() { return this.state }
  async update(transform: WrongAnswerLibraryStateTransform) {
    if (this.fail) throw new Error('atomic write failed')
    const next = transform(this.state); assertWrongAnswerLibraryState(next); this.state = next; return next
  }
}

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

  it('exposes the identical published dictation guidance to daily, extra, and review resolvers', () => {
    const alias = aliases.find(
      ([, value]) => value.originalQuestionType === 'listening-keyword-dictation',
    )?.[1]
    if (!alias) throw new Error('Missing released keyword-dictation alias')
    const item = candidates.find(
      (candidate) => candidate.itemId === alias.source.itemId,
    )
    if (!item) throw new Error('Missing released keyword-dictation supply item')

    // Both daily and R6 extra training resolve the published supply item here;
    // the dedicated review resolver must not manufacture another prompt.
    const daily = resolveListeningSupplyQuestion(catalog, item as never)
    const extra = resolveListeningSupplyQuestion(catalog, item as never)
    const review = resolveListeningWrongAnswerReviewItem(
      catalog,
      item as never,
      alias,
    )
    if (
      daily.question.type !== 'keyword-dictation' ||
      extra.question.type !== 'keyword-dictation' ||
      review.question.type !== 'keyword-dictation'
    ) {
      throw new Error('Expected a keyword-dictation question.')
    }
    expect(extra.question.answerGuidance).toEqual(daily.question.answerGuidance)
    expect(review.question.answerGuidance).toEqual(daily.question.answerGuidance)
  })

  it.each([
    'listening-word-discrimination', 'listening-short-sentence-choice', 'listening-keyword-dictation',
    'listening-full-transcript-detail-choice', 'listening-scene-audio-single-choice',
  ])('persists and restores the released %s review snapshot', async (type) => {
    const alias = aliases.find(([, value]) => value.originalQuestionType === type)?.[1]
    if (!alias) throw new Error(`Missing released ${type} alias`)
    const item = candidates.find((candidate) => candidate.itemId === alias.source.itemId)!
    const resolved = resolveListeningWrongAnswerReviewItem(catalog, item as never, alias)
    const speech: ListeningSpeechPort = { capabilities: () => ({ supported: true, voicesKnown: true, enUsVoiceAvailable: true, localEnUsVoiceCount: 1, pauseResumeAvailable: true, supportedRates: [0.75, 1, 1.25] }), voices: () => [{ id: 'neutral', locale: 'en-US', localService: true }], speak: (_request, callbacks: ListeningSpeechCallbacks) => { callbacks.onStart?.(); callbacks.onEnd?.() }, cancel: () => {}, pause: () => {}, resume: () => {}, isPaused: () => false, isSpeaking: () => false }
    const record = { schemaVersion: 1 as const, recordId: `${alias.reviewContentId}::${type}`, reviewContentId: alias.reviewContentId, originalQuestionType: type, domain: 'listening' as const, status: 'active' as const, incorrectCount: 1, consecutiveReviewCorrect: 0 as const, lastIncorrectAt: '2026-08-03T00:00:00.000Z', lastReviewAttemptAt: null, movedToHistoryAt: null, lastSource: 'daily-training' as const, sources: ['daily-training'] as const }
    const state = new AtomicState(record)
    const base = { record, state, speech, resolve: async () => resolved, now: () => '2026-08-03T00:00:00.000Z' }
    const first = new ListeningWrongAnswerReviewRuntime(base); await first.initialize(); first.setRate(0.75); await new Promise((resolve) => setTimeout(resolve, 0))
    if (resolved.question.type === 'keyword-dictation') await first.changeDictation(resolved.question.acceptedAnswers[0]!); else await first.select(resolved.question.correctOptionId)
    await first.togglePlayback(); await first.submit()
    const restored = new ListeningWrongAnswerReviewRuntime(base); const snapshot = await restored.initialize()
    expect(snapshot.question.id).toBe(resolved.question.id); expect(snapshot.answer?.correct).toBe(true); expect(snapshot.phase).toBe('feedback')
    expect(snapshot.playback.rate).toBe(0.75); if (resolved.question.type === 'keyword-dictation') expect(snapshot.answer?.response).toBe(resolved.question.acceptedAnswers[0])
    expect((await restored.advance()).phase).toBe('completed')
    expect(state.state.activeRound?.status).toBe('completed')
  })
  it('merges a late player callback after submit without reverting feedback', async () => {
    const alias = aliases.find(([, value]) => value.originalQuestionType === 'listening-word-discrimination')![1]
    const resolved = resolveListeningWrongAnswerReviewItem(catalog, candidates.find((candidate) => candidate.itemId === alias.source.itemId)! as never, alias)
    let callbacks: ListeningSpeechCallbacks | null = null
    const speech: ListeningSpeechPort = { capabilities: () => ({ supported: true, voicesKnown: true, enUsVoiceAvailable: true, localEnUsVoiceCount: 1, pauseResumeAvailable: true, supportedRates: [0.75, 1, 1.25] }), voices: () => [{ id: 'neutral', locale: 'en-US', localService: true }], speak: (_request, next) => { callbacks = next }, cancel: () => {}, pause: () => {}, resume: () => {}, isPaused: () => false, isSpeaking: () => false }
    const record = { schemaVersion: 1 as const, recordId: `${alias.reviewContentId}::${alias.originalQuestionType}`, reviewContentId: alias.reviewContentId, originalQuestionType: alias.originalQuestionType, domain: 'listening' as const, status: 'active' as const, incorrectCount: 1, consecutiveReviewCorrect: 0 as const, lastIncorrectAt: '2026-08-03T00:00:00.000Z', lastReviewAttemptAt: null, movedToHistoryAt: null, lastSource: 'daily-training' as const, sources: ['daily-training'] as const }
    const runtime = new ListeningWrongAnswerReviewRuntime({ record, state: new AtomicState(record), speech, resolve: async () => resolved })
    if (resolved.question.type === 'keyword-dictation') throw new Error('Expected choice alias')
    await runtime.initialize(); await runtime.togglePlayback(); (callbacks as unknown as ListeningSpeechCallbacks | null)?.onStart?.(); (callbacks as unknown as ListeningSpeechCallbacks | null)?.onEnd?.(); await new Promise((resolve) => setTimeout(resolve, 0)); await runtime.select(resolved.question.correctOptionId); await runtime.submit()
    ;(callbacks as unknown as ListeningSpeechCallbacks | null)?.onStart?.(); (callbacks as unknown as ListeningSpeechCallbacks | null)?.onEnd?.(); await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runtime.currentSnapshot?.phase).toBe('feedback')
    expect(runtime.currentSnapshot?.answer?.correct).toBe(true)
  })

  it('keeps the durable draft and round unchanged when the atomic answer commit fails', async () => {
    const alias = aliases.find(([, value]) => value.originalQuestionType === 'listening-word-discrimination')![1]
    const resolved = resolveListeningWrongAnswerReviewItem(catalog, candidates.find((candidate) => candidate.itemId === alias.source.itemId)! as never, alias)
    const record = { schemaVersion: 1 as const, recordId: `${alias.reviewContentId}::${alias.originalQuestionType}`, reviewContentId: alias.reviewContentId, originalQuestionType: alias.originalQuestionType, domain: 'listening' as const, status: 'active' as const, incorrectCount: 1, consecutiveReviewCorrect: 0 as const, lastIncorrectAt: '2026-08-03T00:00:00.000Z', lastReviewAttemptAt: null, movedToHistoryAt: null, lastSource: 'daily-training' as const, sources: ['daily-training'] as const }
    const state = new AtomicState(record)
    if (resolved.question.type === 'keyword-dictation') throw new Error('Expected choice question')
    const speech: ListeningSpeechPort = { capabilities: () => ({ supported: true, voicesKnown: true, enUsVoiceAvailable: true, localEnUsVoiceCount: 1, pauseResumeAvailable: true, supportedRates: [0.75, 1, 1.25] }), voices: () => [], speak: (_request, callbacks) => { callbacks.onStart?.(); callbacks.onEnd?.() }, cancel: () => {}, pause: () => {}, resume: () => {}, isPaused: () => false, isSpeaking: () => false }
    const runtime = new ListeningWrongAnswerReviewRuntime({ record, state, speech, resolve: async () => resolved, now: () => '2026-08-03T00:00:01.000Z' })
    await runtime.initialize(); await runtime.togglePlayback(); await runtime.select(resolved.question.correctOptionId)
    state.fail = true
    await expect(runtime.submit()).rejects.toThrow('atomic write failed')
    expect(runtime.currentSnapshot?.phase).toBe('answering')
    expect(state.state.activeRound?.stage).toBe('answering')
    expect(state.state.records[record.recordId]?.consecutiveReviewCorrect).toBe(0)
  })

  it('resets a player failure into an answerable retry without losing the draft', async () => {
    const alias = aliases.find(([, value]) => value.originalQuestionType === 'listening-word-discrimination')![1]
    const resolved = resolveListeningWrongAnswerReviewItem(catalog, candidates.find((candidate) => candidate.itemId === alias.source.itemId)! as never, alias)
    const record = { schemaVersion: 1 as const, recordId: `${alias.reviewContentId}::${alias.originalQuestionType}`, reviewContentId: alias.reviewContentId, originalQuestionType: alias.originalQuestionType, domain: 'listening' as const, status: 'active' as const, incorrectCount: 1, consecutiveReviewCorrect: 0 as const, lastIncorrectAt: '2026-08-03T00:00:00.000Z', lastReviewAttemptAt: null, movedToHistoryAt: null, lastSource: 'daily-training' as const, sources: ['daily-training'] as const }
    const state = new AtomicState(record)
    if (resolved.question.type === 'keyword-dictation') throw new Error('Expected choice question')
    const speech: ListeningSpeechPort = { capabilities: () => ({ supported: true, voicesKnown: true, enUsVoiceAvailable: true, localEnUsVoiceCount: 1, pauseResumeAvailable: true, supportedRates: [0.75, 1, 1.25] }), voices: () => [], speak: (_request, callbacks) => { callbacks.onError?.('audio-busy') }, cancel: () => {}, pause: () => {}, resume: () => {}, isPaused: () => false, isSpeaking: () => false }
    const runtime = new ListeningWrongAnswerReviewRuntime({ record, state, speech, resolve: async () => resolved })
    await runtime.initialize(); await runtime.select(resolved.question.correctOptionId); await runtime.togglePlayback(); await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runtime.currentSnapshot?.phase).toBe('error')
    const recovered = await runtime.retryPlayback()
    expect(recovered.phase).toBe('answering'); expect(recovered.selectedOptionId).toBe(resolved.question.correctOptionId); expect(recovered.playback.errorMessage).toBeNull()
  })
})
