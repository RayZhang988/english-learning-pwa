import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  SpeakingTrainingScreen,
  type SpeakingScreenViewModel,
} from './practice-screens.tsx'

function viewModel(
  contentMatch?: SpeakingScreenViewModel['contentMatch'],
): SpeakingScreenViewModel {
  return {
    header: {
      eyebrow: '口语学习',
      title: '口语训练',
      progress: { label: '已完成 1 / 2', value: 50 },
    },
    instruction: '听到对方的话后，用完整但简短的句子回答。',
    prompt: 'Respond in English',
    cueZh: '介绍自己来自哪里。',
    partnerLine: 'Where are you from?',
    modelAnswer: "I'm from Shanghai.",
    contentMatch,
    recorder: {
      status: 'review',
      statusLabel: '录音完成',
      playbackAvailable: true,
    },
    feedback: {
      tone: 'info',
      title: '已完成有限内容匹配',
      description: '这里只比较课程目标内容。',
    },
    action: { label: '下一题' },
  }
}

function screen(contentMatch?: SpeakingScreenViewModel['contentMatch']) {
  return renderToStaticMarkup(
    <SpeakingTrainingScreen
      viewModel={viewModel(contentMatch)}
      onExit={() => undefined}
      onRecorderAction={() => undefined}
      onPlayback={() => undefined}
      onAction={() => undefined}
    />,
  )
}

describe('SpeakingTrainingScreen R8 content comparison', () => {
  it('renders target and recognized text as separate reader-facing fields', () => {
    const markup = screen({
      state: 'recognized',
      targetText: "I'm from Shanghai.",
      targetTranslationZh: '我来自上海。',
      recognizedText: 'I am Shanghai',
      level: 'partial',
      resultLabel: '只匹配到部分内容',
      guidance: '建议对照目标表达再说一次。',
    })

    expect(markup).toContain('data-content-match-state="recognized"')
    expect(markup).toContain('data-content-match-level="partial"')
    expect(markup).toContain('目标表达')
    expect(markup).toContain('I&#x27;m from Shanghai.')
    expect(markup).toContain('中文翻译')
    expect(markup).toContain('我来自上海。')
    expect(markup).toContain('实际识别')
    expect(markup).toContain('I am Shanghai')
    expect(markup).toContain('只匹配到部分内容')
    expect(markup).toContain('不是发音、口音或流利度评分')
  })

  it('does not invent recognized text when recognition is unavailable', () => {
    const markup = screen({
      state: 'unscorable',
      targetText: "I'm from Shanghai.",
      targetTranslationZh: '我来自上海。',
      recognizedText: null,
      resultLabel: '本次无法判断内容是否说对',
      guidance: '录音已经保留，请回放并对照目标表达自查。',
    })

    expect(markup).toContain('data-content-match-state="unscorable"')
    expect(markup).toContain('本次没有得到可用的识别文本')
    expect(markup).toContain('本次无法判断内容是否说对')
    expect(markup).toContain('中文翻译')
    expect(markup).toContain('我来自上海。')
    expect(markup).not.toContain('data-content-match-level=')
  })

  it('does not show a result panel before an answer exists', () => {
    const markup = screen()

    expect(markup).not.toContain('口语内容匹配结果')
    expect(markup).not.toContain('data-content-match-state=')
    expect(markup).not.toContain('中文翻译')
    expect(markup).not.toContain('我来自上海。')
  })

  it('groups my recording and the original sentence as separate comparison controls after recording', () => {
    const markup = renderToStaticMarkup(
      <SpeakingTrainingScreen
        viewModel={{
          ...viewModel(),
          secondaryActionLabel: '播放示范原句',
        }}
        onExit={() => undefined}
        onRecorderAction={() => undefined}
        onPlayback={() => undefined}
        onSecondaryAction={() => undefined}
        onAction={() => undefined}
      />,
    )

    expect(markup).toContain('录音对比播放')
    expect(markup).toContain('播放我的录音')
    expect(markup).toContain('播放示范原句')
  })

  it('disables both comparison controls while a comparison playback is busy', () => {
    const markup = renderToStaticMarkup(
      <SpeakingTrainingScreen
        viewModel={{
          ...viewModel(),
          secondaryActionLabel: '播放示范原句',
          recorder: {
            status: 'processing',
            statusLabel: '正在处理',
            description: '正在播放示范原句。',
            playbackAvailable: true,
          },
        }}
        onExit={() => undefined}
        onRecorderAction={() => undefined}
        onPlayback={() => undefined}
        onSecondaryAction={() => undefined}
        onAction={() => undefined}
      />,
    )

    expect(markup).toContain('正在播放示范原句')
    expect(markup).toMatch(/播放我的录音<\/button>/)
    expect(markup).toMatch(/播放示范原句<\/button>/)
    expect((markup.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})
