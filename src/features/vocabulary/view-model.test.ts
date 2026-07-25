import { describe, expect, it } from 'vitest'
import { createVocabularyCatalog } from './content.ts'
import { buildVocabularyQuestions } from './questions.ts'
import {
  createVocabularySession,
  pauseVocabularySession,
  selectVocabularyOption,
  submitVocabularyAnswer,
} from './session.ts'
import {
  loadActualVocabularyDocuments,
  vocabularyTaskFor,
} from './test-fixtures.ts'
import { toVocabularyScreenViewModel } from './view-model.ts'

describe('vocabulary UI adapter', () => {
  it('derives every choice visual state from the session state machine', async () => {
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
    const question = questions[0]
    const wrongOption = question.options.find(
      (option) => option.id !== question.correctOptionId,
    )!

    session = selectVocabularyOption(
      session,
      wrongOption.id,
      '2026-07-24T00:00:01.000Z',
    )
    expect(
      toVocabularyScreenViewModel(session).choices.find(
        (choice) => choice.id === wrongOption.id,
      )?.state,
    ).toBe('selected')

    session = submitVocabularyAnswer(
      session,
      '2026-07-24T00:00:02.000Z',
    )
    const feedbackViewModel = toVocabularyScreenViewModel(session)
    expect(
      feedbackViewModel.choices.find(
        (choice) => choice.id === wrongOption.id,
      )?.state,
    ).toBe('incorrect')
    expect(
      feedbackViewModel.choices.find(
        (choice) => choice.id === question.correctOptionId,
      )?.state,
    ).toBe('correct')
    expect(feedbackViewModel.feedback?.tone).toBe('correction')
    expect(feedbackViewModel.exampleEn).toBe(question.exampleEn)
  })

  it('disables choices while a recovered session is paused', async () => {
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
    session = pauseVocabularySession(
      session,
      '2026-07-24T00:00:02.000Z',
    )

    const viewModel = toVocabularyScreenViewModel(session)
    expect(viewModel.choices.every((choice) => choice.state === 'disabled')).toBe(
      true,
    )
    expect(viewModel.action.label).toBe('继续训练')
  })
})
