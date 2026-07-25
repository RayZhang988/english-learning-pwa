import { describe, expect, it } from 'vitest'
import { InMemoryPlatformEventSink } from '../../src/core/testing/index.ts'
import {
  ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
  createPlacementAssessmentRuntime,
} from '../../src/features/assessment/index.ts'
import {
  ListeningSessionRepository,
  ListeningTrainingRuntime,
  type ListeningSpeechPort,
} from '../../src/features/listening/index.ts'
import {
  SpeakingSessionRepository,
  SpeakingTrainingRuntime,
  toSpeakingScreenViewModel,
  type SpeakingRecognitionOutcome,
  type SpeakingRecognitionPort,
  type SpeakingRecording,
  type SpeakingRecordingPort,
} from '../../src/features/speaking/index.ts'
import {
  VocabularyError,
  VocabularySessionRepository,
  VocabularyTrainingRuntime,
} from '../../src/features/vocabulary/index.ts'
import type {
  MicrophonePermissionService,
  NetworkStatusService,
} from '../../src/platform/index.ts'
import { AssessmentRuntimeSnapshotRepository } from '../../src/app/assessment/assessment-runtime-snapshot-repository.ts'
import {
  MemoryNamespaceStore,
  productionTaskFor,
  releasedCatalogs,
  sequenceIds,
  sequenceNow,
} from './fixtures/production-course.ts'

const online: NetworkStatusService = {
  current: () => 'online',
  subscribe: () => () => undefined,
}

const offline: NetworkStatusService = {
  current: () => 'offline',
  subscribe: () => () => undefined,
}

class RecordingPort implements SpeakingRecordingPort {
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
      id: 'qa-fallback-recording',
      blob: new Blob(['voice'], { type: 'audio/mp4' }),
      mimeType: 'audio/mp4',
      durationMs: 1_500,
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

class FixedRecognition implements SpeakingRecognitionPort {
  constructor(
    private readonly outcome: SpeakingRecognitionOutcome,
  ) {}

  capabilities() {
    return { supported: true, requiresSiri: true }
  }

