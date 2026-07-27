import { describe, expect, it } from 'vitest'
import { travelVocabularyBankR1 } from '../../../content/assessment/travel-vocabulary-bank.r1.ts'
import packageIndex from '../../../content/curriculum/package-index.v1.json'
import week1 from '../../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import {
  ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
  createPlacementAssessmentRuntime,
  createTravelVocabularyAssessmentRuntimeR1,
  createVocabularyPlacementRuntime,
  LATEST_PROFILE_KEY,
  TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
  VersionedAssessmentProfileRepository,
  VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
  type PublicTravelVocabularyQuestionR1,
  type TravelVocabularyAssessmentRuntimeSnapshotR1,
} from '../../features/assessment/index.ts'
import {
  LEARNING_ENGINE_STORAGE_NAMESPACE,
  LearningEngineRepository,
} from '../../learning-engine/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import { abilityProfile } from '../../learning-engine/test-fixtures.ts'
import {
  ActivePlanRepository,
  LEARNING_RUNTIME_STORAGE_NAMESPACE,
} from '../learning/active-plan-repository.ts'
import {
  projectLearningCandidates,
  type LearningCandidateSource,
} from '../learning/course-candidate-source.ts'
import { LearningAppCoordinator } from '../learning/learning-app-coordinator.ts'
import {
  TravelVocabularyR1AppCoordinator,
  type TravelVocabularyR1AppState,
} from './travel-vocabulary-r1-app-coordinator.ts'
import {
  TRAVEL_VOCABULARY_CORRUPT_BACKUP_PREFIX_R1,
  TravelVocabularyR1SnapshotRepository,
} from './travel-vocabulary-r1-snapshot-repository.ts'

class MemoryNamespaceStore implements NamespaceStore {
  readonly records = new Map<string, StoredRecord<unknown>>()
  readonly writes: string[] = []
  readonly namespace: string
  failNextPut = false
  failNextPutKey: string | null = null

  constructor(namespace: string) {
    this.namespace = namespace
  }

  async get<T>(key: string): Promise<StoredRecord<T> | undefined> {
    return this.records.get(key) as StoredRecord<T> | undefined
  }

  async put<T>(
    key: string,
    value: T,
    schemaVersion = 1,
  ): Promise<void> {
    if (this.failNextPut || this.failNextPutKey === key) {
      this.failNextPut = false
      this.failNextPutKey = null
      throw new Error('simulated local storage write failure')
    }
    this.writes.push(key)
    this.records.set(key, {
      namespace: this.namespace,
      key,
      value,
      schemaVersion,
      updatedAt: '2026-07-27T08:00:00.000Z',
    })
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }

  async keys(): Promise<readonly string[]> {
    return [...this.records.keys()]
  }

  async clear(): Promise<void> {
    this.records.clear()
  }
}

const releasedCourseDocuments = {
  packageIndex,
  lessonsByPath: {
    'content/lessons/survival-travel-american-4w/week-1.v1.json':
      week1,
    'content/lessons/survival-travel-american-4w/week-2.v1.json':
      week2,
    'content/lessons/survival-travel-american-4w/week-3.v1.json':
      week3,
    'content/lessons/survival-travel-american-4w/week-4.v1.json':
      week4,
  },
}

const releasedCourseCandidates: LearningCandidateSource = {
  async load(completedLearningUnitIds, availableModuleIds) {
    return projectLearningCandidates(
      releasedCourseDocuments,
      completedLearningUnitIds,
      availableModuleIds,
    )
  },
}

function requireReady(
  state: TravelVocabularyR1AppState,
): Extract<TravelVocabularyR1AppState, { status: 'ready' }> {
  if (state.status !== 'ready') {
    throw new Error(`Expected ready R1 state, received ${state.status}.`)
  }
  return state
}

function correctOptionId(
  question: PublicTravelVocabularyQuestionR1,
): string {
  const candidate = travelVocabularyBankR1.stages
    .flatMap((stage) => stage.candidates)
    .find((entry) => entry.word === question.word)
  const option = question.options.find(
    (entry) => entry.text === candidate?.meaningZh,
  )
  if (!candidate || !option) {
    throw new Error(`Cannot resolve the test answer for ${question.id}.`)
  }
  return option.id
}

