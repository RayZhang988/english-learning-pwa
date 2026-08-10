import { describe, expect, it, vi } from 'vitest'
import { applyWrongAnswerEvidence, createWrongAnswerLibraryState, startWrongAnswerReviewRound, type WrongAnswerLibraryState, type WrongAnswerLibraryStateTransform } from '../../learning-engine/index.ts'
import { speakingPrompt } from './test-fixtures.ts'
import type { SpeakingRecognitionHandle, SpeakingRecognitionOutcome, SpeakingRecording, SpeakingRecordingPort } from './types.ts'
import { SpeakingWrongAnswerReviewRuntime, createSpeakingWrongAnswerEvidence } from './wrong-answer.ts'

const now = '2026-08-04T00:00:00.000Z'
const recording: SpeakingRecording = { id: 'recording', blob: new Blob(['audio']), mimeType: 'audio/mp4', durationMs: 1000 }

function library(count = 1): WrongAnswerLibraryState {
  let state = createWrongAnswerLibraryState()
  for (let index = 0; index < count; index += 1) {
    state = applyWrongAnswerEvidence(state, createSpeakingWrongAnswerEvidence({
      eventId: `wrong-${index}`, occurredAt: now, source: 'daily-training',
      identity: { reviewContentId: `review-${index}`, originalQuestionType: 'speaking-activity-prompt', domain: 'speaking', source: { kind: 'daily-supply', itemId: `item-${index}`, sourceId: speakingPrompt.id, contentRef: 'lesson://x' } },
      match: { level: 'different' } as never,
    })).state
  }
  return startWrongAnswerReviewRound(state, { roundId: 'round', seed: 'seed', startedAt: now })
}

class Store {
  state: WrongAnswerLibraryState
  fail = false
  saves = 0
  constructor(state = library()) { this.state = state }
  load = async () => this.state
  update = async (transform: WrongAnswerLibraryStateTransform) => { this.saves += 1; if (this.fail) throw new Error('save failed'); const state = transform(this.state); this.state = state; return state }
}

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

function media(outcome: Promise<SpeakingRecognitionOutcome> = Promise.resolve({ status: 'recognized', transcript: speakingPrompt.modelAnswer, alternatives: [] })) {
  const handle: SpeakingRecognitionHandle = { result: outcome, stop: vi.fn(), abort: vi.fn() }
  const recorder: SpeakingRecordingPort = {
    capabilities: () => ({ supported: true, supportedMimeTypes: ['audio/mp4'] }), start: vi.fn(), stop: vi.fn(async () => recording), cancel: vi.fn(), play: vi.fn(async () => {}), stopPlayback: vi.fn(), discard: vi.fn(), dispose: vi.fn(),
  }
  const recognition = { capabilities: vi.fn(() => ({ supported: true, requiresSiri: false })), start: vi.fn(() => handle) }
  return { handle, recorder, recognition }
}

function runtime(store: Store, options: ReturnType<typeof media>, promptForRecord: (record: unknown) => Promise<typeof speakingPrompt> = async () => speakingPrompt) {
  return new SpeakingWrongAnswerReviewRuntime(store, promptForRecord as never, { recorder: options.recorder, recognition: options.recognition, requestMicrophone: async () => ({ getTracks: () => [] }) as unknown as MediaStream })
}

