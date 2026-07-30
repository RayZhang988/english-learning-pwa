import { describe, expect, it } from 'vitest'
import {
  createExtraTrainingSession,
  LearningEngineRepository,
  parseExtraTrainingEvent,
  type ExtraTrainingEvent,
} from '../../learning-engine/index.ts'
import { ProductionExtraTrainingEventSink } from './production-extra-training-event-sink.ts'
import {
  completedExtraTrainingPlan,
  extraTrainingEngineState,
  MemoryNamespaceStore,
} from './extra-training-test-fixtures.ts'

function event(
  type: ExtraTrainingEvent['type'],
  overrides: Record<string, unknown> = {},
): ExtraTrainingEvent {
  return parseExtraTrainingEvent({
    id: `event:${type}:${String(overrides.id ?? '1')}`,
    type,
    sourceModuleId: 'vocabulary',
    schemaVersion: 1,
    occurredAt: '2026-07-29T09:01:00.000Z',
    payload: {
      sessionId: 'extra-session',
      localDate: '2026-07-29',
      domain: 'vocabulary',
      targetModuleId: 'vocabulary',
      mode: 'learn',
      ...overrides,
    },
  })
}

async function setup() {
  const store = new MemoryNamespaceStore('engine')
  const repository = new LearningEngineRepository(store)
  const engine = extraTrainingEngineState()
  const extraTraining = createExtraTrainingSession(
    undefined,
    completedExtraTrainingPlan(),
    {
      sessionId: 'extra-session',
      localDate: '2026-07-29',
      domain: 'vocabulary',
      targetModuleId: 'vocabulary',
      targetDifficulty: 1,
      priorityItemIds: {
        'recent-error': [],
        'due-review': [],
        'same-day-variant': [],
        'new-optional-content': [],
      },
      startedAt: '2026-07-29T09:00:00.000Z',
    },
  )
  await repository.save({ ...engine, extraTraining })
  return {
    store,
    repository,
    sink: new ProductionExtraTrainingEventSink(repository),
  }
}

describe('ProductionExtraTrainingEventSink', () => {
  it('serially applies timing and scored evidence without any daily plan identity', async () => {
    const { repository, sink } = await setup()
    const timing = event(
      'learning.extra-training.timing.segment.recorded.v1',
      {
        phase: 'answering',
        reason: 'active-answering',
        visibility: 'foreground',
        startedAt: '2026-07-29T09:00:00.000Z',
        endedAt: '2026-07-29T09:00:30.000Z',
        elapsedSeconds: 30,
        idleThresholdSeconds: 45,
      },
    )
    const attempt = event(
      'learning.extra-training.attempt.completed.v1',
      {
        id: 'attempt',
        learningUnitId: 'unit-vocabulary',
        contentRef: 'lesson://course/1/day-1/vocabulary',
        difficultyLevel: 1,
        estimatedSeconds: 120,
        result: 'scored',
        performanceScore: 0,
        evidenceQuality: 1,
        assistanceLevel: 0,
        durationSeconds: 0,
        errorTags: ['meaning-recall'],
        contentTags: ['day:1'],
        failureCategory: null,
        scoreDelta: {
          schemaVersion: 1,
          correctCount: 0,
          incorrectCount: 1,
          unscorableCount: 0,
        },
      },
    )

    await Promise.all([
      sink.publishExtraTrainingEvent(timing),
      sink.publishExtraTrainingEvent(attempt),
    ])
    await sink.publishExtraTrainingEvent(attempt)

    const saved = await repository.load()
    expect(
      saved?.extraTraining?.sessions['extra-session']
        .effectiveSeconds,
    ).toBe(30)
    expect(saved?.progress.attempts).toHaveLength(1)
    expect(
      saved?.extraTraining?.sessions['extra-session'].score,
    ).toEqual({
      schemaVersion: 1,
      correctCount: 0,
      incorrectCount: 1,
      unscorableCount: 0,
    })
    expect(saved?.progress.attempts[0]).toMatchObject({
      planId: 'extra-training:2026-07-29',
      taskId: 'extra-session',
    })
    expect(
      saved?.extraTraining?.processedEventIds,
    ).toEqual(
      expect.arrayContaining([timing.id, attempt.id]),
    )
    expect(
      JSON.stringify(saved),
    ).not.toContain('"planId":"daily:')
  })

  it('keeps the event pending on save failure and accepts the same stable id on retry once', async () => {
    const { store, repository, sink } = await setup()
    const exited = event(
      'learning.extra-training.exited.v1',
    )
    store.failNextPut = true

    await expect(
      sink.publishExtraTrainingEvent(exited),
    ).rejects.toThrow('simulated storage failure')
    expect(
      (await repository.load())?.extraTraining?.sessions[
        'extra-session'
      ].status,
    ).toBe('running')

    await sink.publishExtraTrainingEvent(exited)
    await sink.publishExtraTrainingEvent(exited)
    const saved = await repository.load()
    expect(
      saved?.extraTraining?.sessions['extra-session'],
    ).toMatchObject({
      status: 'paused',
      endReason: 'user-exited',
    })
    expect(
      saved?.extraTraining?.processedEventIds.filter(
        (id) => id === exited.id,
      ),
    ).toHaveLength(1)
  })

  it('rejects a session identity mismatch before saving', async () => {
    const { repository, sink } = await setup()
    const wrong = parseExtraTrainingEvent({
      ...event('learning.extra-training.started.v1'),
      id: 'wrong-module',
      sourceModuleId: 'listening',
      payload: {
        sessionId: 'extra-session',
        localDate: '2026-07-29',
        domain: 'listening',
        targetModuleId: 'listening',
        mode: 'learn',
      },
    })

    await expect(
      sink.publishExtraTrainingEvent(wrong),
    ).rejects.toThrow('identity')
    expect(
      (await repository.load())?.extraTraining
        ?.processedEventIds,
    ).toEqual([])
  })
})
