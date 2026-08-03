import { describe, expect, it, vi } from 'vitest'
import { InMemoryPlatformEventSink } from '../../core/testing/index.ts'
import type { PlatformEvent, PlatformEventSink } from '../../core/index.ts'
import { parseLearningEvent } from '../../learning-engine/index.ts'
import type { NetworkStatusService } from '../../platform/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import { ListeningError } from './errors.ts'
import { ListeningSessionRepository } from './repository.ts'
import { ListeningTrainingRuntime } from './runtime.ts'
import type {
  ListeningSpeechCallbacks,
  ListeningSpeechPort,
  ListeningSpeechRequest,
  ListeningSpeechVoice,
} from './speech-synthesis.ts'
import {
  choiceQuestion,
  createListeningTask,
  createListeningUnit,
  dictationQuestion,
} from './test-fixtures.ts'
import type {
  ListeningCatalog,
  ListeningChoiceQuestion,
  ListeningQuestion,
  ListeningSession,
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
      namespace: 'feature.listening',
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

interface PendingWrite {
  readonly key: string
  readonly value: unknown
  readonly schemaVersion: number
  readonly resolve: () => void
}

class ControlledWriteStore extends MemoryStore {
  readonly pendingWrites: PendingWrite[] = []
  private controlled = false

  controlWrites(): void {
    this.controlled = true
  }

  override async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    if (!this.controlled) {
      await super.put(key, value, schemaVersion)
      return
    }
    await new Promise<void>((resolve) => {
      this.pendingWrites.push({
        key,
        value,
        schemaVersion,
        resolve,
      })
    })
  }

  commitNewest(): void {
    const pending = this.pendingWrites.pop()
    if (!pending) {
      throw new Error('No controlled listening write is pending.')
    }
    this.records.set(pending.key, {
      namespace: 'feature.listening',
      key: pending.key,
      value: pending.value,
      schemaVersion: pending.schemaVersion,
      updatedAt: '2026-07-24T00:00:00.000Z',
    })
    pending.resolve()
  }
}

async function commitControlledWrites(
  store: ControlledWriteStore,
  count: number,
): Promise<void> {
  for (let committed = 0; committed < count; committed += 1) {
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    store.commitNewest()
  }
}

class ImmediateSpeech implements ListeningSpeechPort {
  callbacks: ListeningSpeechCallbacks | null = null
  cancelCount = 0
  readonly speakRequests: ListeningSpeechRequest[] = []
  private readonly voiceCatalog: readonly ListeningSpeechVoice[]

  constructor(
    voiceCatalog: readonly ListeningSpeechVoice[] = [
      {
        id: 'runtime-local-voice',
        locale: 'en-US',
        localService: true,
      },
    ],
  ) {
    this.voiceCatalog = voiceCatalog
  }

  capabilities() {
    return {
      supported: true,
      voicesKnown: true,
      enUsVoiceAvailable: this.voiceCatalog.length > 0,
      localEnUsVoiceCount: this.voiceCatalog.length,
      pauseResumeAvailable: true,
      supportedRates: [0.75, 1, 1.25] as const,
    }
  }

  voices() {
    return this.voiceCatalog
  }

  speak(
    request: ListeningSpeechRequest,
    callbacks: ListeningSpeechCallbacks,
  ): void {
    this.speakRequests.push(request)
    this.callbacks = callbacks
    callbacks.onStart?.()
  }

  pause(): void {}
  resume(): void {}
  cancel(): void {
    this.cancelCount += 1
  }
  isPaused(): boolean {
    return false
  }
  isSpeaking(): boolean {
    return this.callbacks !== null
  }
}

