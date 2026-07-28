import { describe, expect, it } from 'vitest'
import type {
  PlatformEvent,
  PlatformEventSink,
} from '../../src/core/index.ts'
import { InMemoryPlatformEventSink } from '../../src/core/testing/index.ts'
import {
  getCurrentListeningQuestion,
  ListeningSessionRepository,
  ListeningTrainingRuntime,
  type ListeningSpeechCallbacks,
  type ListeningSpeechPort,
  type ListeningSpeechRequest,
} from '../../src/features/listening/index.ts'
import {
  SpeakingSessionRepository,
  SpeakingTrainingRuntime,
  type SpeakingRecognitionPort,
  type SpeakingRecording,
  type SpeakingRecordingLifecycleCallbacks,
  type SpeakingRecordingPort,
} from '../../src/features/speaking/index.ts'
import {
  applyPlanEvent,
  buildLearningTaskSupplyRequest,
  createInitialProgressState,
  createLearningEngineState,
  createPlanProgress,
  generateDailyPlan,
  getPlanTaskAccess,
  parseLearningEvent,
  type LearningTask,
  type PlanProgress,
  type TrainingModuleId,
} from '../../src/learning-engine/index.ts'
import { abilityProfileR1 } from '../../src/learning-engine/test-fixtures.ts'
import type {
  MicrophonePermissionService,
  NetworkStatusService,
} from '../../src/platform/index.ts'
import {
  projectLearningCandidates,
} from '../../src/app/learning/course-candidate-source.ts'
import { createProductionTrainingSupplyProviders } from '../../src/app/learning/training-supply-providers.ts'
import {
  toDailyPlanViewModel,
  toPracticeModulesViewModel,
} from '../../src/app/learning/view-model.ts'
import { formatTrainingBudgetTarget } from '../../src/ui/index.ts'
import {
  MemoryNamespaceStore,
  productionTaskFor,
  releasedCatalogs,
  releasedCourseDocuments,
  sequenceIds,
  sequenceNow,
} from './fixtures/production-course.ts'

const MODULES = [
  'vocabulary',
  'listening',
  'speaking',
] as const satisfies readonly TrainingModuleId[]
const LOCAL_DATE = '2026-07-28'
const GENERATED_AT = '2026-07-28T00:00:00.000Z'

function productionPlan() {
  return generateDailyPlan({
    planId: 'qa-011-plan',
    generatedAt: GENERATED_AT,
    localDate: LOCAL_DATE,
    availableSeconds: 2_700,
    progress: createInitialProgressState(
      abilityProfileR1(),
      GENERATED_AT,
    ),
    reviewItems: {},
    candidates: projectLearningCandidates(
      releasedCourseDocuments,
      new Set(),
      new Set(MODULES),
    ),
  })
}

function taskFor(
  progress: PlanProgress,
  moduleId: TrainingModuleId,
) {
  const execution = progress.tasks.find(
    (candidate) =>
      candidate.task.targetModuleId === moduleId,
  )
  if (!execution) {
    throw new Error(`Missing ${moduleId} execution.`)
  }
  return execution
}

function eventPayload(task: LearningTask) {
  return {
    planId: task.planId,
    taskId: task.taskId,
    learningUnitId: task.learningUnitId,
    contentRef: task.contentRef,
    domain: task.domain,
    targetModuleId: task.targetModuleId,
    localDate: LOCAL_DATE,
    mode: task.mode,
  }
}

