import { describe, expect, it } from 'vitest'
import { createListeningFeatureModule } from './feature-module.ts'

describe('listening feature module', () => {
  it('uses the reserved route and storage namespace', () => {
    const module = createListeningFeatureModule(null)
    expect(module).toMatchObject({
      id: 'listening',
      routeBase: 'listening',
      storage: {
        namespace: 'feature.listening',
        schemaVersion: 1,
      },
    })
    expect(module.routes).toHaveLength(1)
  })
})
