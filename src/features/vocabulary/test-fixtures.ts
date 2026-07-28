/// <reference types="node" />

import { readFile } from 'node:fs/promises'
import type { LearningTask } from '../../learning-engine/index.ts'
import type {
  VocabularyContentDocuments,
  VocabularyTrainingUnit,
} from './types.ts'

const projectRoot = new URL('../../../', import.meta.url)

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(
    await readFile(new URL(path, projectRoot), 'utf8'),
  ) as unknown
}

export async function loadActualVocabularyDocuments(): Promise<VocabularyContentDocuments> {
  const packageIndex = await readJson(
    'content/curriculum/package-index.v1.json',
  )
  const index = packageIndex as {
    readonly manifestFile: string
    readonly lessonFiles: readonly string[]
    readonly trainingSupplyIndexFile?: string
  }
  const lessonsByPath: Record<string, unknown> = {}
  for (const lessonFile of index.lessonFiles) {
    lessonsByPath[lessonFile] = await readJson(lessonFile)
  }
  return {
    packageIndex,
    manifest: await readJson(index.manifestFile),
    lessonsByPath,
    trainingSupplyIndex: index.trainingSupplyIndexFile
      ? await readJson(index.trainingSupplyIndexFile)
      : undefined,
  }
}

export function vocabularyTaskFor(
  unit: VocabularyTrainingUnit,
  overrides: Partial<LearningTask> = {},
): LearningTask {
  return {
    schemaVersion: 1,
    taskId: 'task-vocabulary-1',
    planId: 'plan-1',
    sequence: 1,
    learningUnitId: unit.learningUnitId,
    contentRef: unit.contentRef,
    domain: 'vocabulary',
    targetModuleId: 'vocabulary',
    mode: 'learn',
    origin: 'new',
    difficultyLevel: unit.difficultyLevel,
    estimatedSeconds: unit.estimatedSeconds,
    required: false,
    dueAt: null,
    skipLimit: 2,
    tags: unit.tags,
    ...overrides,
  }
}
