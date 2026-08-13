import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { browserListeningSpeech } from '../../features/listening/index.ts'
import type { AbilityDomain, GrowthUpgradeDisplayEvidence, GrowthUpgradeResult } from '../../learning-engine/index.ts'
import { ErrorState, LoadingState } from '../../ui/index.ts'
import type { GrowthUpgradeSessionViewModel } from './growth-production.ts'
import { useLearningApp } from './learning-app-context.ts'

const domains = new Set<AbilityDomain>(['vocabulary', 'listening', 'speaking'])
const readableDomain = (domain: AbilityDomain) => ({ vocabulary: '词汇', listening: '听力', speaking: '口语' })[domain]

/** R17 production route. It renders only persisted 01/04 state and forwards intent. */
export function GrowthUpgradeRouteHost() {
  const { domain: rawDomain } = useParams()
  const navigate = useNavigate()
  const { coordinator } = useLearningApp()
  const domain = domains.has(rawDomain as AbilityDomain) ? rawDomain as AbilityDomain : null
  const [view, setView] = useState<GrowthUpgradeSessionViewModel | null>(null)
  const [result, setResult] = useState<GrowthUpgradeResult | null>(null)
  const [draft, setDraft] = useState('')
  const [dismissedFeedback, setDismissedFeedback] = useState(false)
  const [media, setMedia] = useState<Awaited<ReturnType<typeof coordinator.growth.speakingUpgradeMedia>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const reload = useCallback(async () => {
    if (!domain) return
    setBusy(true); setError(null)
    try {
      try {
        const next = await coordinator.growth.upgradeSession(domain)
        setView(next); setResult(null); setDraft(next.draft ?? ''); setDismissedFeedback(false)
        if (domain === 'speaking') setMedia(await coordinator.growth.speakingUpgradeMedia())
      } catch (sessionError) {
        const completed = await coordinator.growth.upgradeResult(domain)
        if (!completed) throw sessionError
        setView(null); setResult(completed); setMedia(null)
      }
    } catch (cause) { setError(cause instanceof Error ? cause : new Error('无法恢复升级测试。')) } finally { setBusy(false) }
  }, [domain, coordinator])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => domain === 'speaking' ? coordinator.growth.subscribeSpeakingUpgradeMedia(setMedia) : undefined, [domain, coordinator])

  if (!domain) return <ErrorState title="升级测试不存在" description="请选择词汇、听力或口语测试。" onRetry={() => navigate('/')} />
  if (error) return <ErrorState title="升级测试暂时无法继续" description={error.message} onRetry={() => void reload()} />
  if (result) return <UpgradeResult result={result} busy={busy} onAcknowledge={() => {
    setBusy(true)
    void coordinator.growth.acknowledgeUpgradeResult({ eventId: `growth-result-ack:${domain}:${crypto.randomUUID()}`, domain, sessionId: result.sessionId }).then(
      () => coordinator.initialize(),
    ).then(() => navigate('/?section=progress'), (cause) => setError(cause instanceof Error ? cause : new Error('结果确认失败。'))).finally(() => setBusy(false))
  }} />
  if (!view) return <LoadingState label="正在恢复升级测试" />
  const feedback = dismissedFeedback ? null : view.feedback
  const submit = async () => {
    setBusy(true); setError(null)
    try {
      if (domain === 'speaking') {
        await coordinator.growth.stopSpeakingUpgradeRecording({ eventId: `growth-speaking:${crypto.randomUUID()}`, answeredAt: new Date().toISOString() })
      } else {
        const answer = domain === 'vocabulary' ? { domain, selectedOptionId: draft } as const : { domain, response: draft } as const
        await coordinator.growth.submitUpgradeSessionAnswer({ eventId: `growth-answer:${domain}:${crypto.randomUUID()}`, domain, answer, answeredAt: new Date().toISOString() })
      }
      await reload()
    } catch (cause) { setError(cause instanceof Error ? cause : new Error('答案保存失败。')) } finally { setBusy(false) }
  }
  const question = view.question
  return <main className="training-shell" aria-label={`${readableDomain(domain)}升级测试`}>
    <header className="training-header"><button type="button" className="text-button" disabled={busy} onClick={() => { coordinator.growth.exitSpeakingUpgradeSession(); navigate('/') }}>退出并保存</button><span>升级测试 · {view.targetLevelLabel}</span><strong>第 {view.index + 1}/{view.total} 题</strong></header>
    <section className="training-card">
      {question.domain === 'vocabulary' ? <VocabularyQuestion question={question.question} draft={draft} setDraft={setDraft} disabled={busy || feedback !== null} /> : null}
      {question.domain === 'listening' ? <ListeningQuestion question={question.question} draft={draft} setDraft={setDraft} disabled={busy || feedback !== null} /> : null}
      {question.domain === 'speaking' ? <SpeakingQuestion media={media} busy={busy} onStart={() => void coordinator.growth.startSpeakingUpgradeRecording()} onRetryRecognition={() => void coordinator.growth.retrySpeakingUpgradeRecognition()} onRecordAgain={() => void coordinator.growth.recordSpeakingUpgradeAgain()} onPlayRecording={() => void coordinator.growth.playSpeakingUpgradeRecording()} onPlayReference={() => void coordinator.growth.playSpeakingUpgradeReference()} /> : null}
      {feedback ? <Feedback evidence={feedback} /> : null}
      {feedback ? <button type="button" className="secondary-button" onClick={() => setDismissedFeedback(true)}>下一题</button> : question.domain === 'speaking' ? <button type="button" className="primary-button" disabled={busy || media?.status !== 'capturing'} onClick={() => void submit()}>停止录音并识别</button> : <button type="button" className="primary-button" disabled={busy || !draft} onClick={() => void submit()}>提交答案</button>}
    </section>
  </main>
}

