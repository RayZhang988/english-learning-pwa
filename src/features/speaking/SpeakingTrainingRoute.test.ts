import { describe, expect, it } from 'vitest'
import { InMemoryPlatformEventSink } from '../../core/testing/index.ts'
import { createTrainingSupplyRound } from '../../learning-engine/index.ts'
import type { ListeningSpeechPort } from '../listening/speech-synthesis.ts'
import type { NamespaceStore, StoredRecord } from '../../storage/index.ts'
import { SpeakingSessionRepository } from './repository.ts'
import type { SpeakingSupplyProvider } from './supply.ts'
import {
  createSpeakingCatalogFixture,
  createSpeakingTask,
  createSpeakingUnit,
  speakingPrompt,
} from './test-fixtures.ts'
import type {
  SpeakingRecognitionPort,
  SpeakingRecording,
  SpeakingRecordingPort,
  SpeakingSupplyItem,
} from './types.ts'
import {
  createSpeakingTrainingRouteRuntime,
  sameSpeakingSupplyRound,
  sameSpeakingWrongAnswerEvidencePort,
  toSpeakingTrainingRuntimeOptions,
} from './SpeakingTrainingRoute.tsx'

const network = { current: () => 'online' as const, subscribe: () => () => undefined }
const base = { task: createSpeakingTask(), localDate: '2026-08-03', eventSink: new InMemoryPlatformEventSink(), onExit: () => undefined }

class MemoryStore implements NamespaceStore {
  private readonly records = new Map<string, StoredRecord<unknown>>()
  async get<T>(key: string): Promise<StoredRecord<T> | undefined> { return this.records.get(key) as StoredRecord<T> | undefined }
  async put<T>(key: string, value: T, schemaVersion = 1): Promise<void> { this.records.set(key, { namespace: 'feature.speaking', key, value, schemaVersion, updatedAt: '2026-08-11T00:00:00.000Z' }) }
  async delete(key: string): Promise<void> { this.records.delete(key) }
  async keys(): Promise<readonly string[]> { return [...this.records.keys()] }
  async clear(): Promise<void> { this.records.clear() }
}

const recorder: SpeakingRecordingPort = {
  capabilities: () => ({ supported: true, supportedMimeTypes: ['audio/mp4'] }),
  start: () => undefined,
  stop: async (): Promise<SpeakingRecording> => ({ id: 'route-recording', blob: new Blob(['voice'], { type: 'audio/mp4' }), mimeType: 'audio/mp4', durationMs: 1000 }),
  cancel: () => undefined,
  play: async () => undefined,
  stopPlayback: () => undefined,
  discard: () => undefined,
  dispose: () => undefined,
}

const recognition: SpeakingRecognitionPort = {
  capabilities: () => ({ supported: true, requiresSiri: false }),
  start: () => ({ result: Promise.resolve({ status: 'failed' as const, code: 'no-speech' as const, message: 'No speech.' }), stop: () => undefined, abort: () => undefined }),
}

const microphonePermission = {
  query: async () => 'granted' as const,
  request: async () => ({ getTracks: () => [{ stop: () => undefined }] }) as unknown as MediaStream,
}

