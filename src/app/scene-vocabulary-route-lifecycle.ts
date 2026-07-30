export interface SceneVocabularyRouteToken {
  readonly identity: string
  readonly generation: number
}

/**
 * Binds async route work to the route that started it. Hash-only navigation
 * reuses the host component, so an old catalog load must never update a new
 * scene after params change.
 */
export class SceneVocabularyRouteLifecycle {
  private generation = 0
  private current: SceneVocabularyRouteToken | undefined

  begin(identity: string): SceneVocabularyRouteToken {
    const token = { identity, generation: this.generation + 1 }
    this.generation = token.generation
    this.current = token
    return token
  }

  currentFor(identity: string): SceneVocabularyRouteToken | undefined {
    return this.current?.identity === identity ? this.current : undefined
  }

  isCurrent(token: SceneVocabularyRouteToken): boolean {
    return (
      this.current?.identity === token.identity &&
      this.current.generation === token.generation
    )
  }

  invalidate(token: SceneVocabularyRouteToken): void {
    if (this.isCurrent(token)) {
      this.current = undefined
    }
  }
}