function VocabularyQuestion({ question, draft, setDraft, disabled }: { readonly question: Extract<GrowthUpgradeSessionViewModel['question'], { domain: 'vocabulary' }>['question']; readonly draft: string; readonly setDraft: (value: string) => void; readonly disabled: boolean }) {
  return <><p>{question.instructionZh}</p><h1 lang={question.promptLocale}>{question.prompt}</h1>{question.partOfSpeech ? <p>{question.partOfSpeech}</p> : null}{question.options.map((option) => <button key={option.id} type="button" className={draft === option.id ? 'primary-button' : 'secondary-button'} aria-pressed={draft === option.id} disabled={disabled} onClick={() => setDraft(option.id)}>{option.label}</button>)}</>
}

function ListeningQuestion({ question, draft, setDraft, disabled }: { readonly question: Extract<GrowthUpgradeSessionViewModel['question'], { domain: 'listening' }>['question']; readonly draft: string; readonly setDraft: (value: string) => void; readonly disabled: boolean }) {
  const speak = () => { const segment = question.playback.segments.find((item) => item.id === question.playback.primarySegmentId) ?? question.playback.segments[0]; if (segment) browserListeningSpeech.speak({ text: segment.text, locale: 'en-US', rate: 1, usePreferredDeviceVoice: true }, {}) }
  return <><h1>{question.question.prompt}</h1><button type="button" className="secondary-button" onClick={speak}>播放音频</button>{question.question.kind === 'single-choice' ? question.question.options.map((option) => <button key={option.id} type="button" className={draft === option.id ? 'primary-button' : 'secondary-button'} aria-pressed={draft === option.id} disabled={disabled} onClick={() => setDraft(option.id)}>{option.label}</button>) : <><p>{question.question.requirements.countLabel}</p><p>{question.question.requirements.orderLabel}</p><p>{question.question.requirements.formatLabel}</p><input aria-label="听写答案" disabled={disabled} value={draft} onChange={(event) => setDraft(event.target.value)} /></>}</>
}

