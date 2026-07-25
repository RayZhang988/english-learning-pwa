import type { FeatureModule } from '../contracts/feature-module.ts'

export function createFeatureModuleFixture(
  overrides: Partial<FeatureModule> = {},
): FeatureModule {
  return {
    id: 'fixture',
    routeBase: 'fixture',
    storage: {
      namespace: 'feature.fixture',
      schemaVersion: 1,
    },
    routes: [{ index: true, element: null }],
    ...overrides,
  }
}
