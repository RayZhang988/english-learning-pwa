import { describe, expect, it, vi } from 'vitest'
import { InMemoryPlatformEventSink } from '../../core/testing/index.ts'
import type { PlatformEvent, PlatformEventSink } from '../../core/index.ts'
import type {
  ListeningSpeechCallbacks,
  ListeningSpeechPort,
  ListeningSpeechRequest,
} from '../listening/speech-synthesis.ts'
import {
  createTrainingSupplyRound,
  parseLearningEvent,
} from '../../learning-engine/index.ts'
import type {
  LearningTrainingContentExhaustedEvent,
  LearningTrainingContentRecoveredEvent,
} from '../../learning-engine/index.ts'
import type { ReadonlyDataSource } from '../../core/index.ts'
import type {
  MicrophonePermissionService,
  NetworkStatusService,
} from '../../platform/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import { SpeakingSessionRepository } from './repository.ts'
import { SpeakingTrainingRuntime } from './runtime.ts'
import {
  createSpeakingCatalogFixture,
  createSpeakingTask,
  createSpeakingUnit,
  speakingPrompt,
} from './test-fixtures.ts'
import type {
  SpeakingCatalog,
  SpeakingRecognitionOutcome,
  SpeakingRecognitionPort,
  SpeakingRecording,
  SpeakingRecordingPort,
} from './types.ts'

class MemoryStore implements NamespaceStore {
  readonly records = new Map<string, StoredRecord<unknown>>()

  async get<T>(key: string): Promise<StoredRecord<T> | undefined> {
    return this.records.get(key) as StoredRecord<T> | undefined
  }

  async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    this.records.set(key, {
      namespace: 'feature.speaking',
      key,
      value,
      schemaVersion,
      updatedAt: '2026-07-24T00:00:00.000Z',
    })
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }

  async keys(): Promise<string[]> {
    return [...this.records.keys()]
  }

  async clear(): Promise<void> {
    this.records.clear()
  }
}

class FailRecoveredOnceEventSink implements PlatformEventSink {
  readonly events: PlatformEvent[] = []
  private failed = false

  async publish(event: PlatformEvent): Promise<void> {
    if (event.type === 'learning.training.content.recovered.v1' && !this.failed) {
      this.failed = true
      throw new Error('temporary recovery publish failure')
    }
    this.events.push(event)
  }
}

class FakeRecorder implements SpeakingRecordingPort {
  started = 0
  stopped = 0
  canceled = 0
  played = 0
  playbackStops = 0

  capabilities() {
    return {
      supported: true,
      supportedMimeTypes: ['audio/mp4'],
    }
  }

  start(_stream: MediaStream) {
    this.started += 1
  }

  async stop(): Promise<SpeakingRecording> {
    this.stopped += 1
    return {
      id: `recording-${this.stopped}`,
      blob: new Blob(['voice'], { type: 'audio/mp4' }),
      mimeType: 'audio/mp4',
      durationMs: 1_500,
    }
  }

  cancel() {
    this.canceled += 1
  }

  async play(_recording: SpeakingRecording) {
    this.played += 1
  }

  stopPlayback() { this.playbackStops += 1 }
  discard(_recording: SpeakingRecording) {}
  dispose() {}
}

class FakeOriginalSentenceSpeech implements ListeningSpeechPort {
  readonly requests: ListeningSpeechRequest[] = []
  canceled = 0
  private callbacks: ListeningSpeechCallbacks | null = null

  capabilities() {
    return {
      supported: true,
      voicesKnown: true,
      enUsVoiceAvailable: true,
      localEnUsVoiceCount: 1,
      pauseResumeAvailable: true,
      supportedRates: [0.75, 1, 1.25] as const,
    }
  }

  voices() { return [] }

  speak(request: ListeningSpeechRequest, callbacks: ListeningSpeechCallbacks) {
    this.requests.push(request)
    this.callbacks = callbacks
    callbacks.onStart?.()
  }

  cancel() {
    this.canceled += 1
    this.callbacks = null
  }

  pause() {}
  resume() {}
  isPaused() { return false }
  isSpeaking() { return this.callbacks !== null }

  finish() {
    const callbacks = this.callbacks
    this.callbacks = null
    callbacks?.onEnd?.()
  }
}

class FakeRecognition implements SpeakingRecognitionPort {
  starts = 0
  private readonly outcome: SpeakingRecognitionOutcome

  constructor(outcome: SpeakingRecognitionOutcome) {
    this.outcome = outcome
  }

