import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { browserListeningSpeech } from '../../features/listening/index.ts'
import type { AbilityDomain } from '../../learning-engine/index.ts'
import { ErrorState, LoadingState } from '../../ui/index.ts'
import type { GrowthUpgradeSessionViewModel } from './growth-production.ts'
import { useLearningApp } from './learning-app-context.ts'

const domains = new Set<AbilityDomain>(['vocabulary', 'listening', 'speaking'])
function readableDomain(domain: AbilityDomain): string { return ({ vocabulary: '词汇', listening: '听力', speaking: '口语' })[domain] }

/** Production R17 route. It renders opaque 01 payloads and forwards user
 * intent only; no answer key, score or eligibility is calculated here. */
export function GrowthUpgradeRouteHost() {
  const { domain: rawDomain } = useParams()
  const navigate = useNavigate()
  const { coordinator } = useLearningApp()
  const domain = domains.has(rawDomain as AbilityDomain) ? rawDomain as AbilityDomain : null
  const [view, setView] = useState<GrowthUpgradeSessionViewModel | null>(null)
  const [draft, setDraft] = useState('')
  const [feedback, setFeedback] = useState<unknown>(null)
  const [media, setMedia] = useState<Awaited<ReturnType<typeof coordinator.growth.speakingUpgradeMedia>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const reload = useCallback(async () => {
    if (!domain) return
    setBusy(true); setError(null)
    try {
      const next = await coordinator.growth.upgradeSession(domain)
      setView(next); setDraft(next.draft ?? ''); setFeedback(null)
      if (domain === 'speaking') setMedia(await coordinator.growth.speakingUpgradeMedia())
    } catch (cause) { setError(cause instanceof Error ? cause : new Error('无法恢复升级测试。')) } finally { setBusy(false) }
  }, [domain, coordinator])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => domain === 'speaking' ? coordinator.growth.subscribeSpeakingUpgradeMedia(setMedia) : undefined, [domain, coordinator])

  if (!domain) return <ErrorState title="升级测试不存在" description="请选择词汇、听力或口语测试。" onRetry={() => navigate('/')} />
  if (error) return <ErrorState title="升级测试暂时无法继续" description={error.message} onRetry={() => void reload()} />
  if (!view) return <LoadingState label="正在恢复升级测试" />
  const submit = async () => {
    setBusy(true); setError(null)
    try {
      if (domain === 'speaking') {
        const outcome = await coordinator.growth.stopSpeakingUpgradeRecording({ eventId: `growth-speaking:${crypto.randomUUID()}`, answeredAt: new Date().toISOString() })
        setFeedback(outcome.feedback)
        return
      }
      const answer = domain === 'vocabulary' ? { domain, selectedOptionId: draft } as const : { domain, response: draft } as const
      const outcome = await coordinator.growth.submitUpgradeSessionAnswer({ eventId: `growth-answer:${domain}:${crypto.randomUUID()}`, domain, answer, answeredAt: new Date().toISOString() })
      setFeedback(outcome.feedback)
    } catch (cause) { setError(cause instanceof Error ? cause : new Error('答案保存失败。')) } finally { setBusy(false) }
  }
  const question = view.question
  return <main className="training-shell" aria-label={`${readableDomain(domain)}升级测试`}>
    <header className="training-header"><button type="button" className="text-button" disabled={busy} onClick={() => navigate('/')}>退出并保存</button><span>升级测试 · {view.targetLevelLabel}</span><strong>第 {view.index + 1}/{view.total} 题</strong></header>
    <section className="training-card">
      {question.domain === 'vocabulary' ? <>
        <p>{question.question.instructionZh}</p><h1>{question.question.prompt}</h1>
        {question.question.options.map((option) => <button key={option.id} type="button" className={draft === option.id ? 'primary-button' : 'secondary-button'} disabled={busy || feedback !== null} onClick={() => setDraft(option.id)}>{option.label}</button>)}
      </> : null}
      {question.domain === 'listening' ? <ListeningQuestion question={question.question} draft={draft} setDraft={setDraft} disabled={busy || feedback !== null} /> : null}
      {question.domain === 'speaking' ? <SpeakingQuestion media={media} busy={busy} onStart={() => void coordinator.growth.startSpeakingUpgradeRecording()} onRecordAgain={() => void coordinator.growth.recordSpeakingUpgradeAgain()} onPlayRecording={() => void coordinator.growth.playSpeakingUpgradeRecording()} onPlayReference={() => void coordinator.growth.playSpeakingUpgradeReference()} /> : null}
      {feedback ? <pre aria-live="polite">{JSON.stringify(feedback, null, 2)}</pre> : null}
      {question.domain === 'speaking' ? <button type="button" className="primary-button" disabled={busy || media?.status !== 'capturing'} onClick={() => void submit()}>停止录音并识别</button> : <button type="button" className="primary-button" disabled={busy || !draft || feedback !== null} onClick={() => void submit()}>提交答案</button>}
      {feedback && view.index < 9 ? <button type="button" className="secondary-button" onClick={() => void reload()}>下一题</button> : null}
      {feedback && view.index === 9 ? <button type="button" className="secondary-button" onClick={() => { void coordinator.initialize().finally(() => navigate('/?section=progress')) }}>查看测试结果</button> : null}
    </section>
  </main>
}

function ListeningQuestion({ question, draft, setDraft, disabled }: { readonly question: Extract<GrowthUpgradeSessionViewModel['question'], { domain: 'listening' }>['question']; readonly draft: string; readonly setDraft: (value: string) => void; readonly disabled: boolean }) {
  const speak = () => { const segment = question.playback.segments.find((item) => item.id === question.playback.primarySegmentId) ?? question.playback.segments[0]; if (segment) browserListeningSpeech.speak({ text: segment.text, locale: 'en-US', rate: 1, usePreferredDeviceVoice: true }, {}) }
  return <><h1>{question.question.prompt}</h1><button type="button" className="secondary-button" onClick={speak}>播放音频</button>{question.question.kind === 'single-choice' ? question.question.options.map((option) => <button key={option.id} type="button" className={draft === option.id ? 'primary-button' : 'secondary-button'} disabled={disabled} onClick={() => setDraft(option.id)}>{option.label}</button>) : <><p>{question.question.requirements.countLabel}</p><p>{question.question.requirements.orderLabel}</p><p>{question.question.requirements.formatLabel}</p><input aria-label="听写答案" disabled={disabled} value={draft} onChange={(event) => setDraft(event.target.value)} /></>}</>
}

function SpeakingQuestion({ media, busy, onStart, onRecordAgain, onPlayRecording, onPlayReference }: { readonly media: Awaited<ReturnType<import('./growth-production.ts').GrowthProductionCoordinator['speakingUpgradeMedia']>> | null; readonly busy: boolean; readonly onStart: () => void; readonly onRecordAgain: () => void; readonly onPlayRecording: () => void; readonly onPlayReference: () => void }) {
  if (!media) return <LoadingState label="正在准备口语题" />
  return <><p>{media.prompt.partnerLine}</p><h1>{media.prompt.cueZh}</h1><p>{media.status}</p><p>{media.message}</p><button type="button" className="primary-button" disabled={busy || media.busy || media.status === 'capturing'} onClick={onStart}>开始录音</button>{media.recordingAvailable ? <button type="button" className="secondary-button" onClick={onPlayRecording}>播放录音</button> : null}{media.referenceText ? <button type="button" className="secondary-button" onClick={onPlayReference}>播放示范原句</button> : null}{media.retryable ? <button type="button" className="secondary-button" onClick={onRecordAgain}>重新录音</button> : null}</>
}
