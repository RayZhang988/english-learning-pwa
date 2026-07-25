import { describe, expect, it } from 'vitest'
import { parseLearningEvent } from '../../learning-engine/index.ts'
import { createVocabularyCatalog } from './content.ts'
import {
  createVocabularyTaskPausedEvent,
  createVocabularyTaskSkippedEvent,
  createVocabularyTaskStartedEvent,
  createVocabularyUnscorableEvent,
} from './events.ts'
import {
  loadActualVocabularyDocuments,
  vocabularyTaskFor,
} from './test-fixtures.ts'

describe('vocabulary learning events', () => {
  it('creates all non-completion events accepted by the learning engine', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const task = vocabularyTaskFor(catalog.units[0])
    const identity = {
      eventId: 'event-vocabulary-1',
      occurredAt: '2026-07-24T00:00:00.000Z',
      localDate: '2026-07-24',
    }
    const events = [
      createVocabularyTaskStartedEvent(task, identity),
      createVocabularyTaskPausedEvent(
        task,
        'user-paused',
        12,
        { ...identity, eventId: 'event-vocabulary-2' },
      ),
      createVocabularyTaskSkippedEvent(
        task,
        'user-skipped',
        { ...identity, eventId: 'event-vocabulary-3' },
      ),
      createVocabularyUnscorableEvent(
        task,
        'network',
        4,
        { ...identity, eventId: 'event-vocabulary-4' },
      ),
    ]

    for (const event of events) {
      expect(parseLearningEvent(event)).toBe(event)
      expect(event.sourceModuleId).toBe('vocabulary')
      expect(event.payload.targetModuleId).toBe('vocabulary')
    }
    expect(events[3]).toMatchObject({
      type: 'learning.attempt.completed.v1',
      payload: {
        result: 'unscorable',
        performanceScore: null,
        taskCompleted: false,
        failureCategory: 'network',
      },
    })
  })
})
