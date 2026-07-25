export type VocabularyErrorCode =
  | 'content-unavailable'
  | 'content-invalid'
  | 'content-version-unsupported'
  | 'content-reference-missing'
  | 'activity-unsupported'
  | 'question-options-insufficient'
  | 'task-incompatible'
  | 'session-transition-invalid'
  | 'session-recovery-invalid'

export class VocabularyError extends Error {
  readonly code: VocabularyErrorCode

  constructor(code: VocabularyErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'VocabularyError'
    this.code = code
  }
}

export function toVocabularyError(error: unknown): VocabularyError {
  if (error instanceof VocabularyError) {
    return error
  }

  return new VocabularyError(
    'content-unavailable',
    error instanceof Error ? error.message : '词汇内容暂时不可用。',
    { cause: error },
  )
}