function timingEvent(
  task: LearningTask,
  input: {
    readonly id: string
    readonly elapsedSeconds: number
    readonly phase:
      | 'answering'
      | 'paused'
      | 'idle'
    readonly reason:
      | 'active-answering'
      | 'user-paused'
      | 'idle-timeout'
      | 'app-backgrounded'
    readonly visibility: 'foreground' | 'background'
    readonly offsetSeconds: number
  },
) {
  const startedAt = new Date(
    Date.parse(GENERATED_AT) + input.offsetSeconds * 1_000,
  ).toISOString()
  const endedAt = new Date(
    Date.parse(startedAt) + input.elapsedSeconds * 1_000,
  ).toISOString()
  return parseLearningEvent({
    id: input.id,
    type: 'learning.timing.segment.recorded.v1',
    sourceModuleId: task.targetModuleId,
    schemaVersion: 1,
    occurredAt: endedAt,
    payload: {
      ...eventPayload(task),
      phase: input.phase,
      reason: input.reason,
      visibility: input.visibility,
      startedAt,
      endedAt,
      elapsedSeconds: input.elapsedSeconds,
      idleThresholdSeconds: 45,
    },
  })
}

function itemCompletedEvent(
  task: LearningTask,
  input: {
    readonly id: string
    readonly requestId: string
    readonly itemId: string
    readonly nextCursor: string
  },
) {
  return parseLearningEvent({
    id: input.id,
    type: 'learning.training.item.completed.v1',
    sourceModuleId: task.targetModuleId,
    schemaVersion: 1,
    occurredAt: '2026-07-28T00:01:00.000Z',
    payload: {
      ...eventPayload(task),
      requestId: input.requestId,
      nextSupplyCursor: input.nextCursor,
      outcome: 'unscorable-practice',
      item: {
        itemId: input.itemId,
        learningUnitId: task.learningUnitId,
        contentRef: task.contentRef,
        difficultyLevel: task.difficultyLevel,
        tags: task.tags,
      },
    },
  })
}

function contentExhaustedEvent(
  task: LearningTask,
  requestId: string,
  cursor: string | null,
) {
  return parseLearningEvent({
    id: `${task.taskId}:exhausted`,
    type: 'learning.training.content.exhausted.v1',
    sourceModuleId: task.targetModuleId,
    schemaVersion: 1,
    occurredAt: '2026-07-28T00:02:00.000Z',
    payload: {
      ...eventPayload(task),
      requestId,
      cursor,
      reason: 'all-eligible-content-recently-used',
    },
  })
}

function contentRecoveredEvent(
  task: LearningTask,
  exhaustionRequestId: string,
  id = `${task.taskId}:recovered`,
) {
  return parseLearningEvent({
    id,
    type: 'learning.training.content.recovered.v1',
    sourceModuleId: task.targetModuleId,
    schemaVersion: 1,
    occurredAt: '2026-07-28T00:03:00.000Z',
    payload: {
      ...eventPayload(task),
      exhaustionRequestId,
    },
  })
}

function attemptCompletedEvent(task: LearningTask) {
  return parseLearningEvent({
    id: `${task.taskId}:attempt`,
    type: 'learning.attempt.completed.v1',
    sourceModuleId: task.targetModuleId,
    schemaVersion: 1,
    occurredAt: '2026-07-28T00:15:00.000Z',
    payload: {
      ...eventPayload(task),
      difficultyLevel: task.difficultyLevel,
      estimatedSeconds: task.estimatedSeconds,
      result: 'scored',
      performanceScore: 1,
      evidenceQuality: 1,
      assistanceLevel: 0,
      durationSeconds: 1,
      taskCompleted: true,
      errorTags: [],
      contentTags: task.tags,
      failureCategory: null,
    },
  })
}

function budgetCompletedEvent(
  task: LearningTask,
  itemId: string,
) {
  return parseLearningEvent({
    id: `${task.taskId}:budget-completed`,
    type: 'learning.training.budget.completed.v1',
    sourceModuleId: task.targetModuleId,
    schemaVersion: 1,
    occurredAt: '2026-07-28T00:15:01.000Z',
    payload: {
      ...eventPayload(task),
      lastCompletedItemId: itemId,
      completedItemCount: 1,
    },
  })
}

