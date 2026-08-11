import { Children, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ChoiceList,
  KeywordDictationField,
  ListeningTrainingScreen,
  type ListeningQuestionInputIntent,
  type ListeningScreenViewModel,
  type ListeningTrainingScreenCallbacks,
} from './index.ts'

const commonViewModel = {
  header: {
    eyebrow: 'LISTENING',
    title: '听力训练',
    progress: { label: '2 / 6', value: 34 },
  },
  instruction: '听一遍，然后完成题目',
  player: {
    status: 'paused',
    elapsedLabel: '00:12',
    durationLabel: '00:28',
    progressValue: 43,
    rateLabel: '速度 1×',
    playCountLabel: '已播放 1 / 2',
    statusLabel: '已暂停',
  },
  playbackControls: {
    rate: {
      label: '播放速度',
      currentValue: 1,
      options: [
        { value: 0.75, label: '0.75×' },
        { value: 1, label: '1×' },
        { value: 1.25, label: '1.25×' },
      ],
    },
    segment: {
      label: '播放片段',
      currentId: 'segment-2',
      options: [
        { id: 'segment-1', label: '第 1 句' },
        { id: 'segment-2', label: '第 2 句' },
      ],
    },
    repeat: {
      label: '重复方式',
      currentMode: 'segment',
      options: [
        { value: 'none', label: '不重复' },
        { value: 'segment', label: '当前句' },
        { value: 'all', label: '全文' },
      ],
    },
  },
  action: { label: '确认' },
} as const

function createCallbacks(
  intents: ListeningQuestionInputIntent[] = [],
): ListeningTrainingScreenCallbacks {
  return {
    onExit: () => undefined,
    onToggleAudio: () => undefined,
    onPlaybackRateChange: () => undefined,
    onSegmentChange: () => undefined,
    onRepeatModeChange: () => undefined,
    onQuestionInput: (intent) => intents.push(intent),
    onAction: () => undefined,
  }
}

function screenChildren(viewModel: ListeningScreenViewModel) {
  const element = ListeningTrainingScreen({
    viewModel,
    ...createCallbacks(),
  })

  return Children.toArray(
    (element.props as { readonly children: ReactNode }).children,
  )
}

