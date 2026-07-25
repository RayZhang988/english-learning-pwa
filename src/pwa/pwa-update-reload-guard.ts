export interface PwaControllerIdentity {
  readonly scriptURL?: string
}

export type PwaReload = () => void

/**
 * Keeps the PWA update reload local to the current document.
 *
 * The guard intentionally uses no persistent storage. Learning state belongs to
 * the existing IndexedDB/localStorage repositories, while this object only
 * prevents duplicate reload requests during one controller transition.
 */
export class PwaUpdateReloadGuard {
  private controllerKnown: boolean
  private currentController: PwaControllerIdentity | null
  private reloadRequested = false

  constructor(initialController: PwaControllerIdentity | null) {
    this.controllerKnown = initialController !== null
    this.currentController = initialController
  }

  onControllerChange(
    controller: PwaControllerIdentity | null,
    reload: PwaReload,
  ): boolean {
    if (!controller) {
      return false
    }

    if (!this.controllerKnown) {
      this.controllerKnown = true
      this.currentController = controller
      return false
    }

    if (controller === this.currentController) {
      return false
    }

    this.currentController = controller
    return this.requestReload(controller, reload)
  }

  requestReload(
    controller: PwaControllerIdentity | null,
    reload: PwaReload,
  ): boolean {
    if (this.reloadRequested) {
      return false
    }

    this.reloadRequested = true
    this.currentController = controller
    reload()
    return true
  }
}
