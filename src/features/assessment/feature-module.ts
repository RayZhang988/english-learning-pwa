import type { ReactElement } from 'react'
import {
  defineFeatureModule,
  type FeatureModule,
} from '../../core/index.ts'
import {
  ASSESSMENT_STORAGE_NAMESPACE,
  ASSESSMENT_STORAGE_SCHEMA_VERSION,
} from './repository.ts'

/**
 * 03 owns the assessment business route but not its presentation. 02 supplies
 * the route element; 01 performs final registration.
 */
export function createAssessmentFeatureModule(
  routeElement: ReactElement,
): FeatureModule {
  return defineFeatureModule({
    id: 'assessment',
    routeBase: 'assessment',
    storage: {
      namespace: ASSESSMENT_STORAGE_NAMESPACE,
      schemaVersion: ASSESSMENT_STORAGE_SCHEMA_VERSION,
    },
    routes: [{ index: true, element: routeElement }],
  })
}
