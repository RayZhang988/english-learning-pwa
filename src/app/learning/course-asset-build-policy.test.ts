import { describe, expect, it } from 'vitest'
import { courseAssetBuildPolicy } from '../../../vite.config.ts'

describe('course asset build policy', () => {
  it('publishes fetchable JSON under a portable base and precaches it', () => {
    expect(courseAssetBuildPolicy.base).toBe('./')
    expect(courseAssetBuildPolicy.assetsInlineLimit).toBe(0)
    expect(courseAssetBuildPolicy.indexAssetDirectory).toBe(
      'content/curriculum',
    )
    expect(courseAssetBuildPolicy.indexAssetNames).toEqual([
      'package-index.v1.json',
      'listening-exercise-extension-index.v1.json',
      'training-supply-index.v1.json',
    ])
    expect(
      courseAssetBuildPolicy.workboxGlobPatterns.some((pattern) =>
        pattern.includes('json'),
      ),
    ).toBe(true)
  })
})
