import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { browserListeningSpeech } from '../features/listening/index.ts'
import { ListeningVoiceDiagnosticScreen, type ListeningVoiceDiagnosticViewModel } from '../ui/index.ts'
import { naturalListeningVoiceCandidates } from './listening-voice-diagnostic-model.ts'

export const LISTENING_VOICE_DIAGNOSTIC_ROUTE = '/diagnostics/listening-voices'
export const LISTENING_VOICE_DIAGNOSTIC_STORAGE_KEY = 'english-learning:listening-voice-diagnostic:v1'

const samples = {
  word: 'passport',
  sentence: 'Could you show me the way to the station?',
  dialogue: "Good morning. Hello. I'd like to check in, please. Certainly. May I see your passport?",
} as const

function savedVoice(): string | null {
  try { return window.localStorage.getItem(LISTENING_VOICE_DIAGNOSTIC_STORAGE_KEY) }
  catch { return null }
}

export function ListeningVoiceDiagnosticRouteHost() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>(savedVoice)
  const [viewModel, setViewModel] = useState<ListeningVoiceDiagnosticViewModel>({ status: 'loading', voices: [], playing: null })
  const refresh = useCallback(() => {
    const voices = naturalListeningVoiceCandidates(browserListeningSpeech.voices())
    setViewModel((current) => ({ status: voices.length > 0 ? 'ready' : 'empty', voices: voices.map((voice) => ({ id: voice.id, selected: voice.id === selected })), playing: current.playing }))
  }, [selected])
  useEffect(() => {
    refresh()
    const timers = [250, 1000, 2500].map((delay) => window.setTimeout(refresh, delay))
    return () => { timers.forEach(window.clearTimeout); browserListeningSpeech.cancel() }
  }, [refresh])
  const play = (voiceId: string, sampleId: keyof typeof samples) => {
    browserListeningSpeech.cancel()
    setViewModel((current) => ({ ...current, playing: { voiceId, sampleId }, errorMessage: undefined }))
    try {
      browserListeningSpeech.speak({ text: samples[sampleId], locale: 'en-US', rate: 1, voiceId }, {
        onEnd: () => setViewModel((current) => ({ ...current, playing: null })),
        onError: () => setViewModel((current) => ({ ...current, status: 'error', playing: null, errorMessage: '设备无法播放这个音色，请刷新后重试。' })),
      })
    } catch (error) {
      setViewModel((current) => ({ ...current, status: 'error', playing: null, errorMessage: error instanceof Error ? error.message : '设备无法播放这个音色。' }))
    }
  }
  const select = (voiceId: string) => {
    try { window.localStorage.setItem(LISTENING_VOICE_DIAGNOSTIC_STORAGE_KEY, voiceId) } catch { /* selection remains visible for this visit */ }
    setSelected(voiceId)
    setViewModel((current) => ({ ...current, voices: current.voices.map((voice) => ({ ...voice, selected: voice.id === voiceId })) }))
  }
  return <ListeningVoiceDiagnosticScreen viewModel={viewModel} onPlay={play} onRefresh={refresh} onSelect={select} onExit={() => navigate('/')} />
}
