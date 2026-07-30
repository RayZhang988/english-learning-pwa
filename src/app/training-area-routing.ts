import {
  getTravelScene,
  type TrainingAreaScreen,
} from '../ui/index.ts'

export function trainingAreaScreenFromPath(
  pathname: string,
): TrainingAreaScreen {
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return ''
      }
    })
  if (segments[0] !== 'practice') {
    return { kind: 'hub' }
  }
  if (segments[1] === 'daily') {
    return { kind: 'daily' }
  }
  if (segments[1] === 'ai') {
    return { kind: 'ai' }
  }
  if (segments[1] !== 'scenes') {
    return { kind: 'hub' }
  }
  if (segments[3]) {
    return { kind: 'scene', sceneId: segments[3] }
  }
  if (segments[2]) {
    return { kind: 'category', categoryId: segments[2] }
  }
  return { kind: 'scenes' }
}

export function pathForTrainingAreaScreen(
  screen: TrainingAreaScreen,
): string {
  if (screen.kind === 'daily') return '/practice/daily'
  if (screen.kind === 'scenes') return '/practice/scenes'
  if (screen.kind === 'category') {
    return `/practice/scenes/${encodeURIComponent(screen.categoryId)}`
  }
  if (screen.kind === 'scene') {
    const categoryId = getTravelScene(screen.sceneId)?.category.id
    return categoryId
      ? `/practice/scenes/${encodeURIComponent(categoryId)}/${encodeURIComponent(screen.sceneId)}`
      : '/practice/scenes'
  }
  if (screen.kind === 'ai') return '/practice/ai'
  return '/practice'
}
