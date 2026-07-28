import { describe, expect, it } from 'vitest'
import { SpeakingRuntimeMountLifecycle } from './route-lifecycle.ts'

describe('speaking route timing lifecycle', () => {
  it('survives a StrictMode cleanup/setup probe without disposal', () => {
    const scheduled: (() => void)[] = []
    let disposals = 0
    const lifecycle = new SpeakingRuntimeMountLifecycle({
      schedule: (callback) => scheduled.push(callback),
    })
    const runtime = {
      async dispose() {
        disposals += 1
      },
    }

    const releaseFirst = lifecycle.retain(runtime)
    releaseFirst()
    const releaseSecond = lifecycle.retain(runtime)
    scheduled.shift()?.()
    expect(disposals).toBe(0)

    releaseSecond()
    scheduled.shift()?.()
    expect(disposals).toBe(1)
  })

  it('reports asynchronous disposal failures without throwing in cleanup', async () => {
    const scheduled: (() => void)[] = []
    const errors: unknown[] = []
    const lifecycle = new SpeakingRuntimeMountLifecycle({
      schedule: (callback) => scheduled.push(callback),
      onDisposeError: (error) => errors.push(error),
    })
    const runtime = {
      async dispose() {
        throw new Error('timing dispose failed')
      },
    }

    lifecycle.retain(runtime)()
    scheduled.shift()?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(errors).toHaveLength(1)
  })
})
