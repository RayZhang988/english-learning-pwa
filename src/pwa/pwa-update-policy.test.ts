import { describe, expect, it, vi } from 'vitest'
import { pwaUpdatePolicy } from '../../vite.config.ts'
import { PwaUpdateReloadGuard } from './pwa-update-reload-guard.ts'

describe('PWA update policy', () => {
  it('activates a waiting worker, claims clients, and cleans obsolete caches', () => {
    expect(pwaUpdatePolicy).toEqual({
      registerType: 'autoUpdate',
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true,
    })
  })
})

describe('PwaUpdateReloadGuard', () => {
  it('does not reload when the first worker takes control on a fresh install', () => {
    const reload = vi.fn()
    const guard = new PwaUpdateReloadGuard(null)
    const firstController = {}

    expect(guard.onControllerChange(firstController, reload)).toBe(false)
    expect(guard.onControllerChange(firstController, reload)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads once when an existing controller is replaced', () => {
    const reload = vi.fn()
    const oldController = {}
    const newController = {}
    const guard = new PwaUpdateReloadGuard(oldController)

    expect(guard.onControllerChange(newController, reload)).toBe(true)
    expect(guard.onControllerChange(newController, reload)).toBe(false)
    expect(guard.requestReload(newController, reload)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload twice when activation is reported before control changes', () => {
    const reload = vi.fn()
    const oldController = {}
    const newController = {}
    const guard = new PwaUpdateReloadGuard(oldController)

    expect(guard.requestReload(oldController, reload)).toBe(true)
    expect(guard.onControllerChange(newController, reload)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
