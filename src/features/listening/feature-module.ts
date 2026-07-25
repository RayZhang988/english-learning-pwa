import type { ReactNode } from 'react'
import {
  defineFeatureModule,
  type FeatureModule,
} from '../../core/index.ts'
import {
  LISTENING_STORAGE_NAMESPACE,
  LISTENING_STORAGE_SCHEMA_VERSION,
} from './repository.ts'

export function createListeningFeatureModule(
  routeElement: ReactNode,
): FeatureModule {
  return defineFeatureModule({
    id: 'listening',
    routeBase: 'listening',
    storage: {
      namespace: LISTENING_STORAGE_NAMESPACE,
      schemaVersion: LISTENING_STORAGE_SCHEMA_VERSION,
    },
    routes: [{ index: true, element: routeElement }],
  })
}
