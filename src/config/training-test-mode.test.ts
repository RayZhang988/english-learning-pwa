import { describe, expect, it } from 'vitest'
import {
  createTrainingTimingClock,
  parseTrainingTestMode,
} from './training-test-mode.ts'

describe('30-second training test mode', () => {
  it('requires the explicit URL flag and uses an isolated database', () => {
    expect(parseTrainingTestMode('').enabled).toBe(false)
    expect(parseTrainingTestMode('?trainingTest=30')).toEqual({
      enabled: true,
      wallSeconds: 30,
      timeScale: 30,
      databaseName: 'english-learning-pwa-training-test-30s',
    })
  })

  it('keeps the normal production clock untouched', () => {
    expect(
      createTrainingTimingClock(parseTrainingTestMode('')),
    ).toBeUndefined()
  })
})
