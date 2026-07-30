import { readFile } from 'node:fs/promises'
import { matchRoutes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStaticDataSource } from '../core/testing/index.ts'
import {
  createSceneVocabularyQuestionBank,
  SceneVocabularyPracticeRuntime,
  SCENE_VOCABULARY_STORAGE_NAMESPACE,
} from '../features/vocabulary/index.ts'
import { localStorageService } from '../storage/index.ts'
import { appRoutes } from './route-definitions.tsx'
import { SceneVocabularyPracticeRouteHost } from './scene-vocabulary-practice-route.tsx'
import { playSceneVocabularyTarget } from './scene-vocabulary-target-playback.ts'

const projectRoot = new URL('../../', import.meta.url)

async function releasedBank() {
  return createSceneVocabularyQuestionBank(JSON.parse(await readFile(
    new URL(
      'content/lessons/survival-travel-american-4w/scene-vocabulary-questions.v1.json',
      projectRoot,
    ),
    'utf8',
  )) as unknown)
}

afterEach(async () => {
  await localStorageService.namespace(SCENE_VOCABULARY_STORAGE_NAMESPACE).clear()
  vi.restoreAllMocks()
})

describe('R13-B production route integration', () => {
  it('routes every concrete scene URL to the real practice host before the framework wildcard', () => {
    const matched = matchRoutes(
      appRoutes,
      '/practice/scenes/airport-flight/airport',
    )
    const route = matched?.at(-1)?.route

    expect(
      (route?.element as { readonly type?: unknown } | undefined)?.type,
    ).toBe(SceneVocabularyPracticeRouteHost)
    expect(matchRoutes(appRoutes, '/practice/scenes/airport-flight')).toHaveLength(2)
  })

  it('persists a selected scene answer in the dedicated namespace and restores it without creating daily-plan data', async () => {
    const bank = await releasedBank()
    const source = createStaticDataSource(bank)
    const first = new SceneVocabularyPracticeRuntime({
      categoryId: 'airport-flight',
      sceneId: 'airport',
      contentSource: source,
    })
    await first.initialize()
    const selected = first.toView().question!.options[2]!
    await first.select(selected.id)

    const second = new SceneVocabularyPracticeRuntime({
      categoryId: 'airport-flight',
      sceneId: 'airport',
      contentSource: source,
    })
    await second.initialize()

    expect(
      second.toView().question?.options.find((option) => option.state === 'selected')?.id,
    ).toBe(selected.id)
    expect(
      await localStorageService.namespace(SCENE_VOCABULARY_STORAGE_NAMESPACE).keys(),
    ).toEqual(['session:r13b-scene-vocabulary:airport-flight:airport'])
    expect(
      await localStorageService.namespace('learning.active-plan').keys(),
    ).toEqual([])
    expect(
      await localStorageService.namespace('learning.extra-training').keys(),
    ).toEqual([])
  })

  it('forwards only the highlighted target text to browser speech', () => {
    const speech = {
      cancel: vi.fn(),
      speak: vi.fn(),
    }

    playSceneVocabularyTarget(speech, {
      intent: 'play-target-only',
      text: 'passport',
      locale: 'en-US',
    })

    expect(speech.cancel).toHaveBeenCalledOnce()
    expect(speech.speak).toHaveBeenCalledWith(
      { text: 'passport', locale: 'en-US', rate: 1 },
      {},
    )
    expect(speech.speak).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Please show your passport at the check-in counter.' }),
      expect.anything(),
    )
  })
})