describe('SpeakingWrongAnswerReviewRuntime media boundary', () => {
  it('publishes capturing, stopping, playing, and advancing views as they happen', async () => {
    const stopped = deferred<SpeakingRecording>(); const played = deferred<void>(); const setup = media();
    (setup.recorder.stop as ReturnType<typeof vi.fn>).mockReturnValueOnce(stopped.promise)
    ;(setup.recorder.play as ReturnType<typeof vi.fn>).mockReturnValueOnce(played.promise)
    const views: Array<{ mediaStatus: string; advancing: boolean }> = []
    const store = new Store(library(2))
    const subject = new SpeakingWrongAnswerReviewRuntime(store, async () => speakingPrompt, { recorder: setup.recorder, recognition: setup.recognition, requestMicrophone: async () => ({ getTracks: () => [] }) as unknown as MediaStream, onView: (view) => { views.push({ mediaStatus: view.mediaStatus, advancing: view.advancing }) } })
    await subject.initialize(); await subject.startRecording(); const stopping = subject.stopRecording('view-states', now)
    expect(views.some((view) => view.mediaStatus === 'capturing')).toBe(true); expect(views.some((view) => view.mediaStatus === 'stopping')).toBe(true)
    stopped.resolve(recording); await stopping
    const playing = subject.playRecording(); expect(views.some((view) => view.mediaStatus === 'playing')).toBe(true); played.resolve(); await playing
    const advancing = subject.advance(now); expect(views.some((view) => view.advancing)).toBe(true); await advancing
    expect(views.at(-1)).toEqual({ mediaStatus: 'idle', advancing: false })
  })

  it('submits against the latest atomic state without overwriting a concurrent wrong answer', async () => {
    const store = new Store(); const subject = runtime(store, media()); await subject.initialize()
    store.state = applyWrongAnswerEvidence(store.state, createSpeakingWrongAnswerEvidence({ eventId: 'concurrent', occurredAt: now, source: 'daily-training', identity: { reviewContentId: 'concurrent-review', originalQuestionType: 'speaking-activity-prompt', domain: 'speaking', source: { kind: 'daily-supply', itemId: 'other', sourceId: speakingPrompt.id, contentRef: 'lesson://x' } }, match: { level: 'different' } as never })).state
    await subject.submitTranscript(speakingPrompt.modelAnswer, 'atomic-answer', now)
    expect(store.state.records['concurrent-review::speaking-activity-prompt']?.incorrectCount).toBe(1)
    expect(store.state.records['review-0::speaking-activity-prompt']?.consecutiveReviewCorrect).toBe(1)
  })

  it('restores the official prompt and recognized draft/feedback after reconstruction', async () => {
    const store = new Store(); const first = runtime(store, media())
    await first.initialize(); expect(first.current().stage).toBe('answering'); expect(first.current().prompt).toEqual(speakingPrompt)
    await first.submitTranscript('I am from Shanghai.', 'answer-1', now)
    expect(store.state.activeRound?.answerDraft).toBe('I am from Shanghai.')
    const restored = runtime(store, media()); await restored.initialize()
    expect(restored.current().prompt).toEqual(speakingPrompt); expect(restored.current().feedback?.transcript).toBe('I am from Shanghai.')
  })

  it('writes recognized partial feedback and its transcript draft before a refresh', async () => {
    const store = new Store(); const setup = media(Promise.resolve({ status: 'recognized', transcript: 'I am from Beijing.', alternatives: [] })); const subject = runtime(store, setup)
    await subject.initialize(); await subject.startRecording(); await subject.stopRecording('partial', now)
    expect(subject.current().feedback?.match.level).toBe('partial'); expect(store.state.activeRound?.answerDraft).toBe('I am from Beijing.'); expect(store.state.activeRound?.stage).toBe('feedback')
    const restored = runtime(store, media()); await restored.initialize(); expect(restored.current().feedback?.match.level).toBe('partial')
  })

  it.each(['network', 'no-speech', 'not-allowed'] as const)('keeps score and stage untouched for %s recognition failure while retaining the stopped recording', async (code) => {
    const store = new Store(); const setup = media(Promise.resolve({ status: 'failed', code, message: code })); const subject = runtime(store, setup); await subject.initialize()
    await subject.startRecording(); await subject.stopRecording('failed', now)
    expect(subject.current().unscorable).toBe(true); expect(subject.current().recordingAvailable).toBe(true); expect(store.state.activeRound?.stage).toBe('answering'); expect(store.state.records['review-0::speaking-activity-prompt']?.consecutiveReviewCorrect).toBe(0)
    await subject.playRecording(); expect(setup.recorder.play).toHaveBeenCalledWith(recording)
  })

  it('does not alter scoring state on microphone/start/stop failures, and has no fake recording to play', async () => {
    const store = new Store(); const setup = media(); const denied = new SpeakingWrongAnswerReviewRuntime(store, async () => speakingPrompt, { recorder: setup.recorder, recognition: setup.recognition, requestMicrophone: async () => { throw new Error('denied') } })
    await denied.initialize(); expect((await denied.startRecording()).unscorable).toBe(true)
    const startFails = runtime(store, setup); await startFails.initialize(); (setup.recorder.start as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new Error('start') }); expect((await startFails.startRecording()).unscorable).toBe(true)
    const stopSetup = media(); (stopSetup.recorder.stop as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('stop')); const stopFails = runtime(store, stopSetup); await stopFails.initialize(); await stopFails.startRecording(); await stopFails.stopRecording('stop-fails', now); expect(stopFails.current().unscorable).toBe(true)
    expect(stopFails.current().recordingAvailable).toBe(false); await expect(stopFails.playRecording()).rejects.toThrow('No idle review recording')
    expect(store.state.activeRound?.stage).toBe('answering')
  })

  it('treats unsupported recognition as unscorable without touching the review score and keeps the capture replayable', async () => {
    const store = new Store(); const setup = media(); setup.recognition.capabilities.mockReturnValue({ supported: false, requiresSiri: false }); const subject = runtime(store, setup); await subject.initialize()
    await subject.startRecording(); await subject.stopRecording('unsupported', now)
    expect(subject.current().unscorable).toBe(true); expect(subject.current().recordingAvailable).toBe(true); expect(setup.recognition.start).not.toHaveBeenCalled(); expect(store.state.activeRound?.stage).toBe('answering')
  })

  it('serializes start and stop double clicks and cancel releases both recorder and recognition handle', async () => {
    const store = new Store(); const setup = media(); const subject = runtime(store, setup); await subject.initialize()
    const firstStart = subject.startRecording(); await expect(subject.startRecording()).rejects.toThrow('cannot start recording'); await firstStart; expect(setup.recorder.start).toHaveBeenCalledTimes(1); expect(setup.recognition.start).toHaveBeenCalledTimes(1)
    await Promise.all([subject.stopRecording('one', now), subject.stopRecording('one', now)]); expect(setup.recorder.stop).toHaveBeenCalledTimes(1); expect(setup.handle.stop).toHaveBeenCalledTimes(1)
    const cancelSetup = media(); const cancelling = runtime(new Store(), cancelSetup); await cancelling.initialize(); await cancelling.startRecording(); cancelling.cancelRecording(); expect(cancelSetup.recorder.cancel).toHaveBeenCalledTimes(1); expect(cancelSetup.handle.abort).toHaveBeenCalledTimes(1); expect(cancelling.current().recordingAvailable).toBe(false)
  })

  it('keeps an active capture exclusive: a second start and external submit cannot disturb its handle', async () => {
    const store = new Store(); const setup = media(); const subject = runtime(store, setup); await subject.initialize(); await subject.startRecording()
    expect(subject.current().mediaStatus).toBe('capturing'); await expect(subject.startRecording()).rejects.toThrow('cannot start recording'); await expect(subject.submitTranscript(speakingPrompt.modelAnswer, 'capture-conflict', now)).rejects.toThrow('cannot submit'); expect(store.state.processedEvidenceIds).not.toContain('capture-conflict'); expect(setup.handle.abort).not.toHaveBeenCalled()
    await subject.stopRecording('capture-finished', now); expect(subject.current().stage).toBe('feedback')
  })

  it('keeps playback exclusive and restores idle media state after cancel, resolve, or rejection', async () => {
    const store = new Store(); const playback = deferred<void>(); const setup = media(); (setup.recorder.play as ReturnType<typeof vi.fn>).mockReturnValueOnce(playback.promise); const subject = runtime(store, setup); await subject.initialize(); await subject.startRecording(); await subject.stopRecording('for-playback', now)
    const playing = subject.playRecording(); expect(subject.current().mediaStatus).toBe('playing'); await expect(subject.startRecording()).rejects.toThrow('cannot start recording'); subject.cancelRecording(); expect(setup.recorder.stopPlayback).toHaveBeenCalled(); expect(subject.current().mediaStatus).toBe('idle'); playback.resolve(); expect((await playing).mediaStatus).toBe('idle'); expect(subject.current().mediaStatus).toBe('idle')
    const rejected = deferred<void>(); const failureSetup = media(); (failureSetup.recorder.play as ReturnType<typeof vi.fn>).mockReturnValueOnce(rejected.promise); const failureSubject = runtime(new Store(), failureSetup); await failureSubject.initialize(); await failureSubject.startRecording(); await failureSubject.stopRecording('for-playback-failure', now); const replay = failureSubject.playRecording(); expect(failureSubject.current().mediaStatus).toBe('playing'); rejected.reject(new Error('playback failed')); await expect(replay).rejects.toThrow('playback failed'); expect(failureSubject.current().mediaStatus).toBe('idle')
  })

  it('silently discards a late old recognition result after cancel without writing a draft', async () => {
    const late = deferred<SpeakingRecognitionOutcome>(); const store = new Store(); const setup = media(late.promise); const subject = runtime(store, setup); await subject.initialize()
    await subject.startRecording(); const stopping = subject.stopRecording('late', now); subject.cancelRecording(); late.resolve({ status: 'recognized', transcript: speakingPrompt.modelAnswer, alternatives: [] }); await stopping
    expect(subject.current().unscorable).toBe(false); expect(store.saves).toBe(0); expect(store.state.activeRound?.answerDraft).toBeNull(); expect(store.state.activeRound?.stage).toBe('answering')
  })

  it('silently ignores a microphone rejection that arrives after cancellation', async () => {
    const microphone = deferred<MediaStream>(); const store = new Store(); const setup = media(); const subject = new SpeakingWrongAnswerReviewRuntime(store, async () => speakingPrompt, { recorder: setup.recorder, recognition: setup.recognition, requestMicrophone: () => microphone.promise })
    await subject.initialize(); const starting = subject.startRecording(); subject.cancelRecording(); microphone.reject(new Error('denied late')); await starting
    expect(subject.current().unscorable).toBe(false); expect(subject.current().stage).toBe('answering'); expect(setup.recorder.start).not.toHaveBeenCalled()
  })

  it('stops tracks from a microphone stream that arrives after cancellation without starting the recorder', async () => {
    const microphone = deferred<MediaStream>(); const track = { stop: vi.fn() }; const store = new Store(); const setup = media(); const subject = new SpeakingWrongAnswerReviewRuntime(store, async () => speakingPrompt, { recorder: setup.recorder, recognition: setup.recognition, requestMicrophone: () => microphone.promise })
    await subject.initialize(); const starting = subject.startRecording(); subject.cancelRecording(); microphone.resolve({ getTracks: () => [track] } as unknown as MediaStream); await starting
    expect(track.stop).toHaveBeenCalledTimes(1); expect(setup.recorder.start).not.toHaveBeenCalled(); expect(subject.current().unscorable).toBe(false)
  })

  it('serializes stop behind a pending microphone request so approval after stop cannot start recording', async () => {
    const microphone = deferred<MediaStream>(); const track = { stop: vi.fn() }; const store = new Store(); const setup = media(); const subject = new SpeakingWrongAnswerReviewRuntime(store, async () => speakingPrompt, { recorder: setup.recorder, recognition: setup.recognition, requestMicrophone: () => microphone.promise })
    await subject.initialize(); void subject.startRecording(); const stopping = subject.stopRecording('stop-before-permission', now); microphone.resolve({ getTracks: () => [track] } as unknown as MediaStream); await stopping
    expect(track.stop).toHaveBeenCalledTimes(1); expect(setup.recorder.start).not.toHaveBeenCalled(); expect(setup.recorder.stop).not.toHaveBeenCalled(); expect(subject.current().unscorable).toBe(false)
  })

  it('rejects start during a pending stop without requesting another microphone stream or changing generation', async () => {
    const stopping = deferred<SpeakingRecording>(); const setup = media(); (setup.recorder.stop as ReturnType<typeof vi.fn>).mockReturnValueOnce(stopping.promise); const microphone = vi.fn(async () => ({}) as MediaStream); const subject = new SpeakingWrongAnswerReviewRuntime(new Store(), async () => speakingPrompt, { recorder: setup.recorder, recognition: setup.recognition, requestMicrophone: microphone })
    await subject.initialize(); await subject.startRecording(); const firstStop = subject.stopRecording('pending-stop', now); await expect(subject.startRecording()).rejects.toThrow('cannot start recording'); expect(microphone).toHaveBeenCalledTimes(1)
    stopping.resolve(recording); await firstStop; expect(subject.current().stage).toBe('feedback')
  })

  it('rejects submission during pending microphone permission, cancels it, and releases a later stream', async () => {
    const microphone = deferred<MediaStream>(); const track = { stop: vi.fn() }; const setup = media(); const subject = new SpeakingWrongAnswerReviewRuntime(new Store(), async () => speakingPrompt, { recorder: setup.recorder, recognition: setup.recognition, requestMicrophone: () => microphone.promise })
    await subject.initialize(); void subject.startRecording(); await expect(subject.submitTranscript(speakingPrompt.modelAnswer, 'conflict-submit', now)).rejects.toThrow('media is active'); microphone.resolve({ getTracks: () => [track] } as unknown as MediaStream); await Promise.resolve()
    expect(track.stop).toHaveBeenCalledTimes(1); expect(setup.recorder.start).not.toHaveBeenCalled(); expect(subject.current().stage).toBe('answering')
  })

  it('settles stop without waiting for a never-resolving microphone request and still releases a later stream', async () => {
    const microphone = deferred<MediaStream>(); const track = { stop: vi.fn() }; const setup = media(); const subject = new SpeakingWrongAnswerReviewRuntime(new Store(), async () => speakingPrompt, { recorder: setup.recorder, recognition: setup.recognition, requestMicrophone: () => microphone.promise })
    await subject.initialize(); void subject.startRecording(); await expect(subject.stopRecording('never-permitted', now)).resolves.toMatchObject({ stage: 'answering' }); expect(setup.recorder.start).not.toHaveBeenCalled()
    microphone.resolve({ getTracks: () => [track] } as unknown as MediaStream); await Promise.resolve(); expect(track.stop).toHaveBeenCalledTimes(1); expect(setup.recorder.start).not.toHaveBeenCalled()
  })

  it('silently ignores late stop and recognition rejections after cancellation', async () => {
    const stopped = deferred<SpeakingRecording>(); const store = new Store(); const setup = media(); (setup.recorder.stop as ReturnType<typeof vi.fn>).mockReturnValueOnce(stopped.promise); const subject = runtime(store, setup); await subject.initialize(); await subject.startRecording()
    const stopping = subject.stopRecording('late-stop', now); subject.cancelRecording(); stopped.reject(new Error('stop late')); await stopping
    expect(subject.current().unscorable).toBe(false); expect(subject.current().stage).toBe('answering')
    const recognized = deferred<SpeakingRecognitionOutcome>(); const recognitionSetup = media(recognized.promise); const retry = runtime(new Store(), recognitionSetup); await retry.initialize(); await retry.startRecording(); const waiting = retry.stopRecording('late-recognition', now); retry.cancelRecording(); recognized.reject(new Error('recognition late')); await waiting
    expect(retry.current().unscorable).toBe(false); expect(retry.current().stage).toBe('answering')
  })

  it('stops playback and discards old recording on cancel or advance without double-discarding', async () => {
    const cancelSetup = media(); const cancelSubject = runtime(new Store(), cancelSetup); await cancelSubject.initialize(); await cancelSubject.startRecording(); await cancelSubject.stopRecording('capture', now); await cancelSubject.playRecording(); cancelSubject.cancelRecording(); cancelSubject.cancelRecording()
    expect(cancelSetup.recorder.stopPlayback).toHaveBeenCalledTimes(2); expect(cancelSetup.recorder.discard).toHaveBeenCalledTimes(1); expect(cancelSetup.recorder.discard).toHaveBeenCalledWith(recording)
    const advanceStore = new Store(library(2)); const advanceSetup = media(); const advancing = runtime(advanceStore, advanceSetup); await advancing.initialize(); await advancing.startRecording(); await advancing.stopRecording('advance-capture', now); await advancing.playRecording(); await advancing.advance(now)
    expect(advanceSetup.recorder.stopPlayback).toHaveBeenCalledTimes(1); expect(advanceSetup.recorder.discard).toHaveBeenCalledWith(recording); expect(advancing.current().prompt).not.toBeNull()
  })

  it('advancing aborts and clears the prior media generation before resolving the next prompt', async () => {
    const store = new Store(library(2)); const setup = media(); const subject = runtime(store, setup, async (record) => (record as { reviewContentId: string }).reviewContentId === 'review-0' ? speakingPrompt : { ...speakingPrompt, id: 'second' }); await subject.initialize()
    await subject.submitTranscript(speakingPrompt.modelAnswer, 'advance-safe', now); const view = await subject.advance(now)
    expect(view.prompt?.id).toBe('second'); expect(view.unscorable).toBe(false); expect(view.recordingAvailable).toBe(false); expect(store.state.activeRound?.answerDraft).toBeNull(); expect(store.state.activeRound?.stage).toBe('answering')
  })

  it('clears the old prompt when next-record resolution fails and refuses to score the mismatched state', async () => {
    const store = new Store(library(2)); const subject = runtime(store, media(), async (record) => (record as { reviewContentId: string }).reviewContentId === 'review-0' ? speakingPrompt : Promise.reject(new Error('next prompt unavailable'))); await subject.initialize(); await subject.submitTranscript(speakingPrompt.modelAnswer, 'first-ok', now)
    await expect(subject.advance(now)).rejects.toThrow('next prompt unavailable'); expect(subject.current().record).toBeNull(); expect(subject.current().prompt).toBeNull(); expect(subject.current().feedback).toBeNull()
    await expect(subject.submitTranscript(speakingPrompt.modelAnswer, 'must-not-score', now)).rejects.toThrow('cannot submit'); expect(store.state.processedEvidenceIds).not.toContain('must-not-score')
  })

  it('does not advance memory, feedback, or draft when save fails; retrying the same event writes exactly once', async () => {
    const store = new Store(); const subject = runtime(store, media()); await subject.initialize(); store.fail = true
    await expect(subject.submitTranscript(speakingPrompt.modelAnswer, 'retry', now)).rejects.toThrow('save failed')
    expect(subject.current().feedback).toBeNull(); expect(subject.current().stage).toBe('answering'); expect(store.state.activeRound?.answerDraft).toBeNull()
    store.fail = false; await subject.submitTranscript(speakingPrompt.modelAnswer, 'retry', now); await subject.submitTranscript(speakingPrompt.modelAnswer, 'retry', now).catch(() => undefined)
    expect(store.state.processedEvidenceIds.filter((id) => id === 'retry')).toHaveLength(1)
  })

  it('rolls back library, feedback, recording, and unscorable state when advancing cannot save', async () => {
    const store = new Store(library(2)); const setup = media(); const subject = runtime(store, setup); await subject.initialize(); await subject.startRecording(); await subject.stopRecording('advance-save', now); const before = subject.current(); store.fail = true
    await expect(subject.advance(now)).rejects.toThrow('save failed')
    expect(subject.current().feedback).toEqual(before.feedback); expect(subject.current().recordingAvailable).toBe(true); expect(subject.current().unscorable).toBe(before.unscorable); expect(store.state.activeRound?.stage).toBe('feedback'); expect(setup.recorder.stopPlayback).not.toHaveBeenCalled(); expect(setup.recorder.discard).not.toHaveBeenCalled()
  })

  it('serializes cancellation behind an in-flight answer save so durable and in-memory scoring cannot diverge', async () => {
    const saved = deferred<void>(); const store = new Store(); store.update = async (transform) => { store.saves += 1; await saved.promise; const state = transform(store.state); store.state = state; return state }; const setup = media(); const subject = runtime(store, setup); await subject.initialize(); await subject.startRecording(); const submitting = subject.stopRecording('serialized-save', now); await vi.waitFor(() => expect(store.saves).toBe(1)); subject.cancelRecording(); saved.resolve(); await submitting
    expect(store.state.activeRound?.stage).toBe('feedback'); expect(subject.current().stage).toBe('feedback'); expect(subject.current().feedback?.transcript).toBe(speakingPrompt.modelAnswer); expect(subject.current().recordingAvailable).toBe(false)
  })

  it('rejects recording starts while answer persistence is pending, then clears the boundary after save success or failure', async () => {
    const saved = deferred<void>(); const store = new Store(library(2)); store.update = async (transform) => { store.saves += 1; await saved.promise; const state = transform(store.state); store.state = state; return state }; const setup = media(); const subject = runtime(store, setup); await subject.initialize(); await subject.startRecording(); const submitting = subject.stopRecording('pending-start-success', now); await vi.waitFor(() => expect(store.saves).toBe(1)); const starts = (setup.recorder.start as ReturnType<typeof vi.fn>).mock.calls.length
    await expect(subject.startRecording()).rejects.toThrow('cannot start recording'); expect(setup.recorder.start).toHaveBeenCalledTimes(starts); saved.resolve(); await submitting; await new Promise((resolve) => setTimeout(resolve)); expect(subject.current().stage).toBe('feedback')
    await subject.advance(now); await subject.startRecording(); expect(setup.recorder.start).toHaveBeenCalledTimes(starts + 1)
    const failedStore = new Store(); failedStore.fail = true; const failedSetup = media(); const failed = runtime(failedStore, failedSetup); await failed.initialize(); await failed.startRecording(); await expect(failed.stopRecording('pending-start-failure', now)).rejects.toThrow('save failed'); await new Promise((resolve) => setTimeout(resolve)); await expect(failed.startRecording()).resolves.toMatchObject({ stage: 'answering' }); expect(failedSetup.recorder.start).toHaveBeenCalledTimes(2)
  })

  it('does not emit an unhandled rejection from pending-stop cleanup when a caught answer save rejects', async () => {
    const store = new Store(); store.fail = true; const subject = runtime(store, media()); await subject.initialize(); await subject.startRecording()
    await expect(subject.stopRecording('caught-save-failure', now)).rejects.toThrow('save failed'); await Promise.resolve()
    expect(subject.current().stage).toBe('answering'); expect(subject.current().feedback).toBeNull()
  })

  it('advances to the resolved next prompt, removes after two correct answers, clears streak after an incorrect answer, and leaves unscorable current retryable', async () => {
    const store = new Store(library(2)); const prompts = [speakingPrompt, { ...speakingPrompt, id: 'second', modelAnswer: 'Hello.', acceptedAnswers: ['Hello.'] }]
    const subject = runtime(store, media(), async (record) => (record as { reviewContentId: string }).reviewContentId === 'review-0' ? prompts[0] : prompts[1]); await subject.initialize()
    await subject.submitTranscript(prompts[0].modelAnswer, 'correct-1', now); await subject.advance(now); expect(subject.current().prompt?.id).toBe('second')
    await subject.submitTranscript('wrong words', 'incorrect', now); expect(subject.current().feedback?.match.level).toBe('different'); expect(store.state.records['review-1::speaking-activity-prompt']?.consecutiveReviewCorrect).toBe(0)
    const unscorable = runtime(new Store(), media(Promise.resolve({ status: 'failed', code: 'no-speech', message: 'no speech' }))); await unscorable.initialize(); await unscorable.startRecording(); await unscorable.stopRecording('none', now); expect(unscorable.current().stage).toBe('answering'); await unscorable.submitTranscript(speakingPrompt.modelAnswer, 'after-none', now); expect(unscorable.current().stage).toBe('feedback')
  })

  it('moves a record to history only after its second correctly persisted review', async () => {
    const store = new Store(); const first = runtime(store, media()); await first.initialize(); await first.submitTranscript(speakingPrompt.modelAnswer, 'first-correct', now); await first.advance(now)
    store.state = startWrongAnswerReviewRound({ ...store.state, activeRound: null }, { roundId: 'round-two', seed: 'seed-two', startedAt: now })
    const second = runtime(store, media()); await second.initialize(); await second.submitTranscript(speakingPrompt.modelAnswer, 'second-correct', now)
    expect(store.state.records['review-0::speaking-activity-prompt']?.status).toBe('history')
  })

  it('single-flights advance, exposes advancing, and releases the operation after success or save failure', async () => {
    const saved = deferred<void>(); const store = new Store(library(2)); const setup = media(); const subject = runtime(store, setup); await subject.initialize(); await subject.submitTranscript(speakingPrompt.modelAnswer, 'advance-pending', now); store.update = async (transform) => { store.saves += 1; await saved.promise; const state = transform(store.state); store.state = state; return state }
    const first = subject.advance(now); const second = subject.advance(now); expect(second).toBe(first); expect(subject.current().advancing).toBe(true); await expect(subject.startRecording()).rejects.toThrow('cannot start'); await expect(subject.playRecording()).rejects.toThrow('No idle')
    saved.resolve(); const returned = await first; expect(await second).toEqual(returned); expect(returned.advancing).toBe(false); expect(store.saves).toBe(2); expect(subject.current().advancing).toBe(false)
    const failed = new Store(library(2)); const failureSubject = runtime(failed, media()); await failureSubject.initialize(); await failureSubject.submitTranscript(speakingPrompt.modelAnswer, 'advance-fails', now); failed.fail = true; await expect(failureSubject.advance(now)).rejects.toThrow('save failed'); await Promise.resolve(); expect(failureSubject.current().advancing).toBe(false); expect(failureSubject.current().stage).toBe('feedback')
  })

  it('clears prior unscorable media state only after a successful advance', async () => {
    const store = new Store(library(2)); const failedRecognition = media(Promise.resolve({ status: 'failed', code: 'no-speech', message: 'none' })); const subject = runtime(store, failedRecognition); await subject.initialize(); await subject.startRecording(); await subject.stopRecording('unscorable-first', now); expect(subject.current().unscorable).toBe(true); await subject.submitTranscript(speakingPrompt.modelAnswer, 'score-after-unscorable', now); await subject.advance(now)
    expect(subject.current().recordingAvailable).toBe(false); expect(subject.current().mediaStatus).toBe('idle'); expect(subject.current().unscorable).toBe(false)
    const failedStore = new Store(library(2)); const failedRecognitionAgain = media(Promise.resolve({ status: 'failed', code: 'no-speech', message: 'none' })); const retry = runtime(failedStore, failedRecognitionAgain); await retry.initialize(); await retry.startRecording(); await retry.stopRecording('unscorable-fail', now); await retry.submitTranscript(speakingPrompt.modelAnswer, 'score-before-failed-advance', now); failedStore.fail = true; await expect(retry.advance(now)).rejects.toThrow('save failed'); expect(retry.current().unscorable).toBe(true)
  })
})
