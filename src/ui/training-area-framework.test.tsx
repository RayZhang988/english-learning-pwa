import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  AiConversationPlaceholder,
  TrainingAreaHub,
  TravelSceneCategoryGrid,
  TravelSceneList,
  TravelScenePlaceholder,
  getTravelScene,
  getTravelSceneCategory,
  trainingAreas,
  travelSceneCategories,
  travelScenes,
} from './index.ts'

describe('R12 and R13-A training framework contract', () => {
  it('defines exactly three areas, six categories, and eighteen unique scenes', () => {
    expect(trainingAreas.map((area) => area.id)).toEqual([
      'daily',
      'scenes',
      'ai',
    ])
    expect(travelSceneCategories).toHaveLength(6)
    expect(travelScenes).toHaveLength(18)
    expect(new Set(travelScenes.map((scene) => scene.id))).toHaveLength(18)
    expect(travelSceneCategories.map((category) => category.scenes.length))
      .toEqual([7, 3, 2, 2, 3, 1])
    expect(getTravelScene('medical-pharmacy')).toMatchObject({
      category: { id: 'health' },
      scene: { title: '医疗与药店' },
    })
    expect(getTravelSceneCategory('missing')).toBeUndefined()
    expect(getTravelScene('missing')).toBeUndefined()
  })

  it('renders three honest top-level entries without pretending AI is active', () => {
    const markup = renderToStaticMarkup(
      <TrainingAreaHub onSelect={vi.fn()} />,
    )

    expect(markup.match(/data-training-area=/gu)).toHaveLength(3)
    expect(markup).toContain('日常训练')
    expect(markup).toContain('场景训练')
    expect(markup).toContain('AI 对话训练')
    expect(markup).toContain('暂未开放')
    expect(markup).not.toContain('开始AI对话')
  })

  it('adds exactly one optional wrong-answer tool after the three areas and returns only open intent', () => {
    const onOpen = vi.fn()
    const hub = TrainingAreaHub({ onSelect: vi.fn(), wrongAnswerLibrary: { status: 'ready', activeCount: 0, onOpen } })
    const markup = renderToStaticMarkup(hub)
    expect(markup.match(/data-training-area=/gu)).toHaveLength(3)
    expect(markup.match(/data-wrong-answer-library-entry=/gu)).toHaveLength(1)
    expect(markup).toContain('学习工具')
    expect(markup).toContain('暂无待复习错题')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('renders all category and child-scene entries with real structural counts', () => {
    const grid = renderToStaticMarkup(
      <TravelSceneCategoryGrid
        onBack={vi.fn()}
        onCategoryRequested={vi.fn()}
      />,
    )
    expect(grid.match(/data-scene-category=/gu)).toHaveLength(6)
    expect(grid).toContain('18个子场景')

    let renderedSceneCount = 0
    for (const category of travelSceneCategories) {
      const list = renderToStaticMarkup(
        <TravelSceneList
          categoryId={category.id}
          onBack={vi.fn()}
          onSceneRequested={vi.fn()}
        />,
      )
      renderedSceneCount += list.match(/data-travel-scene=/gu)?.length ?? 0
    }
    expect(renderedSceneCount).toBe(18)
  })

  it('keeps scene skills non-actionable and labels every one as content pending', () => {
    const markup = renderToStaticMarkup(
      <TravelScenePlaceholder
        sceneId="airport"
        onBack={vi.fn()}
      />,
    )

    expect(markup).toContain('场景框架已建立')
    expect(markup.match(/内容准备中/gu)).toHaveLength(3)
    expect(markup).toContain('词汇训练')
    expect(markup).toContain('听力训练')
    expect(markup).toContain('口语训练')
    expect(markup).not.toContain('开始训练')
    expect(markup.match(/<button/gu)).toHaveLength(1)
  })

  it('states the AI boundary without requesting credentials or creating progress', () => {
    const markup = renderToStaticMarkup(
      <AiConversationPlaceholder onBack={vi.fn()} />,
    )

    expect(markup).toContain('暂未开放')
    expect(markup).toContain('不接入开放式AI')
    expect(markup).toContain('不会要求API密钥或产生费用')
    expect(markup).not.toContain('开始对话')
  })
})
