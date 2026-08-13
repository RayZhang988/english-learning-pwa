import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Feedback } from './growth-upgrade-route-host.tsx'

describe('Growth upgrade feedback', () => {
  it('renders vocabulary feedback without serializing an opaque object', () => {
    const markup = renderToStaticMarkup(<Feedback evidence={{ domain: 'vocabulary', feedback: { title: '回答正确', description: '完成', exampleEn: 'Hello.', explanationZh: '你好。' } }} />)
    expect(markup).toContain('回答正确')
    expect(markup).toContain('Hello.')
    expect(markup).not.toContain('JSON.stringify')
  })

  it('discloses listening translations and dictation guidance only in persisted feedback', () => {
    const markup = renderToStaticMarkup(<Feedback evidence={{ domain: 'listening', feedback: { title: '再听一遍', description: '完成' }, disclosure: { transcript: [{ text: 'The train leaves at noon.', translationZh: '火车中午出发。' }], rationaleZh: '关注时间。', dictationReview: { response: 'ten', standardAnswer: 'noon', targetKeywords: ['noon'] } } }} />)
    expect(markup).toContain('参考答案：noon')
    expect(markup).toContain('目标关键词：noon')
    expect(markup).toContain('火车中午出发。')
  })

  it('renders a speaking recognition failure honestly for retry', () => {
    const markup = renderToStaticMarkup(<Feedback evidence={{ domain: 'speaking', submission: { scorable: false, correct: null, retryable: true, recordingId: 'r1', durationMs: 1200, targetText: 'I need help.', targetTranslationZh: '我需要帮助。', message: '未识别到清晰语音。' } }} />)
    expect(markup).toContain('本次无法识别')
    expect(markup).toContain('未识别到清晰语音。')
    expect(markup).toContain('I need help.')
  })
})
