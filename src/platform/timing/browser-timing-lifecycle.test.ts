import { describe, expect, it } from 'vitest'
import {
  BrowserTimingLifecycle,
  type TimingLifecycleEvent,
} from '../index.ts'

class FakeEventTarget {
  visibilityState = 'visible'
  readonly listeners = new Map<string, Set<EventListener>>()

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new Event(type))
    }
  }
}

describe('BrowserTimingLifecycle', () => {
  it('combines visibility, page lifecycle, activity, and cleanup', () => {
    const documentTarget = new FakeEventTarget()
    const pageTarget = new FakeEventTarget()
    const optionalTarget = new FakeEventTarget()
    const lifecycle = new BrowserTimingLifecycle({
      visibilityTarget: documentTarget,
      pageTarget,
      optionalLifecycleTarget: optionalTarget,
    })
    const events: TimingLifecycleEvent[] = []
    const unsubscribe = lifecycle.subscribe((event) =>
      events.push(event),
    )

    documentTarget.visibilityState = 'hidden'
    documentTarget.dispatch('visibilitychange')
    pageTarget.dispatch('pagehide')
    documentTarget.visibilityState = 'visible'
    pageTarget.dispatch('pageshow')
    optionalTarget.dispatch('freeze')
    optionalTarget.dispatch('resume')
    documentTarget.dispatch('pointerdown')
    documentTarget.dispatch('keydown')
    documentTarget.dispatch('input')
    documentTarget.dispatch('touchstart')

    expect(events).toEqual([
      { type: 'background', source: 'visibilitychange' },
      { type: 'background', source: 'pagehide' },
      { type: 'foreground', source: 'pageshow' },
      { type: 'background', source: 'freeze' },
      { type: 'foreground', source: 'resume' },
      { type: 'activity', source: 'pointer' },
      { type: 'activity', source: 'keyboard' },
      { type: 'activity', source: 'input' },
      { type: 'activity', source: 'touch' },
    ])

    unsubscribe()
    expect(
      [...documentTarget.listeners.values()].every(
        (listeners) => listeners.size === 0,
      ),
    ).toBe(true)
    expect(
      [...pageTarget.listeners.values()].every(
        (listeners) => listeners.size === 0,
      ),
    ).toBe(true)
  })

  it('degrades to visibility and pagehide/pageshow when freeze/resume are unavailable', () => {
    const documentTarget = new FakeEventTarget()
    const pageTarget = new FakeEventTarget()
    const lifecycle = new BrowserTimingLifecycle({
      visibilityTarget: documentTarget,
      pageTarget,
      optionalLifecycleTarget: null,
    })
    const events: TimingLifecycleEvent[] = []
    const unsubscribe = lifecycle.subscribe((event) =>
      events.push(event),
    )

    expect(documentTarget.listeners.has('freeze')).toBe(false)
    pageTarget.dispatch('pagehide')
    pageTarget.dispatch('pageshow')
    expect(events).toEqual([
      { type: 'background', source: 'pagehide' },
      { type: 'foreground', source: 'pageshow' },
    ])
    unsubscribe()
  })
})
