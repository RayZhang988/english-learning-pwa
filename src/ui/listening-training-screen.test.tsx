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
  it('renders accessible speed, segment and repeat controls', () => {
    const viewModel: ListeningScreenViewModel = {
      ...commonViewModel,
      question: {
        kind: 'single-choice',
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
        textInput: {
          label: '关键词',
          value: 'reservation',
          placeholder: '输入英文关键词',
          disabled: true,
          state: 'submitting',
          description: '只填写题目要求的关键词。',
          statusLabel: '正在提交听写内容',
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
    expect(markup).toContain('training-screen--input-action')
    expect(markup).not.toContain('role="radiogroup"')
  })

  it('emits keyword text changes without requiring choice data', () => {
    const intents: ListeningQuestionInputIntent[] = []
    const viewModel: ListeningScreenViewModel = {
      ...commonViewModel,
      question: {
        kind: 'keyword-dictation',
        prompt: '输入你听到的关键词',
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
        prompt: '选择答案',
        choices: [{ id: 'a', label: 'A', state: 'default' }],
      },
    }
    const dictation: ListeningScreenViewModel = {
      ...commonViewModel,
      question: {
        kind: 'keyword-dictation',
        prompt: '填写关键词',
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
