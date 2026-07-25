export type SpeakingErrorCode =
  | 'content-invalid'
  | 'content-version-unsupported'
  | 'content-reference-missing'
  | 'content-unavailable'
  | 'task-incompatible'
  | 'session-transition-invalid'
  | 'session-recovery-invalid'
  | 'permission-denied'
  | 'recording-unavailable'
  | 'recording-failed'
  | 'playback-failed'

export class SpeakingError extends Error {
  readonly code: SpeakingErrorCode

  constructor(
    code: SpeakingErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SpeakingError'
    this.code = code
  }
}

export function toSpeakingError(error: unknown): SpeakingError {
  if (error instanceof SpeakingError) {
    return error
  }
  if (error instanceof Error) {
    return new SpeakingError(
      'recording-failed',
      error.message,
      { cause: error },
    )
  }
  return new SpeakingError(
    'recording-failed',
    'Unknown speaking module failure.',
  )
}
