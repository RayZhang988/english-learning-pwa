import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import {
  createLearningEngineState,
  createPlanProgress,
  getPlanTaskAccess,
  type DailyPlan,
  type LearningTask,
  type PlanProgress,
  type TrainingModuleId,
} from '../../learning-engine/index.ts'
import { abilityProfile } from '../../learning-engine/test-fixtures.ts'
import { createActiveLearningRuntime } from './active-plan-repository.ts'
import {
  LearningAppContext,
  type LearningAppContextValue,
} from './learning-app-context.ts'
import type {
  LearningAppCoordinator,
  LearningAppState,
} from './learning-app-coordinator.ts'

interface CapturedRouteProps {
  readonly task: LearningTask
  readonly timingSessionFactory: unknown
  readonly supplyProvider?: {
    next(request: unknown): Promise<unknown>
  }
  readonly trainingBudgetStatus?: () =>
    | 'running'
    | 'finish-current-item'
  readonly onCompleted?: () => void
  readonly onExit: () => void
}

const routeCaptures = vi.hoisted(
  () => new Map<TrainingModuleId, CapturedRouteProps>(),
)

vi.mock('../../features/vocabulary/index.ts', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../features/vocabulary/index.ts')
    >()
  return {
    ...actual,
    VocabularyTrainingRoute: (props: CapturedRouteProps) => {
      routeCaptures.set('vocabulary', props)
      return null
    },
  }
})

vi.mock('../../features/listening/index.ts', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../features/listening/index.ts')
    >()
  return {
    ...actual,
    ListeningTrainingRoute: (props: CapturedRouteProps) => {
      routeCaptures.set('listening', props)
      return null
    },
  }
})

vi.mock('../../features/speaking/index.ts', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../features/speaking/index.ts')
    >()
  return {
    ...actual,
    SpeakingTrainingRoute: (props: CapturedRouteProps) => {
      routeCaptures.set('speaking', props)
      return null
    },
  }
})

import { productionEffectiveTimingSessions } from './effective-timing-production.ts'
import { TrainingRouteHost } from './training-route-hosts.tsx'

const trainingModules = [
  'vocabulary',
  'listening',
  'speaking',
] as const satisfies readonly TrainingModuleId[]

function task(moduleId: TrainingModuleId): LearningTask {
  return {
    schemaVersion: 1,
    taskId: `daily:2026-07-28:${moduleId}`,
    planId: 'daily:2026-07-28',
    sequence:
      moduleId === 'vocabulary'
        ? 1
        : moduleId === 'listening'
          ? 2
          : 3,
    learningUnitId: `unit-${moduleId}`,
    contentRef: `lesson://course/1/day-1/${moduleId}`,
    domain: moduleId,
    targetModuleId: moduleId,
    mode: 'learn',
    origin: 'new',
    difficultyLevel: 1,
    estimatedSeconds: 137,
    trainingBudget: {
      schemaVersion: 1,
      targetEffectiveSeconds: 900,
    },
    required: true,
    dueAt: null,
    skipLimit: 2,
    tags: ['day:1'],
  }
}

function plan(moduleId: TrainingModuleId): DailyPlan {
  const learningTask = task(moduleId)
  return {
    schemaVersion: 1,
    planId: learningTask.planId,
    localDate: '2026-07-28',
    generatedAt: '2026-07-28T08:00:00.000Z',
    targetSeconds: 2_700,
    plannedSeconds: learningTask.estimatedSeconds,
    unfilledSeconds: 2_700 - learningTask.estimatedSeconds,
    status: 'ready',
    tasks: [learningTask],
    allocations: {
      vocabulary: {
        domain: 'vocabulary',
        weaknessWeight: 1 / 3,
        targetDifficulty: 1,
        targetSeconds: 900,
        plannedSeconds:
          moduleId === 'vocabulary'
            ? learningTask.estimatedSeconds
            : 0,
      },
      listening: {
        domain: 'listening',
        weaknessWeight: 1 / 3,
        targetDifficulty: 1,
        targetSeconds: 900,
        plannedSeconds:
          moduleId === 'listening'
            ? learningTask.estimatedSeconds
            : 0,
      },
      speaking: {
        domain: 'speaking',
        weaknessWeight: 1 / 3,
        targetDifficulty: 1,
        targetSeconds: 900,
        plannedSeconds:
          moduleId === 'speaking'
            ? learningTask.estimatedSeconds
            : 0,
      },
    },
    warnings: [],
  }
}

