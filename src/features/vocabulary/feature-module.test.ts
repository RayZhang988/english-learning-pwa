import { describe, expect, it } from 'vitest'
import { createVocabularyFeatureModule } from './feature-module.ts'

describe('vocabulary feature module', () => {
  it('matches the vocabulary slot reserved by task 01', () => {
    expect(createVocabularyFeatureModule(null)).toMatchObject({
      id: 'vocabulary',
      routeBase: 'vocabulary',
      storage: {
        namespace: 'feature.vocabulary',
        schemaVersion: 1,
      },
      routes: [{ index: true, element: null }],
    })
  })
})
