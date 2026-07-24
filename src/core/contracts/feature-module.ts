import type { RouteObject } from 'react-router'

/**
 * Contract required from every independently owned business module.
 *
 * `storageNamespace` prevents unrelated modules from sharing mutable keys.
 * The platform owns route composition; the module owns its internal behavior.
 */
export interface FeatureModule {
  readonly id: string
  readonly storageNamespace: string
  readonly routes: readonly RouteObject[]
}
