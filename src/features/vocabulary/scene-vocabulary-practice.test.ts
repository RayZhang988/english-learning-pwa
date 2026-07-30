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

describe('R13-B scene vocabulary practice runtime', () => {
  it('accepts the released 18-scene, 108-question bank and rejects a forbidden sentence translation contract', async () => {
    const bank = await loadReleasedSceneBank()

    expect(bank.scenes).toHaveLength(18)
    expect(bank.scenes.flatMap((scene) => scene.questions)).toHaveLength(108)
    expect(bank.getScene('health', 'medical-pharmacy')?.questions).toHaveLength(6)
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
    expect(view.progress).toEqual({
      answeredCount: 0,
      correctCount: 0,
      totalCount: 6,
      accuracy: null,
    })
    expect(view.question).toMatchObject({
      questionId: 'r13b-vocabulary-airport-q01',
      promptZh: '这个词是什么意思？',
      sentenceEn: {
        beforeTarget: 'Please show your ',
        targetText: 'passport',
        afterTarget: ' at the check-in counter.',
      },
      targetPlayback: {
        intent: 'play-target-only',
        text: 'passport',
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

    for (let index = 0; index < scene.questions.length; index += 1) {
      const before = runtime.toView()
      const question = scene.questions[index]!
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

    const completed = runtime.toView()
    expect(completed).toEqual({
      status: 'completed',
      progress: {
        answeredCount: 6,
        correctCount: 5,
        totalCount: 6,
        accuracy: 5 / 6,
      },
      completion: { title: '场景词汇练习完成' },
    })
    const persisted = [...repository.records.values()][0]!
    expect(persisted.answers).toHaveLength(6)
    expect('correctCount' in persisted).toBe(false)
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
})
