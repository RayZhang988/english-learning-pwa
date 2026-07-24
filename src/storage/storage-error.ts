import { AppError } from '../core/errors/AppError.ts'

export function isQuotaExceededError(error: unknown) {
  return (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'QuotaExceededError'
  )
}

export function toStorageError(
  error: unknown,
  details?: Readonly<Record<string, unknown>>,
) {
  if (error instanceof AppError) {
    return error
  }

  if (isQuotaExceededError(error)) {
    return new AppError(
      'storage_quota_exceeded',
      '本地存储空间不足，数据未能保存。',
      {
        cause: error,
        recoverable: true,
        details,
      },
    )
  }

  return new AppError('storage_unavailable', '本地学习数据暂时无法访问。', {
    cause: error,
    recoverable: true,
    details,
  })
}
