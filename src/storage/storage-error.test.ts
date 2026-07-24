import { describe, expect, it } from 'vitest'
import { toStorageError } from './storage-error.ts'

describe('toStorageError', () => {
  it('distinguishes quota exhaustion from a generic storage failure', () => {
    const error = toStorageError(
      new DOMException('Quota reached', 'QuotaExceededError'),
    )

    expect(error.code).toBe('storage_quota_exceeded')
    expect(error.recoverable).toBe(true)
  })
})