  capabilities() {
    return { supported: true, requiresSiri: true }
  }

  start(_locale: 'en-US') {
    this.starts += 1
    return {
      result: Promise.resolve(this.outcome),
      stop() {},
      abort() {},
    }
  }
}

const stream = {
  getTracks: () => [{ stop: vi.fn() }],
} as unknown as MediaStream

function permission(
  request: () => Promise<MediaStream> = async () => stream,
): MicrophonePermissionService {
  return {
    query: async () => 'granted',
    request,
  }
}

const online: NetworkStatusService = {
  current: () => 'online',
  subscribe: () => () => undefined,
}

const offline: NetworkStatusService = {
  current: () => 'offline',
  subscribe: () => () => undefined,
}

function clock() {
  let tick = 0
  return () =>
    new Date(
      Date.parse('2026-07-24T12:00:00.000Z') + tick++ * 1_000,
    ).toISOString()
}

function ids(prefix: string) {
  let id = 0
  return () => `${prefix}-${++id}`
}

function runtime(options: {
  readonly sink: InMemoryPlatformEventSink
  readonly recorder?: FakeRecorder
  readonly recognition?: SpeakingRecognitionPort
  readonly network?: NetworkStatusService
  readonly microphone?: MicrophonePermissionService
  readonly contentSource?: ReadonlyDataSource<SpeakingCatalog>
  readonly repository?: SpeakingSessionRepository
  readonly wrongAnswerEvidence?: ConstructorParameters<typeof SpeakingTrainingRuntime>[0]['wrongAnswerEvidence']
  readonly originalSentenceSpeech?: FakeOriginalSentenceSpeech
}) {
  return new SpeakingTrainingRuntime({
    task: createSpeakingTask(),
    localDate: '2026-07-24',
    contentSource:
      options.contentSource ?? {
        load: async () => createSpeakingCatalogFixture(),
      },
    eventSink: options.sink,
    repository: options.repository ?? new SpeakingSessionRepository(new MemoryStore()),
    networkStatus: options.network ?? online,
    microphonePermission: options.microphone ?? permission(),
    recorder: options.recorder ?? new FakeRecorder(),
    recognition:
      options.recognition ??
      new FakeRecognition({
        status: 'recognized',
        transcript: 'I am from Shanghai',
        alternatives: ["I'm from Shanghai"],
      }),
    now: clock(),
    createId: ids('event'),
    wrongAnswerEvidence: options.wrongAnswerEvidence,
    originalSentenceSpeech: options.originalSentenceSpeech,
  })
}

