import { describe, expect, it } from 'vitest'
import { naturalListeningVoiceCandidates } from './listening-voice-diagnostic-model.ts'

describe('naturalListeningVoiceCandidates', () => {
  it('removes Apple novelty and legacy mechanical voices from the user shortlist', () => {
    const voices = [
      'Albert', 'Bad News', 'Bells', 'Boing', 'Bubbles', 'Cellos',
      'Fred', 'Junior', 'Kathy', 'Organ', 'Ralph', 'Trinoids',
      'Whisper', 'Wobble', 'Zarvox', 'Samantha',
      'Eddy (英语（美国）)', 'Ava Premium',
    ].map((id) => ({ id, locale: 'en-US' as const, localService: true as const }))

    expect(naturalListeningVoiceCandidates(voices).map((voice) => voice.id)).toEqual([
      'Ava Premium',
      'Eddy (英语（美国）)',
      'Samantha',
    ])
  })
})
