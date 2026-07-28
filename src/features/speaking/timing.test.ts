import { describe, expect, it } from 'vitest'
import {
  SpeakingEffectiveTiming,
  type SpeakingEffectiveTimingSessionFactoryPort,
  type SpeakingEffectiveTimingSessionPort,
  type SpeakingTimingPhaseDeclaration,
} from './timing.ts'

function label(declaration: SpeakingTimingPhaseDeclaration): string {
  return `${declaration.phase}/${declaration.reason}`
}

class RecordingTimingSession
  implements SpeakingEffectiveTimingSessionPort
{
  readonly calls: string[] = []
  failDisposeOnce = false

  async start(
    declaration: SpeakingTimingPhaseDeclaration,
  ): Promise<void> {
    this.calls.push(`start:${label(declaration)}`)
  }

  async transition(
    declaration: SpeakingTimingPhaseDeclaration,
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
    declaration: SpeakingTimingPhaseDeclaration,
  ): Promise<void> {
    this.calls.push(`resume:${label(declaration)}`)
  }

  async finish(): Promise<void> {
    this.calls.push('finish')
  }

  async dispose(): Promise<void> {
    this.calls.push('dispose')
    if (this.failDisposeOnce) {
      this.failDisposeOnce = false
      throw new Error('dispose failed')
    }
  }
}

class RecordingTimingFactory
  implements SpeakingEffectiveTimingSessionFactoryPort
{
  readonly calls: string[] = []
  readonly sessions: RecordingTimingSession[] = []

  async create(
    taskId: string,
    expectedModuleId: 'speaking',
  ): Promise<RecordingTimingSession> {
    this.calls.push(`${taskId}:${expectedModuleId}`)
    const session = new RecordingTimingSession()
    this.sessions.push(session)
    return session
  }
}

describe('speaking effective timing port', () => {
  it('maps permission, actual media, network, feedback and finish phases', async () => {
    const factory = new RecordingTimingFactory()
    const timing = new SpeakingEffectiveTiming(
      'plan-1:task:speaking',
      factory,
    )

    await timing.startLoading()
    await timing.synchronize('practicing')
    await timing.beginPermissionWait()
    await timing.beginRecordingWait()
    await timing.recordingStarted()
    await timing.recordingPaused()
    await timing.recordingResumed()
    await timing.recordingStopped()
    await timing.beginRecognitionWait()
    await timing.beginPersistenceWait('practicing', false)
    await timing.endPersistenceWait('feedback', true)
    await timing.beginPlaybackWait()
    await timing.playbackStarted()
    await timing.playbackWaiting()
    await timing.playbackStarted()
    await timing.playbackPaused()
    await timing.playbackStarted()
    await timing.playbackEnded()
    await timing.beginPersistenceWait('feedback', true)
    await timing.endPersistenceWait('feedback', true)
    await timing.finish()

    expect(factory.calls).toEqual([
      'plan-1:task:speaking:speaking',
    ])
    expect(factory.sessions[0].calls).toEqual([
      'start:loading/content-loading',
      'transition:answering/active-answering',
      'resume:answering/active-answering',
      'activity',
      'transition:permission-wait/permission-wait',
      'transition:loading/media-loading',
      'resume:recording/active-recording',
      'pause',
      'resume:recording/active-recording',
      'transition:loading/media-loading',
      'transition:network-wait/network-wait',
      'transition:loading/content-loading',
      'resume:feedback/active-feedback',
      'resume:feedback/active-feedback',
      'activity',
      'transition:loading/media-loading',
      'resume:playback/active-playback',
      'transition:loading/media-loading',
      'resume:playback/active-playback',
      'pause',
      'resume:playback/active-playback',
      'transition:loading/media-loading',
      'resume:feedback/active-feedback',
      'activity',
      'transition:loading/content-loading',
      'resume:feedback/active-feedback',
      'finish',
    ])
  })

  it('keeps storage excluded and restores only proven active media', async () => {
    const factory = new RecordingTimingFactory()
    const timing = new SpeakingEffectiveTiming(
      'task-speaking',
      factory,
    )

    await timing.startLoading()
    await timing.beginRecordingWait()
    await timing.recordingStarted()
    await timing.beginPersistenceWait('practicing', false)
    await timing.beginPersistenceWait('practicing', false)
    await timing.endPersistenceWait('practicing', true)
    expect(factory.sessions[0].calls.at(-1)).toBe(
      'transition:loading/content-loading',
    )
    await timing.endPersistenceWait('practicing', true)

    expect(factory.sessions[0].calls.at(-1)).toBe(
      'resume:recording/active-recording',
    )
  })

  it('releases unfinished sessions, retries disposal, and creates a fresh session', async () => {
    const factory = new RecordingTimingFactory()
    const timing = new SpeakingEffectiveTiming(
      'task-speaking',
      factory,
    )

    await timing.startLoading()
    factory.sessions[0].failDisposeOnce = true
    await expect(timing.dispose()).rejects.toThrow('dispose failed')
    await timing.dispose()
    await timing.startLoading()

    expect(factory.sessions).toHaveLength(3)
    expect(factory.sessions[0].calls.at(-1)).toBe('dispose')
    expect(factory.sessions[1].calls).toEqual(['dispose'])
    expect(factory.sessions[2].calls).toEqual([
      'start:loading/content-loading',
    ])
  })

  it('keeps legacy callers operational without a timing factory', async () => {
    const timing = new SpeakingEffectiveTiming('legacy-speaking')

    await timing.startLoading()
    await timing.synchronize('practicing')
    await timing.beginPermissionWait()
    await timing.beginRecordingWait()
    await timing.recordingStarted()
    await timing.recordingPaused()
    await timing.recordingResumed()
    await timing.recordingStopped()
    await timing.beginRecognitionWait()
    await timing.beginPlaybackWait()
    await timing.playbackStarted()
    await timing.playbackWaiting()
    await timing.playbackPaused()
    await timing.playbackEnded()
    await timing.beginPersistenceWait('feedback', true)
    await timing.endPersistenceWait('feedback', true)
    await timing.pause()
    await timing.finish()
    await timing.dispose()

    expect(timing.enabled).toBe(false)
  })
})
