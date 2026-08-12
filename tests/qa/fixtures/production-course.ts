import packageIndex from '../../../content/curriculum/package-index.v1.json'
import manifest from '../../../content/curriculum/survival-travel-american-4w.v1.json'
import extensionIndex from '../../../content/curriculum/listening-exercise-extension-index.v1.json'
import listeningSupply from '../../../content/curriculum/training-supply-index.v1/listening.json'
import speakingSupply from '../../../content/curriculum/training-supply-index.v1/speaking.json'
import vocabulary00 from '../../../content/curriculum/training-supply-index.v1/vocabulary-00.json'
import vocabulary01 from '../../../content/curriculum/training-supply-index.v1/vocabulary-01.json'
import vocabulary02 from '../../../content/curriculum/training-supply-index.v1/vocabulary-02.json'
import vocabulary03 from '../../../content/curriculum/training-supply-index.v1/vocabulary-03.json'
import vocabulary04 from '../../../content/curriculum/training-supply-index.v1/vocabulary-04.json'
import vocabulary05 from '../../../content/curriculum/training-supply-index.v1/vocabulary-05.json'
import vocabulary06 from '../../../content/curriculum/training-supply-index.v1/vocabulary-06.json'
import vocabulary07 from '../../../content/curriculum/training-supply-index.v1/vocabulary-07.json'
import vocabulary08 from '../../../content/curriculum/training-supply-index.v1/vocabulary-08.json'
import vocabulary09 from '../../../content/curriculum/training-supply-index.v1/vocabulary-09.json'
import vocabulary10 from '../../../content/curriculum/training-supply-index.v1/vocabulary-10.json'
import vocabulary11 from '../../../content/curriculum/training-supply-index.v1/vocabulary-11.json'
import vocabulary12 from '../../../content/curriculum/training-supply-index.v1/vocabulary-12.json'
import vocabulary13 from '../../../content/curriculum/training-supply-index.v1/vocabulary-13.json'
import vocabulary14 from '../../../content/curriculum/training-supply-index.v1/vocabulary-14.json'
import vocabulary15 from '../../../content/curriculum/training-supply-index.v1/vocabulary-15.json'
import exercises from '../../../content/lessons/survival-travel-american-4w/listening-exercises.v1.json'
import bilingualChoiceOptions from '../../../content/lessons/survival-travel-american-4w/listening-choice-bilingual-options.v1.json'
import week1 from '../../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import { createListeningCatalog } from '../../../src/features/listening/index.ts'
import { createSpeakingCatalog } from '../../../src/features/speaking/index.ts'
import { createVocabularyCatalog } from '../../../src/features/vocabulary/index.ts'
import type {
  LearningTask,
  TrainingModuleId,
} from '../../../src/learning-engine/index.ts'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../../src/storage/index.ts'

const trainingSupplyIndex = {
  schemaVersion: 1,
  documentType: 'continuous-training-supply-index',
  candidates: [
    ...vocabulary00.candidates, ...vocabulary01.candidates, ...vocabulary02.candidates, ...vocabulary03.candidates,
    ...vocabulary04.candidates, ...vocabulary05.candidates, ...vocabulary06.candidates, ...vocabulary07.candidates,
    ...vocabulary08.candidates, ...vocabulary09.candidates, ...vocabulary10.candidates, ...vocabulary11.candidates,
    ...vocabulary12.candidates, ...vocabulary13.candidates, ...vocabulary14.candidates, ...vocabulary15.candidates,
    ...listeningSupply.candidates, ...speakingSupply.candidates,
  ],
}

export class MemoryNamespaceStore implements NamespaceStore {
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

export const lessonPaths = packageIndex.lessonFiles

export const lessonsByPath = {
  [lessonPaths[0]]: week1,
  [lessonPaths[1]]: week2,
  [lessonPaths[2]]: week3,
  [lessonPaths[3]]: week4,
}

export const releasedCourseDocuments = {
  packageIndex,
  manifest,
  extensionIndex,
  trainingSupplyIndex,
  lessonsByPath,
  exerciseBundlesByPath: {
    [extensionIndex.exerciseBundleFiles[0]]: exercises,
  },
  bilingualChoiceOptions,
}

export function releasedCatalogs() {
  return {
    vocabulary: createVocabularyCatalog({
      packageIndex,
      manifest,
      lessonsByPath,
      trainingSupplyIndex,
    }),
    listening: createListeningCatalog(releasedCourseDocuments),
    speaking: createSpeakingCatalog({
      packageIndex,
      manifest,
      lessonsByPath,
      trainingSupplyIndex,
    }),
  }
}

export function productionTaskFor(
  moduleId: TrainingModuleId,
): LearningTask {
  const catalogs = releasedCatalogs()
  const unit = catalogs[moduleId].units[0]
  return {
    schemaVersion: 1,
    taskId: `qa-production-plan:${moduleId}`,
    planId: 'qa-production-plan',
    sequence:
      moduleId === 'vocabulary' ? 1 : moduleId === 'listening' ? 2 : 3,
    learningUnitId: unit.learningUnitId,
    contentRef: unit.contentRef,
    domain: moduleId,
    targetModuleId: moduleId,
    mode: 'learn',
    origin: 'new',
    difficultyLevel: unit.difficultyLevel,
    estimatedSeconds: unit.estimatedSeconds,
    required: true,
    dueAt: null,
    skipLimit: 2,
    tags: unit.tags,
  }
}

export function sequenceNow(
  start = '2026-07-25T00:00:00.000Z',
  stepMs = 30_000,
): () => string {
  let tick = 0
  return () =>
    new Date(Date.parse(start) + tick++ * stepMs).toISOString()
}

export function sequenceIds(prefix: string): () => string {
  let value = 0
  return () => `${prefix}-${++value}`
}

export {
  packageIndex,
  manifest,
  extensionIndex,
  trainingSupplyIndex,
  exercises,
  week1,
  week2,
  week3,
  week4,
}