function stateFor(
  moduleId: TrainingModuleId,
  completed: boolean,
  source: 'timing-segments' | 'legacy-event-duration' | undefined =
    undefined,
): Extract<LearningAppState, { readonly status: 'ready' }> {
  const dailyPlan = plan(moduleId)
  const initial = createPlanProgress(
    dailyPlan,
    '2026-07-28T08:00:00.000Z',
  )
  const progress: PlanProgress = completed
    ? {
        ...initial,
        status: 'completed',
        tasks: initial.tasks.map((execution) => ({
          ...execution,
          status: 'completed',
          completionKind: 'scored',
          spentSeconds: source === 'timing-segments' ? 132 : 600,
          effectiveSeconds:
            source === 'timing-segments' ? 125 : 600,
          excludedSeconds:
            source === 'timing-segments' ? 7 : undefined,
          timingSegmentCount:
            source === 'timing-segments' ? 2 : undefined,
          effectiveTimeSource: source,
          training: {
            ...execution.training!,
            remainingEffectiveSeconds: 0,
            status: 'completed',
          },
        })),
      }
    : initial
  return {
    status: 'ready',
    localDate: dailyPlan.localDate,
    runtime: createActiveLearningRuntime(progress),
    engineState: createLearningEngineState(
      abilityProfile(),
      '2026-07-28T08:00:00.000Z',
    ),
    assessmentProfileSchemaVersion: 3,
    taskAccess: getPlanTaskAccess(progress),
  }
}

function activeBudgetStateFor(
  moduleId: TrainingModuleId,
  status:
    | 'running'
    | 'finish-current-item'
    | 'content-exhausted',
): Extract<LearningAppState, { readonly status: 'ready' }> {
  const current = stateFor(moduleId, false)
  const remainingEffectiveSeconds =
    status === 'finish-current-item' ? 0 : 900
  const progress: PlanProgress = {
    ...current.runtime.activePlan,
    status: 'in-progress',
    tasks: current.runtime.activePlan.tasks.map((execution) => ({
      ...execution,
      status: status === 'content-exhausted' ? 'blocked' : 'active',
      training: {
        ...execution.training!,
        status,
        remainingEffectiveSeconds,
        contentExhausted:
          status === 'content-exhausted'
            ? {
                requestId: `${execution.task.taskId}:supply:1:initial`,
                cursor: null,
                reason: 'all-eligible-content-recently-used' as const,
                occurredAt: '2026-07-28T08:05:00.000Z',
              }
            : null,
      },
      updatedAt: '2026-07-28T08:06:00.000Z',
    })),
    updatedAt: '2026-07-28T08:06:00.000Z',
  }
  const runtime = createActiveLearningRuntime(progress)
  return {
    ...current,
    runtime,
    taskAccess: getPlanTaskAccess(progress),
  }
}

function appContext(state: LearningAppState): LearningAppContextValue {
  const coordinator = {
    state,
    eventSink: {
      async publish() {
        return undefined
      },
    },
    resolveTask(
      taskId: string,
      expectedModuleId?: TrainingModuleId,
    ) {
      if (state.status !== 'ready') {
        throw new TypeError('Plan is not ready.')
      }
      const execution = state.runtime.activePlan.tasks.find(
        (candidate) => candidate.task.taskId === taskId,
      )
      if (
        !execution ||
        execution.status === 'completed' ||
        execution.status === 'skipped' ||
        (expectedModuleId !== undefined &&
          execution.task.targetModuleId !== expectedModuleId)
      ) {
        throw new TypeError('Task cannot be started.')
      }
      return execution.task
    },
    async initialize() {
      return state
    },
    trainingBudgetStatus(
      taskId: string,
      expectedModuleId: TrainingModuleId,
    ) {
      if (state.status !== 'ready') {
        throw new TypeError('Plan is not ready.')
      }
      const execution = state.runtime.activePlan.tasks.find(
        (candidate) =>
          candidate.task.taskId === taskId &&
          candidate.task.targetModuleId === expectedModuleId,
      )
      if (!execution?.training) {
        throw new TypeError('Training budget is unavailable.')
      }
      return execution.training.status === 'finish-current-item' ||
        execution.training.status === 'completed'
        ? 'finish-current-item'
        : 'running'
    },
  } as unknown as LearningAppCoordinator
  return { coordinator, state }
}

