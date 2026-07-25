import { describe, expect, it } from 'vitest'
import packageIndex from '../../../content/curriculum/package-index.v1.json'
import week1 from '../../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import {
  AssessmentProfileRepository,
  placementBankV1,
  type SpeechObservation,
} from '../../features/assessment/index.ts'
import {
  LEARNING_ENGINE_STORAGE_NAMESPACE,
  LearningEngineRepository,
} from '../../learning-engine/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/index.ts'
import {
  ActivePlanRepository,
  LEARNING_RUNTIME_STORAGE_NAMESPACE,
} from '../learning/active-plan-repository.ts'
import {
  projectLearningCandidates,
  type LearningCandidateSource,
} from '../learning/course-candidate-source.ts'
import { LearningAppCoordinator } from '../learning/learning-app-coordinator.ts'
import { AssessmentAppCoordinator } from './assessment-app-coordinator.ts'
import { AssessmentRuntimeSnapshotRepository } from './assessment-runtime-snapshot-repository.ts'

class MemoryNamespaceStore implements NamespaceStore {
  readonly records = new Map<string, StoredRecord<unknown>>()
  readonly namespace: string

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
    this.records.set(key, {
      namespace: this.namespace,
      key,
      value,
      schemaVersion,
      updatedAt: '2026-07-25T01:00:00.000Z',
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

const reliableSpeechObservation: SpeechObservation = {
  status: 'scored',
  transcript: 'A complete and understandable response',
  metrics: {
    completeness: 0.9,
    intelligibility: 0.9,
    fluency: 0.85,
    languageControl: 0.85,
    taskCompletion: 0.9,
    recognitionConfidence: 0.9,
  },
}

describe('first-use production integration', () => {
  it('moves from a real assessment profile to a persisted plan and routable training task', async () => {
    const assessmentStore = new MemoryNamespaceStore(
      'feature.assessment',
    )
    const planStore = new MemoryNamespaceStore(
      LEARNING_RUNTIME_STORAGE_NAMESPACE,
    )
    const engineStore = new MemoryNamespaceStore(
      LEARNING_ENGINE_STORAGE_NAMESPACE,
    )
    let assessmentTime = Date.parse('2026-07-25T00:00:00.000Z')
    const profiles = new AssessmentProfileRepository(assessmentStore)
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
        now: () => new Date('2026-07-25T08:00:00.000+08:00'),
        createId: () => 'first-day-plan',
      })
    const learning = createLearningCoordinator()
    const assessment = new AssessmentAppCoordinator({
      snapshots: new AssessmentRuntimeSnapshotRepository(
        assessmentStore,
      ),
      profiles,
      dailyPlans: learning,
      now: () => new Date(assessmentTime).toISOString(),
      createId: () => 'first-use-assessment',
    })

    const before = await learning.initialize()
    expect(before.status).toBe('assessment-required')

    await assessment.initialize()
    let completed = await assessment.start()
    for (let step = 0; step < 40; step += 1) {
      if (completed.status !== 'ready') {
        throw new Error('Assessment entered an unexpected error state.')
      }
      if (completed.runtime.lifecycle === 'completed') {
        break
      }
      const item = completed.runtime.item
      if (completed.runtime.lifecycle !== 'active' || !item) {
        throw new Error(
          `Unexpected assessment lifecycle: ${completed.runtime.lifecycle}`,
        )
      }
      assessmentTime += item.expectedSeconds * 1_000
      if (item.kind === 'choice') {
        const scoringItem = placementBankV1.items.find(
          (candidate) => candidate.id === item.id,
        )
        if (!scoringItem || scoringItem.kind !== 'choice') {
          throw new Error(`Missing production scoring item: ${item.id}`)
        }
        await assessment.selectChoice(
          item.id,
          scoringItem.scoring.correctOptionId,
        )
        completed = await assessment.submitChoice(item.id)
      } else {
        completed = await assessment.submitSpeech(
          item.id,
          reliableSpeechObservation,
        )
      }
      if (
        completed.status === 'ready' &&
        completed.runtime.lifecycle === 'feedback'
      ) {
        completed = await assessment.continue()
      }
    }
    expect(completed.status).toBe('ready')
    if (completed.status !== 'ready') {
      throw new Error('Expected a completed real assessment.')
    }
    expect(completed.runtime.lifecycle).toBe('completed')
    expect(completed.runtime.profile?.outcome).toBe('completed')
    expect(
      completed.runtime.profile?.abilities.vocabulary.internalLevel,
    ).not.toBeNull()
    expect(
      completed.runtime.profile?.abilities.listening.internalLevel,
    ).not.toBeNull()
    expect(
      completed.runtime.profile?.abilities.speaking.internalLevel,
    ).not.toBeNull()
    expect(completed.runtime.profile?.profileId).toBeTruthy()
    expect(
      await profiles.loadLatest(),
    ).toEqual(completed.runtime.profile)

    expect(learning.state.status).toBe('ready')
    if (learning.state.status !== 'ready') {
      throw new Error('Expected a real first-day plan.')
    }
    const plan = learning.state.runtime.activePlan.plan
    expect(plan.planId).toBe('daily:2026-07-25:first-day-plan')
    expect(plan.tasks.length).toBeGreaterThan(0)
    expect(
      new Set(plan.tasks.map((task) => task.targetModuleId)),
    ).toEqual(new Set(['vocabulary', 'listening', 'speaking']))
    const firstTask = plan.tasks[0]
    expect(learning.routeForTask(firstTask.taskId)).toBe(
      `/${firstTask.targetModuleId}?taskId=${encodeURIComponent(firstTask.taskId)}`,
    )

    const refreshedLearning = createLearningCoordinator()
    const refreshedAssessment = new AssessmentAppCoordinator({
      snapshots: new AssessmentRuntimeSnapshotRepository(
        assessmentStore,
      ),
      profiles,
      dailyPlans: refreshedLearning,
      now: () => '2026-07-25T00:05:00.000Z',
      createId: () => 'must-not-create-another-plan',
    })
    const restored = await refreshedAssessment.initialize()

    expect(restored.status).toBe('ready')
    if (restored.status === 'ready') {
      expect(restored.runtime.lifecycle).toBe('completed')
    }
    expect(refreshedLearning.state.status).toBe('ready')
    if (refreshedLearning.state.status === 'ready') {
      expect(
        refreshedLearning.state.runtime.activePlan.plan.planId,
      ).toBe(plan.planId)
    }
  })
})
