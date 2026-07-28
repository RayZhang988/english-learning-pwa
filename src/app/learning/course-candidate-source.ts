import { AppError } from '../../core/index.ts'
import {
  calculateContentBaselineSeconds,
  type LearningCandidate,
  type TaskDurationBaseline,
  type TrainingModuleId,
} from '../../learning-engine/index.ts'
import { platformFetch } from '../../platform/index.ts'

export const CURRENT_COURSE_PACKAGE_VERSION = '1.0.0'
const PACKAGE_INDEX_PATH = 'content/curriculum/package-index.v1.json'
const CONTENT_REF_PATTERN =
  /^lesson:\/\/survival-travel-american-4w\/1\.0\.0\/w[1-4]d(?:[1-9]|1\d|2[0-8])\/(vocabulary|listening|speaking)$/

const CURRENT_COURSE_ASSET_URLS: Readonly<Record<string, string>> = {
  [PACKAGE_INDEX_PATH]: new URL(
    '../../../content/curriculum/package-index.v1.json',
    import.meta.url,
  ).href,
  'content/lessons/survival-travel-american-4w/week-1.v1.json': new URL(
    '../../../content/lessons/survival-travel-american-4w/week-1.v1.json',
    import.meta.url,
  ).href,
  'content/lessons/survival-travel-american-4w/week-2.v1.json': new URL(
    '../../../content/lessons/survival-travel-american-4w/week-2.v1.json',
    import.meta.url,
  ).href,
  'content/lessons/survival-travel-american-4w/week-3.v1.json': new URL(
    '../../../content/lessons/survival-travel-american-4w/week-3.v1.json',
    import.meta.url,
  ).href,
  'content/lessons/survival-travel-american-4w/week-4.v1.json': new URL(
    '../../../content/lessons/survival-travel-american-4w/week-4.v1.json',
    import.meta.url,
  ).href,
}

const ACTIVITY_TYPES: Readonly<
  Record<TrainingModuleId, readonly string[]>
> = {
  vocabulary: ['vocabulary-set', 'vocabulary-review'],
  listening: [
    'listening-dialogue',
    'listening-narrative',
    'listening-announcement',
  ],
  speaking: ['fixed-response', 'guided-roleplay'],
}

interface CoursePackageIndex {
  readonly lessonFiles: readonly string[]
}

interface CourseLearningUnit {
  readonly learningUnitId: string
  readonly contentRef: string
  readonly domain: TrainingModuleId
  readonly difficultyLevel: number
  readonly estimatedSeconds: number
  readonly durationBaseline?: TaskDurationBaseline
  readonly tags: readonly string[]
  readonly prerequisiteUnitIds: readonly string[]
}

interface CourseCandidateDocuments {
  readonly packageIndex: unknown
  readonly lessonsByPath: Readonly<Record<string, unknown>>
}

export interface LearningCandidateSource {
  load(
    completedLearningUnitIds: ReadonlySet<string>,
    availableModuleIds: ReadonlySet<TrainingModuleId>,
    signal?: AbortSignal,
  ): Promise<readonly LearningCandidate[]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function requireNonEmptyString(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`)
  }
}

function requireStringArray(
  value: unknown,
  label: string,
): asserts value is readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) => typeof entry !== 'string' || entry.trim().length === 0,
    )
  ) {
    throw new TypeError(`${label} must be a string array.`)
  }
}

function requireFiniteNumber(
  value: unknown,
  label: string,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`)
  }
}

function readDurationBaseline(
  value: unknown,
  label: string,
): TaskDurationBaseline | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  if (value.schemaVersion !== 1) {
    throw new TypeError(`${label}.schemaVersion must be 1.`)
  }
  requireNonEmptyString(value.contentType, `${label}.contentType`)
  requireFiniteNumber(value.fixedSeconds, `${label}.fixedSeconds`)
  requireFiniteNumber(value.itemCount, `${label}.itemCount`)
  requireFiniteNumber(value.secondsPerItem, `${label}.secondsPerItem`)
  requireFiniteNumber(
    value.activeAudioSeconds,
    `${label}.activeAudioSeconds`,
  )
  requireFiniteNumber(
    value.expectedAudioPlaythroughs,
    `${label}.expectedAudioPlaythroughs`,
  )
  requireFiniteNumber(
    value.interactionStepCount,
    `${label}.interactionStepCount`,
  )
  requireFiniteNumber(
    value.secondsPerInteractionStep,
    `${label}.secondsPerInteractionStep`,
  )
  requireFiniteNumber(value.minimumSeconds, `${label}.minimumSeconds`)
  requireFiniteNumber(value.maximumSeconds, `${label}.maximumSeconds`)

  const baseline: TaskDurationBaseline = {
    schemaVersion: 1,
    contentType: value.contentType,
    fixedSeconds: value.fixedSeconds,
    itemCount: value.itemCount,
    secondsPerItem: value.secondsPerItem,
    activeAudioSeconds: value.activeAudioSeconds,
    expectedAudioPlaythroughs: value.expectedAudioPlaythroughs,
    interactionStepCount: value.interactionStepCount,
    secondsPerInteractionStep: value.secondsPerInteractionStep,
    minimumSeconds: value.minimumSeconds,
    maximumSeconds: value.maximumSeconds,
  }

  try {
    calculateContentBaselineSeconds(baseline)
  } catch (error) {
    throw new TypeError(`${label} is invalid.`, { cause: error })
  }
  return baseline
}