function providersAndCatalogs() {
  const catalogs = releasedCatalogs()
  return {
    catalogs,
    providers: createProductionTrainingSupplyProviders({
      vocabulary: { load: async () => catalogs.vocabulary },
      listening: { load: async () => catalogs.listening },
      speaking: { load: async () => catalogs.speaking },
    }),
  }
}

const online: NetworkStatusService = {
  current: () => 'online',
  subscribe: () => () => undefined,
}

class DeferredSpeech implements ListeningSpeechPort {
  callbacks: ListeningSpeechCallbacks | null = null
  canceled = 0

  capabilities() {
    return {
      supported: true,
      voicesKnown: true,
      enUsVoiceAvailable: true,
      pauseResumeAvailable: true,
      supportedRates: [0.75, 1, 1.25] as const,
    }
  }

  speak(
    _request: ListeningSpeechRequest,
    callbacks: ListeningSpeechCallbacks,
  ) {
    this.callbacks = callbacks
    callbacks.onStart?.()
  }

  finish() {
    this.callbacks?.onEnd?.()
  }

  pause() {}
  resume() {}
  cancel() {
    this.canceled += 1
  }
  isPaused() {
    return false
  }
  isSpeaking() {
    return this.callbacks !== null
  }
}

class ObservableRecorder implements SpeakingRecordingPort {
  started = 0
  canceled = 0
  played = 0
  recordingLifecycle: SpeakingRecordingLifecycleCallbacks | null =
    null

  capabilities() {
    return {
      supported: true,
      supportedMimeTypes: ['audio/mp4'],
    }
  }

  start(
    _stream: MediaStream,
    lifecycle?: SpeakingRecordingLifecycleCallbacks,
  ) {
    this.started += 1
    this.recordingLifecycle = lifecycle ?? null
    lifecycle?.onStarted()
  }

  async stop(): Promise<SpeakingRecording> {
    this.recordingLifecycle?.onStopped()
    return {
      id: 'qa-011-recording',
      blob: new Blob(['voice'], { type: 'audio/mp4' }),
      mimeType: 'audio/mp4',
      durationMs: 2_000,
    }
  }

  cancel() {
    this.canceled += 1
  }
  async play(_recording: SpeakingRecording) {
    this.played += 1
  }
  stopPlayback() {}
  discard(_recording: SpeakingRecording) {}
  dispose() {}
}

const grantedMicrophone: MicrophonePermissionService = {
  query: async () => 'granted',
  request: async () =>
    ({
      getTracks: () => [{ stop() {} }],
    }) as unknown as MediaStream,
}