describe('SpeakingTrainingRoute wrong-answer injection', () => {
  it('keeps runtime identity for a cloned persisted supply round', () => {
    const round = createTrainingSupplyRound({
      seed: 'same-round',
      candidateItemIds: ['prompt-a', 'prompt-b'],
      shortTermExcludedItemIds: [],
    })

    expect(
      sameSpeakingSupplyRound(round, { ...round, order: [...round.order] }),
    ).toBe(true)
    expect(sameSpeakingSupplyRound(round, { ...round, seed: 'new-round' })).toBe(false)
  })

  it('passes the exact resolver/sink port through unchanged', () => {
    const port = { resolver: { resolveItem: () => ({ reviewContentId: 'a', originalQuestionType: 'prompt', domain: 'speaking' as const, source: { kind: 'daily-supply' as const, itemId: 'i', sourceId: 's', contentRef: 'c' } }), resolvePrompt: () => ({ reviewContentId: 'a', originalQuestionType: 'prompt', domain: 'speaking' as const, source: { kind: 'daily-supply' as const, itemId: 'i', sourceId: 's', contentRef: 'c' } }) }, sink: { publishWrongAnswerEvidence: async () => undefined } }
    expect(toSpeakingTrainingRuntimeOptions({ ...base, wrongAnswerEvidence: port }, network).wrongAnswerEvidence).toBe(port)
  })
  it('treats an evidence-port replacement as a runtime identity change', () => {
    const one = { resolver: {} as never, sink: {} as never }
    const two = { resolver: {} as never, sink: {} as never }
    expect(sameSpeakingWrongAnswerEvidencePort(one, one)).toBe(true)
    expect(sameSpeakingWrongAnswerEvidencePort(one, two)).toBe(false)
  })
  it('keeps runtime identity for a new wrapper around the same resolver/sink pair', () => {
    const resolver = {} as never
    const sink = {} as never
    expect(sameSpeakingWrongAnswerEvidencePort({ resolver, sink }, { resolver, sink })).toBe(true)
    expect(sameSpeakingWrongAnswerEvidencePort({ resolver, sink }, { resolver: {} as never, sink })).toBe(false)
    expect(sameSpeakingWrongAnswerEvidencePort({ resolver, sink }, { resolver, sink: {} as never })).toBe(false)
  })
  it('keeps the existing route behavior compatible without the optional port', () => {
    expect(toSpeakingTrainingRuntimeOptions(base, network).wrongAnswerEvidence).toBeUndefined()
    expect(sameSpeakingWrongAnswerEvidencePort(undefined, undefined)).toBe(true)
  })

  it('forwards the optional original-sentence speech port without changing old calls', () => {
    const originalSentenceSpeech = {
      capabilities: () => ({ supported: true, voicesKnown: true, enUsVoiceAvailable: true, localEnUsVoiceCount: 1, pauseResumeAvailable: true, supportedRates: [0.75, 1, 1.25] as const }),
      voices: () => [], speak: () => undefined, pause: () => undefined, resume: () => undefined,
      cancel: () => undefined, isPaused: () => false, isSpeaking: () => false,
    } as ListeningSpeechPort
    expect(toSpeakingTrainingRuntimeOptions({ ...base, originalSentenceSpeech }, network).originalSentenceSpeech).toBe(originalSentenceSpeech)
    expect(toSpeakingTrainingRuntimeOptions(base, network).originalSentenceSpeech).toBeUndefined()
  })

  it('forwards a supplied round for prompt and scene items, preserving media and unscorable state through refresh', async () => {
    const scenePrompt = { id: 'route-scene', cueZh: '回应问候。', partnerLine: 'Nice to meet you.', modelAnswer: 'Nice to meet you, too.', modelAnswerTranslationZh: '我也很高兴认识你。', acceptedAnswers: ['Nice to meet you, too.'], requiredConcepts: ['polite-response'] }
    const unit = { ...createSpeakingUnit([speakingPrompt]), scenePrompts: [scenePrompt] }
    const catalog = createSpeakingCatalogFixture(unit)
    const items: readonly SpeakingSupplyItem[] = [
      { itemId: 'route-prompt', learningUnitId: unit.learningUnitId, contentRef: unit.contentRef, difficultyLevel: 1, tags: unit.tags, source: { sourceType: 'speaking-prompt', sourceId: speakingPrompt.id, variantId: 'activity-prompt' } },
      { itemId: 'route-scene-item', learningUnitId: unit.learningUnitId, contentRef: unit.contentRef, difficultyLevel: 1, tags: unit.tags, source: { sourceType: 'speaking-scene-quiz', sourceId: scenePrompt.id, variantId: 'scene-fixed-response' } },
    ]
    const supplyProvider: SpeakingSupplyProvider = { async next(request) {
      const item = items.find((candidate) => candidate.itemId === request.supplyRound?.order[request.supplyRound.cursor])
      if (!item) throw new Error('Route must forward supplyRound before requesting speaking content.')
      return { schemaVersion: 1, requestId: request.requestId, status: 'item', item, nextCursor: item.itemId }
    } }
    const task = createSpeakingTask({ trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } })
    const initialize = (round: ReturnType<typeof createTrainingSupplyRound>, store: MemoryStore) =>
      createSpeakingTrainingRouteRuntime({
        task, localDate: '2026-08-11', eventSink: new InMemoryPlatformEventSink(), onExit: () => undefined,
        contentSource: { load: async () => catalog }, repository: new SpeakingSessionRepository(store), networkStatus: network,
        microphonePermission, recorder, recognition, supplyProvider, supplyRound: round, trainingBudgetStatus: () => 'running',
      }, network)

    const promptRound = createTrainingSupplyRound({ seed: 'route-prompt', candidateItemIds: ['route-prompt'], shortTermExcludedItemIds: [] })
    const promptStore = new MemoryStore()
    const promptRuntime = initialize(promptRound, promptStore)
    let prompt = await promptRuntime.initialize()
    expect(prompt.unit?.prompts[0]?.id).toBe(speakingPrompt.id)
    expect(prompt.stream?.supplyRound).toMatchObject({ order: promptRound.order, cursor: 1 })
    await promptRuntime.startRecording()
    prompt = await promptRuntime.stopRecording()
    expect(prompt.recorder.playbackAvailable).toBe(true)
    expect(prompt.recognition.errorCode).toBe('no-speech')
    const restoredPrompt = await initialize(promptRound, promptStore).initialize()
    expect(restoredPrompt.stream?.supplyRound).toEqual(prompt.stream?.supplyRound)

    const sceneRound = createTrainingSupplyRound({ seed: 'route-scene', candidateItemIds: ['route-scene-item'], shortTermExcludedItemIds: [] })
    const scene = await initialize(sceneRound, new MemoryStore()).initialize()
    expect(scene.unit?.scenePrompts[0]?.id).toBe(scenePrompt.id)
    expect(scene.stream?.activeItem?.source.sourceType).toBe('speaking-scene-quiz')
    expect(scene.stream?.supplyRound).toMatchObject({ order: sceneRound.order, cursor: 1 })
  })
})
