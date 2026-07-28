export interface ListeningRuntimeDisposalPort {
  dispose(): Promise<void>
}

/**
 * React StrictMode performs a cleanup/setup probe. Delaying disposal by one
 * microtask lets a retained runtime survive that probe without creating a
 * second effective timing session.
 */
export class ListeningRuntimeMountLifecycle {
  readonly #mountCounts = new Map<ListeningRuntimeDisposalPort, number>()
  readonly #schedule: (callback: () => void) => void
  readonly #onDisposeError: (error: unknown) => void

  constructor(options: {
    readonly schedule?: (callback: () => void) => void
    readonly onDisposeError?: (error: unknown) => void
  } = {}) {
    this.#schedule = options.schedule ?? queueMicrotask
    this.#onDisposeError = options.onDisposeError ?? (() => undefined)
  }

  retain(runtime: ListeningRuntimeDisposalPort): () => void {
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
