export interface ListeningVoiceDiagnosticViewModel {
  readonly status: 'loading' | 'ready' | 'empty' | 'error'
  readonly voices: readonly {
    readonly id: string
    readonly selected: boolean
  }[]
  readonly playing: { readonly voiceId: string; readonly sampleId: 'word' | 'sentence' | 'dialogue' } | null
  readonly errorMessage?: string
}

const samples = [
  { id: 'word', label: '单词' },
  { id: 'sentence', label: '短句' },
  { id: 'dialogue', label: '对话' },
] as const

export interface ListeningVoiceDiagnosticScreenProps {
  readonly viewModel: ListeningVoiceDiagnosticViewModel
  readonly onPlay: (voiceId: string, sampleId: 'word' | 'sentence' | 'dialogue') => void
  readonly onRefresh: () => void
  readonly onSelect: (voiceId: string) => void
  readonly onExit: () => void
}

export function ListeningVoiceDiagnosticScreen({ viewModel, onPlay, onRefresh, onSelect, onExit }: ListeningVoiceDiagnosticScreenProps) {
  return <main className="listening-voice-diagnostic">
    <header>
      <button type="button" onClick={onExit} aria-label="退出音色测试">←</button>
      <p>LISTENING VOICE CHECK</p>
      <h1>音色自然度测试</h1>
      <p>请在同一部 iPhone 上试听。已过滤明显特效音和旧机械音；这里只记录你的选择，不会自动应用到正式听力。</p>
    </header>
    {viewModel.status === 'loading' ? <p role="status">正在读取设备音色…</p> : null}
    {viewModel.status === 'empty' ? <section><h2>暂未读取到美式英语音色</h2><p>iPhone 的音色列表可能仍在加载，请稍后刷新。</p><button type="button" onClick={onRefresh}>重新读取音色</button></section> : null}
    {viewModel.status === 'error' ? <section role="alert"><h2>音色测试暂时无法播放</h2><p>{viewModel.errorMessage}</p><button type="button" onClick={onRefresh}>重试</button></section> : null}
    {viewModel.status === 'ready' ? <ol aria-label="设备美式英语音色">
      {viewModel.voices.map((voice) => <li key={voice.id}>
        <h2>{voice.id}</h2>
        <div role="group" aria-label={`${voice.id} 试听片段`}>
          {samples.map((sample) => <button type="button" key={sample.id} aria-pressed={viewModel.playing?.voiceId === voice.id && viewModel.playing.sampleId === sample.id} onClick={() => onPlay(voice.id, sample.id)}>{sample.label}</button>)}
        </div>
        <button type="button" aria-pressed={voice.selected} onClick={() => onSelect(voice.id)}>{voice.selected ? '已选择' : '这个音色自然'}</button>
      </li>)}
    </ol> : null}
    <button type="button" onClick={onRefresh}>刷新音色列表</button>
  </main>
}
