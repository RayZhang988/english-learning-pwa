import { describe, expect, it } from 'vitest'
import {
  changeListeningDictation,
  createListeningSession,
  selectListeningOption,
  submitListeningAnswer,
  updateListeningPlayback,
} from './session.ts'
import {
  createListeningTask,
  createListeningUnit,
  dictationQuestion,
} from './test-fixtures.ts'
import { toListeningScreenViewModel } from './view-model.ts'

describe('listening UI adapter', () => {
  it('maps playback policies and keeps transcript hidden before feedback', () => {
    const session = createListeningSession(
      createListeningTask(),
      createListeningUnit(),
      '2026-07-24T12:00:00.000Z',
    )
    const viewModel = toListeningScreenViewModel(session)
    expect(viewModel.question.kind).toBe('single-choice')
    expect(viewModel.playbackControls.rate.options).toEqual([
      { value: 0.75, label: '0.75×' },
      { value: 1, label: '1×' },
    ])
    expect(viewModel.playbackControls.segment.disabled).toBe(true)
    expect(viewModel.transcript).toBeUndefined()
    expect(viewModel.action.disabled).toBe(true)
  })

  it('reveals content explanations only after a scored answer', () => {
    let session = createListeningSession(
      createListeningTask(),
      createListeningUnit(),
      '2026-07-24T12:00:00.000Z',
    )
    session = updateListeningPlayback(
      session,
      {
        ...session.playback,
        status: 'ended',
        playCounts: { 'seg-word': 1 },
      },
      '2026-07-24T12:00:01.000Z',
    )
    session = selectListeningOption(
      session,
      'b',
      '2026-07-24T12:00:02.000Z',
    )
    session = submitListeningAnswer(
      session,
      '2026-07-24T12:00:03.000Z',
    )
    const viewModel = toListeningScreenViewModel(session)
    expect(viewModel.feedback?.tone).toBe('correction')
    expect(viewModel.transcript).toHaveLength(1)
    expect(viewModel.rationaleZh).toBe('音频读的是 Maya。')
  })

  it('states dictation count, order and format before answering, then shows the complete comparison', () => {
    const question = {
      ...dictationQuestion,
      promptZh: '写出预订人数和预订姓氏。',
      targetKeywords: ['three', 'Wu'],
      standardAnswer: 'three under Wu',
      acceptedAnswers: [
        'three under Wu',
        'a table for three under Wu',
      ],
    }
    let session = createListeningSession(
      createListeningTask(),
      createListeningUnit([question]),
      '2026-07-24T12:00:00.000Z',
    )
    const answering = toListeningScreenViewModel(session)
    expect(answering.question).toMatchObject({
      kind: 'keyword-dictation',
      requirements: {
        countLabel: '需要填写 2 项关键信息。',
        orderLabel: '必须按照音频中出现的顺序填写。',
      },
      review: undefined,
    })

    session = updateListeningPlayback(
      session,
      {
        ...session.playback,
        status: 'ended',
        playCounts: { 'seg-sentence': 1 },
      },
      '2026-07-24T12:00:01.000Z',
    )
    session = changeListeningDictation(
      session,
      'three Wu',
      '2026-07-24T12:00:02.000Z',
    )
    session = submitListeningAnswer(
      session,
      '2026-07-24T12:00:03.000Z',
    )

    expect(toListeningScreenViewModel(session).question).toMatchObject({
      kind: 'keyword-dictation',
      review: {
        response: 'three Wu',
        standardAnswer: 'three under Wu',
        targetKeywords: ['three', 'Wu'],
        resultLabel: '回答正确',
      },
    })
  })
})
