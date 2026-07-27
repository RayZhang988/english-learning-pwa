import { renderToStaticMarkup } from 'react-dom/server'
import {
  MemoryRouter,
  useLocation,
} from 'react-router'
import { describe, expect, it } from 'vitest'
import {
  createTravelVocabularyAssessmentRuntimeR1,
} from '../../features/assessment/index.ts'
import {
  ASSESSMENT_RESULTS_ROUTE,
  TravelVocabularyR1RouteHost,
} from './TravelVocabularyR1RouteHost.tsx'
import type {
  TravelVocabularyR1AppCoordinator,
  TravelVocabularyR1AppState,
} from './travel-vocabulary-r1-app-coordinator.ts'

function coordinatorWithState(
  state: TravelVocabularyR1AppState,
): TravelVocabularyR1AppCoordinator {
  return {
    state,
    subscribe() {
      return () => undefined
    },
    async initialize() {
      return state
    },
  } as unknown as TravelVocabularyR1AppCoordinator
}

function RouteHarness({
  coordinator,
}: {
  readonly coordinator: TravelVocabularyR1AppCoordinator
}) {
  const location = useLocation()
  return (
    <>
      <output
        data-current-route={`${location.pathname}${location.search}`}
      />
      <TravelVocabularyR1RouteHost coordinator={coordinator} />
    </>
  )
}

async function completedState(): Promise<TravelVocabularyR1AppState> {
  const runtime = createTravelVocabularyAssessmentRuntimeR1({
    now: () => '2026-07-27T08:00:00.000Z',
    createId: () => 'route-results-r1',
    random: () => 0.31,
  })
  let state = runtime.start()
  for (let stage = 0; stage < 5; stage += 1) {
    for (const question of state.questions) {
      state = runtime.markUncertain(question.id)
    }
    state = await runtime.submitStage()
    if (stage < 4) {
      state = runtime.continueToNextStage()
    }
  }
  if (!state.profile) {
    throw new Error('Expected completed R1 route profile.')
  }
  return { status: 'profile-ready', profile: state.profile }
}

describe('TravelVocabularyR1RouteHost', () => {
  it('keeps the assessment results URL and renders the real R1 schema 3 result', async () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={[ASSESSMENT_RESULTS_ROUTE]}>
        <RouteHarness
          coordinator={coordinatorWithState(await completedState())}
        />
      </MemoryRouter>,
    )

    expect(markup).toContain(
      'data-current-route="/assessment?mode=results"',
    )
    expect(markup).toContain('旅游英语词汇结果')
    expect(markup).toContain('五阶段明细')
    expect(markup).toContain('待校准')
    expect(markup).not.toMatch(
      /专项能力结果|开始综合水平测试|入口尚未接入/u,
    )
  })

  it('renders a legacy migration notice instead of a v1 score or placeholder', () => {
    const runtime = createTravelVocabularyAssessmentRuntimeR1({
      now: () => '2026-07-27T08:00:00.000Z',
      createId: () => 'route-migration-r1',
      random: () => 0.52,
    })
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/assessment']}>
        <RouteHarness
          coordinator={coordinatorWithState({
            status: 'ready',
            runtime: runtime.state,
            migrationSource: 'legacy-v1-profile',
          })}
        />
      </MemoryRouter>,
    )

    expect(markup).toContain('测试规则已更新')
    expect(markup).toContain('需要重新开始新的旅游英语词汇测试')
    expect(markup).toContain('开始新的 R1 测试')
    expect(markup).not.toMatch(/专项能力结果|暂无可用训练/u)
  })
})
