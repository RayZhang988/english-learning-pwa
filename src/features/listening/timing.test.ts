import { describe, expect, it } from 'vitest'
import {
  ListeningEffectiveTiming,
  type ListeningEffectiveTimingSessionFactoryPort,
  type ListeningEffectiveTimingSessionPort,
  type ListeningTimingPhaseDeclaration,
} from './timing.ts'

function label(declaration: ListeningTimingPhaseDeclaration): string {
  return `${declaration.phase}/${declaration.reason}`
}

class RecordingTimingSession
  implements ListeningEffectiveTimingSessionPort
{
  readonly calls: string[] = []

  async start(
    declaration: ListeningTimingPhaseDeclaration,
  ): Promise<void> {
    this.calls.push(`start:${label(declaration)}`)
  }

  async transition(
    declaration: ListeningTimingPhaseDeclaration,
  ): Promise<void> {
    this.calls.push(`transition:${label(declaration)}`)
  }

  async activity(): Promise<void> {
    this.calls.push('activity')
  }

  async pause(): Promise<void> {
    this.calls.push('pause')
  }

  async resume(
    declaration: ListeningTimingPhaseDeclaration,
  ): Promise<void> {
    this.calls.push(`resume:${label(declaration)}`)
  }

  async finish(): Promise<void> {
    this.calls.push('finish')
  }

  async dispose(): Promise<void> {
    this.calls.push('dispose')
  }
}

class RecordingTimingFactory
  implements ListeningEffectiveTimingSessionFactoryPort
{
  readonly calls: string[] = []
  readonly sessions: RecordingTimingSession[] = []

  async create(
    taskId: string,
    expectedModuleId: 'listening',
  ): Promise<RecordingTimingSession> {
    this.calls.push(`${taskId}:${expectedModuleId}`)
    const session = new RecordingTimingSession()
    this.sessions.push(session)
    return session
  }
}

describe('listening effective timing port', () => {
  it('maps actual speech callbacks and durable business phases', async () => {
    const factory = new RecordingTimingFactory()
    const timing = new ListeningEffectiveTiming(
      'plan-1:task:listening',
      factory,
    )

    await timing.startLoading()
    await timing.beginMediaWait()
    await timing.mediaStarted()
    await timing.mediaPaused()
    await timing.mediaStarted()
    await timing.mediaEnded('answering')
    await timing.beginPersistenceWait('answering', true)
    await timing.endPersistenceWait('feedback', true)
    await timing.pause()
    await timing.finish()

    expect(factory.calls).toEqual([
      'plan-1:task:listening:listening',
    ])
    expect(factory.sessions[0].calls).toEqual([
      'start:loading/content-loading',
      'transition:loading/media-loading',
      'resume:audio-listening/active-audio-listening',
      'pause',
      'resume:audio-listening/active-audio-listening',
      'resume:answering/active-answering',
      'resume:answering/active-answering',
      'activity',
      'transition:loading/content-loading',
      'resume:feedback/active-feedback',
      'pause',
      'finish',
    ])
  })

  it('keeps overlapping draft writes excluded until the newest write settles', async () => {
    const factory = new RecordingTimingFactory()
    const timing = new ListeningEffectiveTiming(
      'task-listening',
      factory,
    )

    await timing.startLoading()
    await timing.beginPersistenceWait('answering', true)
    await timing.beginPersistenceWait('answering', true)
    await timing.endPersistenceWait('answering', true)
    expect(factory.sessions[0].calls.at(-1)).toBe(
      'transition:loading/content-loading',
    )
    await timing.endPersistenceWait('answering', true)

    expect(factory.sessions[0].calls.at(-1)).toBe(
      'resume:answering/active-answering',
    )
  })

  it('does not reopen audio while a persistence wait is active', async () => {
    const factory = new RecordingTimingFactory()
    const timing = new ListeningEffectiveTiming(
      'task-listening',
      factory,
    )

    await timing.startLoading()
    await timing.beginPersistenceWait('answering', true)
    await timing.mediaStarted()
    expect(factory.sessions[0].calls.at(-1)).toBe(
      'transition:loading/content-loading',
    )
    await timing.endPersistenceWait('answering', true)

    expect(factory.sessions[0].calls.at(-1)).toBe(
      'resume:audio-listening/active-audio-listening',
    )
  })

  it('releases an unfinished session and requests a fresh 01 session later', async () => {
    const factory = new RecordingTimingFactory()
    const timing = new ListeningEffectiveTiming(
      'task-listening',
      factory,
    )

    await timing.startLoading()
    await timing.dispose()
    await timing.startLoading()

    expect(factory.sessions).toHaveLength(2)
    expect(factory.sessions[0].calls.at(-1)).toBe('dispose')
    expect(factory.sessions[1].calls).toEqual([
      'start:loading/content-loading',
    ])
  })

  it('keeps legacy callers operational without a timing factory', async () => {
    const timing = new ListeningEffectiveTiming('legacy-listening')

    await timing.startLoading()
    await timing.beginMediaWait()
    await timing.mediaStarted()
    await timing.mediaPaused()
    await timing.mediaEnded('answering')
    await timing.beginPersistenceWait('answering', true)
    await timing.endPersistenceWait('feedback', true)
    await timing.pause()
    await timing.finish()
    await timing.dispose()

    expect(timing.enabled).toBe(false)
  })
})
