import type { ReactNode } from 'react'
import {
  defineFeatureModule,
  type FeatureModule,
} from '../../core/index.ts'
import {
  VOCABULARY_STORAGE_NAMESPACE,
  VOCABULARY_STORAGE_SCHEMA_VERSION,
} from './repository.ts'

export function createVocabularyFeatureModule(
  routeElement: ReactNode,
): FeatureModule {
  return defineFeatureModule({
    id: 'vocabulary',
    routeBase: 'vocabulary',
    storage: {
      namespace: VOCABULARY_STORAGE_NAMESPACE,
      schemaVersion: VOCABULARY_STORAGE_SCHEMA_VERSION,
    },
    routes: [{ index: true, element: routeElement }],
  })
}