  start(_locale: 'en-US') {
    return {
      result: Promise.resolve(this.outcome),
      stop() {},
      abort() {},
    }
  }
}

const stream = {
  getTracks: () => [{ stop() {} }],
} as unknown as MediaStream

const granted: MicrophonePermissionService = {
  query: async () => 'granted',
  request: async () => stream,
}

const denied: MicrophonePermissionService = {
  query: async () => 'prompt',
  request: async () => {
    throw new DOMException('Denied', 'NotAllowedError')
  },
}

const unsupportedSpeech: ListeningSpeechPort = {
  capabilities: () => ({
    supported: false,
    voicesKnown: false,
    enUsVoiceAvailable: false,
    pauseResumeAvailable: false,
    supportedRates: [],
  }),
  speak: () => undefined,
  pause: () => undefined,
  resume: () => undefined,
  cancel: () => undefined,
  isPaused: () => false,
  isSpeaking: () => false,
}

describe('09 recovery and degradation acceptance', () => {
  it('rejects future and corrupt assessment snapshots without deleting evidence', async () => {
    const store = new MemoryNamespaceStore('feature.assessment')
    const repository = new AssessmentRuntimeSnapshotRepository(store)
    const valid = createPlacementAssessmentRuntime({
      now: () => '2026-07-25T01:00:00.000Z',
      createId: () => 'qa-snapshot',
    }).toSnapshot()

    await repository.save(valid)
    expect(await repository.load()).toEqual(valid)

    store.records.set(ASSESSMENT_RUNTIME_SNAPSHOT_KEY, {
      namespace: store.namespace,
      key: ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
      value: { schemaVersion: 1, lifecycle: 'active' },
      schemaVersion: 1,
      updatedAt: '2026-07-25T01:00:00.000Z',
    })
    await expect(repository.load()).rejects.toMatchObject({
      code: 'schema_incompatible',
    })
    expect(
      store.records.has(ASSESSMENT_RUNTIME_SNAPSHOT_KEY),
    ).toBe(true)

    store.records.set(ASSESSMENT_RUNTIME_SNAPSHOT_KEY, {
      namespace: store.namespace,
      key: ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
      value: {},
      schemaVersion: 2,
      updatedAt: '2026-07-25T01:00:00.000Z',
    })
    await expect(repository.load()).rejects.toMatchObject({
      code: 'schema_incompatible',
    })
    expect(
      store.records.get(ASSESSMENT_RUNTIME_SNAPSHOT_KEY)?.schemaVersion,
    ).toBe(2)
  })

  it('keeps a paused real vocabulary session and rejects corrupt recovery data', async () => {
    const store = new MemoryNamespaceStore('feature.vocabulary')
    const repository = new VocabularySessionRepository(store)
    const task = productionTaskFor('vocabulary')
    const runtime = new VocabularyTrainingRuntime({
      task,
      localDate: '2026-07-25',
      contentSource: {
        load: async () => releasedCatalogs().vocabulary,
      },
      eventSink: new InMemoryPlatformEventSink(),
      repository,
      networkStatus: online,
      now: sequenceNow(),
      createId: sequenceIds('qa-vocabulary-recovery'),
    })

    await runtime.initialize()
    const paused = await runtime.pause('user-paused')
    const restored = await repository.load(task)
    expect(restored).toEqual(paused)
    expect(restored?.phase).toBe('paused')

    const key = `session:${task.taskId}`
    store.records.set(key, {
      namespace: store.namespace,
      key,
      value: {
        schemaVersion: 1,
        task,
        phase: 'answering',
      },
      schemaVersion: 1,
      updatedAt: '2026-07-25T01:00:00.000Z',
    })
    await expect(repository.load(task)).rejects.toMatchObject({
      code: 'session-recovery-invalid',
    })
    expect(store.records.has(key)).toBe(true)
  })

  it('reports missing offline vocabulary content as unscorable network evidence', async () => {
    const sink = new InMemoryPlatformEventSink()
    const task = productionTaskFor('vocabulary')
    const runtime = new VocabularyTrainingRuntime({
      task,
      localDate: '2026-07-25',
      contentSource: {
        load: async () => {
          throw new VocabularyError(
            'content-unavailable',
            'QA simulates an uninstalled offline package.',
          )
        },
      },
      eventSink: sink,
      repository: new VocabularySessionRepository(
        new MemoryNamespaceStore('feature.vocabulary'),
      ),
      networkStatus: offline,
      now: sequenceNow(),
      createId: sequenceIds('qa-offline-vocabulary'),
    })

    const session = await runtime.initialize()
    expect(session.phase).toBe('error')
    expect(session.failure?.category).toBe('network')
    expect(sink.events.at(-1)?.payload).toMatchObject({
      result: 'unscorable',
      taskCompleted: false,
      failureCategory: 'network',
    })
  })

  it('reports unavailable listening synthesis as a device issue, never a wrong answer', async () => {
    const sink = new InMemoryPlatformEventSink()
    const task = productionTaskFor('listening')
    const runtime = new ListeningTrainingRuntime({
      task,
      localDate: '2026-07-25',
      contentSource: {
        load: async () => releasedCatalogs().listening,
      },
      eventSink: sink,
      repository: new ListeningSessionRepository(
        new MemoryNamespaceStore('feature.listening'),
      ),
      networkStatus: online,
      speech: unsupportedSpeech,
      now: sequenceNow(),
      createId: sequenceIds('qa-listening-device'),
    })

    const session = await runtime.initialize()
    expect(session.phase).toBe('error')
    expect(session.failure?.category).toBe('device')
    expect(sink.events.at(-1)?.payload).toMatchObject({
      result: 'unscorable',
      taskCompleted: false,
      failureCategory: 'device',
    })
  })

  it('preserves real recording playback when recognition fails and clears it after restore', async () => {
    const sink = new InMemoryPlatformEventSink()
    const task = productionTaskFor('speaking')
    const store = new MemoryNamespaceStore('feature.speaking')
    const repository = new SpeakingSessionRepository(store)
    const recorder = new RecordingPort()
    const runtime = new SpeakingTrainingRuntime({
      task,
      localDate: '2026-07-25',
      contentSource: {
        load: async () => releasedCatalogs().speaking,
      },
      eventSink: sink,
      repository,
      networkStatus: online,
      microphonePermission: granted,
      recorder,
      recognition: new FixedRecognition({
        status: 'failed',
        code: 'no-speech',
        message: 'No usable transcript.',
      }),
      now: sequenceNow(),
      createId: sequenceIds('qa-recognition-failure'),
    })

    await runtime.initialize()
    await runtime.startRecording()
    const reviewed = await runtime.stopRecording()
    expect(reviewed.recorder.playbackAvailable).toBe(true)
    expect(reviewed.answers[0]).toMatchObject({
      recorded: true,
      match: null,
      fallbackReason: 'recognition-no-speech',
      failureCategory: 'device',
    })
    expect(toSpeakingScreenViewModel(reviewed).feedback).toMatchObject({
      tone: 'device',
      title: '文本识别不可用，录音仍可回放',
    })
    await runtime.playRecording()
    expect(recorder.played).toBe(1)

    const restored = await repository.load(task)
    expect(restored?.recorder.playbackAvailable).toBe(false)
  })

  it('allows honest unscored continuation after microphone permission denial', async () => {
    const sink = new InMemoryPlatformEventSink()
    const task = productionTaskFor('speaking')
    const runtime = new SpeakingTrainingRuntime({
      task,
      localDate: '2026-07-25',
      contentSource: {
        load: async () => releasedCatalogs().speaking,
      },
      eventSink: sink,
      repository: new SpeakingSessionRepository(
        new MemoryNamespaceStore('feature.speaking'),
      ),
      networkStatus: online,
      microphonePermission: denied,
      recorder: new RecordingPort(),
      recognition: new FixedRecognition({
        status: 'failed',
        code: 'not-allowed',
        message: 'Recognition denied.',
      }),
      now: sequenceNow(),
      createId: sequenceIds('qa-permission-denied'),
    })

    let session = await runtime.initialize()
    while (session.phase !== 'completed') {
      const deniedSession = await runtime.startRecording()
      expect(deniedSession.permission).toBe('denied')
      expect(deniedSession.recorder.playbackAvailable).toBe(false)
      await runtime.continueWithoutRecording()
      session = await runtime.advance()
    }

    expect(sink.events.at(-1)?.payload).toMatchObject({
      result: 'unscorable',
      taskCompleted: false,
      failureCategory: 'permission',
    })
  })
})