function readPackageIndex(value: unknown): CoursePackageIndex {
  if (!isRecord(value)) {
    throw new TypeError('Course package index must be an object.')
  }
  if (
    value.schemaVersion !== 1 ||
    value.packageVersion !== CURRENT_COURSE_PACKAGE_VERSION ||
    value.status !== 'released'
  ) {
    throw new TypeError(
      'Course package index is not the released v1.0.0 package.',
    )
  }
  requireStringArray(value.lessonFiles, 'packageIndex.lessonFiles')
  return {
    lessonFiles: value.lessonFiles,
  }
}

function readLearningUnit(
  value: unknown,
  label: string,
): CourseLearningUnit {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  requireNonEmptyString(value.learningUnitId, `${label}.learningUnitId`)
  requireNonEmptyString(value.contentRef, `${label}.contentRef`)
  if (
    value.domain !== 'vocabulary' &&
    value.domain !== 'listening' &&
    value.domain !== 'speaking'
  ) {
    throw new TypeError(`${label}.domain is unsupported.`)
  }
  if (
    typeof value.difficultyLevel !== 'number' ||
    !Number.isFinite(value.difficultyLevel) ||
    value.difficultyLevel < 0 ||
    value.difficultyLevel > 12
  ) {
    throw new TypeError(`${label}.difficultyLevel is outside 0–12.`)
  }
  if (
    typeof value.estimatedSeconds !== 'number' ||
    !Number.isFinite(value.estimatedSeconds) ||
    value.estimatedSeconds <= 0
  ) {
    throw new TypeError(`${label}.estimatedSeconds must be positive.`)
  }
  requireStringArray(value.tags, `${label}.tags`)
  requireStringArray(
    value.prerequisiteUnitIds,
    `${label}.prerequisiteUnitIds`,
  )
  if (
    !isRecord(value.activity) ||
    typeof value.activity.type !== 'string' ||
    !ACTIVITY_TYPES[value.domain].includes(value.activity.type)
  ) {
    throw new TypeError(`${label}.activity.type is unsupported.`)
  }
  const contentRefMatch = CONTENT_REF_PATTERN.exec(value.contentRef)
  if (contentRefMatch?.[1] !== value.domain) {
    throw new TypeError(`${label}.contentRef is invalid for its domain.`)
  }

  return {
    learningUnitId: value.learningUnitId,
    contentRef: value.contentRef,
    domain: value.domain,
    difficultyLevel: value.difficultyLevel,
    estimatedSeconds: value.estimatedSeconds,
    durationBaseline: readDurationBaseline(
      value.durationBaseline,
      `${label}.durationBaseline`,
    ),
    tags: value.tags,
    prerequisiteUnitIds: value.prerequisiteUnitIds,
  }
}