function renderHost(
  moduleId: TrainingModuleId,
  state: LearningAppState,
): string {
  const taskId =
    state.status === 'ready'
      ? state.runtime.activePlan.plan.tasks[0].taskId
      : 'missing'
  return renderToStaticMarkup(
    <LearningAppContext.Provider value={appContext(state)}>
      <MemoryRouter
        initialEntries={[
          `/${moduleId}?taskId=${encodeURIComponent(taskId)}`,
        ]}
      >
        <TrainingRouteHost moduleId={moduleId} />
      </MemoryRouter>
    </LearningAppContext.Provider>,
  )
}

describe('TrainingRouteHost R3 production integration', () => {
  it.each([
    'vocabulary',
    'listening',
    'speaking',
  ] as const)(
    'injects the shared timing and continuous-supply ports into %s',
    (moduleId) => {
      routeCaptures.clear()
      const state = stateFor(moduleId, false)
      const markup = renderHost(moduleId, state)
      const captured = routeCaptures.get(moduleId)

      expect(captured?.task.taskId).toBe(
        state.runtime.activePlan.plan.tasks[0].taskId,
      )
      expect(captured?.timingSessionFactory).toBe(
        productionEffectiveTimingSessions,
      )
      expect(captured?.supplyProvider?.next).toEqual(
        expect.any(Function),
      )
      expect(captured?.trainingBudgetStatus?.()).toBe('running')
      expect(captured?.onCompleted).toEqual(expect.any(Function))
      expect(captured?.onExit).toEqual(expect.any(Function))
      expect(markup).toContain('data-budget-status="running"')
      expect(markup).toContain(
        'data-target-effective-seconds="900"',
      )
      expect(markup).not.toContain('data-estimate-seconds')
    },
  )

  it.each(trainingModules)(
    'immediately reflects %s retry recovery from exhausted to running or finish-current-item',
    (moduleId) => {
      routeCaptures.clear()
      const exhaustedMarkup = renderHost(
        moduleId,
        activeBudgetStateFor(moduleId, 'content-exhausted'),
      )
      expect(exhaustedMarkup).toContain(
        'data-budget-status="content-exhausted"',
      )

      routeCaptures.clear()
      const runningMarkup = renderHost(
        moduleId,
        activeBudgetStateFor(moduleId, 'running'),
      )
      expect(routeCaptures.get(moduleId)?.trainingBudgetStatus?.()).toBe(
        'running',
      )
      expect(runningMarkup).toContain(
        'data-budget-status="running"',
      )
      expect(runningMarkup).not.toContain(
        'data-budget-status="content-exhausted"',
      )

      routeCaptures.clear()
      const finishingMarkup = renderHost(
        moduleId,
        activeBudgetStateFor(moduleId, 'finish-current-item'),
      )
      expect(routeCaptures.get(moduleId)?.trainingBudgetStatus?.()).toBe(
        'finish-current-item',
      )
      expect(finishingMarkup).toContain(
        'data-budget-status="finish-current-item"',
      )
      expect(finishingMarkup).toContain(
        'data-remaining-effective-seconds="0"',
      )
    },
  )

  it.each([
    ['vocabulary', '词汇训练已完成'],
    ['listening', '听力训练已完成'],
    ['speaking', '口语训练已完成'],
  ] as const)(
    'restores the trusted completion duration for %s without restarting the feature',
    (moduleId, title) => {
      routeCaptures.clear()
      const markup = renderHost(
        moduleId,
        stateFor(moduleId, true, 'timing-segments'),
      )

      expect(routeCaptures.has(moduleId)).toBe(false)
      expect(markup).toContain(title)
      expect(markup).toContain('data-duration-state="reliable"')
      expect(markup).toContain('实际有效练习')
      expect(markup).toContain('data-budget-status="completed"')
      expect(markup).toContain(
        'data-remaining-effective-seconds="0"',
      )
      expect(markup).toContain('返回今日计划')
    },
  )

  it('shows old completion data as unavailable instead of using attempt duration', () => {
    const markup = renderHost(
      'vocabulary',
      stateFor('vocabulary', true, 'legacy-event-duration'),
    )

    expect(markup).toContain('data-duration-state="unavailable"')
    expect(markup).toContain('本次暂无可靠用时')
    expect(markup).not.toContain('10 分钟')
  })
})
