import { describe, expect, it } from 'vitest'
import {
  VocabularyRuntimeMountLifecycle,
  type VocabularyRuntimeDisposalPort,
} from './route-lifecycle.ts'

class RecordingRuntime implements VocabularyRuntimeDisposalPort {
  disposeCount = 0

  async dispose(): Promise<void> {
    this.disposeCount += 1
  }
}

describe('vocabulary route timing lifecycle', () => {
  it('does not dispose during the StrictMode cleanup/setup probe', async () => {
    const scheduled: Array<() => void> = []
    const lifecycle = new VocabularyRuntimeMountLifecycle({
      schedule(callback) {
        scheduled.push(callback)
      },
    })
    const runtime = new RecordingRuntime()

    const firstRelease = lifecycle.retain(runtime)
    firstRelease()
    const secondRelease = lifecycle.retain(runtime)
    scheduled.shift()!()
    await Promise.resolve()

    expect(runtime.disposeCount).toBe(0)

    secondRelease()
    scheduled.shift()!()
    await Promise.resolve()

    expect(runtime.disposeCount).toBe(1)
  })

  it('disposes different task runtimes independently', async () => {
    const scheduled: Array<() => void> = []
    const lifecycle = new VocabularyRuntimeMountLifecycle({
      schedule(callback) {
        scheduled.push(callback)
      },
    })
    const previousTask = new RecordingRuntime()
    const nextTask = new RecordingRuntime()

    lifecycle.retain(previousTask)()
    const releaseNext = lifecycle.retain(nextTask)
    scheduled.shift()!()
    await Promise.resolve()

    expect(previousTask.disposeCount).toBe(1)
    expect(nextTask.disposeCount).toBe(0)

    releaseNext()
    scheduled.shift()!()
    await Promise.resolve()
    expect(nextTask.disposeCount).toBe(1)
  })
})
