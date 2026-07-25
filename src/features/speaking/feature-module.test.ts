import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { createSpeakingFeatureModule } from './feature-module.ts'

describe('speaking feature module', () => {
  it('exposes only its owned route and storage metadata', () => {
    const routeElement = createElement('div')
    const feature = createSpeakingFeatureModule(routeElement)

    expect(feature).toMatchObject({
      id: 'speaking',
      routeBase: 'speaking',
      storage: {
        namespace: 'feature.speaking',
        schemaVersion: 1,
      },
    })
    expect(feature.routes).toEqual([
      { index: true, element: routeElement },
    ])
  })
})
