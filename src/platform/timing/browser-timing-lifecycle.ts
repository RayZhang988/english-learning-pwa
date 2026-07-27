import type {
  TimingLifecycleEvent,
  TimingLifecyclePort,
  TimingLifecycleVisibility,
} from './contracts.ts'

interface BrowserEventTarget {
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

interface BrowserVisibilityTarget extends BrowserEventTarget {
  readonly visibilityState?: string
}

export interface BrowserTimingLifecycleOptions {
  readonly visibilityTarget?: BrowserVisibilityTarget
  readonly pageTarget?: BrowserEventTarget
  /**
   * freeze/resume are optional Page Lifecycle events. Safari may omit them;
   * visibilitychange and pagehide/pageshow remain the required fallback.
   */
  readonly optionalLifecycleTarget?: BrowserEventTarget | null
}

function defaultVisibilityTarget(): BrowserVisibilityTarget | undefined {
  return typeof document === 'undefined'
    ? undefined
    : (document as unknown as BrowserVisibilityTarget)
}

function defaultPageTarget(): BrowserEventTarget | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as unknown as BrowserEventTarget)
}

export class BrowserTimingLifecycle implements TimingLifecyclePort {
  readonly #visibilityTarget: BrowserVisibilityTarget | undefined
  readonly #pageTarget: BrowserEventTarget | undefined
  readonly #optionalLifecycleTarget: BrowserEventTarget | undefined

  constructor(options: BrowserTimingLifecycleOptions = {}) {
    this.#visibilityTarget =
      options.visibilityTarget ?? defaultVisibilityTarget()
    this.#pageTarget = options.pageTarget ?? defaultPageTarget()
    this.#optionalLifecycleTarget =
      options.optionalLifecycleTarget === undefined
        ? this.#visibilityTarget
        : options.optionalLifecycleTarget ?? undefined
  }

  currentVisibility(): TimingLifecycleVisibility {
    return this.#visibilityTarget?.visibilityState === 'hidden'
      ? 'background'
      : 'foreground'
  }

  subscribe(
    listener: (event: TimingLifecycleEvent) => void,
  ): () => void {
    const removers: Array<() => void> = []
    const add = (
      target: BrowserEventTarget | undefined,
      type: string,
      handler: EventListener,
    ) => {
      if (!target) {
        return
      }
      target.addEventListener(type, handler)
      removers.push(() => target.removeEventListener(type, handler))
    }

    const onVisibilityChange: EventListener = () => {
      listener(
        this.currentVisibility() === 'background'
          ? {
              type: 'background',
              source: 'visibilitychange',
            }
          : {
              type: 'foreground',
              source: 'visibilitychange',
            },
      )
    }
    const onPageHide: EventListener = () => {
      listener({ type: 'background', source: 'pagehide' })
    }
    const onPageShow: EventListener = () => {
      if (this.currentVisibility() === 'foreground') {
        listener({ type: 'foreground', source: 'pageshow' })
      }
    }
    const onFreeze: EventListener = () => {
      listener({ type: 'background', source: 'freeze' })
    }
    const onResume: EventListener = () => {
      if (this.currentVisibility() === 'foreground') {
        listener({ type: 'foreground', source: 'resume' })
      }
    }
    const activity = (
      source: Extract<TimingLifecycleEvent, { type: 'activity' }>['source'],
    ): EventListener => {
      return () => listener({ type: 'activity', source })
    }

    add(
      this.#visibilityTarget,
      'visibilitychange',
      onVisibilityChange,
    )
    add(this.#pageTarget, 'pagehide', onPageHide)
    add(this.#pageTarget, 'pageshow', onPageShow)
    add(this.#optionalLifecycleTarget, 'freeze', onFreeze)
    add(this.#optionalLifecycleTarget, 'resume', onResume)
    add(this.#visibilityTarget, 'pointerdown', activity('pointer'))
    add(this.#visibilityTarget, 'keydown', activity('keyboard'))
    add(this.#visibilityTarget, 'input', activity('input'))
    add(this.#visibilityTarget, 'touchstart', activity('touch'))

    return () => {
      for (const remove of removers.splice(0)) {
        remove()
      }
    }
  }
}

export const browserTimingLifecycle = new BrowserTimingLifecycle()
