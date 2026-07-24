import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserStorageHealthService } from './BrowserStorageHealthService.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BrowserStorageHealthService', () => {
  it('reports quota and best-effort persistence', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        estimate: vi.fn().mockResolvedValue({
          usage: 250,
          quota: 1000,
        }),
      },
    })

    const service = new BrowserStorageHealthService()

    await expect(service.inspect()).resolves.toEqual({
      persistence: 'best-effort',
      usageBytes: 250,
      quotaBytes: 1000,
      availableBytes: 750,
      usageRatio: 0.25,
    })
  })

  it('requests persistence and then returns the current state', async () => {
    let persistent = false
    const persist = vi.fn().mockImplementation(async () => {
      persistent = true
      return true
    })
    vi.stubGlobal('navigator', {
      storage: {
        persist,
        persisted: vi.fn().mockImplementation(async () => persistent),
        estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 1000 }),
      },
    })

    const service = new BrowserStorageHealthService()
    const snapshot = await service.requestPersistence()

    expect(persist).toHaveBeenCalledOnce()
    expect(snapshot.persistence).toBe('persistent')
  })

  it('degrades safely when the Storage API is unavailable', async () => {
    vi.stubGlobal('navigator', {})

    const service = new BrowserStorageHealthService()

    await expect(service.inspect()).resolves.toEqual({
      persistence: 'unsupported',
    })
  })
})
