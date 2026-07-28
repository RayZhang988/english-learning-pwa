import { describe, expect, it, vi } from 'vitest'
import {
  ListeningRuntimeMountLifecycle,
  type ListeningRuntimeDisposalPort,
} from './route-lifecycle.ts'

class RecordingRuntime implements ListeningRuntimeDisposalPort {
  readonly dispose = vi.fn(async () => undefined)
}

describe('listening route timing lifecycle', () => {
  it('survives a StrictMode cleanup/setup probe', async () => {
    const scheduled: Array<() => void> = []
    const lifecycle = new ListeningRuntimeMountLifecycle({
      schedule: (callback) => scheduled.push(callback),
    })
    const runtime = new RecordingRuntime()

    const releaseProbe = lifecycle.retain(runtime)
    releaseProbe()
    const releaseMounted = lifecycle.retain(runtime)
    scheduled.shift()?.()
    await Promise.resolve()
    expect(runtime.dispose).not.toHaveBeenCalled()

    releaseMounted()
    scheduled.shift()?.()
    await Promise.resolve()
    expect(runtime.dispose).toHaveBeenCalledOnce()
  })

  it('reports asynchronous disposal failures without leaking a rejection', async () => {
    const scheduled: Array<() => void> = []
    const onDisposeError = vi.fn()
    const runtime: ListeningRuntimeDisposalPort = {
      async dispose() {
        throw new Error('timing dispose failed')
      },
    }
    const lifecycle = new ListeningRuntimeMountLifecycle({
      schedule: (callback) => scheduled.push(callback),
      onDisposeError,
    })

    lifecycle.retain(runtime)()
    scheduled.shift()?.()
    await vi.waitFor(() => {
      expect(onDisposeError).toHaveBeenCalledOnce()
    })
  })
})
