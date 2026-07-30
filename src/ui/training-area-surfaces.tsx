import { Icon } from './icons.tsx'
import {
  getTravelScene,
  getTravelSceneCategory,
  trainingAreas,
  travelSceneCategories,
  type TrainingAreaId,
} from './training-area-model.ts'

export type TrainingAreaScreen =
  | { readonly kind: 'hub' }
  | { readonly kind: 'daily' }
  | { readonly kind: 'scenes' }
  | { readonly kind: 'category'; readonly categoryId: string }
  | { readonly kind: 'scene'; readonly sceneId: string }
  | { readonly kind: 'ai' }

export function TrainingAreaHub({
  onSelect,
}: {
  readonly onSelect: (areaId: TrainingAreaId) => void
}) {
  return (
    <>
      <header className="page-header">
        <span className="eyebrow">PRACTICE</span>
        <h1>选择训练方式</h1>
      </header>
      <p className="page-intro">
        日常训练负责每日学习；场景训练按旅行环节组织；AI 对话暂不开放。
      </p>
      <section className="training-area-list" aria-label="训练方式">
        {trainingAreas.map((area) => (
          <button
            className={`training-area-card training-area-card--${area.accent}`}
            type="button"
            key={area.id}
            data-training-area={area.id}
            onClick={() => onSelect(area.id)}
          >
            <span className={`task-icon task-icon--${area.accent}`}>
              <Icon name={area.icon} />
            </span>
            <span className="training-area-card__body">
              <span className="eyebrow">{area.eyebrow}</span>
              <strong>{area.title}</strong>
              <small>{area.description}</small>
              <span className="training-area-card__status">
                {area.statusLabel}
              </span>
            </span>
            <span className="training-area-card__action">
              {area.actionLabel}
              <Icon name="arrow-right" />
            </span>
          </button>
        ))}
      </section>
    </>
  )
}

function FrameworkHeader({
  eyebrow,
  title,
  onBack,
}: {
  readonly eyebrow: string
  readonly title: string
  readonly onBack: () => void
}) {
  return (
    <header className="detail-header training-framework-header">
      <button type="button" aria-label="返回上一级" onClick={onBack}>
        <Icon name="arrow-left" />
      </button>
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
    </header>
  )
}

export function TravelSceneCategoryGrid({
  onBack,
  onCategoryRequested,
}: {
  readonly onBack: () => void
  readonly onCategoryRequested: (categoryId: string) => void
}) {
  return (
    <>
      <FrameworkHeader
        eyebrow="TRAVEL SCENES"
        title="场景训练"
        onBack={onBack}
      />
      <p className="page-intro">
        先确认6个场景大类和18个子场景的结构；训练内容将在后续逐项加入。
      </p>
      <section className="scene-category-grid" aria-label="旅行场景分类">
        {travelSceneCategories.map((category) => (
          <button
            className="scene-category-card"
            type="button"
            key={category.id}
            data-scene-category={category.id}
            onClick={() => onCategoryRequested(category.id)}
          >
            <span className={`task-icon task-icon--${category.accent}`}>
              <Icon name={category.icon} />
            </span>
            <strong>{category.title}</strong>
            <small>{category.description}</small>
            <span>
              {category.scenes.length} 个场景
              <Icon name="chevron-right" />
            </span>
          </button>
        ))}
      </section>
    </>
  )
}

export function TravelSceneList({
  categoryId,
  onBack,
  onSceneRequested,
}: {
  readonly categoryId: string
  readonly onBack: () => void
  readonly onSceneRequested: (sceneId: string) => void
}) {
  const category = getTravelSceneCategory(categoryId)
  if (!category) {
    return (
      <FrameworkNotice
        title="找不到这个场景分类"
        description="场景结构可能已经更新，请返回场景训练重新选择。"
        onBack={onBack}
      />
    )
  }
  return (
    <>
      <FrameworkHeader
        eyebrow="SCENE CATEGORY"
        title={category.title}
        onBack={onBack}
      />
      <p className="page-intro">{category.description}</p>
      <ol className="scene-list" aria-label={`${category.title}子场景`}>
        {category.scenes.map((scene, index) => (
          <li key={scene.id}>
            <button
              type="button"
              data-travel-scene={scene.id}
              onClick={() => onSceneRequested(scene.id)}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <span>
                <strong>{scene.title}</strong>
                <small>{scene.description}</small>
              </span>
              <Icon name="chevron-right" />
            </button>
          </li>
        ))}
      </ol>
    </>
  )
}

export function TravelScenePlaceholder({
  sceneId,
  onBack,
}: {
  readonly sceneId: string
  readonly onBack: () => void
}) {
  const result = getTravelScene(sceneId)
  if (!result) {
    return (
      <FrameworkNotice
        title="找不到这个旅行场景"
        description="场景结构可能已经更新，请返回场景训练重新选择。"
        onBack={onBack}
      />
    )
  }
  return (
    <>
      <FrameworkHeader
        eyebrow={result.category.title}
        title={result.scene.title}
        onBack={onBack}
      />
      <p className="page-intro">{result.scene.description}</p>
      <section className="scene-placeholder" aria-label="场景内容状态">
        <span className="scene-placeholder__icon">
          <Icon name="spark" />
        </span>
        <span className="eyebrow">FRAMEWORK READY</span>
        <h2>场景框架已建立</h2>
        <p>
          当前只确认入口和结构。词汇、听力和口语内容尚未制作，因此不会生成假题目或假成绩。
        </p>
        <div className="scene-skill-list">
          {[
            ['book', '词汇训练'],
            ['headphones', '听力训练'],
            ['mic', '口语训练'],
          ].map(([icon, label]) => (
            <div key={label}>
              <Icon name={icon as 'book' | 'headphones' | 'mic'} />
              <strong>{label}</strong>
              <span>内容准备中</span>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

export function AiConversationPlaceholder({
  onBack,
}: {
  readonly onBack: () => void
}) {
  return (
    <>
      <FrameworkHeader
        eyebrow="AI CONVERSATION"
        title="AI 对话训练"
        onBack={onBack}
      />
      <section className="scene-placeholder" aria-label="AI对话开放状态">
        <span className="scene-placeholder__icon">
          <Icon name="spark" />
        </span>
        <span className="eyebrow">COMING LATER</span>
        <h2>暂未开放</h2>
        <p>
          第一版不接入开放式AI，也不会要求API密钥或产生费用。后续确认对话规则后再单独开发。
        </p>
      </section>
    </>
  )
}

function FrameworkNotice({
  title,
  description,
  onBack,
}: {
  readonly title: string
  readonly description: string
  readonly onBack: () => void
}) {
  return (
    <>
      <FrameworkHeader
        eyebrow="SCENE STATUS"
        title="场景训练"
        onBack={onBack}
      />
      <section className="scene-placeholder" role="status">
        <h2>{title}</h2>
        <p>{description}</p>
      </section>
    </>
  )
}
