import { describe, expect, it } from 'vitest'
import type {
  PlatformEvent,
  PlatformEventSink,
} from '../../src/core/index.ts'
import {
  AssessmentProfileRepository,
  placementBankV1,
  type SpeechObservation,
} from '../../src/features/assessment/index.ts'
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
  type SpeakingRecordingPort,
} from '../../src/features/speaking/index.ts'
import {
  getCurrentVocabularyQuestion,
  VocabularySessionRepository,
  VocabularyTrainingRuntime,
} from '../../src/features/vocabulary/index.ts'
import {
  calculateContentBaselineSeconds,
  LEARNING_ENGINE_STORAGE_NAMESPACE,
  LearningEngineRepository,
  type LearningTask,
} from '../../src/learning-engine/index.ts'
import type {
  MicrophonePermissionService,
  NetworkStatusService,
} from '../../src/platform/index.ts'
import {
  ActivePlanRepository,
  LEARNING_RUNTIME_STORAGE_NAMESPACE,
} from '../../src/app/learning/active-plan-repository.ts'
import {
  projectLearningCandidates,
  type LearningCandidateSource,
} from '../../src/app/learning/course-candidate-source.ts'
import { LearningAppCoordinator } from '../../src/app/learning/learning-app-coordinator.ts'
import { createProductionTrainingSupplyProviders } from '../../src/app/learning/training-supply-providers.ts'
import { AssessmentAppCoordinator } from '../../src/app/assessment/assessment-app-coordinator.ts'
import { AssessmentRuntimeSnapshotRepository } from '../../src/app/assessment/assessment-runtime-snapshot-repository.ts'
import {
  MemoryNamespaceStore,
  releasedCatalogs,
  releasedCourseDocuments,
  sequenceIds,
  sequenceNow,
} from './fixtures/production-course.ts'

const reliableSpeechObservation: SpeechObservation = {
  status: 'scored',
  transcript: 'A complete and understandable response',
  metrics: {
    completeness: 0.9,
    intelligibility: 0.9,
    fluency: 0.85,
    languageControl: 0.85,
    taskCompletion: 0.9,
    recognitionConfidence: 0.9,
  },
}

const releasedCourseCandidates: LearningCandidateSource = {
  async load(completedLearningUnitIds, availableModuleIds) {
    return projectLearningCandidates(
      {
        packageIndex: releasedCourseDocuments.packageIndex,
        lessonsByPath: releasedCourseDocuments.lessonsByPath,
      },
      completedLearningUnitIds,
      availableModuleIds,
    )
  },
}

class ImmediateSpeech implements ListeningSpeechPort {
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
  ): void {
    callbacks.onStart?.()
    callbacks.onEnd?.()
  }

  pause(): void {}
  resume(): void {}
  cancel(): void {}
  isPaused(): boolean {
    return false
  }
  isSpeaking(): boolean {
    return false
  }
}

class MemoryRecorder implements SpeakingRecordingPort {
  played = 0

  capabilities() {
    return {
      supported: true,
      supportedMimeTypes: ['audio/mp4'],
    }
  }

  start(_stream: MediaStream): void {}

  async stop(): Promise<SpeakingRecording> {
    return {
      id: 'qa-recording',
      blob: new Blob(['voice'], { type: 'audio/mp4' }),
      mimeType: 'audio/mp4',
      durationMs: 2_000,
    }
  }

  cancel(): void {}

  async play(_recording: SpeakingRecording): Promise<void> {
    this.played += 1
  }

  stopPlayback(): void {}
  discard(_recording: SpeakingRecording): void {}
  dispose(): void {}
}

const online: NetworkStatusService = {
  current: () => 'online',
  subscribe: () => () => undefined,
}

const grantedMicrophone: MicrophonePermissionService = {
  query: async () => 'granted',
  request: async () =>
    ({
      getTracks: () => [{ stop() {} }],
    }) as unknown as MediaStream,
}

