import { describe, expect, it } from 'vitest'
import {
  advanceListeningSession,
  canSubmitListeningAnswer,
  changeListeningDictation,
  createListeningSession,
  getListeningSessionResult,
  selectListeningOption,
  submitListeningAnswer,
  updateListeningPlayback,
} from './session.ts'
import {
  createListeningTask,
  createListeningUnit,
} from './test-fixtures.ts'

const startedAt = '2026-07-24T12:00:00.000Z'

function markPrimaryPlayed(
  session: ReturnType<typeof createListeningSession>,
  now = '2026-07-24T12:00:01.000Z',
) {
  return updateListeningPlayback(
    session,
    {
      ...session.playback,
      status: 'ended',
      playCounts: {
        ...session.playback.playCounts,
        [session.playback.currentSegmentId]: 1,
      },
    },
    now,
  )
}

describe('listening session state machine', () => {
  it('requires audible evidence and an answer before submission', () => {
    let session = createListeningSession(
      createListeningTask(),
      createListeningUnit(),
      startedAt,
    )
    session = selectListeningOption(
      session,
      'a',
      '2026-07-24T12:00:01.000Z',
    )
    expect(canSubmitListeningAnswer(session)).toBe(false)
    session = markPrimaryPlayed(session)
    expect(canSubmitListeningAnswer(session)).toBe(true)
  })

  it('judges choice and dictation questions without mixing input types', () => {
    let session = createListeningSession(
      createListeningTask(),
      createListeningUnit(),
      startedAt,
    )
    session = markPrimaryPlayed(session)
    session = selectListeningOption(
      session,
      'a',
      '2026-07-24T12:00:02.000Z',
    )
    session = submitListeningAnswer(
      session,
      '2026-07-24T12:00:03.000Z',
    )
    session = advanceListeningSession(
      session,
      '2026-07-24T12:00:04.000Z',
    )
    expect(session.questionIndex).toBe(1)
    expect(() =>
      selectListeningOption(
        session,
        'a',
        '2026-07-24T12:00:05.000Z',
      ),
    ).toThrow(/choice/i)

    session = markPrimaryPlayed(
      session,
      '2026-07-24T12:00:05.000Z',
    )
    session = changeListeningDictation(
      session,
      ' boston. ',
      '2026-07-24T12:00:06.000Z',
    )
    session = submitListeningAnswer(
      session,
      '2026-07-24T12:00:07.000Z',
    )
    session = advanceListeningSession(
      session,
      '2026-07-24T12:00:08.000Z',
    )

    expect(session.phase).toBe('completed')
    expect(getListeningSessionResult(session)).toMatchObject({
      correctCount: 2,
      questionCount: 2,
      performanceScore: 1,
      errorTags: [],
    })
  })

  it('reports standardized listening error tags and assistance', () => {
    let session = createListeningSession(
      createListeningTask(),
      createListeningUnit(),
      startedAt,
    )
    session = updateListeningPlayback(
      session,
      {
        ...session.playback,
        status: 'ended',
        rate: 0.75,
        repeatMode: 'segment',
        playCounts: { 'seg-word': 3 },
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
    const result = getListeningSessionResult(session)
    expect(result.performanceScore).toBe(0)
    expect(result.errorTags).toEqual(['sound-discrimination'])
    expect(result.assistanceLevel).toBeCloseTo(0.6)
  })
})