function SpeakingQuestion({ media, busy, onStart, onRetryRecognition, onRecordAgain, onPlayRecording, onPlayReference }: { readonly media: Awaited<ReturnType<import('./growth-production.ts').GrowthProductionCoordinator['speakingUpgradeMedia']>> | null; readonly busy: boolean; readonly onStart: () => void; readonly onRetryRecognition: () => void; readonly onRecordAgain: () => void; readonly onPlayRecording: () => void; readonly onPlayReference: () => void }) {
  if (!media) return <LoadingState label="正在准备口语题" />
  return <><p lang="en">{media.prompt.partnerLine}</p><h1>{media.prompt.cueZh}</h1><p aria-live="polite">{media.message}</p>{media.submission?.contentMatch.state === 'unscorable' ? <section aria-live="polite"><h2>本次无法识别，不计入分数</h2><p>{media.submission.contentMatch.message}</p><p>目标表达：<span lang="en">{media.submission.contentMatch.targetText}</span></p></section> : null}<button type="button" className="primary-button" disabled={busy || media.busy || media.status === 'capturing'} onClick={onStart}>开始录音</button>{media.recordingAvailable ? <button type="button" className="secondary-button" onClick={onPlayRecording}>播放录音</button> : null}{media.referenceText ? <button type="button" className="secondary-button" onClick={onPlayReference}>播放示范原句</button> : null}{media.retryable ? <><button type="button" className="secondary-button" onClick={onRetryRecognition}>重试识别</button><button type="button" className="secondary-button" onClick={onRecordAgain}>重新录音</button></> : null}</>
}

export function Feedback({ evidence }: { readonly evidence: GrowthUpgradeDisplayEvidence }) {
  if (evidence.domain === 'vocabulary') return <section aria-live="polite"><h2>{evidence.feedback.title}</h2><p>{evidence.feedback.description}</p>{evidence.feedback.exampleEn ? <p lang="en">{evidence.feedback.exampleEn}</p> : null}{evidence.feedback.explanationZh ? <p>{evidence.feedback.explanationZh}</p> : null}</section>
  if (evidence.domain === 'listening') return <section aria-live="polite"><h2>{evidence.feedback.title}</h2><p>{evidence.feedback.description}</p>{evidence.disclosure.choiceTranslations ? <ul>{evidence.disclosure.choiceTranslations.map((item) => <li key={item.id}>{item.translationZh ?? '暂无中文翻译'}</li>)}</ul> : null}{evidence.disclosure.dictationReview ? <><p>你的输入：{evidence.disclosure.dictationReview.response}</p><p>参考答案：{evidence.disclosure.dictationReview.standardAnswer}</p><p>目标关键词：{evidence.disclosure.dictationReview.targetKeywords.join('、')}</p></> : null}<p>{evidence.disclosure.rationaleZh}</p>{evidence.disclosure.transcript.map((line, index) => <p key={index} lang="en">{line.text}{line.translationZh ? ` · ${line.translationZh}` : ''}</p>)}</section>
  const submission = evidence.submission
  return <section aria-live="polite"><h2>{submission.scorable ? (submission.correct ? '内容匹配' : '内容需要调整') : '本次无法识别'}</h2><p>目标表达：<span lang="en">{submission.targetText}</span></p><p>中文提示：{submission.targetTranslationZh}</p>{submission.recognizedText ? <p>识别文本：<span lang="en">{submission.recognizedText}</span></p> : null}{submission.matchLevel ? <p>内容匹配：{submission.matchLevel}</p> : null}{submission.message ? <p>{submission.message}</p> : null}</section>
}

function UpgradeResult({ result, busy, onAcknowledge }: { readonly result: GrowthUpgradeResult; readonly busy: boolean; readonly onAcknowledge: () => void }) {
  return <main className="training-shell" aria-label="升级测试结果"><section className="training-card"><p>升级测试结果</p><h1>{result.passed ? '升级成功' : '本次未通过'}</h1><p>{result.score.correctCount}/{result.total} 题正确</p>{result.passed ? <p>等级：{R17_LABELS[result.previousLevelOrdinal]} → {R17_LABELS[result.resultingLevelOrdinal]}；新等级成长进度从 0% 开始。</p> : <p>等级保持在 {R17_LABELS[result.previousLevelOrdinal]}；再完成 {result.cooldownRequired} 次正式训练后可以重试。</p>}<button type="button" className="primary-button" disabled={busy} onClick={onAcknowledge}>返回进度</button></section></main>
}

const R17_LABELS = ['幼儿园', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三', '大学四级', '大学六级'] as const
