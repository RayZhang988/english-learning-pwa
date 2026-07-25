import { describe, expect, it } from 'vitest'
import {
  createListeningSession,
  selectListeningOption,
  submitListeningAnswer,
  updateListeningPlayback,
} from './session.ts'
import {
  createListeningTask,
  createListeningUnit,
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
})