describe('ListeningTrainingScreen UI contract', () => {
  it('hides every choice until one full playback has completed', () => {
    const viewModel: ListeningScreenViewModel = {
      ...commonViewModel,
      question: {
        kind: 'single-choice',
        available: false,
        waitingLabel: '请先完整播放一次，播放结束后显示英文选项。',
        prompt: '选择你听到的信息',
        choices: [
          {
            id: 'choice-a',
            label: 'The taxi is outside.',
            supportingText: '出租车在外面。',
            state: 'default',
          },
        ],
      },
    }

    const markup = renderToStaticMarkup(
      <ListeningTrainingScreen
        viewModel={viewModel}
        {...createCallbacks()}
      />,
    )

    expect(markup).toContain('请先完整播放一次')
    expect(markup).not.toContain('role="radiogroup"')
    expect(markup).not.toContain('The taxi is outside.')
    expect(markup).not.toContain('出租车在外面。')
  })

  it('renders English and submitted Chinese translations as separate lines', () => {
    const viewModel: ListeningScreenViewModel = {
      ...commonViewModel,
      question: {
        kind: 'single-choice',
        available: true,
        prompt: '选择你听到的信息',
        choices: [
          {
            id: 'choice-a',
            label: 'The taxi is outside.',
            supportingText: '出租车在外面。',
            state: 'correct',
          },
          {
            id: 'choice-b',
            label: 'The bus is delayed.',
            supportingText: '公交车晚点了。',
            state: 'incorrect',
          },
        ],
      },
    }

    const markup = renderToStaticMarkup(
      <ListeningTrainingScreen
        viewModel={viewModel}
        {...createCallbacks()}
      />,
    )

    expect(markup).toContain('The taxi is outside.')
    expect(markup).toContain('出租车在外面。')
    expect(markup).toContain('The bus is delayed.')
    expect(markup).toContain('公交车晚点了。')
  })

  it('renders accessible speed, segment and repeat controls', () => {
    const viewModel: ListeningScreenViewModel = {
      ...commonViewModel,
      question: {
        kind: 'single-choice',
        available: true,
        prompt: '对话中的客人想做什么？',
        choices: [
          { id: 'check-in', label: '办理入住', state: 'selected' },
          { id: 'change-flight', label: '更换航班', state: 'default' },
        ],
      },
    }

    const markup = renderToStaticMarkup(
      <ListeningTrainingScreen
        viewModel={viewModel}
        {...createCallbacks()}
      />,
    )

    expect(markup).toContain('<legend>播放速度</legend>')
    expect(markup).toContain('checked="" value="1"')
    expect(markup).toContain('<option value="segment-2" selected="">')
    expect(markup).toContain('<legend>重复方式</legend>')
    expect(markup).toContain('当前句')
    expect(markup).toContain('role="radiogroup"')
  })

  it('keeps single-choice input behind a discriminated intent', () => {
    const intents: ListeningQuestionInputIntent[] = []
    const viewModel: ListeningScreenViewModel = {
      ...commonViewModel,
      question: {
        kind: 'single-choice',
        available: true,
        prompt: '选择你听到的信息',
        choices: [
          { id: 'choice-a', label: 'A', state: 'default' },
          { id: 'choice-b', label: 'B', state: 'default' },
        ],
      },
    }
    const element = ListeningTrainingScreen({
      viewModel,
      ...createCallbacks(intents),
    })
    const choiceList = Children.toArray(
      (element.props as { readonly children: ReactNode }).children,
    ).find(
      (child) => isValidElement(child) && child.type === ChoiceList,
    )

    expect(isValidElement(choiceList)).toBe(true)
    if (isValidElement<{ readonly onSelect: (id: string) => void }>(choiceList)) {
      choiceList.props.onSelect('choice-b')
    }

    expect(intents).toEqual([
      { type: 'select-choice', choiceId: 'choice-b' },
    ])
  })

  it('renders keyword dictation value, placeholder, disabled and submission state', () => {
    const viewModel: ListeningScreenViewModel = {
      ...commonViewModel,
      question: {
        kind: 'keyword-dictation',
        prompt: '输入你听到的关键词',
        requirements: {
          targetLabel: '写出预订人数和预订姓氏。',
          countLabel: '需要填写 2 项关键信息。',
          orderLabel: '必须按照音频中出现的顺序填写。',
          formatLabel: '输入一条英文短语，用空格连接。',
        },
        answerGuidance: {
          answerType: 'reservation-details',
          guidanceZh: '填写听到的预订信息；使用英文单词输入。',
          acceptedInputFormats: ['english-words'],
        },
        textInput: {
          label: '关键词',
          value: 'reservation',
          placeholder: '输入英文关键词',
          disabled: true,
          state: 'submitting',
          description: '只填写题目要求的关键词。',
          statusLabel: '正在提交听写内容',
        },
        review: {
          response: 'three Wu',
          standardAnswer: 'three under Wu',
          targetKeywords: ['three', 'Wu'],
          resultLabel: '回答正确',
        },
      },
    }

    const markup = renderToStaticMarkup(
      <ListeningTrainingScreen
        viewModel={viewModel}
        {...createCallbacks()}
      />,
    )

    expect(markup).toContain('data-state="submitting"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('value="reservation"')
    expect(markup).toContain('placeholder="输入英文关键词"')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('本题填写目标')
    expect(markup).toContain('写出预订人数和预订姓氏')
    expect(markup).toContain('听写填写规则')
    expect(markup).toContain('需要填写 2 项关键信息')
    expect(markup).toContain('必须按照音频中出现的顺序填写')
    expect(markup).toContain('关键词听写答案对照')
    expect(markup).toContain('你的输入')
    expect(markup).toContain('three Wu')
    expect(markup).toContain('参考答案')
    expect(markup).toContain('three under Wu')
    expect(markup).toContain('目标关键词（按顺序）')
    expect(markup).toContain('training-screen--input-action')
    expect(markup).not.toContain('role="radiogroup"')
  })

  it('shows what to enter and accepted formats before dictation is submitted without revealing the answer', () => {
    const viewModel: ListeningScreenViewModel = {
      ...commonViewModel,
      question: {
        kind: 'keyword-dictation',
        prompt: '写出听到的开始时间。',
        requirements: {
          targetLabel: '写出听到的开始时间。',
          countLabel: '需要填写 1 项关键信息。',
          orderLabel: '只有 1 项，不涉及先后顺序。',
          formatLabel: '输入一条英文短语。',
        },
        answerGuidance: {
          answerType: 'time',
          guidanceZh: '填写听到的开始时间；可使用英文数字词、阿拉伯数字或时钟时间。',
          acceptedInputFormats: ['english-words', 'digits', 'clock-time'],
        },
        textInput: {
          label: '听写答案',
          value: '',
          placeholder: '输入听到的关键词',
          disabled: false,
          state: 'empty',
        },
      },
    }

    const markup = renderToStaticMarkup(
      <ListeningTrainingScreen viewModel={viewModel} {...createCallbacks()} />,
    )

    expect(markup).toContain('本题作答提示')
    expect(markup).toContain('<dt>填写内容</dt><dd>时间</dd>')
    expect(markup).toContain('填写听到的开始时间；可使用英文数字词、阿拉伯数字或时钟时间。')
    expect(markup).toContain('<dt>可用输入格式</dt><dd>英文单词、阿拉伯数字、时钟时间</dd>')
    expect(markup).toContain('aria-describedby=')
    expect(markup).not.toContain('nine thirty')
  })

  it('emits keyword text changes without requiring choice data', () => {
    const intents: ListeningQuestionInputIntent[] = []
    const viewModel: ListeningScreenViewModel = {
      ...commonViewModel,
      question: {
        kind: 'keyword-dictation',
        prompt: '输入你听到的关键词',
        requirements: {
          targetLabel: '写出听到的姓。',
          countLabel: '需要填写 1 项关键信息。',
          orderLabel: '只有 1 项，不涉及先后顺序。',
          formatLabel: '输入一条英文短语。',
        },
        answerGuidance: {
          answerType: 'surname',
          guidanceZh: '填写听到的英文姓氏；使用英文单词输入。',
          acceptedInputFormats: ['english-words'],
        },
        textInput: {
          label: '关键词',
          value: '',
          placeholder: '输入英文关键词',
          disabled: false,
          state: 'empty',
        },
      },
    }
    const element = ListeningTrainingScreen({
      viewModel,
      ...createCallbacks(intents),
    })
    const dictationField = Children.toArray(
      (element.props as { readonly children: ReactNode }).children,
    ).find(
      (child) =>
        isValidElement(child) && child.type === KeywordDictationField,
    )

    expect(isValidElement(dictationField)).toBe(true)
    if (
      isValidElement<{ readonly onChange: (value: string) => void }>(
        dictationField,
      )
    ) {
      dictationField.props.onChange('reservation')
    }

    expect(intents).toEqual([
      {
        type: 'change-keyword-dictation',
        value: 'reservation',
      },
    ])
  })

  it('contains only question-specific answer controls in each variant', () => {
    const singleChoice: ListeningScreenViewModel = {
      ...commonViewModel,
      question: {
        kind: 'single-choice',
        available: true,
        prompt: '选择答案',
        choices: [{ id: 'a', label: 'A', state: 'default' }],
      },
    }
    const dictation: ListeningScreenViewModel = {
      ...commonViewModel,
      question: {
        kind: 'keyword-dictation',
        prompt: '填写关键词',
        requirements: {
          targetLabel: '写出听到的姓。',
          countLabel: '需要填写 1 项关键信息。',
          orderLabel: '只有 1 项，不涉及先后顺序。',
          formatLabel: '输入一条英文短语。',
        },
        answerGuidance: {
          answerType: 'surname',
          guidanceZh: '填写听到的英文姓氏；使用英文单词输入。',
          acceptedInputFormats: ['english-words'],
        },
        textInput: {
          label: '关键词',
          value: '',
          placeholder: '输入英文关键词',
          disabled: false,
          state: 'empty',
        },
      },
    }

    expect(
      screenChildren(singleChoice).some(
        (child) => isValidElement(child) && child.type === ChoiceList,
      ),
    ).toBe(true)
    expect(
      screenChildren(singleChoice).some(
        (child) =>
          isValidElement(child) && child.type === KeywordDictationField,
      ),
    ).toBe(false)
    expect(
      screenChildren(dictation).some(
        (child) => isValidElement(child) && child.type === ChoiceList,
      ),
    ).toBe(false)
    expect(
      screenChildren(dictation).some(
        (child) =>
          isValidElement(child) && child.type === KeywordDictationField,
      ),
    ).toBe(true)
  })
})
