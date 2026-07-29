import type {
  EffectiveTimingClock,
  EffectiveTimingScheduler,
} from '../platform/index.ts'

export const TRAINING_TEST_WALL_SECONDS = 30
export const TRAINING_TEST_EFFECTIVE_SECONDS = 900
export const TRAINING_TEST_TIME_SCALE =
  TRAINING_TEST_EFFECTIVE_SECONDS / TRAINING_TEST_WALL_SECONDS

export interface TrainingTestMode {
  readonly enabled: boolean
  readonly wallSeconds: number
  readonly timeScale: number
  readonly databaseName: string
}

export function parseTrainingTestMode(search: string): TrainingTestMode {
  const enabled =
    new URLSearchParams(search).get('trainingTest') ===
    String(TRAINING_TEST_WALL_SECONDS)
  return {
    enabled,
    wallSeconds: TRAINING_TEST_WALL_SECONDS,
    timeScale: enabled ? TRAINING_TEST_TIME_SCALE : 1,
    databaseName: enabled
      ? 'english-learning-pwa-training-test-30s'
      : 'english-learning-pwa',
  }
}

export const trainingTestMode = parseTrainingTestMode(
  typeof globalThis.location === 'undefined'
    ? ''
    : globalThis.location.search,
)

export function createTrainingTimingClock(
  mode: TrainingTestMode = trainingTestMode,
): EffectiveTimingClock | undefined {
  if (!mode.enabled) {
    return undefined
  }
  const initialWallMs = Date.now()
  const initialMonotonicMs =
    typeof performance === 'undefined'
      ? initialWallMs
      : performance.now()
  return {
    now() {
      const currentMonotonicMs =
        typeof performance === 'undefined'
          ? Date.now()
          : performance.now()
      const scaledElapsedMs =
        (currentMonotonicMs - initialMonotonicMs) * mode.timeScale
      return {
        wallTimeMs: initialWallMs + scaledElapsedMs,
        monotonicTimeMs:
          initialMonotonicMs + scaledElapsedMs,
      }
    },
  }
}

export function createTrainingTimingScheduler(
  mode: TrainingTestMode = trainingTestMode,
): EffectiveTimingScheduler | undefined {
  if (!mode.enabled) {
    return undefined
  }
  return {
    set(callback, delayMs) {
      return globalThis.setTimeout(
        callback,
        delayMs / mode.timeScale,
      )
    },
    clear(handle) {
      globalThis.clearTimeout(
        handle as ReturnType<typeof globalThis.setTimeout>,
      )
    },
  }
}
