import type { ReactNode } from 'react'
import {
  defineFeatureModule,
  type FeatureModule,
} from '../../core/index.ts'
import {
  SPEAKING_STORAGE_NAMESPACE,
  SPEAKING_STORAGE_SCHEMA_VERSION,
} from './repository.ts'

export function createSpeakingFeatureModule(
  routeElement: ReactNode,
): FeatureModule {
  return defineFeatureModule({
    id: 'speaking',
    routeBase: 'speaking',
    storage: {
      namespace: SPEAKING_STORAGE_NAMESPACE,
      schemaVersion: SPEAKING_STORAGE_SCHEMA_VERSION,
    },
    routes: [{ index: true, element: routeElement }],
  })
}
