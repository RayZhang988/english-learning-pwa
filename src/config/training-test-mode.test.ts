import { describe, expect, it } from 'vitest'
import {
  createTrainingTimingClock,
  parseTrainingTestMode,
  toTrainingDisplaySeconds,
  trainingBlockDurationLabel,
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

  it('shows the accelerated wall-clock duration without changing production data', () => {
    const testMode = parseTrainingTestMode('?trainingTest=30')
    const productionMode = parseTrainingTestMode('')

    expect(toTrainingDisplaySeconds(900, testMode)).toBe(30)
    expect(toTrainingDisplaySeconds(450, testMode)).toBe(15)
    expect(toTrainingDisplaySeconds(1, testMode)).toBe(1)
    expect(toTrainingDisplaySeconds(900, productionMode)).toBe(900)
    expect(trainingBlockDurationLabel(testMode)).toBe('30 秒')
    expect(trainingBlockDurationLabel(productionMode)).toBe('15 分钟')
  })
})