describe('speaking training runtime fallbacks', () => {
  it('persists daily incorrect evidence before delivery and replays its stable id after restart', async () => {
    const repository = new SpeakingSessionRepository(new MemoryStore())
    const received: string[] = []; let reject = true
    const wrongAnswerEvidence = { resolver: { resolveItem: () => { throw new Error('unused') }, resolvePrompt: () => ({ reviewContentId: 'review-speaking', originalQuestionType: 'speaking-activity-prompt', domain: 'speaking' as const, source: { kind: 'daily-supply' as const, itemId: 'item', sourceId: speakingPrompt.id, contentRef: createSpeakingTask().contentRef } }) }, sink: { publishWrongAnswerEvidence: async (e: { eventId: string }) => { if (reject) { reject = false; throw new Error('sink down') }; received.push(e.eventId) } } }
    const first = runtime({ sink: new InMemoryPlatformEventSink(), repository, recognition: new FakeRecognition({ status: 'recognized', transcript: 'wrong words', alternatives: [] }), wrongAnswerEvidence })
    await first.initialize(); await first.startRecording(); await first.stopRecording()
    await expect(first.advance()).rejects.toThrow('sink down')
    const pending = first.currentSession?.pendingWrongAnswerEvidence?.[0]
    expect(pending?.outcome).toBe('incorrect')
    const restored = runtime({ sink: new InMemoryPlatformEventSink(), repository, wrongAnswerEvidence })
    await restored.initialize()
    expect(received).toEqual([pending?.eventId])
    expect(restored.currentSession?.pendingWrongAnswerEvidence).toEqual([])
  })
  it('continues from the plan seed into a prompt from another published unit', async () => {
    const secondPrompt = {
      ...speakingPrompt,
      id: 'w1d2-s1',
      cueZh: '说明你要去机场。',
      modelAnswer: 'I need to go to the airport.',
      acceptedAnswers: ['I need to go to the airport.'],
    }
    const firstUnit = createSpeakingUnit()
    const secondUnit = {
      ...createSpeakingUnit([secondPrompt]),
      learningUnitId: 'st4w-w1d2-speaking',
      contentRef:
        'lesson://survival-travel-american-4w/1.0.0/w1d2/speaking',
      tags: ['scene:airport', 'task:fixed-response'],
    }
    const catalog: SpeakingCatalog = {
      schemaVersion: 1,
      packageVersion: '1.0.0',
      courseId: 'survival-travel-american-4w',
      units: [firstUnit, secondUnit],
      getUnit: (contentRef) =>
        [firstUnit, secondUnit].find(
          (unit) => unit.contentRef === contentRef,
        ),
    }
    const items = [
      {
        itemId: 'cross-unit-speaking-1',
        learningUnitId: firstUnit.learningUnitId,
        contentRef: firstUnit.contentRef,
        difficultyLevel: 1,
        tags: firstUnit.tags,
        source: {
          sourceType: 'speaking-prompt' as const,
          sourceId: speakingPrompt.id,
          variantId: 'activity-prompt' as const,
        },
      },
      {
        itemId: 'cross-unit-speaking-2',
        learningUnitId: secondUnit.learningUnitId,
        contentRef: secondUnit.contentRef,
        difficultyLevel: 1,
        tags: secondUnit.tags,
        source: {
          sourceType: 'speaking-prompt' as const,
          sourceId: secondPrompt.id,
          variantId: 'activity-prompt' as const,
        },
      },
    ]
    const training = new SpeakingTrainingRuntime({
      task: createSpeakingTask({
        trainingBudget: {
          schemaVersion: 1,
          targetEffectiveSeconds: 900,
        },
      }),
      localDate: '2026-07-29',
      contentSource: { load: async () => catalog },
      eventSink: new InMemoryPlatformEventSink(),
      repository: new SpeakingSessionRepository(new MemoryStore()),
      networkStatus: online,
      microphonePermission: permission(),
      recorder: new FakeRecorder(),
      recognition: new FakeRecognition({
        status: 'recognized',
        transcript: "I'm from Shanghai.",
        alternatives: [],
      }),
      now: clock(),
      createId: ids('cross-unit-speaking'),
      supplyProvider: {
        async next(request) {
          const item = items.find(
            (candidate) =>
              !request.excludeItemIds.includes(candidate.itemId),
          )
          return item
            ? {
                schemaVersion: 1,
                requestId: request.requestId,
                status: 'item',
                item,
                nextCursor: item.itemId,
              }
            : {
                schemaVersion: 1,
                requestId: request.requestId,
                status: 'content-exhausted',
                reason: 'all-eligible-content-recently-used',
              }
        },
      },
      trainingBudgetStatus: () => 'running',
    })

    await training.initialize()
    await training.startRecording()
    await training.stopRecording()
    const continued = await training.advance()

    expect(continued.phase).toBe('practicing')
    expect(continued.failure).toBeNull()
    expect(continued.task.learningUnitId).toBe(
      firstUnit.learningUnitId,
    )
    expect(continued.unit?.learningUnitId).toBe(
      secondUnit.learningUnitId,
    )
    expect(continued.stream?.activeItem?.itemId).toBe(
      'cross-unit-speaking-2',
    )
  })

  it('restarts a failed stream that has no acknowledged exhaustion instead of attempting a false recovery', async () => {
    const catalog = createSpeakingCatalogFixture()
    const item = {
      itemId: 'restart-after-content-error',
      learningUnitId: catalog.units[0].learningUnitId,
      contentRef: catalog.units[0].contentRef,
      difficultyLevel: 1,
      tags: catalog.units[0].tags,
      source: {
        sourceType: 'speaking-prompt' as const,
        sourceId: speakingPrompt.id,
        variantId: 'activity-prompt' as const,
      },
    }
    let contentAvailable = true
    const training = new SpeakingTrainingRuntime({
      task: createSpeakingTask({
        trainingBudget: {
          schemaVersion: 1,
          targetEffectiveSeconds: 900,
        },
      }),
      localDate: '2026-07-29',
      contentSource: {
        load: async () => {
          if (!contentAvailable) {
            throw new Error('temporary content resolution failure')
          }
          return catalog
        },
      },
      eventSink: new InMemoryPlatformEventSink(),
      repository: new SpeakingSessionRepository(new MemoryStore()),
      networkStatus: online,
      microphonePermission: permission(),
      recorder: new FakeRecorder(),
      recognition: new FakeRecognition({
        status: 'recognized',
        transcript: "I'm from Shanghai.",
        alternatives: [],
      }),
      now: clock(),
      createId: ids('restart-after-content-error'),
      supplyProvider: {
        async next(request) {
          return {
            schemaVersion: 1,
            requestId: request.requestId,
            status: 'item',
            item,
            nextCursor: item.itemId,
          }
        },
      },
      trainingBudgetStatus: () => 'running',
    })

    await training.initialize()
    await training.startRecording()
    await training.stopRecording()
    contentAvailable = false
    const failed = await training.advance()
    expect(failed.phase).toBe('error')
    expect(failed.stream?.exhaustionRequestId).toBeNull()

    contentAvailable = true
    const restarted = await training.retrySupply()
    expect(restarted.phase).toBe('practicing')
    expect(restarted.failure).toBeNull()
    expect(restarted.stream?.activeItem?.itemId).toBe(item.itemId)
  })

  it('streams durable non-repeating prompts and completes only after finish-current-item', async () => {
    const secondPrompt = { ...speakingPrompt, id: 'w1d1-s2', cueZh: '说明你在纽约旅行。', modelAnswer: "I'm visiting New York.", acceptedAnswers: ["I'm visiting New York."] }
    const catalog = createSpeakingCatalogFixture(createSpeakingUnit([speakingPrompt, secondPrompt]))
    const items = [
      { itemId: 'supply-1', learningUnitId: catalog.units[0].learningUnitId, contentRef: catalog.units[0].contentRef, difficultyLevel: 1, tags: ['scene:introductions'], source: { sourceType: 'speaking-prompt' as const, sourceId: 'w1d1-s1', variantId: 'activity-prompt' as const } },
      { itemId: 'supply-2', learningUnitId: catalog.units[0].learningUnitId, contentRef: catalog.units[0].contentRef, difficultyLevel: 1, tags: ['scene:introductions'], source: { sourceType: 'speaking-prompt' as const, sourceId: 'w1d1-s2', variantId: 'activity-prompt' as const } },
    ]
    const supplyProvider = { async next(request: import('../../learning-engine/index.ts').LearningTaskSupplyRequest) {
      const item = items.find((candidate) => !request.excludeItemIds.includes(candidate.itemId))
      return item ? { schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item, nextCursor: item.itemId }
        : { schemaVersion: 1 as const, requestId: request.requestId, status: 'content-exhausted' as const, reason: 'all-eligible-content-recently-used' as const }
    } }
    let budget: 'running' | 'finish-current-item' = 'running'
    const store = new MemoryStore()
    const sink = new InMemoryPlatformEventSink()
    const options = {
      task: createSpeakingTask({ trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } }), localDate: '2026-07-28',
      contentSource: { load: async () => catalog }, eventSink: sink,
      repository: new SpeakingSessionRepository(store), networkStatus: online, microphonePermission: permission(), recorder: new FakeRecorder(),
      recognition: new FakeRecognition({ status: 'recognized' as const, transcript: "I'm from Shanghai.", alternatives: [] }), now: clock(), createId: ids('stream'), supplyProvider, trainingBudgetStatus: () => budget,
      supplyRound: createTrainingSupplyRound({
        seed: 'daily-speaking-round',
        candidateItemIds: items.map((item) => item.itemId),
        shortTermExcludedItemIds: [],
        priorityItemIds: ['supply-1'],
      }),
    }
    const training = new SpeakingTrainingRuntime(options)
    let session = await training.initialize()
    expect(session.stream?.activeItem?.itemId).toBe('supply-1')
    await training.startRecording(); await training.stopRecording(); session = await training.advance()
    expect(session.phase).toBe('practicing')
    expect(session.stream?.completedItemIds).toEqual(['supply-1'])
    expect(session.stream?.activeItem?.itemId).toBe('supply-2')

    const restored = new SpeakingTrainingRuntime({ ...options, repository: new SpeakingSessionRepository(store) })
    await restored.initialize()
    budget = 'finish-current-item'
    await restored.startRecording(); await restored.stopRecording(); session = await restored.advance()
    expect(session.phase).toBe('completed')
    const events = sink.events.map((event) => parseLearningEvent(event))
    expect(events.filter((event) => event.type === 'learning.training.item.completed.v1')).toHaveLength(2)
    expect(events.find((event) => event.type === 'learning.training.item.completed.v1')?.payload.supplyRound).toMatchObject({
      seed: 'daily-speaking-round', cursor: 1,
      order: expect.arrayContaining(['supply-1', 'supply-2']),
    })
    expect(events.some((event) => event.type === 'learning.training.budget.completed.v1')).toBe(true)
    expect(events.filter((event) => event.type === 'learning.attempt.completed.v1').every((event) => event.payload.taskCompleted === false)).toBe(true)
  })

  it('starts a scene fixed-response supply item in practicing without inventing a prompt', async () => {
    const scenePrompt = {
      id: 'w1d1-q3', cueZh: '对方说“Nice to meet you.” 请回应。',
      partnerLine: '对方说“Nice to meet you.” 请回应。',
      modelAnswer: 'Nice to meet you, too.',
      modelAnswerTranslationZh: '我也很高兴认识你。',
      acceptedAnswers: ['Nice to meet you, too.'], requiredConcepts: ['polite-response'],
    }
    const catalog = createSpeakingCatalogFixture({
      ...createSpeakingUnit(), scenePrompts: [scenePrompt],
    })
    const sceneItem = {
      itemId: 'scene-first', learningUnitId: catalog.units[0].learningUnitId,
      contentRef: catalog.units[0].contentRef, difficultyLevel: 1, tags: [],
      source: { sourceType: 'speaking-scene-quiz' as const, sourceId: 'w1d1-q3', variantId: 'scene-fixed-response' as const },
    }
    const supplyProvider = { async next(request: import('../../learning-engine/index.ts').LearningTaskSupplyRequest) {
      return { schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item: sceneItem, nextCursor: sceneItem.itemId }
    } }
    const training = new SpeakingTrainingRuntime({ task: createSpeakingTask({ trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } }), localDate: '2026-07-28', contentSource: { load: async () => catalog }, eventSink: new InMemoryPlatformEventSink(), repository: new SpeakingSessionRepository(new MemoryStore()), networkStatus: online, microphonePermission: permission(), recorder: new FakeRecorder(), recognition: new FakeRecognition({ status: 'recognized', transcript: 'Nice to meet you, too.', alternatives: [] }), now: clock(), createId: ids('scene-first'), supplyProvider, trainingBudgetStatus: () => 'running' })
    const session = await training.initialize()
    expect(session.phase).toBe('practicing')
    expect(session.unit?.prompts[0]).toEqual(scenePrompt)
  })

  it('reports exhausted streams without clearing exclusions and allows an honest retry', async () => {
    const catalog = createSpeakingCatalogFixture()
    const item = { itemId: 'only-item', learningUnitId: catalog.units[0].learningUnitId, contentRef: catalog.units[0].contentRef, difficultyLevel: 1, tags: [], source: { sourceType: 'speaking-prompt' as const, sourceId: 'w1d1-s1', variantId: 'activity-prompt' as const } }
    const requests: import('../../learning-engine/index.ts').LearningTaskSupplyRequest[] = []
    const supplyProvider = { async next(request: import('../../learning-engine/index.ts').LearningTaskSupplyRequest) {
      requests.push(request)
      return request.excludeItemIds.includes(item.itemId)
        ? { schemaVersion: 1 as const, requestId: request.requestId, status: 'content-exhausted' as const, reason: 'all-eligible-content-recently-used' as const }
        : { schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item, nextCursor: item.itemId }
    } }
    const training = new SpeakingTrainingRuntime({ task: createSpeakingTask({ trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } }), localDate: '2026-07-28', contentSource: { load: async () => catalog }, eventSink: new InMemoryPlatformEventSink(), repository: new SpeakingSessionRepository(new MemoryStore()), networkStatus: online, microphonePermission: permission(), recorder: new FakeRecorder(), recognition: new FakeRecognition({ status: 'recognized', transcript: "I'm from Shanghai.", alternatives: [] }), now: clock(), createId: ids('exhausted'), supplyProvider, trainingBudgetStatus: () => 'running' })
    await training.initialize(); await training.startRecording(); await training.stopRecording()
    const exhausted = await training.advance()
    expect(exhausted.phase).toBe('error')
    expect(exhausted.stream?.completedItemIds).toEqual(['only-item'])
    await training.retrySupply()
    expect(training.currentSession?.phase).toBe('error')
    expect(requests.at(-1)?.excludeItemIds).toEqual(['only-item'])
  })

  it('persists the exhaustion identity across refresh, publishes recovery first, then completes the recovered finish-current-item', async () => {
    const secondPrompt = { ...speakingPrompt, id: 'w1d1-s2', modelAnswer: "I'm visiting New York.", acceptedAnswers: ["I'm visiting New York."] }
    const catalog = createSpeakingCatalogFixture(createSpeakingUnit([speakingPrompt, secondPrompt]))
    const first = { itemId: 'supply-1', learningUnitId: catalog.units[0].learningUnitId, contentRef: catalog.units[0].contentRef, difficultyLevel: 1, tags: [], source: { sourceType: 'speaking-prompt' as const, sourceId: 'w1d1-s1', variantId: 'activity-prompt' as const } }
    const second = { ...first, itemId: 'supply-2', source: { sourceType: 'speaking-prompt' as const, sourceId: 'w1d1-s2', variantId: 'activity-prompt' as const } }
    let recoveredAvailable = false
    const provider = { async next(request: import('../../learning-engine/index.ts').LearningTaskSupplyRequest) {
      const item = !request.excludeItemIds.includes(first.itemId) ? first
        : recoveredAvailable && !request.excludeItemIds.includes(second.itemId) ? second : null
      return item ? { schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item, nextCursor: item.itemId }
        : { schemaVersion: 1 as const, requestId: request.requestId, status: 'content-exhausted' as const, reason: 'all-eligible-content-recently-used' as const }
    } }
    let budget: 'running' | 'finish-current-item' = 'running'
    const store = new MemoryStore()
    const sink = new InMemoryPlatformEventSink()
    const makeRuntime = () => new SpeakingTrainingRuntime({ task: createSpeakingTask({ trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } }), localDate: '2026-07-28', contentSource: { load: async () => catalog }, eventSink: sink, repository: new SpeakingSessionRepository(store), networkStatus: online, microphonePermission: permission(), recorder: new FakeRecorder(), recognition: new FakeRecognition({ status: 'recognized', transcript: "I'm from Shanghai.", alternatives: [] }), now: clock(), createId: ids('recovery'), supplyProvider: provider, trainingBudgetStatus: () => budget })
    const original = makeRuntime()
    await original.initialize(); await original.startRecording(); await original.stopRecording()
    const exhausted = await original.advance()
    const learningEvents = sink.events.map(parseLearningEvent)
    const exhaustion = learningEvents.find(
      (event): event is LearningTrainingContentExhaustedEvent =>
        event.type === 'learning.training.content.exhausted.v1',
    )
    if (!exhaustion) {
      throw new Error('Expected the exhausted speaking stream event.')
    }
    const exhaustionRequestId = exhaustion.payload.requestId
    expect(exhausted.stream?.exhaustionRequestId).toBe(exhaustionRequestId)

    recoveredAvailable = true
    const refreshed = makeRuntime()
    await refreshed.initialize()
    let session = await refreshed.retrySupply()
    expect(session.phase).toBe('practicing')
    expect(session.stream?.completedItemIds).toEqual(['supply-1'])
    expect(session.stream?.exhaustionRequestId).toBeNull()
    const recovery = sink.events
      .map(parseLearningEvent)
      .find(
        (event): event is LearningTrainingContentRecoveredEvent =>
          event.type === 'learning.training.content.recovered.v1',
      )
    if (!recovery) {
      throw new Error('Expected the speaking stream recovery event.')
    }
    expect(recovery.payload.exhaustionRequestId).toBe(exhaustionRequestId)
    budget = 'finish-current-item'
    await refreshed.startRecording(); await refreshed.stopRecording(); session = await refreshed.advance()
    expect(session.phase).toBe('completed')
    const types = sink.events.map((event) => event.type)
    expect(types.indexOf('learning.training.content.recovered.v1')).toBeLessThan(types.lastIndexOf('learning.training.item.completed.v1'))
    expect(types.indexOf('learning.training.content.recovered.v1')).toBeLessThan(types.indexOf('learning.training.budget.completed.v1'))
  })

  it('keeps one stable recovery event in the outbox when publication fails', async () => {
    const catalog = createSpeakingCatalogFixture()
    const item = { itemId: 'supply-1', learningUnitId: catalog.units[0].learningUnitId, contentRef: catalog.units[0].contentRef, difficultyLevel: 1, tags: [], source: { sourceType: 'speaking-prompt' as const, sourceId: 'w1d1-s1', variantId: 'activity-prompt' as const } }
    let available = false
    const provider = { async next(request: import('../../learning-engine/index.ts').LearningTaskSupplyRequest) {
      const next = !request.excludeItemIds.includes(item.itemId) ? item : available ? { ...item, itemId: 'supply-2' } : null
      return next ? { schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item: next, nextCursor: next.itemId }
        : { schemaVersion: 1 as const, requestId: request.requestId, status: 'content-exhausted' as const, reason: 'all-eligible-content-recently-used' as const }
    } }
    const sink = new FailRecoveredOnceEventSink()
    const training = new SpeakingTrainingRuntime({ task: createSpeakingTask({ trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } }), localDate: '2026-07-28', contentSource: { load: async () => catalog }, eventSink: sink, repository: new SpeakingSessionRepository(new MemoryStore()), networkStatus: online, microphonePermission: permission(), recorder: new FakeRecorder(), recognition: new FakeRecognition({ status: 'recognized', transcript: "I'm from Shanghai.", alternatives: [] }), now: clock(), createId: ids('retry-recovery'), supplyProvider: provider, trainingBudgetStatus: () => 'running' })
    await training.initialize(); await training.startRecording(); await training.stopRecording(); await training.advance()
    available = true
    await expect(training.retrySupply()).rejects.toThrow('temporary recovery publish failure')
    expect(training.currentSession?.pendingEvents.filter((event) => event.type === 'learning.training.content.recovered.v1')).toHaveLength(1)
    const session = await training.retrySupply()
    expect(session.phase).toBe('practicing')
    expect(sink.events.filter((event) => event.type === 'learning.training.content.recovered.v1')).toHaveLength(1)
  })
  it('publishes scored evidence from controlled recognition matching', async () => {
    const sink = new InMemoryPlatformEventSink()
    const training = runtime({ sink })

    await training.initialize()
    await training.startRecording()
    const reviewed = await training.stopRecording()
    const completed = await training.advance()

    expect(reviewed.answers[0].match?.level).toBe('match')
    expect(completed.phase).toBe('completed')
    expect(sink.events.map((event) => event.type)).toEqual([
      'learning.task.started.v1',
      'learning.attempt.completed.v1',
    ])
    expect(sink.events[1].payload).toMatchObject({
      result: 'scored',
      performanceScore: 1,
      taskCompleted: true,
    })
  })

  it('keeps offline practice recordable and replayable without scoring it', async () => {
    const sink = new InMemoryPlatformEventSink()
    const recorder = new FakeRecorder()
    const recognition = new FakeRecognition({
      status: 'recognized',
      transcript: 'should not run',
      alternatives: [],
    })
    const training = runtime({
      sink,
      recorder,
      recognition,
      network: offline,
    })

    await training.initialize()
    await training.startRecording()
    const reviewed = await training.stopRecording()
    await training.playRecording()
    await training.advance()

    expect(recognition.starts).toBe(0)
    expect(reviewed.recorder.playbackAvailable).toBe(true)
    expect(recorder.played).toBe(1)
    expect(sink.events[1].payload).toMatchObject({
      result: 'unscorable',
      taskCompleted: false,
      failureCategory: 'network',
    })
  })

  it('does not publish unscorable completion until every prompt is reviewed', async () => {
    const sink = new InMemoryPlatformEventSink()
    const unit = createSpeakingUnit([
      speakingPrompt,
      {
        ...speakingPrompt,
        id: 'w1d1-s2',
        cueZh: '说明你在纽约旅行。',
        modelAnswer: "I'm visiting New York.",
        acceptedAnswers: ["I'm visiting New York."],
      },
    ])
    const training = runtime({
      sink,
      network: offline,
      contentSource: {
        load: async () => createSpeakingCatalogFixture(unit),
      },
    })

    await training.initialize()
    await training.startRecording()
    await training.stopRecording()
    const nextPrompt = await training.advance()

    expect(nextPrompt.phase).toBe('practicing')
    expect(nextPrompt.promptIndex).toBe(1)
    expect(
      sink.events.filter(
        (event) => event.type === 'learning.attempt.completed.v1',
      ),
    ).toHaveLength(0)
  })

  it('keeps a recording after Siri recognition fails', async () => {
    const sink = new InMemoryPlatformEventSink()
    const training = runtime({
      sink,
      recognition: new FakeRecognition({
        status: 'failed',
        code: 'no-speech',
        message: '没有识别到文本。',
      }),
    })

    await training.initialize()
    await training.startRecording()
    const reviewed = await training.stopRecording()

    expect(reviewed.phase).toBe('feedback')
    expect(reviewed.recorder.playbackAvailable).toBe(true)
    expect(reviewed.answers[0]).toMatchObject({
      recorded: true,
      match: null,
      fallbackReason: 'recognition-no-speech',
    })
  })

  it('plays only the model sentence after an unscorable recording and stops the recording player first', async () => {
    const recorder = new FakeRecorder()
    const originalSentenceSpeech = new FakeOriginalSentenceSpeech()
    const training = runtime({
      sink: new InMemoryPlatformEventSink(),
      recorder,
      recognition: new FakeRecognition({
        status: 'failed', code: 'no-speech', message: '没有识别到文本。',
      }),
      originalSentenceSpeech,
    })

    await training.initialize()
    await training.startRecording()
    const reviewed = await training.stopRecording()
    expect(reviewed.recorder.playbackAvailable).toBe(true)
    expect(reviewed.recognition.errorCode).toBe('no-speech')

    const playing = training.playOriginalSentence()
    await vi.waitFor(() => expect(originalSentenceSpeech.requests).toEqual([{
      text: speakingPrompt.modelAnswer,
      locale: 'en-US',
      rate: 1,
      usePreferredDeviceVoice: true,
    }]))
    expect(recorder.playbackStops).toBeGreaterThan(0)
    expect(training.currentSession?.recorder.message).toBe('正在播放示范原句。')
    originalSentenceSpeech.finish()
    const finished = await playing
    expect(finished.recorder.message).toBe('示范原句播放完毕。')

    await training.playRecording()
    expect(originalSentenceSpeech.canceled).toBeGreaterThan(0)
    expect(recorder.played).toBe(1)
  })

  it('allows unscored continuation after microphone permission denial', async () => {
    const sink = new InMemoryPlatformEventSink()
    const training = runtime({
      sink,
      microphone: permission(async () => {
        throw new DOMException('Denied', 'NotAllowedError')
      }),
    })

    await training.initialize()
    const denied = await training.startRecording()
    const reviewed = await training.continueWithoutRecording()
    await training.advance()

    expect(denied.recorder.playbackAvailable).toBe(false)
    expect(reviewed.phase).toBe('feedback')
    expect(sink.events[1].payload).toMatchObject({
      result: 'unscorable',
      taskCompleted: false,
      failureCategory: 'permission',
    })
  })

  it('reports a missing microphone as a device failure, not permission denial', async () => {
    const sink = new InMemoryPlatformEventSink()
    const training = runtime({
      sink,
      microphone: permission(async () => {
        throw new DOMException('No microphone', 'NotFoundError')
      }),
    })

    await training.initialize()
    const failed = await training.startRecording()
    await training.continueWithoutRecording()
    await training.advance()

    expect(failed.permission).toBe('unknown')
    expect(sink.events[1].payload).toMatchObject({
      result: 'unscorable',
      failureCategory: 'device',
    })
  })

  it('cancels active capture and reports a pause when backgrounded', async () => {
    const sink = new InMemoryPlatformEventSink()
    const recorder = new FakeRecorder()
    const training = runtime({ sink, recorder })
    await training.initialize()
    await training.startRecording()

    const paused = await training.pause('app-backgrounded')

    expect(paused.phase).toBe('paused')
    expect(recorder.canceled).toBe(1)
    expect(sink.events.at(-1)).toMatchObject({
      type: 'learning.task.paused.v1',
      payload: { reason: 'app-backgrounded' },
    })
    expect(
      sink.events.some(
        (event) => event.type === 'learning.attempt.completed.v1',
      ),
    ).toBe(false)
  })

  it('keeps initialization and content failures paused instead of completed', async () => {
    const sink = new InMemoryPlatformEventSink()
    const training = runtime({
      sink,
      contentSource: {
        load: async () => {
          throw new Error('Content package unavailable')
        },
      },
    })

    const failed = await training.initialize()

    expect(failed.phase).toBe('error')
    expect(sink.events.map((event) => event.type)).toEqual([
      'learning.task.started.v1',
      'learning.task.paused.v1',
    ])
    expect(sink.events[1].payload).toMatchObject({
      reason: 'content-failure',
    })
  })

  it('keeps interrupted unscorable evidence paused at the final prompt', async () => {
    const sink = new InMemoryPlatformEventSink()
    const training = runtime({
      sink,
      recognition: new FakeRecognition({
        status: 'failed',
        code: 'aborted',
        message: '识别被中断。',
      }),
    })

    await training.initialize()
    await training.startRecording()
    await training.stopRecording()
    const paused = await training.advance()

    expect(paused.phase).toBe('paused')
    expect(sink.events.map((event) => event.type)).toEqual([
      'learning.task.started.v1',
      'learning.task.paused.v1',
    ])
    expect(
      sink.events.some(
        (event) => event.type === 'learning.attempt.completed.v1',
      ),
    ).toBe(false)
  })
})
