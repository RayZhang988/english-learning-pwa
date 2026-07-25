import { describe, expect, it } from 'vitest'
import { createVocabularyCatalog } from './content.ts'
import { VocabularyError } from './errors.ts'
import { buildVocabularyQuestions } from './questions.ts'
import {
  advanceVocabularySession,
  createVocabularySession,
  getVocabularyAnswerFeedback,
  getVocabularySessionResult,
  pauseVocabularySession,
  resumeVocabularySession,
  selectVocabularyOption,
  submitVocabularyAnswer,
} from './session.ts'
import {
  loadActualVocabularyDocuments,
  vocabularyTaskFor,
} from './test-fixtures.ts'

describe('vocabulary session state machine', () => {
  it('locks a submitted answer, exposes feedback, and advances', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const unit = catalog.units[0]
    const questions = buildVocabularyQuestions(unit)
    let session = createVocabularySession(
      vocabularyTaskFor(unit),
      questions,
      '2026-07-24T00:00:00.000Z',
    )
    const first = questions[0]
    const wrongOption = first.options.find(
      (option) => option.id !== first.correctOptionId,
    )
    expect(wrongOption).toBeDefined()

    session = selectVocabularyOption(
      session,
      wrongOption!.id,
      '2026-07-24T00:00:02.000Z',
    )
    session = submitVocabularyAnswer(
      session,
      '2026-07-24T00:00:04.000Z',
    )

    expect(session.phase).toBe('feedback')
    expect(getVocabularyAnswerFeedback(session)).toMatchObject({
      correct: false,
    })
    expect(() =>
      selectVocabularyOption(
        session,
        first.correctOptionId,
        '2026-07-24T00:00:05.000Z',
      ),
    ).toThrowError(VocabularyError)

    session = advanceVocabularySession(
      session,
      '2026-07-24T00:00:06.000Z',
    )
    expect(session.phase).toBe('answering')
    expect(session.questionIndex).toBe(1)
    expect(session.selectedOptionId).toBeNull()
  })

  it('completes exactly once and aggregates standardized error tags', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const unit = catalog.units[0]
    const questions = buildVocabularyQuestions(unit)
    let session = createVocabularySession(
      vocabularyTaskFor(unit),
      questions,
      '2026-07-24T00:00:00.000Z',
    )

    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index]
      const selectedOptionId =
        index === 0
          ? question.options.find(
              (option) => option.id !== question.correctOptionId,
            )!.id
          : question.correctOptionId
      session = selectVocabularyOption(
        session,
        selectedOptionId,
        `2026-07-24T00:00:${String(index * 2 + 1).padStart(2, '0')}.000Z`,
      )
      session = submitVocabularyAnswer(
        session,
        `2026-07-24T00:00:${String(index * 2 + 2).padStart(2, '0')}.000Z`,
      )
      session = advanceVocabularySession(
        session,
        `2026-07-24T00:00:${String(index * 2 + 3).padStart(2, '0')}.000Z`,
      )
    }

    expect(session.phase).toBe('completed')
    expect(getVocabularySessionResult(session)).toEqual({
      correctCount: questions.length - 1,
      questionCount: questions.length,
      performanceScore: (questions.length - 1) / questions.length,
      errorTags: ['meaning-recall'],
    })
    expect(() =>
      advanceVocabularySession(
        session,
        '2026-07-24T00:01:00.000Z',
      ),
    ).toThrowError(VocabularyError)
  })

  it('preserves the exact answer or feedback phase across pause and resume', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const unit = catalog.units[0]
    const questions = buildVocabularyQuestions(unit)
    let session = createVocabularySession(
      vocabularyTaskFor(unit),
      questions,
      '2026-07-24T00:00:00.000Z',
    )
    session = selectVocabularyOption(
      session,
      questions[0].correctOptionId,
      '2026-07-24T00:00:02.000Z',
    )
    session = pauseVocabularySession(
      session,
      '2026-07-24T00:00:05.000Z',
    )

    expect(session.phase).toBe('paused')
    expect(session.pausedFromPhase).toBe('answering')
    expect(session.activeDurationSeconds).toBe(5)

    session = resumeVocabularySession(
      session,
      '2026-07-24T01:00:00.000Z',
    )
    expect(session.phase).toBe('answering')
    expect(session.selectedOptionId).toBe(questions[0].correctOptionId)
    expect(session.activeDurationSeconds).toBe(5)
  })
})
