import type { FeatureModule } from '../core/contracts/feature-module.ts'

/**
 * Integration point for business modules.
 *
 * A feature must be delivered as a FeatureModule and added here. Platform code
 * must not reach into a feature's internal files.
 */
export const featureModules: readonly FeatureModule[] = []
