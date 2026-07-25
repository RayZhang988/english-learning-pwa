import { renderToStaticMarkup } from 'react-dom/server'
import {
  MemoryRouter,
  useLocation,
} from 'react-router'
import { describe, expect, it } from 'vitest'
import { abilityProfile } from '../../learning-engine/test-fixtures.ts'
import {
  ASSESSMENT_RESULTS_ROUTE,
  AssessmentRouteHost,
} from './AssessmentRouteHost.tsx'
import type {
  AssessmentAppCoordinator,
  AssessmentAppState,
} from './assessment-app-coordinator.ts'

function coordinatorWithState(
  state: AssessmentAppState,
): AssessmentAppCoordinator {
  return {
    state,
    subscribe() {
      return () => undefined
    },
    async initialize() {
      return state
    },
  } as unknown as AssessmentAppCoordinator
}

function AssessmentResultHarness({
  coordinator,
}: {
  readonly coordinator: AssessmentAppCoordinator
}) {
  const location = useLocation()
  return (
    <>
      <output
        data-current-route={`${location.pathname}${location.search}`}
      />
      <AssessmentRouteHost coordinator={coordinator} />
    </>
  )
}

describe('AssessmentRouteHost results mode', () => {
  it('keeps the real assessment URL and displays the persisted profile', () => {
    const profile = abilityProfile()
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={[ASSESSMENT_RESULTS_ROUTE]}>
        <AssessmentResultHarness
          coordinator={coordinatorWithState({
            status: 'profile-ready',
            profile,
          })}
        />
      </MemoryRouter>,
    )

    expect(markup).toContain(
      'data-current-route="/assessment?mode=results"',
    )
    expect(markup).toContain('起点估算完成')
    expect(markup).toContain('专项能力结果')
    expect(markup).toContain('词汇')
    expect(markup).toContain('听力')
    expect(markup).toContain('口语')
    expect(markup).not.toMatch(
      /暂无可用训练|训练内容接入后|开始水平测试/u,
    )
  })
})