function wrongOptionId(
  question: PublicTravelVocabularyQuestionR1,
): string {
  const correct = correctOptionId(question)
  const option = question.options.find((entry) => entry.id !== correct)
  if (!option) {
    throw new Error(`Cannot resolve a wrong option for ${question.id}.`)
  }
  return option.id
}

describe('R1 production application integration', () => {
  it('completes 150 questions with mixed 0/20/50/100% stages, persists schema 3, and creates a conservative first-day plan', async () => {
    const assessmentStore = new MemoryNamespaceStore(
      'feature.assessment',
    )
    const planStore = new MemoryNamespaceStore(
      LEARNING_RUNTIME_STORAGE_NAMESPACE,
    )
    const engineStore = new MemoryNamespaceStore(
      LEARNING_ENGINE_STORAGE_NAMESPACE,
    )
    const profiles = new VersionedAssessmentProfileRepository(
      assessmentStore,
    )
    const createLearningCoordinator = () =>
      new LearningAppCoordinator({
        profiles,
        activePlans: new ActivePlanRepository(planStore),
        engineStates: new LearningEngineRepository(engineStore),
        candidates: releasedCourseCandidates,
        availableModuleIds: new Set([
          'vocabulary',
          'listening',
          'speaking',
        ]),
        now: () => new Date('2026-07-27T08:00:00.000+08:00'),
        createId: () => 'r1-first-day-plan',
      })
    const learning = createLearningCoordinator()
    expect((await learning.initialize()).status).toBe(
      'assessment-required',
    )

    let clock = Date.parse('2026-07-27T00:00:00.000Z')
    const createAssessmentCoordinator = () =>
      new TravelVocabularyR1AppCoordinator({
        snapshots: new TravelVocabularyR1SnapshotRepository(
          assessmentStore,
        ),
        profiles,
        dailyPlans: learning,
        now: () => new Date(clock).toISOString(),
        createId: () => 'r1-assessment-session',
        random: () => 0.37,
      })
    let assessment = createAssessmentCoordinator()
    let state = requireReady(await assessment.initialize())
    expect(state.runtime.lifecycle).toBe('intro')
    state = requireReady(await assessment.start())

    const firstQuestion = state.runtime.questions[0]
    await assessment.selectChoice(
      firstQuestion.id,
      wrongOptionId(firstQuestion),
    )
    await assessment.navigate(5)
    const sixthQuestion = requireReady(assessment.state).runtime
      .questions[5]
    await assessment.markUncertain(sixthQuestion.id)
    const beforePause = requireReady(assessment.state).runtime
    const fixedQuestions = beforePause.questions
    const fixedDrafts = beforePause.draftAnswers
    state = requireReady(await assessment.pause())
    expect(state.runtime.lifecycle).toBe('paused')

    assessment = createAssessmentCoordinator()
    state = requireReady(await assessment.initialize())
    expect(state.runtime.lifecycle).toBe('paused')
    expect(state.runtime.questions).toEqual(fixedQuestions)
    expect(state.runtime.draftAnswers).toEqual(fixedDrafts)
    expect(state.runtime.currentQuestionIndex).toBe(5)
    state = requireReady(await assessment.resume())

    const correctTargets = [0, 6, 15, 30, 12] as const
    const expectedRates = [0, 0.2, 0.5, 1, 0.4] as const
    for (let stageIndex = 0; stageIndex < 5; stageIndex += 1) {
      const stageQuestions = state.runtime.questions
      for (
        let questionIndex = 0;
        questionIndex < stageQuestions.length;
        questionIndex += 1
      ) {
        const question = stageQuestions[questionIndex]
        clock += 1_000
        state = requireReady(
          await assessment.navigate(questionIndex),
        )
        if (stageIndex === 4 && questionIndex >= 12 && questionIndex < 18) {
          state = requireReady(
            await assessment.markUncertain(question.id),
          )
          continue
        }
        const optionId =
          questionIndex < correctTargets[stageIndex]
            ? correctOptionId(question)
            : wrongOptionId(question)
        state = requireReady(
          await assessment.selectChoice(question.id, optionId),
        )
        if (stageIndex === 2 && questionIndex === 0) {
          state = requireReady(
            await assessment.clearAnswer(question.id),
          )
          state = requireReady(
            await assessment.selectChoice(
              question.id,
              correctOptionId(question),
            ),
          )
        }
      }

      state = requireReady(await assessment.submitStage())
      const result = state.runtime.latestStageResult
      expect(result?.masteryRate).toBe(expectedRates[stageIndex])
      expect(result?.correctCount).toBe(correctTargets[stageIndex])
      if (stageIndex < 4) {
        expect(state.runtime.actions.canContinueToNextStage).toBe(true)
        state = requireReady(
          await assessment.continueToNextStage(),
        )
        expect(state.runtime.lifecycle).toBe('active')
      }
    }

    expect(state.runtime.lifecycle).toBe('completed')
    const profile = state.runtime.profile
    expect(profile?.schemaVersion).toBe(3)
    expect(profile?.travelVocabulary.stageResults).toHaveLength(5)
    expect(profile?.travelVocabulary.validQuestionCount).toBe(150)
    expect(profile?.abilities.listening.calibrationState).toBe(
      'pending-calibration',
    )
    expect(profile?.abilities.speaking.calibrationState).toBe(
      'pending-calibration',
    )
    expect(await profiles.loadLatest()).toEqual(profile)
    expect(
      assessmentStore.records.get(
        TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
      )?.schemaVersion,
    ).toBe(3)

    expect(learning.state.status).toBe('ready')
    if (learning.state.status !== 'ready') {
      throw new Error('Expected the schema 3 first-day plan.')
    }
    expect(learning.state.assessmentProfileSchemaVersion).toBe(3)
    expect(
      learning.state.engineState.progress.r1VocabularyStartPlacement,
    ).toBeDefined()
    expect(
      learning.state.runtime.activePlan.plan.tasks.some(
        (task) => task.mode === 'calibration',
      ),
    ).toBe(false)
    expect(
      new Set(
        learning.state.runtime.activePlan.plan.tasks.map(
          (task) => task.targetModuleId,
        ),
      ),
    ).toEqual(new Set(['vocabulary', 'listening', 'speaking']))
    const planId = learning.state.runtime.activePlan.plan.planId

    const refreshedLearning = createLearningCoordinator()
    const refreshedAssessment =
      new TravelVocabularyR1AppCoordinator({
        snapshots: new TravelVocabularyR1SnapshotRepository(
          assessmentStore,
        ),
        profiles,
        dailyPlans: refreshedLearning,
        now: () => new Date(clock + 60_000).toISOString(),
        createId: () => 'must-not-replace-r1-session',
        random: () => 0.91,
      })
    const restored = requireReady(
      await refreshedAssessment.initialize(),
    )
    expect(restored.runtime.lifecycle).toBe('completed')
    expect(refreshedLearning.state.status).toBe('ready')
    if (refreshedLearning.state.status === 'ready') {
      expect(
        refreshedLearning.state.runtime.activePlan.plan.planId,
      ).toBe(planId)
    }
  })

  it('migrates a valid v1 runtime to a new R1 sample without deleting or rewriting the legacy record', async () => {
    const store = new MemoryNamespaceStore('feature.assessment')
    const legacyRuntime = createPlacementAssessmentRuntime({
      now: () => '2026-07-27T00:00:00.000Z',
      createId: () => 'legacy-v1-session',
    })
    const legacySnapshot = legacyRuntime.toSnapshot()
    await store.put(
      ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
      legacySnapshot,
      1,
    )
    const coordinator = new TravelVocabularyR1AppCoordinator({
      snapshots: new TravelVocabularyR1SnapshotRepository(store),
      profiles: new VersionedAssessmentProfileRepository(store),
      dailyPlans: {
        async initialize() {
          return { status: 'ready' }
        },
      },
      now: () => '2026-07-27T01:00:00.000Z',
      createId: () => 'migrated-r1-session',
      random: () => 0.22,
    })

    const state = requireReady(await coordinator.initialize())
    expect(state.runtime.lifecycle).toBe('intro')
    expect(state.runtime.migrationNotice).toBe(
      'legacy-measurement-incompatible-new-sample-required',
    )
    expect(state.migrationSource).toBe('legacy-v1-runtime')
    expect(
      store.records.get(ASSESSMENT_RUNTIME_SNAPSHOT_KEY)?.value,
    ).toEqual(legacySnapshot)
    expect(
      store.records.get(TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1)
        ?.schemaVersion,
    ).toBe(3)
  })

  it('migrates a valid v2 runtime before v1 and preserves the v2 source record', async () => {
    const store = new MemoryNamespaceStore('feature.assessment')
    const legacyV2 = createVocabularyPlacementRuntime({
      now: () => '2026-07-27T00:00:00.000Z',
      createId: () => 'legacy-v2-session',
    }).toSnapshot()
    const legacyV1 = createPlacementAssessmentRuntime({
      now: () => '2026-07-27T00:00:00.000Z',
      createId: () => 'legacy-v1-ignored',
    }).toSnapshot()
    await store.put(ASSESSMENT_RUNTIME_SNAPSHOT_KEY, legacyV1, 1)
    await store.put(
      VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
      legacyV2,
      2,
    )
    const coordinator = new TravelVocabularyR1AppCoordinator({
      snapshots: new TravelVocabularyR1SnapshotRepository(store),
      profiles: new VersionedAssessmentProfileRepository(store),
      dailyPlans: {
        async initialize() {
          return { status: 'ready' }
        },
      },
      now: () => '2026-07-27T01:00:00.000Z',
      createId: () => 'migrated-v2-r1-session',
      random: () => 0.73,
    })

    const state = requireReady(await coordinator.initialize())
    expect(state.migrationSource).toBe('legacy-v2-runtime')
    expect(state.runtime.migrationNotice).toBe(
      'legacy-measurement-incompatible-new-sample-required',
    )
    expect(
      store.records.get(VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY)
        ?.value,
    ).toEqual(legacyV2)
    expect(
      store.records.get(ASSESSMENT_RUNTIME_SNAPSHOT_KEY)?.value,
    ).toEqual(legacyV1)
  })

  it('shows a profile-only legacy migration and does not pass the old score off as R1', async () => {
    const store = new MemoryNamespaceStore('feature.assessment')
    const profiles = new VersionedAssessmentProfileRepository(store)
    await profiles.saveLatest(abilityProfile())
    const coordinator = new TravelVocabularyR1AppCoordinator({
      snapshots: new TravelVocabularyR1SnapshotRepository(store),
      profiles,
      dailyPlans: {
        async initialize() {
          return { status: 'ready' }
        },
      },
      now: () => '2026-07-27T01:00:00.000Z',
      createId: () => 'profile-only-r1-session',
      random: () => 0.61,
    })

    const state = requireReady(await coordinator.initialize())
    expect(state.runtime.lifecycle).toBe('intro')
    expect(state.runtime.profile).toBeNull()
    expect(state.migrationSource).toBe('legacy-v1-profile')
  })

  it('preserves a corrupt R1 record and exposes a recoverable fresh-sample path', async () => {
    const store = new MemoryNamespaceStore('feature.assessment')
    const corrupt = {
      schemaVersion: 3,
      assessmentKind: 'staged-travel-vocabulary',
      broken: true,
    }
    await store.put(
      TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
      corrupt,
      3,
    )
    const coordinator = new TravelVocabularyR1AppCoordinator({
      snapshots: new TravelVocabularyR1SnapshotRepository(store),
      profiles: new VersionedAssessmentProfileRepository(store),
      dailyPlans: {
        async initialize() {
          return { status: 'ready' }
        },
      },
      now: () => '2026-07-27T02:00:00.000Z',
      createId: () => 'corrupt-recovery',
      random: () => 0.48,
    })

    const failed = await coordinator.initialize()
    expect(failed.status).toBe('error')
    if (failed.status === 'error') {
      expect(failed.recovery).toBe('preserve-and-start-fresh')
      expect(failed.error.message).toContain('原始数据仍保留')
    }
    expect(
      store.records.get(TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1)
        ?.value,
    ).toEqual(corrupt)

    const recovered = requireReady(
      await coordinator.recoverWithFreshSample(),
    )
    expect(recovered.runtime.lifecycle).toBe('intro')
    expect(
      [...store.records.keys()].some((key) =>
        key.startsWith(TRAVEL_VOCABULARY_CORRUPT_BACKUP_PREFIX_R1),
      ),
    ).toBe(true)
  })

  it('deduplicates rapid repeated answer and stage-submit actions without advancing twice', async () => {
    const store = new MemoryNamespaceStore('feature.assessment')
    const coordinator = new TravelVocabularyR1AppCoordinator({
      snapshots: new TravelVocabularyR1SnapshotRepository(store),
      profiles: new VersionedAssessmentProfileRepository(store),
      dailyPlans: {
        async initialize() {
          return { status: 'ready' }
        },
      },
      now: () => '2026-07-27T03:00:00.000Z',
      createId: () => 'deduplicated-r1-session',
      random: () => 0.27,
    })
    await coordinator.initialize()
    let state = requireReady(await coordinator.start())
    const first = state.runtime.questions[0]
    const firstAnswer = coordinator.markUncertain(first.id)
    const repeatedAnswer = coordinator.markUncertain(first.id)
    expect(repeatedAnswer).toBe(firstAnswer)
    state = requireReady(await repeatedAnswer)

    for (const question of state.runtime.questions.slice(1)) {
      state = requireReady(
        await coordinator.markUncertain(question.id),
      )
    }
    const firstSubmit = coordinator.submitStage()
    const repeatedSubmit = coordinator.submitStage()
    expect(repeatedSubmit).toBe(firstSubmit)
    state = requireReady(await repeatedSubmit)

    expect(state.runtime.lifecycle).toBe('stage-summary')
    expect(state.runtime.progress.currentStage).toBe(1)
    expect(state.runtime.latestStageResult?.validQuestionCount).toBe(30)
  })

  it('uses the runtime atomic next action, persists uncertain before navigation, and restores that exact state', async () => {
    const store = new MemoryNamespaceStore('feature.assessment')
    const createCoordinator = () =>
      new TravelVocabularyR1AppCoordinator({
        snapshots: new TravelVocabularyR1SnapshotRepository(store),
        profiles: new VersionedAssessmentProfileRepository(store),
        dailyPlans: {
          async initialize() {
            return { status: 'ready' }
          },
        },
        now: () => '2026-07-27T03:15:00.000Z',
        createId: () => 'atomic-next-r1-session',
        random: () => 0.33,
      })
    const coordinator = createCoordinator()
    await coordinator.initialize()
    const started = requireReady(await coordinator.start())
    const firstQuestionId = started.runtime.questions[0].id

    const firstAdvance = coordinator.advanceToNextQuestion()
    const repeatedAdvance = coordinator.advanceToNextQuestion()
    expect(repeatedAdvance).toBe(firstAdvance)
    const advanced = requireReady(await repeatedAdvance)

    expect(advanced.runtime.currentQuestionIndex).toBe(1)
    expect(advanced.runtime.draftAnswers[firstQuestionId]?.kind).toBe(
      'uncertain',
    )

    const stored = store.records.get(
      TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
    )?.value as TravelVocabularyAssessmentRuntimeSnapshotR1
    expect(stored.session.currentQuestionIndex).toBe(1)
    expect(stored.session.draftAnswers[firstQuestionId]?.kind).toBe(
      'uncertain',
    )

    const restored = requireReady(await createCoordinator().initialize())
    expect(restored.runtime.lifecycle).toBe('paused')
    expect(restored.runtime.currentQuestionIndex).toBe(1)
    expect(restored.runtime.draftAnswers[firstQuestionId]?.kind).toBe(
      'uncertain',
    )
  })

  it('submits a partially answered stage and lets the runtime fill every unanswered item as uncertain', async () => {
    const store = new MemoryNamespaceStore('feature.assessment')
    const coordinator = new TravelVocabularyR1AppCoordinator({
      snapshots: new TravelVocabularyR1SnapshotRepository(store),
      profiles: new VersionedAssessmentProfileRepository(store),
      dailyPlans: {
        async initialize() {
          return { status: 'ready' }
        },
      },
      now: () => '2026-07-27T03:20:00.000Z',
      createId: () => 'partial-submit-r1-session',
      random: () => 0.43,
    })
    await coordinator.initialize()
    let state = requireReady(await coordinator.start())
    const firstQuestion = state.runtime.questions[0]
    state = requireReady(
      await coordinator.selectChoice(
        firstQuestion.id,
        correctOptionId(firstQuestion),
      ),
    )
    expect(state.runtime.progress.answeredInStage).toBe(1)
    expect(state.runtime.actions.canSubmitStage).toBe(true)

    state = requireReady(await coordinator.submitStage())

    expect(state.runtime.lifecycle).toBe('stage-summary')
    expect(state.runtime.latestStageResult?.validQuestionCount).toBe(30)
    expect(state.runtime.latestStageResult?.correctCount).toBe(1)
    expect(state.runtime.latestStageResult?.uncertainCount).toBe(29)
  })

  it('confirms early finish once, saves the completed snapshot before the profile, and restores the same result', async () => {
    const store = new MemoryNamespaceStore('feature.assessment')
    const profiles = new VersionedAssessmentProfileRepository(store)
    let dailyPlanInitializations = 0
    const createCoordinator = () =>
      new TravelVocabularyR1AppCoordinator({
        snapshots: new TravelVocabularyR1SnapshotRepository(store),
        profiles,
        dailyPlans: {
          async initialize() {
            dailyPlanInitializations += 1
            return { status: 'ready' }
          },
        },
        now: () => '2026-07-27T03:25:00.000Z',
        createId: () => 'finish-remaining-r1-session',
        random: () => 0.53,
      })
    const coordinator = createCoordinator()
    await coordinator.initialize()
    let state = requireReady(await coordinator.start())
    const firstQuestion = state.runtime.questions[0]
    state = requireReady(
      await coordinator.selectChoice(
        firstQuestion.id,
        correctOptionId(firstQuestion),
      ),
    )
    expect(state.runtime.remainingQuestionsToMarkUncertain).toBe(149)
    store.writes.length = 0

    const firstConfirmation = coordinator.finishRemainingUnknown()
    const repeatedConfirmation = coordinator.finishRemainingUnknown()
    expect(repeatedConfirmation).toBe(firstConfirmation)
    state = requireReady(await repeatedConfirmation)

    expect(state.runtime.lifecycle).toBe('completed')
    expect(state.runtime.completionReason).toBe(
      'remaining-marked-unknown',
    )
    expect(state.runtime.profile?.completionReason).toBe(
      'remaining-marked-unknown',
    )
    expect(state.runtime.profile?.travelVocabulary.validQuestionCount).toBe(
      150,
    )
    expect(state.runtime.profile?.travelVocabulary.correctCount).toBe(1)
    expect(state.runtime.profile?.travelVocabulary.uncertainCount).toBe(
      149,
    )
    expect(store.writes.slice(0, 2)).toEqual([
      TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
      LATEST_PROFILE_KEY,
    ])
    expect(dailyPlanInitializations).toBe(1)

    const repeatedAfterCompletion = requireReady(
      await coordinator.finishRemainingUnknown(),
    )
    expect(repeatedAfterCompletion.runtime.profile).toEqual(
      state.runtime.profile,
    )
    expect(dailyPlanInitializations).toBe(1)

    store.writes.length = 0
    const restored = requireReady(await createCoordinator().initialize())
    expect(restored.runtime.lifecycle).toBe('completed')
    expect(restored.runtime.profile).toEqual(state.runtime.profile)
    expect(store.writes).not.toContain(LATEST_PROFILE_KEY)
  })

  it('does not make an unpersisted atomic advance survive a refresh', async () => {
    const store = new MemoryNamespaceStore('feature.assessment')
    const createCoordinator = () =>
      new TravelVocabularyR1AppCoordinator({
        snapshots: new TravelVocabularyR1SnapshotRepository(store),
        profiles: new VersionedAssessmentProfileRepository(store),
        dailyPlans: {
          async initialize() {
            return { status: 'ready' }
          },
        },
        now: () => '2026-07-27T03:30:00.000Z',
        createId: () => 'failed-next-r1-session',
        random: () => 0.63,
      })
    const coordinator = createCoordinator()
    await coordinator.initialize()
    const started = requireReady(await coordinator.start())
    const firstQuestionId = started.runtime.questions[0].id
    store.failNextPut = true

    const failed = await coordinator.advanceToNextQuestion()
    expect(failed.status).toBe('error')

    const restored = requireReady(await createCoordinator().initialize())
    expect(restored.runtime.lifecycle).toBe('paused')
    expect(restored.runtime.currentQuestionIndex).toBe(0)
    expect(restored.runtime.draftAnswers[firstQuestionId]).toBeUndefined()
  })

  it('keeps a completed snapshot recoverable when profile persistence fails and retries completion idempotently', async () => {
    const store = new MemoryNamespaceStore('feature.assessment')
    const profiles = new VersionedAssessmentProfileRepository(store)
    let dailyPlanInitializations = 0
    const coordinator = new TravelVocabularyR1AppCoordinator({
      snapshots: new TravelVocabularyR1SnapshotRepository(store),
      profiles,
      dailyPlans: {
        async initialize() {
          dailyPlanInitializations += 1
          return { status: 'ready' }
        },
      },
      now: () => '2026-07-27T03:35:00.000Z',
      createId: () => 'retry-finish-r1-session',
      random: () => 0.73,
    })
    await coordinator.initialize()
    await coordinator.start()
    store.failNextPutKey = LATEST_PROFILE_KEY

    const failed = await coordinator.finishRemainingUnknown()
    expect(failed.status).toBe('error')
    if (failed.status === 'error') {
      expect(failed.recovery).toBe('retry-completion')
      expect(failed.runtime?.lifecycle).toBe('completed')
    }
    const completedSnapshot = store.records.get(
      TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
    )?.value as TravelVocabularyAssessmentRuntimeSnapshotR1
    expect(completedSnapshot.lifecycle).toBe('completed')
    expect(completedSnapshot.session.completionReason).toBe(
      'remaining-marked-unknown',
    )
    expect(await profiles.loadLatest()).toBeUndefined()
    expect(dailyPlanInitializations).toBe(0)

    const recovered = requireReady(await coordinator.retryCompletion())
    expect(recovered.runtime.lifecycle).toBe('completed')
    expect(
      (await profiles.loadLatest())?.profileId,
    ).toBe(recovered.runtime.profile?.profileId)
    expect(dailyPlanInitializations).toBe(1)

    const repeated = requireReady(await coordinator.retryCompletion())
    expect(repeated.runtime.profile).toEqual(recovered.runtime.profile)
    expect(dailyPlanInitializations).toBe(1)
  })

  it('surfaces a local write failure and succeeds after a safe retry', async () => {
    const store = new MemoryNamespaceStore('feature.assessment')
    store.failNextPut = true
    const coordinator = new TravelVocabularyR1AppCoordinator({
      snapshots: new TravelVocabularyR1SnapshotRepository(store),
      profiles: new VersionedAssessmentProfileRepository(store),
      dailyPlans: {
        async initialize() {
          return { status: 'ready' }
        },
      },
      now: () => '2026-07-27T04:00:00.000Z',
      createId: () => 'storage-retry-r1-session',
      random: () => 0.64,
    })

    const failed = await coordinator.initialize()
    expect(failed.status).toBe('error')
    if (failed.status === 'error') {
      expect(failed.recovery).toBe('retry-initialize')
    }
    expect(
      store.records.has(TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1),
    ).toBe(false)

    const recovered = requireReady(await coordinator.initialize())
    expect(recovered.runtime.lifecycle).toBe('intro')
    expect(
      store.records.has(TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1),
    ).toBe(true)
  })

  it('creates a different non-overlapping sample when recent R1 words are supplied', () => {
    const first = createTravelVocabularyAssessmentRuntimeR1({
      now: () => '2026-07-27T00:00:00.000Z',
      createId: () => 'random-sample-1',
      random: () => 0.19,
    }).toSnapshot()
    const firstWordIds = first.session.stagePlans.flatMap((stage) =>
      stage.questions.map((question) => question.wordId),
    )
    const second = createTravelVocabularyAssessmentRuntimeR1({
      now: () => '2026-07-27T00:01:00.000Z',
      createId: () => 'random-sample-2',
      random: () => 0.19,
      recentWordIds: firstWordIds,
    }).toSnapshot()
    const secondWordIds = second.session.stagePlans.flatMap((stage) =>
      stage.questions.map((question) => question.wordId),
    )

    expect(firstWordIds).toHaveLength(150)
    expect(secondWordIds).toHaveLength(150)
    expect(new Set(firstWordIds).size).toBe(150)
    expect(new Set(secondWordIds).size).toBe(150)
    expect(
      secondWordIds.filter((wordId) => firstWordIds.includes(wordId)),
    ).toHaveLength(0)
  })
})