function activeTimingEvent(
  task: LearningTask,
  localDate: string,
  id: string,
  startedAt: string,
  elapsedSeconds: number,
): PlatformEvent {
  const endedAt = new Date(
    Date.parse(startedAt) + elapsedSeconds * 1_000,
  ).toISOString()
  const phase =
    task.targetModuleId === 'vocabulary'
      ? 'answering'
      : task.targetModuleId === 'listening'
        ? 'audio-listening'
        : 'recording'
  const reason =
    task.targetModuleId === 'vocabulary'
      ? 'active-answering'
      : task.targetModuleId === 'listening'
        ? 'active-audio-listening'
        : 'active-recording'
  return {
    id,
    type: 'learning.timing.segment.recorded.v1',
    sourceModuleId: task.targetModuleId,
    occurredAt: endedAt,
    schemaVersion: 1,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate,
      mode: task.mode,
      phase,
      reason,
      visibility: 'foreground',
      startedAt,
      endedAt,
      elapsedSeconds,
      idleThresholdSeconds: 45,
    },
  }
}

describe('09 first-use production acceptance', () => {
  it('executes assessment → real profile → first plan → three real modules → persisted refresh', async () => {
    const assessmentStore = new MemoryNamespaceStore(
      'feature.assessment',
    )
    const planStore = new MemoryNamespaceStore(
      LEARNING_RUNTIME_STORAGE_NAMESPACE,
    )
    const engineStore = new MemoryNamespaceStore(
      LEARNING_ENGINE_STORAGE_NAMESPACE,
    )
    const profiles = new AssessmentProfileRepository(assessmentStore)
    const plans = new ActivePlanRepository(planStore)
    const engines = new LearningEngineRepository(engineStore)
    const createLearningCoordinator = () =>
      new LearningAppCoordinator({
        profiles,
        activePlans: plans,
        engineStates: engines,
        candidates: releasedCourseCandidates,
        availableModuleIds: new Set([
          'vocabulary',
          'listening',
          'speaking',
        ]),
        now: () => new Date('2026-07-25T08:00:00.000+08:00'),
        createId: () => 'qa-first-day',
      })
    const learning = createLearningCoordinator()
    let assessmentTime = Date.parse('2026-07-25T00:00:00.000Z')
    const assessment = new AssessmentAppCoordinator({
      snapshots: new AssessmentRuntimeSnapshotRepository(
        assessmentStore,
      ),
      profiles,
      dailyPlans: learning,
      now: () => new Date(assessmentTime).toISOString(),
      createId: () => 'qa-first-use-assessment',
    })

    expect((await learning.initialize()).status).toBe(
      'assessment-required',
    )
    await assessment.initialize()
    let assessmentState = await assessment.start()

    for (let step = 0; step < 40; step += 1) {
      if (
        assessmentState.status !== 'ready' ||
        assessmentState.runtime.lifecycle === 'completed'
      ) {
        break
      }
      const item = assessmentState.runtime.item
      if (
        assessmentState.runtime.lifecycle !== 'active' ||
        !item
      ) {
        throw new Error(
          `Unexpected assessment lifecycle: ${assessmentState.runtime.lifecycle}`,
        )
      }
      assessmentTime += item.expectedSeconds * 1_000
      if (item.kind === 'choice') {
        const privateItem = placementBankV1.items.find(
          (candidate) => candidate.id === item.id,
        )
        if (!privateItem || privateItem.kind !== 'choice') {
          throw new Error(`Missing scoring item ${item.id}`)
        }
        await assessment.selectChoice(
          item.id,
          privateItem.scoring.correctOptionId,
        )
        assessmentState = await assessment.submitChoice(item.id)
      } else {
        assessmentState = await assessment.submitSpeech(
          item.id,
          reliableSpeechObservation,
        )
      }
      if (
        assessmentState.status === 'ready' &&
        assessmentState.runtime.lifecycle === 'feedback'
      ) {
        assessmentState = await assessment.continue()
      }
    }

    expect(assessmentState.status).toBe('ready')
    if (assessmentState.status !== 'ready') {
      throw new Error('Assessment did not finish in ready state.')
    }
    expect(assessmentState.runtime.lifecycle).toBe('completed')
    const profile = assessmentState.runtime.profile
    expect(profile).not.toBeNull()
    if (!profile) {
      throw new Error('Real AbilityProfile was not produced.')
    }
    expect(profile.durationSeconds).toBeGreaterThanOrEqual(15 * 60)
    expect(profile.durationSeconds).toBeLessThanOrEqual(20 * 60)
    expect(
      Object.values(profile.abilities).map((ability) => ability.domain),
    ).toEqual(['vocabulary', 'listening', 'speaking'])
    expect(
      Object.values(profile.abilities).every(
        (ability) => ability.internalLevel !== null,
      ),
    ).toBe(true)
    expect(await profiles.loadLatest()).toEqual(profile)

    expect(learning.state.status).toBe('ready')
    if (learning.state.status !== 'ready') {
      throw new Error('First-day plan was not generated.')
    }
    const originalPlan = learning.state.runtime.activePlan.plan
    expect(originalPlan.targetSeconds).toBe(2_700)
    expect(originalPlan.plannedSeconds).toBe(
      originalPlan.tasks.reduce(
        (total, task) => total + task.estimatedSeconds,
        0,
      ),
    )
    const baselineCandidates = await releasedCourseCandidates.load(
      new Set(),
      new Set(['vocabulary', 'listening', 'speaking']),
    )
    const expectedSeconds = Object.fromEntries(
      originalPlan.tasks.map((task) => {
        const unit = baselineCandidates.find(
          (candidate) => candidate.learningUnitId === task.learningUnitId,
        )
        expect(unit).toBeDefined()
        return [
          task.targetModuleId,
          calculateContentBaselineSeconds(unit!.durationBaseline!),
        ]
      }),
    )
    expect(
      Object.fromEntries(
        originalPlan.tasks.map((task) => [
          task.targetModuleId,
          task.durationEstimate?.estimateSeconds,
        ]),
      ),
    ).toEqual(expectedSeconds)
    expect(
      originalPlan.tasks.every(
        (task) =>
          task.durationEstimate?.baselineSource ===
            'structured-content' &&
          task.estimatedSeconds ===
            task.durationEstimate.estimateSeconds &&
          task.estimatedSeconds !== 900,
      ),
    ).toBe(true)
    expect(
      new Set(originalPlan.tasks.map((task) => task.targetModuleId)),
    ).toEqual(new Set(['vocabulary', 'listening', 'speaking']))
    expect(
      originalPlan.tasks.every(
        (task) =>
          learning.routeForTask(task.taskId) ===
          `/${task.targetModuleId}?taskId=${encodeURIComponent(task.taskId)}`,
      ),
    ).toBe(true)
    expect(() => learning.routeForTask('qa-forged-task')).toThrow(
      /taskId/,
    )

    const catalogs = releasedCatalogs()
    const supplyProviders = createProductionTrainingSupplyProviders({
      vocabulary: { load: async () => catalogs.vocabulary },
      listening: { load: async () => catalogs.listening },
      speaking: { load: async () => catalogs.speaking },
    })
    const publishedEvents: PlatformEvent[] = []
    const recordingProductionSink: PlatformEventSink = {
      publish: async (event) => {
        publishedEvents.push(event)
        await learning.eventSink.publish(event)
      },
    }
    const publishEffectiveSeconds = async (
      task: LearningTask,
      idPrefix: string,
      startedAt: string,
      totalSeconds: number,
    ) => {
      let remaining = totalSeconds
      let offsetSeconds = 0
      let segment = 0
      while (remaining > 0) {
        const elapsedSeconds = Math.min(45, remaining)
        await recordingProductionSink.publish(
          activeTimingEvent(
            task,
            originalPlan.localDate,
            `${idPrefix}-${++segment}`,
            new Date(
              Date.parse(startedAt) + offsetSeconds * 1_000,
            ).toISOString(),
            elapsedSeconds,
          ),
        )
        remaining -= elapsedSeconds
        offsetSeconds += elapsedSeconds
      }
    }
    const vocabularyTask = originalPlan.tasks.find(
      (task) => task.targetModuleId === 'vocabulary',
    )
    const listeningTask = originalPlan.tasks.find(
      (task) => task.targetModuleId === 'listening',
    )
    const speakingTask = originalPlan.tasks.find(
      (task) => task.targetModuleId === 'speaking',
    )
    if (!vocabularyTask || !listeningTask || !speakingTask) {
      throw new Error('First-day plan lacks one or more training modules.')
    }
    const executionFor = (task: LearningTask) => {
      if (learning.state.status !== 'ready') {
        throw new Error('Learning state was lost during budget training.')
      }
      const execution =
        learning.state.runtime.activePlan.tasks.find(
          (candidate) =>
            candidate.task.taskId === task.taskId,
        )
      if (!execution) {
        throw new Error(`Missing task execution ${task.taskId}.`)
      }
      return execution
    }
    for (const task of originalPlan.tasks) {
      expect(task.trainingBudget).toEqual({
        schemaVersion: 1,
        targetEffectiveSeconds: 900,
      })
      expect(executionFor(task).training).toMatchObject({
        status: 'running',
        remainingEffectiveSeconds: 900,
        completedItemIds: [],
        nextSupplyCursor: null,
      })
    }

    const vocabulary = new VocabularyTrainingRuntime({
      task: learning.resolveTask(vocabularyTask.taskId, 'vocabulary'),
      localDate: originalPlan.localDate,
      contentSource: { load: async () => catalogs.vocabulary },
      eventSink: recordingProductionSink,
      repository: new VocabularySessionRepository(
        new MemoryNamespaceStore('feature.vocabulary'),
      ),
      networkStatus: online,
      now: sequenceNow(),
      createId: sequenceIds('qa-vocabulary'),
      supplyProvider: supplyProviders.vocabulary,
      trainingBudgetStatus: () =>
        learning.trainingBudgetStatus(
          vocabularyTask.taskId,
          'vocabulary',
        ),
    })
    let vocabularySession = await vocabulary.initialize()
    const firstVocabularyItem =
      vocabularySession.stream?.activeItem?.itemId
    let vocabularyQuestion = getCurrentVocabularyQuestion(
      vocabularySession,
    )
    if (!firstVocabularyItem || !vocabularyQuestion) {
      throw new Error('Vocabulary stream did not load its first real item.')
    }
    await publishEffectiveSeconds(
      vocabularyTask,
      'qa-vocabulary-timing-initial',
      '2026-07-25T00:59:59.000Z',
      1,
    )
    await vocabulary.select(vocabularyQuestion.correctOptionId)
    await vocabulary.submit()
    vocabularySession = await vocabulary.advance()
    expect(vocabularySession.phase).toBe('answering')
    expect(vocabularySession.stream?.completedItemIds).toEqual([
      firstVocabularyItem,
    ])
    expect(vocabularySession.stream?.activeItem?.itemId).not.toBe(
      firstVocabularyItem,
    )
    expect(executionFor(vocabularyTask)).toMatchObject({
      status: 'active',
      effectiveSeconds: 1,
      training: {
        status: 'running',
        remainingEffectiveSeconds: 899,
        completedItemIds: [firstVocabularyItem],
      },
    })
    await publishEffectiveSeconds(
      vocabularyTask,
      'qa-vocabulary-timing-899',
      '2026-07-25T01:00:00.000Z',
      898,
    )
    expect(executionFor(vocabularyTask).training).toMatchObject({
      status: 'running',
      remainingEffectiveSeconds: 1,
    })
    await publishEffectiveSeconds(
      vocabularyTask,
      'qa-vocabulary-timing-900',
      '2026-07-25T01:14:59.000Z',
      1,
    )
    expect(executionFor(vocabularyTask)).toMatchObject({
      status: 'active',
      training: {
        status: 'finish-current-item',
        remainingEffectiveSeconds: 0,
      },
    })
    vocabularyQuestion = getCurrentVocabularyQuestion(
      vocabularySession,
    )
    if (!vocabularyQuestion) {
      throw new Error('Vocabulary stream lost its finish-current item.')
    }
    await vocabulary.select(vocabularyQuestion.correctOptionId)
    await vocabulary.submit()
    vocabularySession = await vocabulary.advance()
    expect(vocabularySession.phase).toBe('completed')
    expect(executionFor(vocabularyTask)).toMatchObject({
      status: 'completed',
      effectiveSeconds: 900,
      training: {
        status: 'completed',
        remainingEffectiveSeconds: 0,
      },
    })

    const listening = new ListeningTrainingRuntime({
      task: learning.resolveTask(listeningTask.taskId, 'listening'),
      localDate: originalPlan.localDate,
      contentSource: { load: async () => catalogs.listening },
      eventSink: recordingProductionSink,
      repository: new ListeningSessionRepository(
        new MemoryNamespaceStore('feature.listening'),
      ),
      networkStatus: online,
      speech: new ImmediateSpeech(),
      now: sequenceNow(),
      createId: sequenceIds('qa-listening'),
      supplyProvider: supplyProviders.listening,
      trainingBudgetStatus: () =>
        learning.trainingBudgetStatus(
          listeningTask.taskId,
          'listening',
        ),
    })
    let listeningSession = await listening.initialize()
    const answerListeningItem = async () => {
      await listening.togglePlayback()
      const question = getCurrentListeningQuestion(listeningSession)
      if (!question) {
        throw new Error('Listening session lost its real question.')
      }
      if (question.type === 'keyword-dictation') {
        await listening.changeDictation(question.standardAnswer)
      } else {
        await listening.select(question.correctOptionId)
      }
      await listening.submit()
      listeningSession = await listening.advance()
    }
    const firstListeningItem =
      listeningSession.stream?.activeItem?.itemId
    if (!firstListeningItem) {
      throw new Error('Listening stream did not load its first real item.')
    }
    await publishEffectiveSeconds(
      listeningTask,
      'qa-listening-timing-initial',
      '2026-07-25T01:59:59.000Z',
      1,
    )
    await answerListeningItem()
    expect(listeningSession.phase).toBe('answering')
    expect(listeningSession.stream?.completedItemIds).toEqual([
      firstListeningItem,
    ])
    expect(listeningSession.stream?.activeItem?.itemId).not.toBe(
      firstListeningItem,
    )
    expect(executionFor(listeningTask)).toMatchObject({
      status: 'active',
      effectiveSeconds: 1,
      training: {
        status: 'running',
        remainingEffectiveSeconds: 899,
        completedItemIds: [firstListeningItem],
      },
    })
    await publishEffectiveSeconds(
      listeningTask,
      'qa-listening-timing-899',
      '2026-07-25T02:00:00.000Z',
      898,
    )
    expect(executionFor(listeningTask).training).toMatchObject({
      status: 'running',
      remainingEffectiveSeconds: 1,
    })
    await publishEffectiveSeconds(
      listeningTask,
      'qa-listening-timing-900',
      '2026-07-25T02:14:59.000Z',
      1,
    )
    expect(executionFor(listeningTask)).toMatchObject({
      status: 'active',
      training: {
        status: 'finish-current-item',
        remainingEffectiveSeconds: 0,
      },
    })
    await answerListeningItem()
    expect(listeningSession.phase).toBe('completed')
    expect(executionFor(listeningTask)).toMatchObject({
      status: 'completed',
      effectiveSeconds: 900,
      training: {
        status: 'completed',
        remainingEffectiveSeconds: 0,
      },
    })

    const recorder = new MemoryRecorder()
    let speaking: SpeakingTrainingRuntime
    const recognition: SpeakingRecognitionPort = {
      capabilities: () => ({ supported: true, requiresSiri: true }),
      start: () => {
        const current = speaking.currentSession
        const prompt =
          current?.unit?.prompts[current.promptIndex]
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
    speaking = new SpeakingTrainingRuntime({
      task: learning.resolveTask(speakingTask.taskId, 'speaking'),
      localDate: originalPlan.localDate,
      contentSource: { load: async () => catalogs.speaking },
      eventSink: recordingProductionSink,
      repository: new SpeakingSessionRepository(
        new MemoryNamespaceStore('feature.speaking'),
      ),
      networkStatus: online,
      microphonePermission: grantedMicrophone,
      recorder,
      recognition,
      now: sequenceNow(),
      createId: sequenceIds('qa-speaking'),
      supplyProvider: supplyProviders.speaking,
      trainingBudgetStatus: () =>
        learning.trainingBudgetStatus(
          speakingTask.taskId,
          'speaking',
        ),
    })
    let speakingSession = await speaking.initialize()
    const completeSpeakingItem = async () => {
      await speaking.startRecording()
      speakingSession = await speaking.stopRecording()
      expect(speakingSession.recorder.playbackAvailable).toBe(true)
      await speaking.playRecording()
      speakingSession = await speaking.advance()
    }
    const firstSpeakingItem =
      speakingSession.stream?.activeItem?.itemId
    if (!firstSpeakingItem) {
      throw new Error(
        `Speaking stream did not load its first real item: ${JSON.stringify({
          phase: speakingSession.phase,
          failure: speakingSession.failure,
          stream: speakingSession.stream,
          task: {
            mode: speakingTask.mode,
            difficultyLevel: speakingTask.difficultyLevel,
          },
        })}`,
      )
    }
    await publishEffectiveSeconds(
      speakingTask,
      'qa-speaking-timing-initial',
      '2026-07-25T02:59:59.000Z',
      1,
    )
    await completeSpeakingItem()
    expect(speakingSession.phase).toBe('practicing')
    expect(speakingSession.stream?.completedItemIds).toEqual([
      firstSpeakingItem,
    ])
    expect(speakingSession.stream?.activeItem?.itemId).not.toBe(
      firstSpeakingItem,
    )
    expect(executionFor(speakingTask)).toMatchObject({
      status: 'active',
      effectiveSeconds: 1,
      training: {
        status: 'running',
        remainingEffectiveSeconds: 899,
        completedItemIds: [firstSpeakingItem],
      },
    })
    await publishEffectiveSeconds(
      speakingTask,
      'qa-speaking-timing-899',
      '2026-07-25T03:00:00.000Z',
      898,
    )
    expect(executionFor(speakingTask).training).toMatchObject({
      status: 'running',
      remainingEffectiveSeconds: 1,
    })
    await publishEffectiveSeconds(
      speakingTask,
      'qa-speaking-timing-900',
      '2026-07-25T03:14:59.000Z',
      1,
    )
    expect(executionFor(speakingTask)).toMatchObject({
      status: 'active',
      training: {
        status: 'finish-current-item',
        remainingEffectiveSeconds: 0,
      },
    })
    await completeSpeakingItem()
    expect(speakingSession.phase).toBe('completed')
    expect(executionFor(speakingTask)).toMatchObject({
      status: 'completed',
      effectiveSeconds: 900,
      training: {
        status: 'completed',
        remainingEffectiveSeconds: 0,
      },
    })
    expect(recorder.played).toBeGreaterThan(0)

    expect(learning.state.status).toBe('ready')
    if (learning.state.status !== 'ready') {
      throw new Error('Learning state was lost after module completion.')
    }
    expect(learning.state.runtime.activePlan.status).toBe('completed')
    expect(
      learning.state.runtime.activePlan.tasks.map((task) => task.status),
    ).toEqual(['completed', 'completed', 'completed'])

    const replay = publishedEvents.find(
      (event) => event.type === 'learning.attempt.completed.v1',
    )
    if (!replay) {
      throw new Error('No production completion event was captured.')
    }
    const attemptsBeforeReplay = (await engines.load())?.progress.attempts
      .length
    const processedBeforeReplay = (await plans.load())?.processedEventIds
      .length
    await learning.eventSink.publish(replay)
    expect((await engines.load())?.progress.attempts.length).toBe(
      attemptsBeforeReplay,
    )
    expect((await plans.load())?.processedEventIds.length).toBe(
      processedBeforeReplay,
    )

    const refreshed = createLearningCoordinator()
    const refreshedState = await refreshed.initialize()
    expect(refreshedState.status).toBe('ready')
    if (refreshedState.status === 'ready') {
      expect(refreshedState.runtime.activePlan.plan.planId).toBe(
        originalPlan.planId,
      )
      expect(
        refreshedState.runtime.activePlan.tasks.map(
          (task) => task.status,
        ),
      ).toEqual(['completed', 'completed', 'completed'])
      expect(refreshedState.runtime.processedEventIds.length).toBeGreaterThan(
        3,
      )
    }
  })
})
