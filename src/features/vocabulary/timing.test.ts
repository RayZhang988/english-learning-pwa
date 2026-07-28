import { describe, expect, it } from 'vitest'
import {
  VocabularyEffectiveTiming,
  type VocabularyEffectiveTimingSessionFactoryPort,
  type VocabularyEffectiveTimingSessionPort,
  type VocabularyTimingPhaseDeclaration,
} from './timing.ts'

function declarationLabel(
  declaration: VocabularyTimingPhaseDeclaration,
): string {
  return `${declaration.phase}/${declaration.reason}`
}

class RecordingTimingSession
  implements VocabularyEffectiveTimingSessionPort
{
  readonly calls: string[] = []

  async start(
    declaration: VocabularyTimingPhaseDeclaration,
  ): Promise<void> {
    this.calls.push(`start:${declarationLabel(declaration)}`)
  }

  async transition(
    declaration: VocabularyTimingPhaseDeclaration,
  ): Promise<void> {
    this.calls.push(`transition:${declarationLabel(declaration)}`)
  }

  async activity(): Promise<void> {
    this.calls.push('activity')
  }

  async pause(): Promise<void> {
    this.calls.push('pause')
  }

  async resume(
    declaration: VocabularyTimingPhaseDeclaration,
  ): Promise<void> {
    this.calls.push(`resume:${declarationLabel(declaration)}`)
  }

  async finish(): Promise<void> {
    this.calls.push('finish')
  }

  async dispose(): Promise<void> {
    this.calls.push('dispose')
  }
}

class RecordingTimingFactory
  implements VocabularyEffectiveTimingSessionFactoryPort
{
  readonly calls: string[] = []
  readonly sessions: RecordingTimingSession[] = []

  async create(
    taskId: string,
    expectedModuleId: 'vocabulary',
  ): Promise<RecordingTimingSession> {
    this.calls.push(`${taskId}:${expectedModuleId}`)
    const session = new RecordingTimingSession()
    this.sessions.push(session)
    return session
  }
}

describe('vocabulary effective timing port', () => {
  it('maps real vocabulary phases without owning browser timing', async () => {
    const factory = new RecordingTimingFactory()
    const timing = new VocabularyEffectiveTiming(
      'plan-1:task:vocabulary',
      factory,
    )

    await timing.startLoading()
    await timing.synchronize('answering')
    await timing.beginPersistenceWait(true)
    await timing.synchronize('feedback')
    await timing.pause()
    await timing.beginPersistenceWait(true)
    await timing.synchronize('answering', true)
    await timing.finish()

    expect(factory.calls).toEqual([
      'plan-1:task:vocabulary:vocabulary',
    ])
    expect(factory.sessions[0].calls).toEqual([
      'start:loading/content-loading',
      'transition:answering/active-answering',
      'activity',
      'transition:loading/content-loading',
      'transition:feedback/active-feedback',
      'pause',
      'activity',
      'transition:loading/content-loading',
      'resume:answering/active-answering',
      'finish',
    ])
  })

  it('releases a disposed session and asks the 01 factory for a fresh one', async () => {
    const factory = new RecordingTimingFactory()
    const timing = new VocabularyEffectiveTiming(
      'task-vocabulary',
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

  it('reopens the persisted 01 session when disposal must be retried', async () => {
    const first = new RecordingTimingSession()
    first.dispose = async () => {
      first.calls.push('dispose:failed')
      throw new Error('dispose failed')
    }
    const second = new RecordingTimingSession()
    const sessions = [first, second]
    let createCount = 0
    const factory: VocabularyEffectiveTimingSessionFactoryPort = {
      async create() {
        const session = sessions[createCount]
        createCount += 1
        return session
      },
    }
    const timing = new VocabularyEffectiveTiming(
      'task-vocabulary',
      factory,
    )

    await timing.startLoading()
    await expect(timing.dispose()).rejects.toThrow('dispose failed')
    await timing.dispose()

    expect(createCount).toBe(2)
    expect(first.calls.at(-1)).toBe('dispose:failed')
    expect(second.calls).toEqual(['dispose'])
  })

  it('keeps legacy callers operational when no timing factory is injected', async () => {
    const timing = new VocabularyEffectiveTiming('legacy-task')

    await timing.startLoading()
    await timing.beginPersistenceWait(true)
    await timing.synchronize('answering')
    await timing.pause()
    await timing.finish()
    await timing.dispose()

    expect(timing.enabled).toBe(false)
  })
})
