/// <reference types="node" />

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createStaticDataSource } from '../../core/testing/index.ts'
import { localStorageService } from '../../storage/index.ts'
import { VocabularyError } from './errors.ts'
import { applyWrongAnswerEvidence, createWrongAnswerLibraryState, type WrongAnswerEvidence } from '../../learning-engine/index.ts'
import { createTrainingSupplyRound } from '../../learning-engine/index.ts'
import type { WrongAnswerEvidenceSink, ReviewContentIndex } from './wrong-answer-review.ts'
import {
  createSceneVocabularyQuestionBank,
  SceneVocabularyPracticeRuntime,
  StoredSceneVocabularyPracticeRepository,
  SCENE_VOCABULARY_STORAGE_NAMESPACE,
  type SceneVocabularyPracticeRepository,
  type SceneVocabularyPracticeSnapshot,
} from './scene-vocabulary-practice.ts'

const projectRoot = new URL('../../../', import.meta.url)

async function loadReleasedSceneBank() {
  return createSceneVocabularyQuestionBank(JSON.parse(await readFile(
    new URL('content/lessons/survival-travel-american-4w/scene-vocabulary-questions.v1.json', projectRoot),
    'utf8',
  )) as unknown)
}

class MemoryScenePracticeRepository implements SceneVocabularyPracticeRepository {
  readonly records = new Map<string, SceneVocabularyPracticeSnapshot>()
  discardCount = 0
  discardFailure: Error | undefined
  saveFailure: Error | undefined

  async load(sessionId: string): Promise<SceneVocabularyPracticeSnapshot | undefined> {
    return this.records.get(sessionId)
  }

  async save(snapshot: SceneVocabularyPracticeSnapshot): Promise<void> {
    if (this.saveFailure) { const error = this.saveFailure; this.saveFailure = undefined; throw error }
    this.records.set(snapshot.sessionId, structuredClone(snapshot))
  }

  async discardInvalidSnapshot(sessionId: string): Promise<void> {
    this.discardCount += 1
    if (this.discardFailure) {
      throw this.discardFailure
    }
    this.records.delete(sessionId)
  }
}

function clock() {
  let value = Date.parse('2026-07-30T00:00:00.000Z')
  return () => {
    const now = new Date(value).toISOString()
    value += 1_000
    return now
  }
}

function runtimeFor(
  bank: Awaited<ReturnType<typeof loadReleasedSceneBank>>,
  repository = new MemoryScenePracticeRepository(),
  wrongAnswerReview?: { readonly index: ReviewContentIndex; readonly sink: WrongAnswerEvidenceSink },
  onTrainingItemCompleted?: ConstructorParameters<typeof SceneVocabularyPracticeRuntime>[0]['onTrainingItemCompleted'],
) {
  return new SceneVocabularyPracticeRuntime({
    categoryId: 'airport-flight',
    sceneId: 'airport',
    contentSource: createStaticDataSource(bank),
    repository,
    now: clock(),
    wrongAnswerReview,
    onTrainingItemCompleted,
  })
}

function legacyOptionId(questionId: string, position: number): string {
  return `${questionId}:meaning:${position + 1}`
}

