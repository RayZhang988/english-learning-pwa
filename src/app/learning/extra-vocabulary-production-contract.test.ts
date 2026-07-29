import { describe, expect, it } from 'vitest'
import * as vocabularyFeature from '../../features/vocabulary/index.ts'
import {
  ExtraVocabularyTrainingRepository,
  ExtraVocabularyTrainingRuntime,
} from '../../features/vocabulary/index.ts'
import type {
  ExtraTrainingSession,
  ExtraTrainingSupplyRequest,
} from '../../learning-engine/index.ts'
import { MemoryNamespaceStore } from './extra-training-test-fixtures.ts'

const session: ExtraTrainingSession = {
  schemaVersion: 1,
  sessionId: 'extra-vocabulary-production',
  localDate: '2026-07-29',
  domain: 'vocabulary',
  targetModuleId: 'vocabulary',
  mode: 'learn',
  targetDifficulty: 1,
  targetEffectiveSeconds: 900,
  remainingEffectiveSeconds: 900,
  status: 'running',
  nextSupplyCursor: null,
  excludeItemIds: [],
  priorityItemIds: {
    'recent-error': [],
    'due-review': [],
    'same-day-variant': [],
    'new-optional-content': [],
  },
  completedItemCount: 0,
  startedAt: '2026-07-29T09:00:00.000Z',
  updatedAt: '2026-07-29T09:00:00.000Z',
  endedAt: null,
  endReason: null,
}

const item = {
  itemId: 'supply-vocabulary-1',
  learningUnitId: 'unit-1',
  contentRef: 'lesson://unit-1',
  difficultyLevel: 1,
  tags: [],
  source: {
    sourceType: 'vocabulary-item' as const,
    sourceId: 'word',
    variantId: 'term-to-meaning-choice' as const,
    distractorItemIds: [],
  },
}

const question = {
  id: 'question',
  type: 'term-to-meaning' as const,
  instructionZh: '选择',
  prompt: 'word',
  promptLocale: 'en-US' as const,
  partOfSpeech: null,
  options: [
    { id: 'right', label: '对' },
    { id: 'wrong', label: '错' },
  ],
  correctOptionId: 'right',
  exampleEn: null,
  explanationZh: null,
  errorTag: 'meaning-recall' as const,
}

function supplyRequest(
  current: ExtraTrainingSession,
): ExtraTrainingSupplyRequest {
  return {
    schemaVersion: 1,
    requestId:
      `${current.sessionId}:supply:${current.completedItemCount + 1}`,
    sessionId: current.sessionId,
    localDate: current.localDate,
    domain: current.domain,
    targetModuleId: current.targetModuleId,
    mode: 'learn',
    targetDifficulty: current.targetDifficulty,
    cursor: current.nextSupplyCursor,
    excludeItemIds: current.excludeItemIds,
    priority: [
      'recent-error',
      'due-review',
      'same-day-variant',
      'new-optional-content',
    ],
    priorityItemIds: current.priorityItemIds!,
    reason:
      current.completedItemCount === 0
        ? 'initial'
        : 'continue-after-item',
  }
}

describe('06 extra-vocabulary public production contract', () => {
  it('exports the delivered runtime and repository through the feature barrel used by 01', () => {
    expect(vocabularyFeature).toHaveProperty(
      'ExtraVocabularyTrainingRuntime',
    )
    expect(vocabularyFeature).toHaveProperty(
      'ExtraVocabularyTrainingRepository',
    )
  })

  it('advances from ordinary feedback to the next supplied item before the 900-second budget ends', async () => {
    const runtime = new ExtraVocabularyTrainingRuntime({
      session,
      repository: new ExtraVocabularyTrainingRepository(
        new MemoryNamespaceStore('extra-vocabulary'),
      ),
      supplyRequest,
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
      questionForItem: async () => question,
      timingSessionFactory: {
        async create() {
          return {
            async start() {},
            async transition() {},
            async activity() {},
            async pause() {},
            async resume() {},
            async finish() {},
            async dispose() {},
          }
        },
      },
      eventSink: {
        async publishExtraTrainingEvent() {},
      },
      now: () => '2026-07-29T09:01:00.000Z',
      createId: () => 'stable-event',
    })

    await runtime.initialize()
    await runtime.next()
    await runtime.select('right')
    await runtime.submit()
    const next = await runtime.advanceAfterFeedback()
    await runtime.flush()

    expect(next.phase).toBe('answering')
    expect(next.session.completedItemCount).toBe(1)
    expect(next.question).not.toBeNull()
  })
})
