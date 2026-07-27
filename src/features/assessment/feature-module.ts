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

/**
 * Frozen v2 registration contract for compatibility tests and recovery.
 * It must not be selected for new R1 production sessions.
 */
export function createVocabularyAssessmentFeatureModule(
  routeElement: ReactElement,
): FeatureModule {
  return defineFeatureModule({
    id: 'assessment',
    routeBase: 'assessment',
    storage: {
      namespace: ASSESSMENT_STORAGE_NAMESPACE,
      schemaVersion: 2,
    },
    routes: [{ index: true, element: routeElement }],
  })
}

/**
 * R1 registration contract. 01 must use this module for the new production
 * entry while keeping v1/v2 factories available only for legacy recovery.
 */
export function createTravelVocabularyAssessmentFeatureModuleR1(
  routeElement: ReactElement,
): FeatureModule {
  return defineFeatureModule({
    id: 'assessment',
    routeBase: 'assessment',
    storage: {
      namespace: ASSESSMENT_STORAGE_NAMESPACE,
      schemaVersion: 3,
    },
    routes: [{ index: true, element: routeElement }],
  })
}