describe('R13-C scene vocabulary practice runtime', () => {
  it('replays one durable scene error without changing R13-C feedback or target-only playback', async () => {
    const bank = await loadReleasedSceneBank(); const index = JSON.parse(await readFile(new URL('content/curriculum/review-content-index.v1.json', projectRoot), 'utf8')) as ReviewContentIndex; const repository = new MemoryScenePracticeRepository(); let state = createWrongAnswerLibraryState(); const ids: string[] = []; let fail = true
    const sink: WrongAnswerEvidenceSink = { async publish(evidence: WrongAnswerEvidence) { ids.push(evidence.eventId); if (fail) { fail = false; throw new Error('sink failed') }; state = applyWrongAnswerEvidence(state, evidence).state } }
    const first = runtimeFor(bank, repository, { index, sink }); let snapshot = await first.initialize(); const view = first.toView(); const active = bank.getScene('airport-flight', 'airport')!.questions.find((question) => question.questionId === view.question!.questionId)!; const wrong = view.question!.options.find((option) => option.labelZh !== active.correctMeaningZh)!; await first.select(wrong.id); await expect(first.submit()).rejects.toThrow('sink failed'); snapshot = first.currentSnapshot!; expect(snapshot.phase).toBe('feedback'); const answered = snapshot.answers.length; const playback = first.toView().question!.targetPlayback
    const second = runtimeFor(bank, repository, { index, sink }); snapshot = await second.initialize(); expect(ids[0]).toBe(ids[1]); expect(snapshot.pendingWrongAnswerEvidence).toEqual([]); expect(snapshot.answers).toHaveLength(answered); expect(second.toView().question!.targetPlayback).toEqual(playback); expect(Object.values(state.records)[0]?.incorrectCount).toBe(1)
  })
  it('keeps scene evidence pending when confirmation-clear save fails, then replays idempotently', async () => {
    const bank = await loadReleasedSceneBank(); const index = JSON.parse(await readFile(new URL('content/curriculum/review-content-index.v1.json', projectRoot), 'utf8')) as ReviewContentIndex; const repository = new MemoryScenePracticeRepository(); let state = createWrongAnswerLibraryState(); const ids: string[] = []
    const sink: WrongAnswerEvidenceSink = { async publish(evidence: WrongAnswerEvidence) { ids.push(evidence.eventId); state = applyWrongAnswerEvidence(state, evidence).state; if (ids.length === 1) repository.saveFailure = new Error('clear save failed') } }
    const first = runtimeFor(bank, repository, { index, sink }); await first.initialize(); const view = first.toView(); const active = bank.getScene('airport-flight', 'airport')!.questions.find((question) => question.questionId === view.question!.questionId)!; const choice = view.question!.options.find((option) => option.labelZh !== active.correctMeaningZh)!; await first.select(choice.id); await expect(first.submit()).rejects.toThrow('clear save failed'); expect(first.currentSnapshot?.pendingWrongAnswerEvidence).toHaveLength(1)
    const second = runtimeFor(bank, repository, { index, sink }); const restored = await second.initialize(); expect(restored.pendingWrongAnswerEvidence).toEqual([]); expect(ids[0]).toBe(ids[1]); expect(Object.values(state.records)[0]?.incorrectCount).toBe(1); expect(second.toView().question?.targetPlayback.intent).toBe('play-target-only')
  })
  it('does not create scene evidence for correct, selected-only, or exit snapshots', async () => {
    const bank = await loadReleasedSceneBank(); const index = JSON.parse(await readFile(new URL('content/curriculum/review-content-index.v1.json', projectRoot), 'utf8')) as ReviewContentIndex; const sink: WrongAnswerEvidenceSink = { publish: async () => { throw new Error('unexpected evidence') } }; const review = { index, sink }
    const selected = runtimeFor(bank, new MemoryScenePracticeRepository(), review); await selected.initialize(); await selected.select(selected.toView().question!.options[0]!.id); await selected.exit(); expect(selected.currentSnapshot?.pendingWrongAnswerEvidence ?? []).toEqual([])
  })
  it('emits one scene evidence for a feedback double-submit and none for a correct formal answer', async () => {
    const bank = await loadReleasedSceneBank(); const index = JSON.parse(await readFile(new URL('content/curriculum/review-content-index.v1.json', projectRoot), 'utf8')) as ReviewContentIndex; let state = createWrongAnswerLibraryState(); const ids: string[] = []; const sink: WrongAnswerEvidenceSink = { async publish(evidence) { ids.push(evidence.eventId); state = applyWrongAnswerEvidence(state, evidence).state } }; const review = { index, sink }
    const wrongRuntime = runtimeFor(bank, new MemoryScenePracticeRepository(), review); await wrongRuntime.initialize(); const wrongView = wrongRuntime.toView(); const wrongSource = bank.scenes.flatMap((scene) => scene.questions).find((question) => question.questionId === wrongView.question!.questionId)!; await wrongRuntime.select(wrongView.question!.options.find((candidate) => candidate.labelZh !== wrongSource.correctMeaningZh)!.id); await wrongRuntime.submit(); await expect(wrongRuntime.submit()).rejects.toThrow(); expect(ids).toHaveLength(1); expect(Object.values(state.records)[0]?.incorrectCount).toBe(1)
    const correctRuntime = runtimeFor(bank, new MemoryScenePracticeRepository(), review); await correctRuntime.initialize(); const view = correctRuntime.toView(); const source = bank.scenes.flatMap((scene) => scene.questions).find((question) => question.questionId === view.question!.questionId)!; const option = view.question!.options.find((candidate) => candidate.labelZh === source.correctMeaningZh)!; await correctRuntime.select(option.id); await correctRuntime.submit(); expect(correctRuntime.currentSnapshot?.pendingWrongAnswerEvidence ?? []).toEqual([]); expect(ids).toHaveLength(1)
  })
  it('fails corrupt and drifted R13-C snapshots before any scene evidence handoff', async () => {
    const bank = await loadReleasedSceneBank(); const index = JSON.parse(await readFile(new URL('content/curriculum/review-content-index.v1.json', projectRoot), 'utf8')) as ReviewContentIndex; let calls = 0; const review = { index, sink: { publish: async () => { calls += 1 } } }
    const repository = new MemoryScenePracticeRepository(); const healthy = runtimeFor(bank, repository, review); const snapshot = await healthy.initialize(); repository.records.set(snapshot.sessionId, { ...snapshot, currentQuestionId: 'missing' }); await expect(runtimeFor(bank, repository, review).initialize()).rejects.toThrow(); expect(calls).toBe(0)
    repository.records.set(snapshot.sessionId, { ...snapshot, questionIds: [...snapshot.questionIds].reverse() }); await expect(runtimeFor(bank, repository, review).initialize()).rejects.toThrow(); expect(calls).toBe(0)
  })
  it('stores and discards only the explicitly named corrupt scene record', async () => {
    const store = localStorageService.namespace(SCENE_VOCABULARY_STORAGE_NAMESPACE)
    const repository = new StoredSceneVocabularyPracticeRepository(store)
    const currentId = 'r13b-scene-vocabulary:airport-flight:airport'
    const otherId = 'r13b-scene-vocabulary:city-transport:taxi'
    await store.clear()
    await store.put(`session:${currentId}`, { incomplete: true }, 2)
    await store.put(`session:${otherId}`, { preserved: true }, 2)

    await expect(repository.load(currentId)).rejects.toThrowError(
      expect.objectContaining({ code: 'session-recovery-invalid' }),
    )
    await Promise.all([
      repository.discardInvalidSnapshot(currentId),
      repository.discardInvalidSnapshot(currentId),
    ])
    expect(await store.get(`session:${currentId}`)).toBeUndefined()
    expect((await store.get(`session:${otherId}`))?.value).toEqual({ preserved: true })
    await store.clear()
  })

  it('accepts the released 18-scene, 612-question bank and rejects a forbidden sentence translation contract', async () => {
    const bank = await loadReleasedSceneBank()

    expect(bank.scenes).toHaveLength(18)
    expect(bank.scenes.flatMap((scene) => scene.questions)).toHaveLength(612)
    expect(bank.getScene('health', 'medical-pharmacy')?.questions).toHaveLength(48)
    expect(bank.interaction.sentenceTranslationAllowed).toBe(false)

    const invalid = JSON.parse(await readFile(
      new URL('content/lessons/survival-travel-american-4w/scene-vocabulary-questions.v1.json', projectRoot),
      'utf8',
    )) as Record<string, unknown>
    invalid.interaction = {
      promptZh: '这个词是什么意思？',
      targetPlayback: 'tap-highlighted-target-only',
      sentenceTranslationAllowed: true,
    }
    expect(() => createSceneVocabularyQuestionBank(invalid)).toThrowError(
      expect.objectContaining({ code: 'content-invalid' }),
    )
  })

  it('publishes a UI-only contract with highlighted English, target-only playback, and no sentence translation', async () => {
    const bank = await loadReleasedSceneBank()
    const runtime = runtimeFor(bank)
    await runtime.initialize()

    const view = runtime.toView()
    expect(view.status).toBe('question')
    expect(view.progress).toMatchObject({
      answeredCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      totalCount: 48,
      accuracy: null,
    })
    const question = bank.getScene('airport-flight', 'airport')!.questions.find(
      (entry) => entry.questionId === view.question?.questionId,
    )!
    const targetIndex = question.sentenceEn.toLocaleLowerCase('en-US').indexOf(question.targetText.toLocaleLowerCase('en-US'))
    expect(view.question).toMatchObject({
      questionId: question.questionId,
      promptZh: '这个词是什么意思？',
      sentenceEn: {
        beforeTarget: question.sentenceEn.slice(0, targetIndex),
        targetText: question.targetText,
        afterTarget: question.sentenceEn.slice(targetIndex + question.targetText.length),
      },
      targetPlayback: {
        intent: 'play-target-only',
        text: question.targetText,
        locale: 'en-US',
      },
    })
    expect(view.question?.options).toHaveLength(4)
    expect('sentenceTranslationZh' in (view.question ?? {})).toBe(false)
  })

  it('scores only submitted released option ids, persists ordered progress, and ends with the exact rate', async () => {
    const bank = await loadReleasedSceneBank()
    const repository = new MemoryScenePracticeRepository()
    const runtime = runtimeFor(bank, repository)
    await runtime.initialize()
    const scene = bank.getScene('airport-flight', 'airport')!

    for (let index = 0; index < 6; index += 1) {
      const before = runtime.toView()
      const question = scene.questions.find((entry) => entry.questionId === before.question!.questionId)!
      const selected = index === 1
        ? before.question!.options.find((option) => option.labelZh !== question.correctMeaningZh)!
        : before.question!.options.find((option) => option.labelZh === question.correctMeaningZh)!
      await runtime.select(selected.id)
      await runtime.submit()
      const feedback = runtime.toView()
      expect(feedback.status).toBe('feedback')
      expect(feedback.feedback?.correct).toBe(index !== 1)
      expect(feedback.progress.answeredCount).toBe(index + 1)
      expect(feedback.progress.correctCount).toBe(index === 0 ? 1 : index)
      await runtime.advance()
    }

    const continued = runtime.toView()
    expect(continued).toMatchObject({
      status: 'question',
      progress: {
        answeredCount: 6,
        correctCount: 5,
        incorrectCount: 1,
        totalCount: 48,
        accuracy: 5 / 6,
      },
    })
    const persisted = [...repository.records.values()][0]!
    expect(persisted.answers).toHaveLength(6)
    expect(persisted.correctCount).toBe(5)
  })

  it('emits one durable scene completion only after the answered item is saved', async () => {
    const bank = await loadReleasedSceneBank()
    const completions: string[] = []
    const runtime = runtimeFor(bank, new MemoryScenePracticeRepository(), undefined, async (completion) => { completions.push(completion.acknowledgementId) })
    await runtime.initialize()
    const view = runtime.toView()
    await runtime.select(view.question!.options[0]!.id)
    await runtime.submit()
    await runtime.advance()

    expect(completions).toHaveLength(1)
    expect(runtime.currentSnapshot?.pendingTrainingItemCompletions).toEqual([])
    await expect(runtime.advance()).rejects.toThrow('feedback')
    expect(completions).toHaveLength(1)
  })

  it('restores a selected answer and refuses tampered progress that does not match the released order or option ids', async () => {
    const bank = await loadReleasedSceneBank()
    const repository = new MemoryScenePracticeRepository()
    const first = runtimeFor(bank, repository)
    await first.initialize()
    const selected = first.toView().question!.options[0]!
    await first.select(selected.id)

    const restored = runtimeFor(bank, repository)
    await restored.initialize()
    expect(restored.toView().question?.options.find((option) => option.state === 'selected')?.id).toBe(selected.id)

    const snapshot = repository.records.values().next().value as SceneVocabularyPracticeSnapshot
    repository.records.set(snapshot.sessionId, {
      ...snapshot,
      answers: [{ questionId: 'r13b-vocabulary-airport-q06', selectedOptionId: 'invented', submittedAt: snapshot.updatedAt }],
      selectedOptionId: null,
      phase: 'feedback',
    })
    const tampered = runtimeFor(bank, repository)
    await expect(tampered.initialize()).rejects.toThrowError(
      expect.objectContaining({ code: 'session-recovery-invalid' }),
    )
  })

  it('does not allow arbitrary ids or skipping feedback', async () => {
    const bank = await loadReleasedSceneBank()
    const runtime = runtimeFor(bank)
    await runtime.initialize()

    await expect(runtime.select('self-reported-correct')).rejects.toThrow(VocabularyError)
    await expect(runtime.submit()).rejects.toThrow(VocabularyError)
    await expect(runtime.advance()).rejects.toThrow(VocabularyError)
  })

  it('uses every released airport question once per round, restores the same cursor, and rotates without an immediate repeat', async () => {
    const bank = await loadReleasedSceneBank()
    const repository = new MemoryScenePracticeRepository()
    const first = runtimeFor(bank, repository)
    await first.initialize()
    const firstRound: string[] = []
    for (let index = 0; index < 48; index += 1) {
      const view = first.toView()
      firstRound.push(view.question!.questionId)
      const question = bank.getScene('airport-flight', 'airport')!.questions.find((entry) => entry.questionId === view.question!.questionId)!
      await first.select(view.question!.options.find((option) => option.labelZh === question.correctMeaningZh)!.id)
      await first.submit(); await first.advance()
    }
    expect(new Set(firstRound).size).toBe(48)
    const next = first.toView().question!.questionId
    expect(firstRound.slice(-3)).not.toContain(next)
    const restored = runtimeFor(bank, repository)
    await restored.initialize()
    expect(restored.toView().question!.questionId).toBe(next)
    expect(restored.toView().progress).toMatchObject({ answeredCount: 48, correctCount: 48, incorrectCount: 0, accuracy: 1 })
    await first.exit(); await first.exit()
    expect(first.currentSnapshot?.answers).toHaveLength(48)
    await first.startNewRound(); await first.startNewRound()
    expect(first.toView().progress.answeredCount).toBe(0)
    expect(first.currentSnapshot?.priorRounds).toContainEqual(
      expect.objectContaining({ answeredCount: 48, correctCount: 48 }),
    )
  })

  it('keeps an injected shared randomized scene round through refresh and feedback', async () => {
    const bank = await loadReleasedSceneBank()
    const repository = new MemoryScenePracticeRepository()
    const scene = bank.getScene('airport-flight', 'airport')!
    const round = createTrainingSupplyRound({ seed: 'scene-round', candidateItemIds: scene.questions.map((question) => question.questionId), shortTermExcludedItemIds: [] })
    const options = { categoryId: 'airport-flight', sceneId: 'airport', contentSource: createStaticDataSource(bank), repository, now: clock(), supplyRound: round } as unknown as ConstructorParameters<typeof SceneVocabularyPracticeRuntime>[0]
    const first = new SceneVocabularyPracticeRuntime(options)
    const started = await first.initialize()
    expect(started.supplyRound).toEqual(round)
    expect(first.toView().question?.questionId).toBe(round.order[0])
    const active = first.toView().question!
    const question = scene.questions.find((candidate) => candidate.questionId === active.questionId)!
    await first.select(active.options.find((option) => option.labelZh === question.correctMeaningZh)!.id)
    await first.submit()
    const advanced = await first.advance()
    expect(advanced.supplyRound).toMatchObject({ seed: 'scene-round', cursor: 1 })
    const restored = await new SceneVocabularyPracticeRuntime(options).initialize()
    expect(restored.supplyRound).toEqual(advanced.supplyRound)
  })

  it('keeps corrupt or drifted scene snapshots isolated so a retry cannot mutate daily or extra-training state', async () => {
    const bank = await loadReleasedSceneBank()
    const repository = new MemoryScenePracticeRepository()
    const first = runtimeFor(bank, repository)
    await first.initialize()
    const snapshot = first.currentSnapshot!
    repository.records.set(snapshot.sessionId, {
      ...snapshot,
      currentQuestionId: 'removed-by-content-drift',
    })

    const retry = runtimeFor(bank, repository)
    await expect(retry.initialize()).rejects.toThrowError(
      expect.objectContaining({ code: 'session-recovery-invalid' }),
    )
    expect(repository.records.get(snapshot.sessionId)).toMatchObject({
      currentQuestionId: 'removed-by-content-drift',
    })
  })

  it('only clears an explicitly confirmed invalid current-scene snapshot and starts from zero', async () => {
    const bank = await loadReleasedSceneBank()
    const repository = new MemoryScenePracticeRepository()
    const first = runtimeFor(bank, repository)
    await first.initialize()
    const snapshot = first.currentSnapshot!
    const otherSceneId = 'r13b-scene-vocabulary:city-transport:taxi'
    const otherSnapshot = {
      ...snapshot,
      sessionId: otherSceneId,
      categoryId: 'city-transport',
      sceneId: 'taxi',
      currentQuestionId: 'unrelated-scene-snapshot',
    }
    repository.records.set(otherSceneId, otherSnapshot)
    repository.records.set(snapshot.sessionId, {
      ...snapshot,
      questionIds: ['question-removed-by-content-drift'],
      currentQuestionId: 'question-removed-by-content-drift',
    })

    const recovered = runtimeFor(bank, repository)
    await expect(recovered.initialize()).rejects.toThrowError(
      expect.objectContaining({ code: 'session-recovery-invalid' }),
    )
    const [firstRecovery, repeatedRecovery] = await Promise.all([
      recovered.restartAfterInvalidSnapshot(),
      recovered.restartAfterInvalidSnapshot(),
    ])

    expect(firstRecovery).toEqual(repeatedRecovery)
    expect(firstRecovery).toMatchObject({
      categoryId: 'airport-flight',
      sceneId: 'airport',
      answers: [],
      correctCount: 0,
      incorrectCount: 0,
      selectedOptionId: null,
      phase: 'answering',
    })
    expect(recovered.toView().progress).toMatchObject({
      answeredCount: 0,
      correctCount: 0,
      accuracy: null,
    })
    expect(repository.discardCount).toBe(1)
    expect(repository.records.get(otherSceneId)).toEqual(otherSnapshot)
  })

  it('keeps the invalid record and remains retryable when clearing it fails', async () => {
    const bank = await loadReleasedSceneBank()
    const repository = new MemoryScenePracticeRepository()
    const first = runtimeFor(bank, repository)
    await first.initialize()
    const snapshot = first.currentSnapshot!
    const corrupted = {
      ...snapshot,
      currentQuestionId: 'missing-question',
    }
    repository.records.set(snapshot.sessionId, corrupted)
    const recovery = runtimeFor(bank, repository)
    await expect(recovery.initialize()).rejects.toThrowError(
      expect.objectContaining({ code: 'session-recovery-invalid' }),
    )
    repository.discardFailure = new Error('storage is temporarily unavailable')
    await expect(recovery.restartAfterInvalidSnapshot()).rejects.toThrow(
      'storage is temporarily unavailable',
    )
    expect(repository.records.get(snapshot.sessionId)).toEqual(corrupted)
    repository.discardFailure = undefined
    await expect(recovery.restartAfterInvalidSnapshot()).resolves.toMatchObject({
      answers: [],
      correctCount: 0,
    })
  })

  it('automatically migrates legitimate schema-1 selections and feedback without discarding them', async () => {
    const bank = await loadReleasedSceneBank()
    const repository = new MemoryScenePracticeRepository()
    const scene = bank.getScene('airport-flight', 'airport')!
    const questionIds = scene.questions.slice(0, 6).map((question) => question.questionId)
    const selectionSessionId = 'legacy-selection'
    const feedbackSessionId = 'legacy-feedback'
    const answer = {
      questionId: questionIds[0]!,
      selectedOptionId: legacyOptionId(questionIds[0]!, 0),
      submittedAt: '2026-07-30T00:00:00.000Z',
    }
    const base = {
      schemaVersion: 1,
      bankId: 'r13b-travel-scene-vocabulary',
      contentVersion: '1.0.0',
      categoryId: 'airport-flight',
      sceneId: 'airport',
      questionIds,
      answers: [answer],
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:01.000Z',
    } as const
    repository.records.set(selectionSessionId, {
      ...base,
      sessionId: selectionSessionId,
      selectedOptionId: legacyOptionId(questionIds[1]!, 1),
      phase: 'answering',
    } as unknown as SceneVocabularyPracticeSnapshot)
    repository.records.set(feedbackSessionId, {
      ...base,
      sessionId: feedbackSessionId,
      selectedOptionId: null,
      phase: 'feedback',
    } as unknown as SceneVocabularyPracticeSnapshot)

    const selected = new SceneVocabularyPracticeRuntime({
      categoryId: 'airport-flight', sceneId: 'airport', sessionId: selectionSessionId,
      contentSource: createStaticDataSource(bank), repository, now: clock(),
    })
    await selected.initialize()
    expect(selected.toView().question?.options.find((option) => option.state === 'selected')?.id)
      .toBe(legacyOptionId(questionIds[1]!, 1))
    expect(selected.toView().progress.answeredCount).toBe(1)

    const feedback = new SceneVocabularyPracticeRuntime({
      categoryId: 'airport-flight', sceneId: 'airport', sessionId: feedbackSessionId,
      contentSource: createStaticDataSource(bank), repository, now: clock(),
    })
    await feedback.initialize()
    expect(feedback.toView().status).toBe('feedback')
    expect(feedback.toView().progress.answeredCount).toBe(1)
    expect(repository.discardCount).toBe(0)
  })
})
