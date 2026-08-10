import { describe, expect, it } from 'vitest'
import {
  LISTENING_VOICE_PREFERENCE_STORAGE_KEY,
  readListeningVoicePreference,
  saveListeningVoicePreference,
} from './voice-preference.ts'

describe('listening voice preference', () => {
  it('keeps the diagnostic storage key so an existing Samantha choice survives the upgrade', () => {
    expect(LISTENING_VOICE_PREFERENCE_STORAGE_KEY).toBe(
      'english-learning:listening-voice-diagnostic:v1',
    )
  })

  it('reads and writes a trimmed device voice identity', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    }

    saveListeningVoicePreference('  Samantha  ', storage)

    expect(readListeningVoicePreference(storage)).toBe('Samantha')
  })

  it('returns no preference when browser storage is unavailable or damaged', () => {
    const brokenStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
    }

    expect(readListeningVoicePreference(undefined)).toBeNull()
    expect(readListeningVoicePreference(brokenStorage)).toBeNull()
  })
})
