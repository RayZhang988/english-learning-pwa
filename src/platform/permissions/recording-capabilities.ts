export interface RecordingCapabilities {
  readonly mediaRecorder: boolean
  readonly supportedMimeTypes: readonly string[]
}

const candidateMimeTypes = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/webm',
  'audio/ogg;codecs=opus',
] as const

export function getRecordingCapabilities(): RecordingCapabilities {
  if (typeof MediaRecorder === 'undefined') {
    return {
      mediaRecorder: false,
      supportedMimeTypes: [],
    }
  }

  return {
    mediaRecorder: true,
    supportedMimeTypes: candidateMimeTypes.filter((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    ),
  }
}
