/// <reference types="node" />

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createStaticDataSource } from '../../core/testing/index.ts'
import { VocabularyError } from './errors.ts'
import {
  createSceneVocabularyQuestionBank,
  SceneVocabularyPracticeRuntime,
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

  async load(sessionId: string): Promise<SceneVocabularyPracticeSnapshot | undefined> {
    return this.records.get(sessionId)
  }

  async save(snapshot: SceneVocabularyPracticeSnapshot): Promise<void> {
    this.records.set(snapshot.sessionId, structuredClone(snapshot))
  }

  async delete(sessionId: string): Promise<void> {
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
) {
  return new SceneVocabularyPracticeRuntime({
    categoryId: 'airport-flight',
    sceneId: 'airport',
    contentSource: createStaticDataSource(bank),
    repository,
    now: clock(),
  })
}

describe('R13-C scene vocabulary practice runtime', () => {
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
    const targetIndex = question.sentenceEn.indexOf(question.targetText)
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
})
