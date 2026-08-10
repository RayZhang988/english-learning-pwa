export const LISTENING_VOICE_PREFERENCE_STORAGE_KEY =
  'english-learning:listening-voice-diagnostic:v1'

interface VoicePreferenceReader {
  getItem(key: string): string | null
}

interface VoicePreferenceWriter {
  setItem(key: string, value: string): void
}

function browserStorage(): Storage | undefined {
  try {
    return typeof globalThis.localStorage === 'undefined'
      ? undefined
      : globalThis.localStorage
  } catch {
    return undefined
  }
}

export function readListeningVoicePreference(
  storage: VoicePreferenceReader | undefined = browserStorage(),
): string | null {
  if (!storage) {
    return null
  }
  try {
    return storage
      .getItem(LISTENING_VOICE_PREFERENCE_STORAGE_KEY)
      ?.trim() || null
  } catch {
    return null
  }
}

export function saveListeningVoicePreference(
  voiceId: string,
  storage: VoicePreferenceWriter | undefined = browserStorage(),
): void {
  const normalized = voiceId.trim()
  if (!storage || normalized.length === 0) {
    return
  }
  try {
    storage.setItem(
      LISTENING_VOICE_PREFERENCE_STORAGE_KEY,
      normalized,
    )
  } catch {
    // A blocked browser store must not break the current diagnostic session.
  }
}