describe('QA-011 continuous effective-training acceptance', () => {
  it('shows the same 15-minute budget on Today and Training and supplies stable non-repeating production items', async () => {
    const plan = productionPlan()
    const progress = createPlanProgress(plan, GENERATED_AT)
    const access = getPlanTaskAccess(progress)
    const daily = toDailyPlanViewModel(
      progress,
      createLearningEngineState(abilityProfileR1(), GENERATED_AT),
      access,
      GENERATED_AT,
    )
    const practice = toPracticeModulesViewModel(progress, access)

    expect(formatTrainingBudgetTarget(900)).toBe('15 分钟有效训练')
    expect(
      daily.tasks.map((task) =>
        task.availability === 'startable'
          ? task.trainingBudget?.targetEffectiveSeconds
          : null,
      ),
    ).toEqual([900, 900, 900])
    expect(
      practice
        .filter((module) => module.moduleId !== 'assessment')
        .map((module) =>
          module.availability === 'startable'
            ? module.trainingBudget?.targetEffectiveSeconds
            : null,
        ),
    ).toEqual([900, 900, 900])

    const { providers } = providersAndCatalogs()
    for (const moduleId of MODULES) {
      const execution = taskFor(progress, moduleId)
      const firstRequest = buildLearningTaskSupplyRequest(execution)
      if (!firstRequest) {
        throw new Error(`Missing ${moduleId} first request.`)
      }
      const first = await providers[moduleId].next(firstRequest)
      expect(first.status).toBe('item')
      if (first.status !== 'item') {
        throw new Error(`${moduleId} did not return its first item.`)
      }
      const restoredRequest = JSON.parse(
        JSON.stringify({
          ...firstRequest,
          requestId: `${execution.task.taskId}:supply:2:${first.nextCursor}`,
          cursor: first.nextCursor,
          excludeItemIds: [first.item.itemId],
          reason: 'continue-after-item',
        }),
      ) as typeof firstRequest
      const second = await providers[moduleId].next(restoredRequest)
      expect(second.status).toBe('item')
      if (second.status !== 'item') {
        throw new Error(`${moduleId} did not return its second item.`)
      }
      expect(second.item.itemId).not.toBe(first.item.itemId)
      expect(restoredRequest.cursor).toBe(first.nextCursor)
      expect(restoredRequest.excludeItemIds).toEqual([
        first.item.itemId,
      ])
    }
  })

  it('keeps excluded time outside the budget, continues at 899, and completes only after the current item and budget event', () => {
    const initial = createPlanProgress(productionPlan(), GENERATED_AT)
    const task = taskFor(initial, 'vocabulary').task
    let progress = initial
    for (const event of [
      timingEvent(task, {
        id: 'qa-011-background',
        elapsedSeconds: 120,
        phase: 'answering',
        reason: 'app-backgrounded',
        visibility: 'background',
        offsetSeconds: 0,
      }),
      timingEvent(task, {
        id: 'qa-011-paused',
        elapsedSeconds: 120,
        phase: 'paused',
        reason: 'user-paused',
        visibility: 'foreground',
        offsetSeconds: 120,
      }),
      timingEvent(task, {
        id: 'qa-011-idle',
        elapsedSeconds: 120,
        phase: 'idle',
        reason: 'idle-timeout',
        visibility: 'foreground',
        offsetSeconds: 240,
      }),
    ]) {
      progress = applyPlanEvent(progress, event)
    }
    expect(taskFor(progress, 'vocabulary')).toMatchObject({
      effectiveSeconds: 0,
      excludedSeconds: 360,
      training: {
        remainingEffectiveSeconds: 900,
        status: 'running',
      },
    })

    let remaining = 899
    let offsetSeconds = 360
    let segment = 0
    while (remaining > 0) {
      const elapsedSeconds = Math.min(45, remaining)
      progress = applyPlanEvent(
        progress,
        timingEvent(task, {
          id: `qa-011-active-${++segment}`,
          elapsedSeconds,
          phase: 'answering',
          reason: 'active-answering',
          visibility: 'foreground',
          offsetSeconds,
        }),
      )
      remaining -= elapsedSeconds
      offsetSeconds += elapsedSeconds
    }
    expect(taskFor(progress, 'vocabulary')).toMatchObject({
      status: 'active',
      effectiveSeconds: 899,
      training: {
        remainingEffectiveSeconds: 1,
        status: 'running',
      },
    })

    progress = applyPlanEvent(progress, attemptCompletedEvent(task))
    expect(taskFor(progress, 'vocabulary').status).toBe('active')
    progress = applyPlanEvent(
      progress,
      timingEvent(task, {
        id: 'qa-011-active-900',
        elapsedSeconds: 1,
        phase: 'answering',
        reason: 'active-answering',
        visibility: 'foreground',
        offsetSeconds,
      }),
    )
    expect(taskFor(progress, 'vocabulary')).toMatchObject({
      status: 'active',
      effectiveSeconds: 900,
      training: {
        remainingEffectiveSeconds: 0,
        status: 'finish-current-item',
      },
    })

    const request = buildLearningTaskSupplyRequest(
      taskFor(progress, 'vocabulary'),
    )
    if (!request) {
      throw new Error('Missing finish-current request.')
    }
    const itemId = 'qa-011-finish-current-item'
    progress = applyPlanEvent(
      progress,
      itemCompletedEvent(task, {
        id: 'qa-011-finish-current-item-event',
        requestId: request.requestId,
        itemId,
        nextCursor: itemId,
      }),
    )
    expect(taskFor(progress, 'vocabulary').status).toBe('active')
    progress = applyPlanEvent(
      progress,
      budgetCompletedEvent(task, itemId),
    )
    expect(taskFor(progress, 'vocabulary')).toMatchObject({
      status: 'completed',
      training: {
        remainingEffectiveSeconds: 0,
        status: 'completed',
      },
    })
  })

  it.each(MODULES)(
    'restores %s exhaustion, rejects the wrong recovery, and continues without clearing cursor or exclusions',
    (moduleId) => {
      const initial = createPlanProgress(
        productionPlan(),
        GENERATED_AT,
      )
      const task = taskFor(initial, moduleId).task
      const firstRequest = buildLearningTaskSupplyRequest(
        taskFor(initial, moduleId),
      )
      if (!firstRequest) {
        throw new Error(`Missing ${moduleId} first request.`)
      }
      const firstItemId = `qa-011-${moduleId}-item-1`
      let progress = applyPlanEvent(
        initial,
        itemCompletedEvent(task, {
          id: `${moduleId}:item-1-event`,
          requestId: firstRequest.requestId,
          itemId: firstItemId,
          nextCursor: firstItemId,
        }),
      )
      const secondRequest = buildLearningTaskSupplyRequest(
        taskFor(progress, moduleId),
      )
      if (!secondRequest) {
        throw new Error(`Missing ${moduleId} second request.`)
      }
      const exhausted = contentExhaustedEvent(
        task,
        secondRequest.requestId,
        secondRequest.cursor,
      )
      progress = applyPlanEvent(progress, exhausted)
      expect(taskFor(progress, moduleId)).toMatchObject({
        status: 'blocked',
        training: {
          status: 'content-exhausted',
          completedItemIds: [firstItemId],
          nextSupplyCursor: firstItemId,
        },
      })

      const restored = JSON.parse(
        JSON.stringify(progress),
      ) as PlanProgress
      expect(() =>
        applyPlanEvent(
          restored,
          contentRecoveredEvent(task, 'wrong-request', `${moduleId}:wrong`),
        ),
      ).toThrow(/does not match/u)
      const recoveredEvent = contentRecoveredEvent(
        task,
        secondRequest.requestId,
      )
      const recovered = applyPlanEvent(restored, recoveredEvent)
      expect(taskFor(recovered, moduleId)).toMatchObject({
        status: 'active',
        training: {
          status: 'running',
          remainingEffectiveSeconds: 900,
          completedItemIds: [firstItemId],
          nextSupplyCursor: firstItemId,
          contentExhausted: null,
        },
      })
      expect(applyPlanEvent(recovered, recoveredEvent)).toBe(
        recovered,
      )
      const retryRequest = buildLearningTaskSupplyRequest(
        taskFor(recovered, moduleId),
      )
      expect(retryRequest).toMatchObject({
        requestId: secondRequest.requestId,
        cursor: firstItemId,
        excludeItemIds: [firstItemId],
      })
      if (!retryRequest) {
        throw new Error(`Missing ${moduleId} retry request.`)
      }
      const secondItemId = `qa-011-${moduleId}-item-2`
      const continued = applyPlanEvent(
        recovered,
        itemCompletedEvent(task, {
          id: `${moduleId}:item-2-event`,
          requestId: retryRequest.requestId,
          itemId: secondItemId,
          nextCursor: secondItemId,
        }),
      )
      expect(
        taskFor(continued, moduleId).training?.completedItemIds,
      ).toEqual([firstItemId, secondItemId])
    },
  )

  it('does not cancel listening playback when the deadline arrives and completes only after playback and the answer', async () => {
    const { catalogs, providers } = providersAndCatalogs()
    const task = {
      ...productionTaskFor('listening'),
      trainingBudget: {
        schemaVersion: 1 as const,
        targetEffectiveSeconds: 900 as const,
      },
    }
    const speech = new DeferredSpeech()
    const sink = new InMemoryPlatformEventSink()
    let budget: 'running' | 'finish-current-item' = 'running'
    const runtime = new ListeningTrainingRuntime({
      task,
      localDate: LOCAL_DATE,
      contentSource: { load: async () => catalogs.listening },
      eventSink: sink,
      repository: new ListeningSessionRepository(
        new MemoryNamespaceStore('qa-011.listening'),
      ),
      networkStatus: online,
      speech,
      now: sequenceNow(),
      createId: sequenceIds('qa-011-listening'),
      supplyProvider: providers.listening,
      trainingBudgetStatus: () => budget,
    })

    let session = await runtime.initialize()
    await runtime.togglePlayback()
    budget = 'finish-current-item'
    expect(runtime.currentSession?.phase).not.toBe('completed')
    expect(speech.canceled).toBe(0)
    speech.finish()
    const question = getCurrentListeningQuestion(
      runtime.currentSession ?? session,
    )
    if (!question) {
      throw new Error('Listening finish-current item is missing.')
    }
    if (question.type === 'keyword-dictation') {
      await runtime.changeDictation(question.standardAnswer)
    } else {
      await runtime.select(question.correctOptionId)
    }
    await runtime.submit()
    session = await runtime.advance()
    expect(session.phase).toBe('completed')
    expect(sink.events.map((event) => event.type).slice(-2)).toEqual([
      'learning.training.item.completed.v1',
      'learning.training.budget.completed.v1',
    ])
  })

  it('does not cancel an active speaking recording when the deadline arrives and completes after recognition', async () => {
    const { catalogs, providers } = providersAndCatalogs()
    const task = {
      ...productionTaskFor('speaking'),
      trainingBudget: {
        schemaVersion: 1 as const,
        targetEffectiveSeconds: 900 as const,
      },
    }
    const recorder = new ObservableRecorder()
    const sink: PlatformEventSink & { readonly events: PlatformEvent[] } =
      new InMemoryPlatformEventSink()
    let budget: 'running' | 'finish-current-item' = 'running'
    let runtime: SpeakingTrainingRuntime
    const recognition: SpeakingRecognitionPort = {
      capabilities: () => ({
        supported: true,
        requiresSiri: true,
      }),
      start: () => {
        const prompt =
          runtime.currentSession?.unit?.prompts[
            runtime.currentSession.promptIndex
          ]
        return {
          result: Promise.resolve({
            status: 'recognized' as const,
            transcript: prompt?.modelAnswer ?? '',
            alternatives: [],
          }),
          stop() {},
          abort() {},
        }
      },
    }
    runtime = new SpeakingTrainingRuntime({
      task,
      localDate: LOCAL_DATE,
      contentSource: { load: async () => catalogs.speaking },
      eventSink: sink,
      repository: new SpeakingSessionRepository(
        new MemoryNamespaceStore('qa-011.speaking'),
      ),
      networkStatus: online,
      microphonePermission: grantedMicrophone,
      recorder,
      recognition,
      now: sequenceNow(),
      createId: sequenceIds('qa-011-speaking'),
      supplyProvider: providers.speaking,
      trainingBudgetStatus: () => budget,
    })

    await runtime.initialize()
    await runtime.startRecording()
    budget = 'finish-current-item'
    expect(runtime.currentSession).toMatchObject({
      phase: 'practicing',
      recorder: { status: 'recording' },
    })
    expect(recorder.started).toBe(1)
    expect(recorder.canceled).toBe(0)
    await runtime.stopRecording()
    const session = await runtime.advance()
    expect(session.phase).toBe('completed')
    expect(recorder.canceled).toBe(0)
    expect(sink.events.map((event) => event.type).slice(-2)).toEqual([
      'learning.training.item.completed.v1',
      'learning.training.budget.completed.v1',
    ])
  })
})