async function completeRuntimePlayback(
  runtime: ListeningTrainingRuntime,
  speech: ImmediateSpeech,
) {
  await runtime.togglePlayback()
  speech.callbacks?.onEnd?.()
  await vi.waitFor(() => {
    const session = runtime.currentSession
    const question = session?.questions[session.questionIndex]
    expect(
      question
        ? session?.playback.completedPlayCounts?.[
            question.primarySegmentId
          ]
        : 0,
    ).toBeGreaterThan(0)
  })
  await runtime.setRate(1)
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

function catalog(
  questions: readonly ListeningQuestion[] = [choiceQuestion],
): ListeningCatalog {
  const unit = createListeningUnit(questions)
  return {
    schemaVersion: 1,
    packageVersion: '1.0.0',
    extensionVersion: '1.1.0',
    courseId: 'survival-travel-american-4w',
    units: [unit],
    getUnit: (contentRef) =>
      contentRef === unit.contentRef ? unit : undefined,
  }
}

const dialogueDictationQuestion: ListeningQuestion = {
  ...dictationQuestion,
  primarySegmentId: 'dialogue-a-1',
  segments: [
    {
      id: 'dialogue-a-1',
      locale: 'en-US',
      text: 'Good morning.',
      label: 'Alex 的句子',
      speaker: 'Alex',
    },
    {
      id: 'dialogue-b',
      locale: 'en-US',
      text: 'How can I help?',
      label: 'Blair 的句子',
      speaker: 'Blair',
    },
    {
      id: 'dialogue-a-2',
      locale: 'en-US',
      text: 'I need a ticket.',
      label: 'Alex 的句子',
      speaker: 'Alex',
    },
  ],
  playbackPolicy: {
    ...dictationQuestion.playbackPolicy,
    sequenceMode: 'all-segments',
  },
}

function dialogueCatalog(): ListeningCatalog {
  const base = catalog([dialogueDictationQuestion])
  const unit = {
    ...base.units[0],
    transcript: [
      {
        id: 'dialogue-line-a-1',
        speaker: 'Alex',
        text: 'Good morning.',
        translationZh: '早上好。',
      },
      {
        id: 'dialogue-line-b',
        speaker: 'Blair',
        text: 'How can I help?',
        translationZh: '我能怎么帮您？',
      },
      {
        id: 'dialogue-line-a-2',
        speaker: 'Alex',
        text: 'I need a ticket.',
        translationZh: '我需要一张票。',
      },
    ],
  }
  return {
    ...base,
    units: [unit],
    getUnit: (contentRef) =>
      contentRef === unit.contentRef ? unit : undefined,
  }
}

describe('listening training runtime', () => {
  it('persists a rejected daily wrong-answer outbox and replays its stable id after refresh', async () => {
    const currentCatalog = catalog([choiceQuestion])
    const item = { itemId: 'wrong-outbox-item', learningUnitId: 'st4w-w1d1-listening', contentRef: 'lesson://survival-travel-american-4w/1.0.0/w1d1/listening', difficultyLevel: 2, tags: ['scene:introductions'], source: { sourceType: 'listening-extension' as const, sourceId: choiceQuestion.id, variantId: 'word-discrimination' } }
    const store = new MemoryStore(); const task = createListeningTask({ trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } })
    const evidence: import('../../learning-engine/index.ts').WrongAnswerEvidence[] = []; let reject = true
    const base = { task, localDate: '2026-07-29', contentSource: { load: async () => currentCatalog }, eventSink: new InMemoryPlatformEventSink(), repository: new ListeningSessionRepository(store), now: clock(), supplyProvider: { next: async (request: import('../../learning-engine/index.ts').LearningTaskSupplyRequest) => ({ schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item, nextCursor: item.itemId }) }, trainingBudgetStatus: () => 'running' as const, reviewIdentityForItem: () => ({ reviewContentId: 'review-daily', originalQuestionType: 'listening-word-discrimination' }), publishWrongAnswerEvidence: async (value: import('../../learning-engine/index.ts').WrongAnswerEvidence) => { evidence.push(value); if (reject) throw new Error('sink rejected') } }
    const speech = new ImmediateSpeech(); const first = new ListeningTrainingRuntime({ ...base, speech })
    await first.initialize(); await completeRuntimePlayback(first, speech); await first.select('b')
    await Promise.allSettled([first.submit(), first.submit()])
    expect(first.currentSession?.pendingWrongAnswerEvidence).toHaveLength(1)
    const firstId = first.currentSession?.pendingWrongAnswerEvidence?.[0]?.eventId
    expect(evidence.map((entry) => entry.eventId)).toEqual([firstId])
    reject = false
    const restored = new ListeningTrainingRuntime({ ...base, speech: new ImmediateSpeech() })
    await restored.initialize()
    expect(evidence.map((entry) => entry.eventId)).toEqual([firstId, firstId])
    expect(restored.currentSession?.pendingWrongAnswerEvidence).toEqual([])
  })
  it('does not enqueue daily wrong-answer evidence for a correct answer or unanswered exit', async () => {
    const currentCatalog = catalog([choiceQuestion]); const item = { itemId: 'daily-exclusion', learningUnitId: 'st4w-w1d1-listening', contentRef: 'lesson://survival-travel-american-4w/1.0.0/w1d1/listening', difficultyLevel: 2, tags: [], source: { sourceType: 'listening-extension' as const, sourceId: choiceQuestion.id, variantId: 'word-discrimination' } }; const calls: unknown[] = []
    const make = (taskId: string) => { const speech = new ImmediateSpeech(); const runtime = new ListeningTrainingRuntime({ task: createListeningTask({ taskId, trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } }), localDate: '2026-08-03', contentSource: { load: async () => currentCatalog }, eventSink: new InMemoryPlatformEventSink(), repository: new ListeningSessionRepository(new MemoryStore()), speech, now: clock(), supplyProvider: { next: async (request) => ({ schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item, nextCursor: item.itemId }) }, trainingBudgetStatus: () => 'running' as const, reviewIdentityForItem: () => ({ reviewContentId: 'review-exclusion', originalQuestionType: 'listening-word-discrimination' }), publishWrongAnswerEvidence: async (value) => { calls.push(value) } }); return { runtime, speech } }
    const correct = make('daily-correct'); await correct.runtime.initialize(); await completeRuntimePlayback(correct.runtime, correct.speech); await correct.runtime.select('a'); await correct.runtime.submit(); expect(correct.runtime.currentSession?.pendingWrongAnswerEvidence).toEqual([])
    const exit = make('daily-exit'); await exit.runtime.initialize(); await exit.runtime.skip('user-skipped'); expect(exit.runtime.currentSession?.pendingWrongAnswerEvidence).toEqual([]); expect(calls).toEqual([])
  })
  it.each([() => null, () => { throw new Error('identity failed') }])('keeps incorrect feedback when the review identity resolver is unavailable', async (resolver) => {
    const currentCatalog = catalog([choiceQuestion]); const item = { itemId: 'daily-identity', learningUnitId: 'st4w-w1d1-listening', contentRef: 'lesson://survival-travel-american-4w/1.0.0/w1d1/listening', difficultyLevel: 2, tags: [], source: { sourceType: 'listening-extension' as const, sourceId: choiceQuestion.id, variantId: 'word-discrimination' } }; const calls: unknown[] = []; const speech = new ImmediateSpeech()
    const runtime = new ListeningTrainingRuntime({ task: createListeningTask({ trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } }), localDate: '2026-08-03', contentSource: { load: async () => currentCatalog }, eventSink: new InMemoryPlatformEventSink(), repository: new ListeningSessionRepository(new MemoryStore()), speech, now: clock(), supplyProvider: { next: async (request) => ({ schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item, nextCursor: item.itemId }) }, trainingBudgetStatus: () => 'running' as const, reviewIdentityForItem: resolver, publishWrongAnswerEvidence: async (value) => { calls.push(value) } })
    await runtime.initialize(); await completeRuntimePlayback(runtime, speech); await runtime.select('b'); await runtime.submit()
    expect(runtime.currentSession).toMatchObject({ phase: 'feedback', pendingWrongAnswerEvidence: [] }); expect(runtime.currentSession?.answers[0]?.correct).toBe(false); expect(calls).toEqual([])
  })
  it('starts a continuous budget from a supplied unit different from the plan seed', async () => {
    const task = createListeningTask({
      trainingBudget: {
        schemaVersion: 1,
        targetEffectiveSeconds: 900,
      },
    })
    const suppliedUnit = {
      ...createListeningUnit([choiceQuestion]),
      learningUnitId: 'st4w-w1d2-listening',
      contentRef:
        'lesson://survival-travel-american-4w/1.0.0/w1d2/listening',
    }
    const suppliedItem = {
      itemId: 'cross-unit-listening-item',
      learningUnitId: suppliedUnit.learningUnitId,
      contentRef: suppliedUnit.contentRef,
      difficultyLevel: 2,
      tags: ['scene:airport'],
      source: {
        sourceType: 'listening-extension' as const,
        sourceId: choiceQuestion.id,
        variantId: 'word-discrimination',
      },
    }
    const suppliedCatalog: ListeningCatalog = {
      schemaVersion: 1,
      packageVersion: '1.0.0',
      extensionVersion: '1.1.0',
      courseId: 'survival-travel-american-4w',
      units: [suppliedUnit],
      getUnit: (contentRef) =>
        contentRef === suppliedUnit.contentRef
          ? suppliedUnit
          : undefined,
    }
    const runtime = new ListeningTrainingRuntime({
      task,
      localDate: '2026-07-29',
      contentSource: { load: async () => suppliedCatalog },
      eventSink: new InMemoryPlatformEventSink(),
      repository: new ListeningSessionRepository(
        new MemoryStore(),
      ),
      speech: new ImmediateSpeech(),
      now: clock(),
      createId: () => 'cross-unit-listening-event',
      supplyProvider: {
        async next(request) {
          return {
            schemaVersion: 1,
            requestId: request.requestId,
            status: 'item',
            item: suppliedItem,
            nextCursor: suppliedItem.itemId,
          }
        },
      },
      trainingBudgetStatus: () => 'running',
    })

    const session = await runtime.initialize()
    expect(session.phase).toBe('answering')
    expect(session.failure).toBeNull()
    expect(session.task).toEqual(task)
    expect(session.stream?.activeItem).toEqual(suppliedItem)
    expect(session.questions[0].id).toBe(choiceQuestion.id)
  })

  it('publishes one durable recovery before a refreshed item and budget completion', async () => {
    const secondQuestion: ListeningChoiceQuestion = {
      id: 'question-choice-recovered', type: 'word-discrimination', promptZh: '你听到了哪一句？',
      primarySegmentId: 'seg-sentence', segments: choiceQuestion.segments, playbackPolicy: choiceQuestion.playbackPolicy,
      options: [{ id: 'yes', label: "I'm visiting Boston this week." }, { id: 'no', label: 'I live in Chicago.' }],
      correctOptionId: 'yes', rationaleZh: '音频读的是 Boston。', errorTag: 'sound-discrimination',
    }
    const currentCatalog = catalog([choiceQuestion, secondQuestion])
    const first = { itemId: 'recovery-first', learningUnitId: 'st4w-w1d1-listening', contentRef: 'lesson://survival-travel-american-4w/1.0.0/w1d1/listening', difficultyLevel: 2, tags: ['scene:introductions'], source: { sourceType: 'listening-extension' as const, sourceId: 'question-choice', variantId: 'word-discrimination' } }
    const second = { ...first, itemId: 'recovery-second', source: { ...first.source, sourceId: 'question-choice-recovered' } }
    let calls = 0
    const supplyProvider = { async next(request: import('../../learning-engine/index.ts').LearningTaskSupplyRequest) {
      calls += 1
      if (calls === 1) return { schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item: first, nextCursor: first.itemId }
      if (calls === 2) return { schemaVersion: 1 as const, requestId: request.requestId, status: 'content-exhausted' as const, reason: 'provider-failure' as const }
      return { schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item: second, nextCursor: second.itemId }
    } }
    let budget: 'running' | 'finish-current-item' = 'running'
    const sink = new InMemoryPlatformEventSink()
    const store = new MemoryStore()
    const task = createListeningTask({ trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } })
    const speech = new ImmediateSpeech()
    const runtime = new ListeningTrainingRuntime({ task, localDate: '2026-07-28', contentSource: { load: async () => currentCatalog }, eventSink: sink, repository: new ListeningSessionRepository(store), speech, now: clock(), createId: (() => { let id = 0; return () => `recovery-${id++}` })(), supplyProvider, trainingBudgetStatus: () => budget })
    await runtime.initialize()
    await completeRuntimePlayback(runtime, speech)
    await runtime.select('a')
    await runtime.submit()
    const exhausted = await runtime.advance()
    expect(exhausted.phase).toBe('error')
    const exhaustion = sink.events.find((event) => event.type === 'learning.training.content.exhausted.v1')
    expect(exhaustion).toBeDefined()

    const refreshedSpeech = new ImmediateSpeech()
    const refreshed = new ListeningTrainingRuntime({ task, localDate: '2026-07-28', contentSource: { load: async () => currentCatalog }, eventSink: sink, repository: new ListeningSessionRepository(store), speech: refreshedSpeech, now: clock(), createId: (() => { let id = 0; return () => `recovered-${id++}` })(), supplyProvider, trainingBudgetStatus: () => budget })
    await refreshed.initialize()
    let session = await refreshed.retrySupply()
    expect(session.phase).toBe('answering')
    expect(session.stream?.completedItemIds).toEqual([first.itemId])
    expect(session.stream?.exhaustionRequestId).toBeNull()
    const recovery = sink.events.filter((event) => event.type === 'learning.training.content.recovered.v1')
    expect(recovery).toHaveLength(1)
    const exhaustedPayload = (parseLearningEvent(exhaustion!) as Extract<ReturnType<typeof parseLearningEvent>, { type: 'learning.training.content.exhausted.v1' }>).payload
    const recoveredPayload = (parseLearningEvent(recovery[0]) as Extract<ReturnType<typeof parseLearningEvent>, { type: 'learning.training.content.recovered.v1' }>).payload
    expect(recoveredPayload.exhaustionRequestId).toBe(exhaustedPayload.requestId)

    budget = 'finish-current-item'
    await completeRuntimePlayback(refreshed, refreshedSpeech)
    await refreshed.select('yes')
    await refreshed.submit()
    session = await refreshed.advance()
    expect(session.phase).toBe('completed')
    const types = sink.events.map((event) => event.type)
    expect(types.indexOf('learning.training.content.recovered.v1')).toBeLessThan(types.lastIndexOf('learning.training.item.completed.v1'))
    expect(types.indexOf('learning.training.content.recovered.v1')).toBeLessThan(types.indexOf('learning.training.budget.completed.v1'))
  })

  it('retries one failed recovery outbox event without creating another identity', async () => {
    const secondQuestion: ListeningChoiceQuestion = {
      id: 'question-choice-retry', type: 'word-discrimination', promptZh: '你听到了哪一句？',
      primarySegmentId: 'seg-sentence', segments: choiceQuestion.segments, playbackPolicy: choiceQuestion.playbackPolicy,
      options: [{ id: 'yes', label: "I'm visiting Boston this week." }, { id: 'no', label: 'I live in Chicago.' }],
      correctOptionId: 'yes', rationaleZh: '音频读的是 Boston。', errorTag: 'sound-discrimination',
    }
    const currentCatalog = catalog([choiceQuestion, secondQuestion])
    const first = { itemId: 'retry-first', learningUnitId: 'st4w-w1d1-listening', contentRef: 'lesson://survival-travel-american-4w/1.0.0/w1d1/listening', difficultyLevel: 2, tags: ['scene:introductions'], source: { sourceType: 'listening-extension' as const, sourceId: 'question-choice', variantId: 'word-discrimination' } }
    const second = { ...first, itemId: 'retry-second', source: { ...first.source, sourceId: 'question-choice-retry' } }
    let calls = 0
    const supplyProvider = { async next(request: import('../../learning-engine/index.ts').LearningTaskSupplyRequest) {
      calls += 1
      if (calls === 1) return { schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item: first, nextCursor: first.itemId }
      if (calls === 2) return { schemaVersion: 1 as const, requestId: request.requestId, status: 'content-exhausted' as const, reason: 'provider-failure' as const }
      return { schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item: second, nextCursor: second.itemId }
    } }
    const sink = new FailRecoveredOnceEventSink()
    const speech = new ImmediateSpeech()
    const runtime = new ListeningTrainingRuntime({ task: createListeningTask({ trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } }), localDate: '2026-07-28', contentSource: { load: async () => currentCatalog }, eventSink: sink, repository: new ListeningSessionRepository(new MemoryStore()), speech, now: clock(), createId: (() => { let id = 0; return () => `retry-${id++}` })(), supplyProvider, trainingBudgetStatus: () => 'running' })
    await runtime.initialize()
    await completeRuntimePlayback(runtime, speech)
    await runtime.select('a')
    await runtime.submit()
    await runtime.advance()
    await expect(runtime.retrySupply()).rejects.toThrow('temporary recovery publish failure')
    expect(runtime.currentSession?.pendingEvents.filter((event) => event.type === 'learning.training.content.recovered.v1')).toHaveLength(1)
    const session = await runtime.retrySupply()
    expect(session.phase).toBe('answering')
    expect(sink.events.filter((event) => event.type === 'learning.training.content.recovered.v1')).toHaveLength(1)
    expect(session.stream?.completedItemIds).toEqual([first.itemId])
  })

  it('streams durable non-repeating items and completes only after finish-current-item', async () => {
    const secondQuestion: ListeningChoiceQuestion = {
      id: 'question-choice-2',
      type: 'word-discrimination',
      promptZh: '你听到了哪一句？',
      primarySegmentId: 'seg-sentence',
      segments: choiceQuestion.segments,
      playbackPolicy: choiceQuestion.playbackPolicy,
      options: [
        { id: 'yes', label: "I'm visiting Boston this week." },
        { id: 'no', label: 'I live in Chicago.' },
      ],
      correctOptionId: 'yes',
      rationaleZh: '音频读的是 Boston。',
      errorTag: 'sound-discrimination',
    }
    const currentCatalog = catalog([choiceQuestion, secondQuestion])
    const items = [
      {
        itemId: 'supply-1', learningUnitId: 'st4w-w1d1-listening', contentRef: 'lesson://survival-travel-american-4w/1.0.0/w1d1/listening',
        difficultyLevel: 2, tags: ['scene:introductions'], source: { sourceType: 'listening-extension' as const, sourceId: 'question-choice', variantId: 'word-discrimination' },
      },
      {
        itemId: 'supply-2', learningUnitId: 'st4w-w1d1-listening', contentRef: 'lesson://survival-travel-american-4w/1.0.0/w1d1/listening',
        difficultyLevel: 2, tags: ['scene:introductions'], source: { sourceType: 'listening-extension' as const, sourceId: 'question-choice-2', variantId: 'word-discrimination' },
      },
    ]
    const supplyProvider = {
      async next(request: import('../../learning-engine/index.ts').LearningTaskSupplyRequest) {
        const item = items.find((candidate) => !request.excludeItemIds.includes(candidate.itemId))
        return item
          ? { schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item, nextCursor: item.itemId }
          : { schemaVersion: 1 as const, requestId: request.requestId, status: 'content-exhausted' as const, reason: 'all-eligible-content-recently-used' as const }
      },
    }
    let budget: 'running' | 'finish-current-item' = 'running'
    const store = new MemoryStore()
    const sink = new InMemoryPlatformEventSink()
    const speech = new ImmediateSpeech()
    const runtime = new ListeningTrainingRuntime({
      task: createListeningTask({ trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } }),
      localDate: '2026-07-28', contentSource: { load: async () => currentCatalog }, eventSink: sink,
      repository: new ListeningSessionRepository(store), speech, now: clock(), createId: (() => { let id = 0; return () => `event-${id++}` })(),
      supplyProvider, trainingBudgetStatus: () => budget,
    })
    let session = await runtime.initialize()
    expect(session.stream?.activeItem.itemId).toBe('supply-1')
    await completeRuntimePlayback(runtime, speech)
    session = await runtime.select('a')
    session = await runtime.submit()
    session = await runtime.advance()
    expect(session.phase).toBe('answering')
    expect(session.stream?.completedItemIds).toEqual(['supply-1'])
    expect(session.stream?.activeItem.itemId).toBe('supply-2')

    const restoredSpeech = new ImmediateSpeech()
    const restored = new ListeningTrainingRuntime({
      task: createListeningTask({ trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } }),
      localDate: '2026-07-28', contentSource: { load: async () => currentCatalog }, eventSink: sink,
      repository: new ListeningSessionRepository(store), speech: restoredSpeech, now: clock(), createId: (() => { let id = 0; return () => `restored-event-${id++}` })(),
      supplyProvider, trainingBudgetStatus: () => budget,
    })
    session = await restored.initialize()
    expect(session.stream?.completedItemIds).toEqual(['supply-1'])
    budget = 'finish-current-item'
    await completeRuntimePlayback(restored, restoredSpeech)
    session = await restored.select('yes')
    session = await restored.submit()
    session = await restored.advance()
    expect(session.phase).toBe('completed')
    expect(sink.events.map((event) => event.type)).toContain('learning.training.item.completed.v1')
    expect(sink.events.map((event) => event.type)).toContain('learning.training.budget.completed.v1')
    const attempts = sink.events
      .map((event) => parseLearningEvent(event))
      .filter((event) => event.type === 'learning.attempt.completed.v1')
    expect(attempts.every((event) => event.payload.taskCompleted === false)).toBe(true)
  })

  it('reports a retryable exhausted stream without clearing completed exclusions', async () => {
    const currentCatalog = catalog([choiceQuestion])
    const item = {
      itemId: 'only-item', learningUnitId: 'st4w-w1d1-listening', contentRef: 'lesson://survival-travel-american-4w/1.0.0/w1d1/listening',
      difficultyLevel: 2, tags: ['scene:introductions'], source: { sourceType: 'listening-extension' as const, sourceId: 'question-choice', variantId: 'word-discrimination' },
    }
    const requests: import('../../learning-engine/index.ts').LearningTaskSupplyRequest[] = []
    const supplyProvider = {
      async next(request: import('../../learning-engine/index.ts').LearningTaskSupplyRequest) {
        requests.push(request)
        return request.excludeItemIds.includes(item.itemId)
          ? { schemaVersion: 1 as const, requestId: request.requestId, status: 'content-exhausted' as const, reason: 'all-eligible-content-recently-used' as const }
          : { schemaVersion: 1 as const, requestId: request.requestId, status: 'item' as const, item, nextCursor: item.itemId }
      },
    }
    const sink = new InMemoryPlatformEventSink()
    const speech = new ImmediateSpeech()
    const runtime = new ListeningTrainingRuntime({
      task: createListeningTask({ trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } }),
      localDate: '2026-07-28', contentSource: { load: async () => currentCatalog }, eventSink: sink,
      repository: new ListeningSessionRepository(new MemoryStore()), speech, now: clock(), createId: (() => { let id = 0; return () => `event-${id++}` })(),
      supplyProvider, trainingBudgetStatus: () => 'running',
    })
    await runtime.initialize()
    await completeRuntimePlayback(runtime, speech)
    await runtime.select('a')
    await runtime.submit()
    const exhausted = await runtime.advance()
    expect(exhausted.phase).toBe('error')
    expect(exhausted.stream?.completedItemIds).toEqual(['only-item'])
    expect(sink.events
      .map((event) => parseLearningEvent(event))
      .some((event) => event.type === 'learning.training.content.exhausted.v1' && event.payload.reason === 'all-eligible-content-recently-used')).toBe(true)
    await runtime.retrySupply()
    expect(runtime.currentSession?.phase).toBe('error')
    expect(requests.at(-1)?.excludeItemIds).toEqual(['only-item'])
  })

  it('keeps rapid dictation notifications and persistence on the latest complete value', async () => {
    const store = new ControlledWriteStore()
    const repository = new ListeningSessionRepository(store)
    const runtime = new ListeningTrainingRuntime({
      task: createListeningTask(),
      localDate: '2026-07-24',
      contentSource: {
        load: async () => catalog([dictationQuestion]),
      },
      eventSink: new InMemoryPlatformEventSink(),
      repository,
      networkStatus: online,
      speech: new ImmediateSpeech(),
      now: clock(),
      createId: (() => {
        let id = 0
        return () => `dictation-id-${++id}`
      })(),
    })
    await runtime.initialize()

    const notifications: string[] = []
    const unsubscribe = runtime.subscribe((session) => {
      notifications.push(session.dictationInput)
    })
    store.controlWrites()

    const updates = [
      runtime.changeDictation('a'),
      runtime.changeDictation('ab'),
      runtime.changeDictation('abc'),
    ]
    const immediateNotifications = [...notifications]

    await commitControlledWrites(store, updates.length)
    const returnedSessions = await Promise.all(updates)
    const restored = await repository.load(createListeningTask())
    unsubscribe()

    expect.soft(immediateNotifications).toEqual(['a', 'ab', 'abc'])
    expect.soft(notifications).toEqual(['a', 'ab', 'abc'])
    expect.soft(
      returnedSessions.map(
        (session: ListeningSession) => session.dictationInput,
      ),
    ).toEqual(['abc', 'abc', 'abc'])
    expect.soft(restored?.dictationInput).toBe('abc')
  })

  it('saves the latest rapid dictation before submitting', async () => {
    const store = new ControlledWriteStore()
    const repository = new ListeningSessionRepository(store)
    const task = createListeningTask()
    const speech = new ImmediateSpeech()
    const runtime = new ListeningTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: {
        load: async () => catalog([dictationQuestion]),
      },
      eventSink: new InMemoryPlatformEventSink(),
      repository,
      networkStatus: online,
      speech,
      now: clock(),
      createId: () => 'submit-dictation-id',
    })
    await runtime.initialize()
    await completeRuntimePlayback(runtime, speech)
    const notifications: ListeningSession[] = []
    runtime.subscribe((session) => {
      notifications.push(session)
    })
    store.controlWrites()

    const updates = [
      runtime.changeDictation('a'),
      runtime.changeDictation('ab'),
      runtime.changeDictation('abc'),
    ]
    const submission = runtime.submit()

    await commitControlledWrites(store, 3)
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    const publishedFeedbackBeforeDurableWrite = notifications.some(
      (session) => session.phase === 'feedback',
    )
    const storedBeforeFeedbackWrite = await repository.load(task)
    store.commitNewest()
    await Promise.all(updates)
    const submitted = await submission
    const restored = await repository.load(task)

    expect(publishedFeedbackBeforeDurableWrite).toBe(false)
    expect(storedBeforeFeedbackWrite?.phase).toBe('answering')
    expect(submitted.phase).toBe('feedback')
    expect(submitted.dictationInput).toBe('abc')
    expect(submitted.answers.at(-1)?.response).toBe('abc')
    expect(restored).toMatchObject({
      phase: 'feedback',
      dictationInput: 'abc',
    })
  })

  it('keeps a restored same-turn draft while using one continuous neutral dialogue utterance', async () => {
    const store = new ControlledWriteStore()
    const repository = new ListeningSessionRepository(store)
    const task = createListeningTask()
    const speech = new ImmediateSpeech([
      { id: 'runtime-voice-a', locale: 'en-US', localService: true },
      { id: 'runtime-voice-b', locale: 'en-US', localService: true },
    ])
    const runtimeOptions = {
      task,
      localDate: '2026-07-24',
      contentSource: {
        load: async () => dialogueCatalog(),
      },
      eventSink: new InMemoryPlatformEventSink(),
      repository,
      networkStatus: online,
      speech,
      now: clock(),
      createId: () => 'restored-submit-dictation-id',
    } as const
    const firstRuntime = new ListeningTrainingRuntime(runtimeOptions)
    await firstRuntime.initialize()
    await firstRuntime.togglePlayback()
    expect(speech.speakRequests).toEqual([
      {
        text: 'Good morning. How can I help? I need a ticket.',
        locale: 'en-US',
        rate: 1,
      },
    ])
    expect(speech.speakRequests[0].text).not.toMatch(/Alex:|Blair:/u)
    speech.callbacks?.onEnd?.()
    await firstRuntime.changeDictation('abc')
    await firstRuntime.pause('user-paused')
    firstRuntime.dispose()

    const runtime = new ListeningTrainingRuntime(runtimeOptions)
    await runtime.initialize()
    await runtime.resume()
    const notifications: ListeningSession[] = []
    runtime.subscribe((session) => {
      notifications.push(session)
    })
    store.controlWrites()

    const submission = runtime.submit()
    const latestDraft = Promise.resolve().then(() =>
      runtime.changeDictation('abcdef'),
    )
    void latestDraft.catch(() => undefined)

    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    store.commitNewest()
    await latestDraft
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    const publishedFeedbackBeforeDurableWrite = notifications.some(
      (session) => session.phase === 'feedback',
    )
    store.commitNewest()
    const submitted = await submission
    const restored = await repository.load(task)

    expect(publishedFeedbackBeforeDurableWrite).toBe(false)
    expect(submitted).toMatchObject({
      phase: 'feedback',
      dictationInput: 'abcdef',
    })
    expect(submitted.answers.at(-1)?.response).toBe('abcdef')
    expect(restored).toMatchObject({
      phase: 'feedback',
      dictationInput: 'abcdef',
    })
    expect(restored?.answers.at(-1)?.response).toBe('abcdef')
  })

  it('saves the latest rapid dictation before pausing for exit', async () => {
    const store = new ControlledWriteStore()
    const repository = new ListeningSessionRepository(store)
    const task = createListeningTask()
    const runtime = new ListeningTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: {
        load: async () => catalog([dictationQuestion]),
      },
      eventSink: new InMemoryPlatformEventSink(),
      repository,
      networkStatus: online,
      speech: new ImmediateSpeech(),
      now: clock(),
      createId: () => 'pause-dictation-id',
    })
    await runtime.initialize()
    const notifications: ListeningSession[] = []
    runtime.subscribe((session) => {
      notifications.push(session)
    })
    store.controlWrites()

    const updates = [
      runtime.changeDictation('a'),
      runtime.changeDictation('ab'),
      runtime.changeDictation('abc'),
    ]
    let exitReady = false
    const pauseForExit = runtime.pause('user-paused').then((session) => {
      exitReady = true
      return session
    })

    await commitControlledWrites(store, 3)
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    const publishedPauseBeforeDurableWrite = notifications.some(
      (session) => session.phase === 'paused',
    )
    const storedBeforePauseWrite = await repository.load(task)
    store.commitNewest()
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    const exitReadyBeforeFinalWrite = exitReady
    store.commitNewest()
    await Promise.all(updates)
    const paused = await pauseForExit
    const restored = await repository.load(task)

    expect(publishedPauseBeforeDurableWrite).toBe(false)
    expect(storedBeforePauseWrite?.phase).toBe('answering')
    expect(exitReadyBeforeFinalWrite).toBe(false)
    expect(paused).toMatchObject({
      phase: 'paused',
      dictationInput: 'abc',
      pendingEvents: [],
    })
    expect(restored).toMatchObject({
      phase: 'paused',
      dictationInput: 'abc',
      pendingEvents: [],
    })
  })

  it('pauses only after a restored same-turn draft is durable', async () => {
    const store = new ControlledWriteStore()
    const repository = new ListeningSessionRepository(store)
    const task = createListeningTask()
    const runtimeOptions = {
      task,
      localDate: '2026-07-24',
      contentSource: {
        load: async () => catalog([dictationQuestion]),
      },
      eventSink: new InMemoryPlatformEventSink(),
      repository,
      networkStatus: online,
      speech: new ImmediateSpeech(),
      now: clock(),
      createId: () => 'restored-pause-dictation-id',
    } as const
    const firstRuntime = new ListeningTrainingRuntime(runtimeOptions)
    await firstRuntime.initialize()
    await firstRuntime.togglePlayback()
    await firstRuntime.changeDictation('abc')
    await firstRuntime.pause('user-paused')
    firstRuntime.dispose()

    const runtime = new ListeningTrainingRuntime(runtimeOptions)
    await runtime.initialize()
    await runtime.resume()
    const notifications: ListeningSession[] = []
    runtime.subscribe((session) => {
      notifications.push(session)
    })
    store.controlWrites()

    let exitReady = false
    const pauseForExit = runtime.pause('user-paused').then((session) => {
      exitReady = true
      return session
    })
    const latestDraft = Promise.resolve().then(() =>
      runtime.changeDictation('abcdef'),
    )
    void latestDraft.catch(() => undefined)

    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    store.commitNewest()
    await latestDraft
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    const publishedPauseBeforeDurableWrite = notifications.some(
      (session) => session.phase === 'paused',
    )
    const exitReadyBeforePauseWrite = exitReady
    store.commitNewest()
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    store.commitNewest()
    const paused = await pauseForExit
    const restored = await repository.load(task)

    expect(publishedPauseBeforeDurableWrite).toBe(false)
    expect(exitReadyBeforePauseWrite).toBe(false)
    expect(paused).toMatchObject({
      phase: 'paused',
      dictationInput: 'abcdef',
      pendingEvents: [],
    })
    expect(restored).toMatchObject({
      phase: 'paused',
      dictationInput: 'abcdef',
      pendingEvents: [],
    })
  })

  it('does not publish completion before the advanced session is durable', async () => {
    const store = new ControlledWriteStore()
    const repository = new ListeningSessionRepository(store)
    const task = createListeningTask()
    const sink = new InMemoryPlatformEventSink()
    const speech = new ImmediateSpeech()
    const runtime = new ListeningTrainingRuntime({
      task,
      localDate: '2026-07-24',
      contentSource: {
        load: async () => catalog([dictationQuestion]),
      },
      eventSink: sink,
      repository,
      networkStatus: online,
      speech,
      now: clock(),
      createId: () => 'advance-dictation-id',
    })
    await runtime.initialize()
    await completeRuntimePlayback(runtime, speech)
    await runtime.changeDictation('abc')
    await runtime.submit()

    const notifications: ListeningSession[] = []
    runtime.subscribe((session) => {
      notifications.push(session)
    })
    store.controlWrites()
    let advanceResolved = false
    const advance = runtime.advance().then((session) => {
      advanceResolved = true
      return session
    })

    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    const publishedCompletionBeforeDurableWrite = notifications.some(
      (session) => session.phase === 'completed',
    )
    const storedBeforeCompletionWrite = await repository.load(task)
    store.commitNewest()
    await vi.waitFor(() => {
      expect(store.pendingWrites.length).toBeGreaterThan(0)
    })
    const advanceResolvedBeforeFinalWrite = advanceResolved
    store.commitNewest()
    const completed = await advance
    const restored = await repository.load(task)

    expect(publishedCompletionBeforeDurableWrite).toBe(false)
    expect(storedBeforeCompletionWrite?.phase).toBe('feedback')
    expect(advanceResolvedBeforeFinalWrite).toBe(false)
    expect(completed.phase).toBe('completed')
    expect(restored).toMatchObject({
      phase: 'completed',
      pendingEvents: [],
    })
    expect(sink.events.at(-1)?.type).toBe(
      'learning.attempt.completed.v1',
    )
  })

  it('publishes start and scored completion through the durable outbox', async () => {
    const sink = new InMemoryPlatformEventSink()
    const speech = new ImmediateSpeech()
    const runtime = new ListeningTrainingRuntime({
      task: createListeningTask(),
      localDate: '2026-07-24',
      contentSource: { load: async () => catalog() },
      eventSink: sink,
      repository: new ListeningSessionRepository(new MemoryStore()),
      networkStatus: online,
      speech,
      now: clock(),
      createId: (() => {
        let id = 0
        return () => `id-${++id}`
      })(),
    })

    await runtime.initialize()
    await completeRuntimePlayback(runtime, speech)
    await runtime.select('a')
    await runtime.submit()
    const completed = await runtime.advance()

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

  it('degrades missing offline content to an unscorable network result', async () => {
    const sink = new InMemoryPlatformEventSink()
    const runtime = new ListeningTrainingRuntime({
      task: createListeningTask(),
      localDate: '2026-07-24',
      contentSource: {
        load: async () => {
          throw new ListeningError(
            'content-unavailable',
            'Content fetch failed.',
          )
        },
      },
      eventSink: sink,
      repository: new ListeningSessionRepository(new MemoryStore()),
      networkStatus: offline,
      speech: new ImmediateSpeech(),
      now: clock(),
      createId: (() => {
        let id = 0
        return () => `offline-id-${++id}`
      })(),
    })

    const session = await runtime.initialize()

    expect(session.phase).toBe('error')
    expect(session.failure?.category).toBe('network')
    expect(sink.events[1].payload).toMatchObject({
      result: 'unscorable',
      performanceScore: null,
      taskCompleted: false,
      failureCategory: 'network',
    })
  })

  it('cancels speech and publishes a pause when the app backgrounds', async () => {
    const sink = new InMemoryPlatformEventSink()
    const speech = new ImmediateSpeech()
    const runtime = new ListeningTrainingRuntime({
      task: createListeningTask(),
      localDate: '2026-07-24',
      contentSource: { load: async () => catalog() },
      eventSink: sink,
      repository: new ListeningSessionRepository(new MemoryStore()),
      networkStatus: online,
      speech,
      now: clock(),
      createId: (() => {
        let id = 0
        return () => `background-id-${++id}`
      })(),
    })
    await runtime.initialize()
    await runtime.togglePlayback()

    const paused = await runtime.pause('app-backgrounded')

    expect(paused.phase).toBe('paused')
    expect(paused.playback.status).toBe('paused')
    expect(speech.cancelCount).toBeGreaterThan(0)
    expect(sink.events.at(-1)).toMatchObject({
      type: 'learning.task.paused.v1',
      payload: { reason: 'app-backgrounded' },
    })
  })

  it('turns an active audio interruption into unscorable device evidence', async () => {
    const sink = new InMemoryPlatformEventSink()
    const wrongAnswerSink: unknown[] = []
    const speech = new ImmediateSpeech()
    const runtime = new ListeningTrainingRuntime({
      task: createListeningTask(),
      localDate: '2026-07-24',
      contentSource: { load: async () => catalog() },
      eventSink: sink,
      repository: new ListeningSessionRepository(new MemoryStore()),
      networkStatus: online,
      speech,
      now: clock(),
      createId: (() => {
        let id = 0
        return () => `device-id-${++id}`
      })(),
      publishWrongAnswerEvidence: async (evidence) => { wrongAnswerSink.push(evidence) },
    })
    await runtime.initialize()
    await runtime.togglePlayback()

    speech.callbacks?.onError?.('audio-busy')

    await vi.waitFor(() => {
      expect(runtime.currentSession?.phase).toBe('error')
      expect(sink.events.at(-1)?.payload).toMatchObject({
        result: 'unscorable',
        performanceScore: null,
        taskCompleted: false,
        failureCategory: 'device',
      })
    })
    expect(runtime.currentSession?.failure?.category).toBe('device')
    expect(runtime.currentSession?.pendingWrongAnswerEvidence).toEqual([])
    expect(wrongAnswerSink).toEqual([])
  })
})
