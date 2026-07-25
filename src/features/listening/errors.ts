export type ListeningErrorCode =
  | 'content-invalid'
  | 'content-version-unsupported'
  | 'content-reference-missing'
  | 'content-unavailable'
  | 'task-incompatible'
  | 'session-transition-invalid'
  | 'session-recovery-invalid'
  | 'speech-unavailable'
  | 'speech-failed'

export class ListeningError extends Error {
  readonly code: ListeningErrorCode

  constructor(
    code: ListeningErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ListeningError'
    this.code = code
  }
}

export function toListeningError(error: unknown): ListeningError {
  if (error instanceof ListeningError) {
    return error
  }
  if (error instanceof Error) {
    return new ListeningError(
      'content-invalid',
      error.message,
      { cause: error },
    )
  }
  return new ListeningError(
    'content-invalid',
    'Unknown listening module failure.',
  )
}
