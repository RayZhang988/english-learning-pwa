export interface VocabularyRuntimeDisposalPort {
  dispose(): Promise<void>
}

export class VocabularyRuntimeMountLifecycle {
  readonly #mountCounts = new Map<VocabularyRuntimeDisposalPort, number>()
  readonly #schedule: (callback: () => void) => void
  readonly #onDisposeError: (error: unknown) => void

  constructor(options: {
    readonly schedule?: (callback: () => void) => void
    readonly onDisposeError?: (error: unknown) => void
  } = {}) {
    this.#schedule =
      options.schedule ?? ((callback) => queueMicrotask(callback))
    this.#onDisposeError = options.onDisposeError ?? (() => undefined)
  }

  retain(runtime: VocabularyRuntimeDisposalPort): () => void {
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
