export interface SpeakingRuntimeDisposalPort {
  dispose(): Promise<void>
}

/**
 * React StrictMode performs a cleanup/setup probe. A microtask delay lets the
 * retained runtime survive that probe instead of disposing and recreating the
 * same task-01 timing session.
 */
export class SpeakingRuntimeMountLifecycle {
  readonly #mountCounts = new Map<SpeakingRuntimeDisposalPort, number>()
  readonly #schedule: (callback: () => void) => void
  readonly #onDisposeError: (error: unknown) => void

  constructor(options: {
    readonly schedule?: (callback: () => void) => void
    readonly onDisposeError?: (error: unknown) => void
  } = {}) {
    this.#schedule = options.schedule ?? queueMicrotask
    this.#onDisposeError = options.onDisposeError ?? (() => undefined)
  }

  retain(runtime: SpeakingRuntimeDisposalPort): () => void {
    this.#mountCounts.set(
      runtime,
      (this.#mountCounts.get(runtime) ?? 0) + 1,
    )
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      const remaining = Math.max(
        0,
        (this.#mountCounts.get(runtime) ?? 1) - 1,
      )
      this.#mountCounts.set(runtime, remaining)
      this.#schedule(() => {
        if (this.#mountCounts.get(runtime) !== 0) {
          return
        }
        this.#mountCounts.delete(runtime)
        void runtime.dispose().catch(this.#onDisposeError)
      })
    }
  }
}
