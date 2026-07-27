import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import {
  createAssessmentFeatureModule,
  createTravelVocabularyAssessmentFeatureModuleR1,
  createVocabularyAssessmentFeatureModule,
} from './feature-module.ts'

describe('assessment feature module contract', () => {
  it('matches the slot reserved by 01 while accepting presentation injection', () => {
    const module = createAssessmentFeatureModule(
      createElement('main', null),
    )

    expect(module.id).toBe('assessment')
    expect(module.routeBase).toBe('assessment')
    expect(module.storage).toEqual({
      namespace: 'feature.assessment',
      schemaVersion: 1,
    })
    expect(module.routes).toHaveLength(1)
    expect(module.routes[0]?.index).toBe(true)
  })

  it('keeps the frozen v2 module available for legacy compatibility', () => {
    const module = createVocabularyAssessmentFeatureModule(
      createElement('main', null),
    )

    expect(module.id).toBe('assessment')
    expect(module.routeBase).toBe('assessment')
    expect(module.storage).toEqual({
      namespace: 'feature.assessment',
      schemaVersion: 2,
    })
    expect(module.routes).toHaveLength(1)
    expect(module.routes[0]?.index).toBe(true)
  })

  it('exposes schema 3 for the active R1 production registration', () => {
    const module = createTravelVocabularyAssessmentFeatureModuleR1(
      createElement('main', null),
    )

    expect(module.id).toBe('assessment')
    expect(module.routeBase).toBe('assessment')
    expect(module.storage).toEqual({
      namespace: 'feature.assessment',
      schemaVersion: 3,
    })
  })
})
