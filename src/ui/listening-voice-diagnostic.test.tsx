import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ListeningVoiceDiagnosticScreen } from './listening-voice-diagnostic.tsx'

describe('ListeningVoiceDiagnosticScreen', () => {
  it('shows every device voice with comparable word, sentence, and dialogue samples', () => {
    const markup = renderToStaticMarkup(
      <ListeningVoiceDiagnosticScreen
        viewModel={{
          status: 'ready',
          voices: [
            { id: 'Samantha', selected: false },
            { id: 'Ava Premium', selected: true },
          ],
          playing: null,
        }}
        onPlay={vi.fn()}
        onRefresh={vi.fn()}
        onSelect={vi.fn()}
        onExit={vi.fn()}
      />,
    )

    expect(markup).toContain('音色自然度测试')
    expect(markup).toContain('Samantha')
    expect(markup).toContain('Ava Premium')
    expect(markup).toContain('单词')
    expect(markup).toContain('短句')
    expect(markup).toContain('对话')
    expect(markup).toContain('已选择')
    expect(markup).toContain('会用于正式听力')
  })
})
