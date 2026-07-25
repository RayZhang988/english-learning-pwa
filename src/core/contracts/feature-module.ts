import type { RouteObject } from 'react-router'

export interface FeatureStorageContract {
  /**
   * Globally unique IndexedDB namespace owned by this feature.
   */
  readonly namespace: string
  /**
   * Current version of values written by this feature.
   */
  readonly schemaVersion: number
}

/**
 * Contract required from every independently owned business module.
 *
 * The platform owns route mounting and registration. A feature only supplies
 * routes relative to its reserved route base and never edits `src/app/**`.
 */
export interface FeatureModule {
  readonly id: string
  readonly routeBase: string
  readonly storage: FeatureStorageContract
  readonly routes: readonly RouteObject[]
}

/**
 * Preserves literal module metadata while checking the public contract.
 */
export function defineFeatureModule<const TFeature extends FeatureModule>(
  feature: TFeature,
): TFeature {
  return feature
}
