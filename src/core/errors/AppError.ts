export type AppErrorCode =
  | 'storage_unavailable'
  | 'storage_quota_exceeded'
  | 'schema_incompatible'
  | 'network_unavailable'
  | 'permission_denied'
  | 'offline_asset_failed'
  | 'backup_invalid'
  | 'unknown'

interface AppErrorOptions {
  readonly cause?: unknown
  readonly recoverable?: boolean
  readonly details?: Readonly<Record<string, unknown>>
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly recoverable: boolean
  readonly details?: Readonly<Record<string, unknown>>

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.recoverable = options.recoverable ?? false
    this.details = options.details
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error
  }

  return new AppError('unknown', '发生了未预期的错误。', {
    cause: error,
    recoverable: true,
  })
}
