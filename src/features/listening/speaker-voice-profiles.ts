import type {
  ListeningSpeechVoice,
} from './speech-synthesis.ts'

export interface ListeningSpeakerVoiceProfile {
  readonly voiceId: string | null
  readonly pitch: number
  readonly rateScale: number
}

const NARRATOR_KEY = '\u0000narrator'
const FALLBACK_PROFILES: readonly Omit<
  ListeningSpeakerVoiceProfile,
  'voiceId'
>[] = [
  { pitch: 0.97, rateScale: 0.98 },
  { pitch: 1.03, rateScale: 1.02 },
  { pitch: 0.94, rateScale: 1 },
  { pitch: 1.06, rateScale: 1 },
]

function speakerKey(speaker: string | null): string {
  return speaker ?? NARRATOR_KEY
}

export class ListeningSpeakerVoiceProfiles {
  private readonly speakerKeys: readonly string[]
  private readonly voiceSource: () => readonly ListeningSpeechVoice[]
  private profiles: Map<string, ListeningSpeakerVoiceProfile> | null =
    null
  private voiceSnapshot: readonly ListeningSpeechVoice[] = []

  constructor(
    speakers: readonly (string | null)[],
    voiceSource: () => readonly ListeningSpeechVoice[],
  ) {
    this.speakerKeys = [...new Set(speakers.map(speakerKey))]
    this.voiceSource = voiceSource
  }

  private initialize(): void {
    if (this.profiles) {
      return
    }
    try {
      this.voiceSnapshot = this.voiceSource().filter(
        (voice) =>
          voice.locale === 'en-US' && voice.localService === true,
      )
    } catch {
      this.voiceSnapshot = []
    }
    const speakerKeys =
      this.speakerKeys.length > 0
        ? this.speakerKeys
        : [NARRATOR_KEY]
    const neutral = speakerKeys.length === 1
    const distinctVoicesAvailable =
      this.voiceSnapshot.length >= speakerKeys.length
    this.profiles = new Map(
      speakerKeys.map((key, index) => {
        const fallback = neutral
          ? { pitch: 1, rateScale: 1 }
          : FALLBACK_PROFILES[index % FALLBACK_PROFILES.length]
        return [
          key,
          {
            voiceId:
              this.voiceSnapshot.length > 0
                ? this.voiceSnapshot[index % this.voiceSnapshot.length]
                    .id
                : null,
            pitch: distinctVoicesAvailable ? 1 : fallback.pitch,
            rateScale: distinctVoicesAvailable
              ? 1
              : fallback.rateScale,
          },
        ]
      }),
    )
  }

  profileFor(speaker: string | null): ListeningSpeakerVoiceProfile {
    this.initialize()
    const key = speakerKey(speaker)
    const existing = this.profiles?.get(key)
    if (existing) {
      return existing
    }
    const fallback: ListeningSpeakerVoiceProfile = {
      voiceId: this.voiceSnapshot[0]?.id ?? null,
      pitch: 1,
      rateScale: 1,
    }
    this.profiles?.set(key, fallback)
    return fallback
  }
}
