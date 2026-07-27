import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import {
  createAssessmentFeatureModule,
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

  it('exposes the v2 vocabulary-only module for new-user registration', () => {
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
})
