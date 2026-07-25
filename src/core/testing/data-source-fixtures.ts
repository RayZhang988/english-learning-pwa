import type { ReadonlyDataSource } from '../contracts/async-data.ts'

export function createStaticDataSource<TValue>(
  value: TValue,
): ReadonlyDataSource<TValue> {
  return {
    async load(signal) {
      signal?.throwIfAborted()
      return value
    },
  }
}

export function createFailingDataSource<TValue = never>(
  error: Error,
): ReadonlyDataSource<TValue> {
  return {
    async load(signal) {
      signal?.throwIfAborted()
      throw error
    },
  }
}