export function projectLearningCandidates(
  documents: CourseCandidateDocuments,
  completedLearningUnitIds: ReadonlySet<string>,
  availableModuleIds: ReadonlySet<TrainingModuleId>,
): readonly LearningCandidate[] {
  const packageIndex = readPackageIndex(documents.packageIndex)
  const units: CourseLearningUnit[] = []
  const unitIds = new Set<string>()
  const contentRefs = new Set<string>()

  packageIndex.lessonFiles.forEach((lessonPath, fileIndex) => {
    const document = documents.lessonsByPath[lessonPath]
    if (!isRecord(document)) {
      throw new TypeError(
        `Package lesson file is missing or invalid: ${lessonPath}.`,
      )
    }
    if (
      document.schemaVersion !== 1 ||
      document.packageVersion !== CURRENT_COURSE_PACKAGE_VERSION ||
      !Array.isArray(document.lessons)
    ) {
      throw new TypeError(
        `Lesson file ${lessonPath} is not a v1.0.0 lesson week.`,
      )
    }
    document.lessons.forEach((lesson, lessonIndex) => {
      if (!isRecord(lesson) || !Array.isArray(lesson.learningUnits)) {
        throw new TypeError(
          `lessonsByPath[${fileIndex}].lessons[${lessonIndex}] is invalid.`,
        )
      }
      lesson.learningUnits.forEach((unit, unitIndex) => {
        const parsed = readLearningUnit(
          unit,
          `${lessonPath}.lessons[${lessonIndex}].learningUnits[${unitIndex}]`,
        )
        if (
          unitIds.has(parsed.learningUnitId) ||
          contentRefs.has(parsed.contentRef)
        ) {
          throw new TypeError(
            `Course package contains a duplicate unit identity: ${parsed.learningUnitId}.`,
          )
        }
        unitIds.add(parsed.learningUnitId)
        contentRefs.add(parsed.contentRef)
        units.push(parsed)
      })
    })
  })

  for (const unit of units) {
    for (const prerequisiteId of unit.prerequisiteUnitIds) {
      if (!unitIds.has(prerequisiteId)) {
        throw new TypeError(
          `Learning unit ${unit.learningUnitId} has a missing prerequisite: ${prerequisiteId}.`,
        )
      }
    }
  }

  return units
    .filter((unit) => availableModuleIds.has(unit.domain))
    .map((unit) => ({
      schemaVersion: 1,
      learningUnitId: unit.learningUnitId,
      contentRef: unit.contentRef,
      domain: unit.domain,
      difficultyLevel: unit.difficultyLevel,
      estimatedSeconds: unit.estimatedSeconds,
      durationBaseline: unit.durationBaseline,
      tags: unit.tags,
      prerequisitesMet: unit.prerequisiteUnitIds.every((id) =>
        completedLearningUnitIds.has(id),
      ),
    }))
}

export class CurrentCourseCandidateSource
  implements LearningCandidateSource
{
  readonly #fetcher: typeof fetch
  readonly #assetUrls: Readonly<Record<string, string>>

  constructor(
    fetcher: typeof fetch = platformFetch,
    assetUrls: Readonly<Record<string, string>> =
      CURRENT_COURSE_ASSET_URLS,
  ) {
    this.#fetcher = fetcher
    this.#assetUrls = assetUrls
  }

  async #readJson(path: string, signal?: AbortSignal): Promise<unknown> {
    const url = this.#assetUrls[path]
    if (!url) {
      throw new AppError(
        'schema_incompatible',
        `课程包引用了未打包的文件：${path}。`,
        { recoverable: false },
      )
    }
    let response: Response
    try {
      response = await this.#fetcher(url, { signal })
    } catch (error) {
      throw new AppError(
        'offline_asset_failed',
        `课程文件暂时无法读取：${path}。`,
        { cause: error, recoverable: true },
      )
    }
    if (!response.ok) {
      throw new AppError(
        'offline_asset_failed',
        `课程文件读取失败（${response.status}）：${path}。`,
        { recoverable: true },
      )
    }
    try {
      return await response.json()
    } catch (error) {
      throw new AppError(
        'schema_incompatible',
        `课程文件不是有效 JSON：${path}。`,
        { cause: error, recoverable: false },
      )
    }
  }

  async load(
    completedLearningUnitIds: ReadonlySet<string>,
    availableModuleIds: ReadonlySet<TrainingModuleId>,
    signal?: AbortSignal,
  ): Promise<readonly LearningCandidate[]> {
    try {
      const packageIndex = await this.#readJson(
        PACKAGE_INDEX_PATH,
        signal,
      )
      const packageFiles = readPackageIndex(packageIndex)
      const lessonsByPath: Record<string, unknown> = {}
      for (const path of packageFiles.lessonFiles) {
        lessonsByPath[path] = await this.#readJson(path, signal)
      }
      return projectLearningCandidates(
        { packageIndex, lessonsByPath },
        completedLearningUnitIds,
        availableModuleIds,
      )
    } catch (error) {
      if (error instanceof AppError) {
        throw error
      }
      throw new AppError(
        'schema_incompatible',
        '课程包结构无效，不能生成学习计划。',
        { cause: error, recoverable: false },
      )
    }
  }
}

export const currentCourseCandidateSource =
  new CurrentCourseCandidateSource()
