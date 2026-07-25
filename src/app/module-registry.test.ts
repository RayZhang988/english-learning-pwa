import { describe, expect, it } from 'vitest'
import { createFeatureModuleFixture } from '../core/testing/index.ts'
import {
  createFeatureRegistry,
  featureRegistry,
  FeatureRegistrationError,
} from './module-registry.ts'
import type { FeatureModuleSlot } from './module-slots.ts'

const fixtureSlot: FeatureModuleSlot = {
  id: 'fixture',
  ownerTask: '03',
  routeBase: 'fixture',
  storageNamespace: 'feature.fixture',
}

describe('createFeatureRegistry', () => {
  it('registers all delivered training modules in production', () => {
    expect(
      featureRegistry.modules.map((module) => module.id),
    ).toEqual([
      'assessment',
      'vocabulary',
      'listening',
      'speaking',
    ])
    expect(featureRegistry.routes.map((route) => route.path)).toEqual([
      'assessment',
      'vocabulary',
      'listening',
      'speaking',
    ])
  })

  it('mounts a delivered feature below its reserved route base', () => {
    const module = createFeatureModuleFixture()
    const registry = createFeatureRegistry([module], [fixtureSlot])

    expect(registry.get('fixture')).toBe(module)
    expect(registry.routes).toEqual([
      {
        path: 'fixture',
        children: [{ index: true, element: null }],
      },
    ])
  })

  it('rejects modules that do not own a reserved slot', () => {
    expect(() =>
      createFeatureRegistry([createFeatureModuleFixture()], []),
    ).toThrowError(FeatureRegistrationError)
  })

  it('rejects duplicate registrations', () => {
    const module = createFeatureModuleFixture()

    expect(() =>
      createFeatureRegistry([module, module], [fixtureSlot]),
    ).toThrow('already registered')
  })

  it('rejects absolute feature routes', () => {
    const module = createFeatureModuleFixture({
      routes: [{ path: '/outside', element: null }],
    })

    expect(() => createFeatureRegistry([module], [fixtureSlot])).toThrow(
      'non-relative route',
    )
  })

  it('rejects a namespace that differs from the reserved slot', () => {
    const module = createFeatureModuleFixture({
      storage: {
        namespace: 'feature.someone-else',
        schemaVersion: 1,
      },
    })

    expect(() => createFeatureRegistry([module], [fixtureSlot])).toThrow(
      'must use storage namespace',
    )
  })
})
