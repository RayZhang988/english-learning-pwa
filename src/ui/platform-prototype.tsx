import {
  LearningAppVisualDemo,
  UiVisualFixture,
} from './visual-fixture.tsx'
import { isUiVisualFixtureId } from './visual-fixture-ids.ts'

export function PlatformPrototype() {
  if (import.meta.env.DEV) {
    const fixtureId = new URLSearchParams(window.location.search).get(
      'ui-fixture',
    )
    if (isUiVisualFixtureId(fixtureId)) {
      return <UiVisualFixture id={fixtureId} />
    }
  }

  return <LearningAppVisualDemo />
}
