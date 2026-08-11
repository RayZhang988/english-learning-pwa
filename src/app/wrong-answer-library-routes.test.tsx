import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { speakingPrompt } from '../features/speaking/test-fixtures.ts'
import { dictationQuestion } from '../features/listening/test-fixtures.ts'
import type { SpeakingWrongAnswerReviewView } from '../features/speaking/index.ts'
import type { WrongAnswerReviewActive, WrongAnswerReviewCoordinator } from './wrong-answer-review-coordinator.ts'
import {
  ListeningReviewQuestionSlot,
  SpeakingReviewQuestionSlot,
} from './wrong-answer-library-routes.tsx'

function active(view: SpeakingWrongAnswerReviewView): Extract<WrongAnswerReviewActive, { kind: 'speaking' }> {
  return { kind: 'speaking', record: {} as Extract<WrongAnswerReviewActive, { kind: 'speaking' }>['record'], view }
}

const coordinator = {} as WrongAnswerReviewCoordinator
const baseView: SpeakingWrongAnswerReviewView = {
  library: {} as SpeakingWrongAnswerReviewView['library'],
  round: null,
  record: null,
  prompt: speakingPrompt,
  stage: 'answering',
  feedback: null,
  recordingAvailable: false,
  unscorable: false,
  mediaStatus: 'idle',
  advancing: false,
}

describe('SpeakingReviewQuestionSlot', () => {
  it('hides the target translation before recording and reveals it with scored feedback', () => {
    const before = renderToStaticMarkup(<SpeakingReviewQuestionSlot active={active(baseView)} coordinator={coordinator} disabled={false} />)
    expect(before).not.toContain('中文翻译')
    expect(before).not.toContain(speakingPrompt.modelAnswerTranslationZh)

    const after = renderToStaticMarkup(<SpeakingReviewQuestionSlot active={active({
      ...baseView,
      stage: 'feedback',
      feedback: { transcript: speakingPrompt.modelAnswer, match: { level: 'match', similarity: 1, transcript: speakingPrompt.modelAnswer, normalizedTranscript: "i'm from shanghai", closestAcceptedAnswer: speakingPrompt.modelAnswer, normalizedAcceptedAnswer: "i'm from shanghai" } },
      recordingAvailable: true,
    })} coordinator={coordinator} disabled />)
    expect(after).toContain('参考回答')
    expect(after).toContain('中文翻译')
    expect(after).toContain(speakingPrompt.modelAnswerTranslationZh)
  })

  it('reveals the target translation after an unscorable recording without inventing recognized text', () => {
    const markup = renderToStaticMarkup(<SpeakingReviewQuestionSlot active={active({
      ...baseView,
      recordingAvailable: true,
      unscorable: true,
    })} coordinator={coordinator} disabled={false} />)
    expect(markup).toContain('本次录音无法识别，未计入评分')
    expect(markup).toContain('参考回答')
    expect(markup).toContain('中文翻译')
    expect(markup).toContain(speakingPrompt.modelAnswerTranslationZh)
    expect(markup).not.toContain('识别文本')
  })
})

describe('ListeningReviewQuestionSlot', () => {
  it('shows published dictation guidance before submission without showing the answer', () => {
    const listening = {
      kind: 'listening' as const,
      record: {} as Extract<WrongAnswerReviewActive, { kind: 'listening' }>['record'],
      snapshot: {
        question: dictationQuestion,
        dictationInput: '',
        playback: {
          status: 'idle' as const,
          rate: 1 as const,
          repeatMode: 'none' as const,
          currentSegmentId: dictationQuestion.primarySegmentId,
          playCounts: {},
          completedPlayCounts: {},
          errorMessage: null,
        },
      },
    } as Extract<WrongAnswerReviewActive, { kind: 'listening' }>
    const markup = renderToStaticMarkup(
      <ListeningReviewQuestionSlot
        active={listening}
        coordinator={coordinator}
        phase="answering"
        disabled={false}
      />,
    )

    expect(markup).toContain('本题作答提示')
    expect(markup).toContain('填写内容')
    expect(markup).toContain('地点名')
    expect(markup).toContain(dictationQuestion.answerGuidance.guidanceZh)
    expect(markup).not.toContain(dictationQuestion.standardAnswer)
  })
})
