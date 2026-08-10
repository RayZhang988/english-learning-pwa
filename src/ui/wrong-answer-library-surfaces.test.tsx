import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WrongAnswerLibraryEntry, WrongAnswerLibraryScreen, WrongAnswerReviewScreen, type WrongAnswerLibraryViewModel } from './wrong-answer-library-surfaces.tsx'

const record = { id: 'r', summary: 'passport 是什么意思？', sourceLabel: '场景·机场', incorrectCount: 3, lastIncorrectAtLabel: '今天 10:20', consecutiveCorrect: 1 as const }
const ready = (more: Partial<WrongAnswerLibraryViewModel> = {}): WrongAnswerLibraryViewModel => ({ status: 'ready', activeCount: 1, selectedTab: 'active', activeRecords: [record], historyRecords: [], canStart: true, hasResumableRound: false, ...more })

describe('WrongAnswerLibrary R13-D display contract', () => {
  it('keeps a single visible entry even with zero records', () => {
    const onOpen = vi.fn()
    const entry = WrongAnswerLibraryEntry({ status: 'ready', activeCount: 0, onOpen })
    const markup = renderToStaticMarkup(entry)
    expect(markup).toContain('错题库')
    expect(markup).toContain('暂无待复习错题')
    entry.props.onClick()
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
  it('renders active facts without leaking an answer and exposes only supplied intents', () => {
    const start = vi.fn(); const switchTab = vi.fn()
    const screen = WrongAnswerLibraryScreen({ viewModel: ready(), onExit: vi.fn(), onSwitchTab: switchTab, onStartRound: start, onResumeRound: vi.fn(), onRetry: vi.fn() })
    const markup = renderToStaticMarkup(screen)
    expect(markup).toContain('累计答错</dt><dd>3 次')
    expect(markup).toContain('连续答对</dt><dd>1/2')
    expect(markup).not.toContain('护照')
    expect(markup).toContain('开始复习')
    expect(markup).toContain('aria-controls="wrong-answer-panel-active"')
    expect(markup).toContain('aria-labelledby="wrong-answer-tab-active"')
  })
  it('renders loading, error, active empty and history empty states honestly', () => {
    const callbacks = { onExit: vi.fn(), onSwitchTab: vi.fn(), onStartRound: vi.fn(), onResumeRound: vi.fn(), onRetry: vi.fn() }
    expect(renderToStaticMarkup(<WrongAnswerLibraryScreen {...callbacks} viewModel={ready({ status: 'loading' })} />)).toContain('正在读取错题库')
    expect(renderToStaticMarkup(<WrongAnswerLibraryScreen {...callbacks} viewModel={ready({ status: 'error', error: { title: '读取失败', description: '网络不可用' } })} />)).toContain('读取失败')
    expect(renderToStaticMarkup(<WrongAnswerLibraryScreen {...callbacks} viewModel={ready({ activeCount: 0, activeRecords: [] })} />)).toContain('暂无待复习错题')
    expect(renderToStaticMarkup(<WrongAnswerLibraryScreen {...callbacks} viewModel={ready({ selectedTab: 'history', historyRecords: [] })} />)).toContain('还没有历史记录')
  })
  it('shows supplied review numbers, unscorable honesty, and feedback consequences', () => {
    const common = { onExit: vi.fn(), onSubmit: vi.fn(), onAdvance: vi.fn(), onRetry: vi.fn(), onNewRound: vi.fn() }
    const unscorable = renderToStaticMarkup(<WrongAnswerReviewScreen {...common} viewModel={{ phase: 'unscorable', answeredCount: 2, correctCount: 1, accuracy: .5, remainingCount: 4, questionSlot: { kind: 'speaking', content: <p>原口语题</p> } }} />)
    expect(unscorable).toContain('正确率</dt><dd>50%')
    expect(unscorable).toContain('本题暂时无法评分')
    expect(unscorable).toContain('不会被记为错题')
    expect(unscorable).toContain('原口语题')
    const moved = renderToStaticMarkup(<WrongAnswerReviewScreen {...common} viewModel={{ phase: 'feedback', answeredCount: 2, correctCount: 2, accuracy: 1, remainingCount: 0, feedback: { outcome: 'moved-to-history', consecutiveCorrect: 2, message: '已移入历史' }, questionSlot: { kind: 'vocabulary', content: <p>题面</p> }, primaryAction: { label: '下一题', disabled: false } }} />)
    expect(moved).toContain('已连续答对 2 次，已移入历史记录。')
    expect(moved).not.toContain('15分钟')
  })
  it('renders all feedback and terminal states from supplied facts without fixed sequence copy', () => {
    const common = { onExit: vi.fn(), onSubmit: vi.fn(), onAdvance: vi.fn(), onRetry: vi.fn(), onNewRound: vi.fn() }
    const render = (phase: 'feedback' | 'saving' | 'error' | 'round-completed') => renderToStaticMarkup(<WrongAnswerReviewScreen {...common} viewModel={phase === 'feedback' ? { phase, answeredCount: 7, correctCount: 3, accuracy: .428, remainingCount: 8, feedback: { outcome: 'incorrect', consecutiveCorrect: 0, message: '回答不正确' }, questionSlot: { kind: 'listening', content: <p>听写题</p> }, primaryAction: { label: '下一题', disabled: false } } : phase === 'saving' ? { phase, answeredCount: 7, correctCount: 3, accuracy: .428, remainingCount: 8, questionSlot: { kind: 'speaking', content: <p>录音题</p> } } : phase === 'error' ? { phase, answeredCount: 7, correctCount: 3, accuracy: .428, remainingCount: 8, error: { title: '保存失败', description: '可重试' } } : { phase, answeredCount: 7, correctCount: 3, accuracy: .428, remainingCount: 0, newRoundAction: { label: '开始新一轮', disabled: false } } } />)
    expect(render('feedback')).toContain('连续答对已归零。')
    expect(render('saving')).toContain('aria-busy="true"')
    expect(render('saving')).toContain('正在保存本题结果')
    expect(render('error')).toContain('保存失败')
    expect(render('round-completed')).toContain('开始新一轮')
    const all = `${render('feedback')}${render('saving')}${render('error')}${render('round-completed')}`
    expect(all).not.toContain('3/3')
    expect(all).not.toContain('固定顺序')
  })
  it('does not invent history time or a new round action, and locks exit while saving', () => {
    const callbacks = { onExit: vi.fn(), onSwitchTab: vi.fn(), onStartRound: vi.fn(), onResumeRound: vi.fn(), onRetry: vi.fn() }
    const history = renderToStaticMarkup(<WrongAnswerLibraryScreen {...callbacks} viewModel={ready({ selectedTab: 'history', historyRecords: [{ ...record, consecutiveCorrect: 0 }] })} />)
    expect(history).not.toContain('移入历史：')
    const common = { onExit: vi.fn(), onSubmit: vi.fn(), onAdvance: vi.fn(), onRetry: vi.fn(), onNewRound: vi.fn() }
    const completed = renderToStaticMarkup(<WrongAnswerReviewScreen {...common} viewModel={{ phase: 'round-completed', answeredCount: 1, correctCount: 1, accuracy: 1, remainingCount: 0 }} />)
    expect(completed).not.toContain('开始新一轮')
    const saving = renderToStaticMarkup(<WrongAnswerReviewScreen {...common} viewModel={{ phase: 'saving', answeredCount: 0, correctCount: 0, accuracy: null, remainingCount: 1, questionSlot: { kind: 'listening', content: <p>原题</p> } }} />)
    expect(saving).toContain('disabled="" aria-label="退出错题复习"')
    expect(saving).toContain('原题')
  })
})
