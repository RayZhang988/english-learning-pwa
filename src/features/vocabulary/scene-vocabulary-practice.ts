import type { ReadonlyDataSource } from '../../core/index.ts'
import { localStorageService, type NamespaceStore } from '../../storage/index.ts'
import { VocabularyError } from './errors.ts'

const SCENE_VOCABULARY_BANK_ID = 'r13b-travel-scene-vocabulary'
const SCENE_VOCABULARY_CONTENT_VERSION = '1.0.0'
const SCENE_VOCABULARY_STORAGE_NAMESPACE = 'feature.vocabulary.scene-practice'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new VocabularyError('content-invalid', `${label} must be an object.`)
  }
  return value
}

function requireString(record: UnknownRecord, key: string, label: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new VocabularyError('content-invalid', `${label}.${key} must be a non-empty string.`)
  }
  return value
}

function requireStringArray(
  record: UnknownRecord,
  key: string,
  label: string,
): readonly string[] {
  const value = record[key]
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new VocabularyError('content-invalid', `${label}.${key} must contain non-empty strings.`)
  }
  return value as readonly string[]
}

export interface SceneVocabularyQuestionSource {
  readonly sourceId: string
  readonly kind: 'project-authored-controlled-text'
  readonly rights: 'original-project-content'
}

export interface SceneVocabularyQuestion {
  readonly questionId: string
  readonly sentenceEn: string
  readonly targetText: string
  readonly targetOccurrence: 1
  readonly correctMeaningZh: string
  readonly distractorMeaningsZh: readonly [string, string, string]
  readonly source: SceneVocabularyQuestionSource
}

export interface SceneVocabularyScene {
  readonly sceneId: string
  readonly categoryId: string
  readonly titleZh: string
  readonly questions: readonly SceneVocabularyQuestion[]
}

export interface SceneVocabularyQuestionBank {
  readonly schemaVersion: 1
  readonly documentType: 'scene-vocabulary-question-bank'
  readonly contentVersion: '1.0.0'
  readonly bankId: 'r13b-travel-scene-vocabulary'
  readonly interaction: {
    readonly promptZh: '这个词是什么意思？'
    readonly targetPlayback: 'tap-highlighted-target-only'
    readonly sentenceTranslationAllowed: false
  }
  readonly scenes: readonly SceneVocabularyScene[]
  getScene(categoryId: string, sceneId: string): SceneVocabularyScene | undefined
}

function parseQuestion(value: unknown, label: string): SceneVocabularyQuestion {
  const question = requireRecord(value, label)
  const targetText = requireString(question, 'targetText', label)
  const sentenceEn = requireString(question, 'sentenceEn', label)
  const targetOccurrence = question.targetOccurrence
  const distractors = requireStringArray(question, 'distractorMeaningsZh', label)
  const source = requireRecord(question.source, `${label}.source`)
  if (
    targetOccurrence !== 1 ||
    distractors.length !== 3 ||
    new Set(distractors).size !== 3 ||
    sentenceEn.indexOf(targetText) === -1 ||
    sentenceEn.indexOf(targetText) !== sentenceEn.lastIndexOf(targetText) ||
    source.kind !== 'project-authored-controlled-text' ||
    source.rights !== 'original-project-content'
  ) {
    throw new VocabularyError('content-invalid', `${label} violates the frozen scene vocabulary contract.`)
  }
  const correctMeaningZh = requireString(question, 'correctMeaningZh', label)
  if (distractors.includes(correctMeaningZh)) {
    throw new VocabularyError('content-invalid', `${label} repeats the correct meaning as a distractor.`)
  }
  return {
    questionId: requireString(question, 'questionId', label),
    sentenceEn,
    targetText,
    targetOccurrence: 1,
    correctMeaningZh,
    distractorMeaningsZh: distractors as [string, string, string],
    source: {
      sourceId: requireString(source, 'sourceId', `${label}.source`),
      kind: 'project-authored-controlled-text',
      rights: 'original-project-content',
    },
  }
}

/** Parses only the released R13-B contract. Callers must not scan content directories. */
export function createSceneVocabularyQuestionBank(value: unknown): SceneVocabularyQuestionBank {
  const document = requireRecord(value, 'scene vocabulary question bank')
  if (
    document.schemaVersion !== 1 ||
    document.documentType !== 'scene-vocabulary-question-bank' ||
    document.contentVersion !== SCENE_VOCABULARY_CONTENT_VERSION ||
    document.bankId !== SCENE_VOCABULARY_BANK_ID
  ) {
    throw new VocabularyError('content-version-unsupported', 'Scene vocabulary question bank uses an unsupported version.')
  }
  const interaction = requireRecord(document.interaction, 'scene vocabulary interaction')
  if (
    interaction.promptZh !== '这个词是什么意思？' ||
    interaction.targetPlayback !== 'tap-highlighted-target-only' ||
    interaction.sentenceTranslationAllowed !== false
  ) {
    throw new VocabularyError('content-invalid', 'Scene vocabulary interaction contract is invalid.')
  }
  if (!Array.isArray(document.scenes) || document.scenes.length !== 18) {
    throw new VocabularyError('content-invalid', 'Scene vocabulary question bank must contain exactly 18 scenes.')
  }
  const sceneIds = new Set<string>()
  const questionIds = new Set<string>()
  const scenes = document.scenes.map((value, index): SceneVocabularyScene => {
    const scene = requireRecord(value, `scenes[${index}]`)
    const sceneId = requireString(scene, 'sceneId', `scenes[${index}]`)
    if (sceneIds.has(sceneId) || !Array.isArray(scene.questions) || scene.questions.length !== 6) {
      throw new VocabularyError('content-invalid', `scenes[${index}] has an invalid id or question count.`)
    }
    sceneIds.add(sceneId)
    const questions = scene.questions.map((question, questionIndex) => {
      const parsed = parseQuestion(question, `scenes[${index}].questions[${questionIndex}]`)
      if (questionIds.has(parsed.questionId)) {
        throw new VocabularyError('content-invalid', `Duplicate scene vocabulary question ${parsed.questionId}.`)
      }
      questionIds.add(parsed.questionId)
      return parsed
    })
    return {
      sceneId,
      categoryId: requireString(scene, 'categoryId', `scenes[${index}]`),
      titleZh: requireString(scene, 'titleZh', `scenes[${index}]`),
      questions,
    }
  })
  if (questionIds.size !== 108) {
    throw new VocabularyError('content-invalid', 'Scene vocabulary question bank must contain exactly 108 questions.')
  }
  return {
    schemaVersion: 1,
    documentType: 'scene-vocabulary-question-bank',
    contentVersion: '1.0.0',
    bankId: 'r13b-travel-scene-vocabulary',
    interaction: {
      promptZh: '这个词是什么意思？',
      targetPlayback: 'tap-highlighted-target-only',
      sentenceTranslationAllowed: false,
    },
    scenes,
    getScene: (categoryId, sceneId) => scenes.find((scene) => scene.categoryId === categoryId && scene.sceneId === sceneId),
  }
}

export interface SceneVocabularyPracticeAnswer {
  readonly questionId: string
  readonly selectedOptionId: string
  readonly submittedAt: string
}

export interface SceneVocabularyPracticeSnapshot {
  readonly schemaVersion: 1
  readonly sessionId: string
  readonly bankId: 'r13b-travel-scene-vocabulary'
  readonly contentVersion: '1.0.0'
  readonly categoryId: string
  readonly sceneId: string
  /** The released file order. It is persisted rather than regenerated on restore. */
  readonly questionIds: readonly string[]
  readonly answers: readonly SceneVocabularyPracticeAnswer[]
  readonly selectedOptionId: string | null
  readonly phase: 'answering' | 'feedback' | 'completed'
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SceneVocabularyPracticeRepository {
  load(sessionId: string): Promise<SceneVocabularyPracticeSnapshot | undefined>
  save(snapshot: SceneVocabularyPracticeSnapshot): Promise<void>
  delete(sessionId: string): Promise<void>
}

function isSnapshot(value: unknown): value is SceneVocabularyPracticeSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.bankId !== SCENE_VOCABULARY_BANK_ID || value.contentVersion !== SCENE_VOCABULARY_CONTENT_VERSION || !Array.isArray(value.questionIds) || !Array.isArray(value.answers)) return false
  if (typeof value.sessionId !== 'string' || typeof value.categoryId !== 'string' || typeof value.sceneId !== 'string' || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' || (value.selectedOptionId !== null && typeof value.selectedOptionId !== 'string') || !['answering', 'feedback', 'completed'].includes(String(value.phase))) return false
  return value.questionIds.every((id) => typeof id === 'string') && value.answers.every((answer) => isRecord(answer) && typeof answer.questionId === 'string' && typeof answer.selectedOptionId === 'string' && typeof answer.submittedAt === 'string')
}

export class StoredSceneVocabularyPracticeRepository implements SceneVocabularyPracticeRepository {
  private readonly store: NamespaceStore

  constructor(store: NamespaceStore = localStorageService.namespace(SCENE_VOCABULARY_STORAGE_NAMESPACE)) {
    this.store = store
  }

  private key(sessionId: string): string { return `session:${sessionId}` }

  async load(sessionId: string): Promise<SceneVocabularyPracticeSnapshot | undefined> {
    const record = await this.store.get<unknown>(this.key(sessionId))
    if (!record) return undefined
    if (!isSnapshot(record.value) || record.value.sessionId !== sessionId) {
      throw new VocabularyError('session-recovery-invalid', 'Stored scene vocabulary practice snapshot is invalid.')
    }
    return record.value
  }

  async save(snapshot: SceneVocabularyPracticeSnapshot): Promise<void> {
    const encoded = JSON.stringify(snapshot)
    const portable = JSON.parse(encoded) as unknown
    if (!isSnapshot(portable)) {
      throw new VocabularyError('session-recovery-invalid', 'Scene vocabulary practice snapshot is not JSON-portable.')
    }
    await this.store.put(this.key(snapshot.sessionId), portable, 1)
  }

  delete(sessionId: string): Promise<void> { return this.store.delete(this.key(sessionId)) }
}

export type SceneVocabularyOptionState = 'default' | 'selected' | 'correct' | 'incorrect'

export interface SceneVocabularyPracticeView {
  readonly status: 'question' | 'feedback' | 'completed'
  readonly progress: {
    readonly answeredCount: number
    readonly correctCount: number
    readonly totalCount: number
    /** Exact, scored-only ratio: correctCount / answeredCount; null before an answer. */
    readonly accuracy: number | null
  }
  readonly question?: {
    readonly questionId: string
    readonly promptZh: '这个词是什么意思？'
    readonly sentenceEn: {
      readonly beforeTarget: string
      readonly targetText: string
      readonly afterTarget: string
    }
    readonly options: readonly { readonly id: string; readonly labelZh: string; readonly state: SceneVocabularyOptionState }[]
    /** UI sends this exact intent to a playback adapter; it must not read the whole sentence. */
    readonly targetPlayback: { readonly intent: 'play-target-only'; readonly text: string; readonly locale: 'en-US' }
  }
  readonly feedback?: {
    readonly correct: boolean
    readonly correctMeaningZh: string
  }
  readonly completion?: {
    readonly title: '场景词汇练习完成'
  }
}

export interface SceneVocabularyPracticeRuntimeOptions {
  readonly categoryId: string
  readonly sceneId: string
  readonly contentSource: ReadonlyDataSource<SceneVocabularyQuestionBank>
  readonly repository?: SceneVocabularyPracticeRepository
  readonly sessionId?: string
  readonly now?: () => string
}

function optionId(questionId: string, position: number): string {
  return `${questionId}:meaning:${position + 1}`
}

/** A stable, question-id-derived rotation prevents the released answer from always being first. */
function meaningsFor(question: SceneVocabularyQuestion): readonly string[] {
  const meanings = [question.correctMeaningZh, ...question.distractorMeaningsZh]
  let hash = 0
  for (const character of question.questionId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const offset = hash % meanings.length
  return [...meanings.slice(offset), ...meanings.slice(0, offset)]
}

function currentQuestion(snapshot: SceneVocabularyPracticeSnapshot, scene: SceneVocabularyScene): SceneVocabularyQuestion | null {
  if (snapshot.phase === 'completed') return null
  const questionId = snapshot.questionIds[
    snapshot.phase === 'feedback'
      ? snapshot.answers.length - 1
      : snapshot.answers.length
  ]
  return scene.questions.find((question) => question.questionId === questionId) ?? null
}

function correctOptionId(question: SceneVocabularyQuestion): string {
  const position = meaningsFor(question).indexOf(question.correctMeaningZh)
  return optionId(question.questionId, position)
}

function validateSnapshot(snapshot: SceneVocabularyPracticeSnapshot, scene: SceneVocabularyScene, categoryId: string, sceneId: string, sessionId: string): void {
  const releasedQuestionIds = scene.questions.map((question) => question.questionId)
  if (snapshot.sessionId !== sessionId || snapshot.categoryId !== categoryId || snapshot.sceneId !== sceneId || snapshot.questionIds.length !== releasedQuestionIds.length || snapshot.questionIds.some((id, index) => id !== releasedQuestionIds[index])) {
    throw new VocabularyError('session-recovery-invalid', 'Stored scene vocabulary practice does not match the released scene sequence.')
  }
  if (snapshot.answers.length > snapshot.questionIds.length || new Set(snapshot.answers.map((answer) => answer.questionId)).size !== snapshot.answers.length) {
    throw new VocabularyError('session-recovery-invalid', 'Stored scene vocabulary answers are invalid.')
  }
  snapshot.answers.forEach((answer, index) => {
    const question = scene.questions[index]
    if (!question || answer.questionId !== question.questionId || !meaningsFor(question).some((_, optionIndex) => optionId(question.questionId, optionIndex) === answer.selectedOptionId)) {
      throw new VocabularyError('session-recovery-invalid', 'Stored scene vocabulary answer does not match released options.')
    }
  })
  if (snapshot.phase === 'answering' && snapshot.selectedOptionId !== null) {
    const active = currentQuestion(snapshot, scene)
    if (!active || !meaningsFor(active).some((_, index) => optionId(active.questionId, index) === snapshot.selectedOptionId)) {
      throw new VocabularyError('session-recovery-invalid', 'Stored selected scene vocabulary option does not match released options.')
    }
  }
  const phaseIsConsistent =
    (snapshot.phase === 'answering' && snapshot.answers.length < scene.questions.length) ||
    (snapshot.phase === 'feedback' && snapshot.answers.length > 0) ||
    (snapshot.phase === 'completed' && snapshot.answers.length === scene.questions.length)
  if (!phaseIsConsistent || (snapshot.phase === 'feedback' && snapshot.selectedOptionId !== null) || (snapshot.phase === 'completed' && snapshot.selectedOptionId !== null)) {
    throw new VocabularyError('session-recovery-invalid', 'Stored scene vocabulary phase is invalid.')
  }
}

export class SceneVocabularyPracticeRuntime {
  private readonly options: SceneVocabularyPracticeRuntimeOptions
  private readonly repository: SceneVocabularyPracticeRepository
  private readonly now: () => string
  private snapshot: SceneVocabularyPracticeSnapshot | null = null
  private scene: SceneVocabularyScene | null = null
  private tail: Promise<void> = Promise.resolve()

  constructor(options: SceneVocabularyPracticeRuntimeOptions) {
    this.options = options
    this.repository = options.repository ?? new StoredSceneVocabularyPracticeRepository()
    this.now = options.now ?? (() => new Date().toISOString())
  }

  get currentSnapshot(): SceneVocabularyPracticeSnapshot | null { return this.snapshot }

  private get sessionId(): string { return this.options.sessionId ?? `r13b-scene-vocabulary:${this.options.categoryId}:${this.options.sceneId}` }
  private requireSnapshot(): SceneVocabularyPracticeSnapshot { if (!this.snapshot) throw new VocabularyError('session-transition-invalid', 'Scene vocabulary runtime has not been initialized.'); return this.snapshot }
  private requireScene(): SceneVocabularyScene { if (!this.scene) throw new VocabularyError('session-transition-invalid', 'Scene vocabulary runtime has not loaded its scene.'); return this.scene }
  private queue<T>(operation: () => Promise<T>): Promise<T> { const result = this.tail.then(operation, operation); this.tail = result.then(() => undefined, () => undefined); return result }
  private async save(snapshot: SceneVocabularyPracticeSnapshot): Promise<SceneVocabularyPracticeSnapshot> { await this.repository.save(snapshot); this.snapshot = snapshot; return snapshot }

  initialize(): Promise<SceneVocabularyPracticeSnapshot> {
    return this.queue(async () => {
      const bank = await this.options.contentSource.load()
      const scene = bank.getScene(this.options.categoryId, this.options.sceneId)
      if (!scene) throw new VocabularyError('content-reference-missing', `Scene vocabulary content is unavailable for ${this.options.categoryId}/${this.options.sceneId}.`)
      this.scene = scene
      const stored = await this.repository.load(this.sessionId)
      if (stored) {
        validateSnapshot(stored, scene, this.options.categoryId, this.options.sceneId, this.sessionId)
        this.snapshot = stored
        return stored
      }
      const now = this.now()
      return this.save({ schemaVersion: 1, sessionId: this.sessionId, bankId: 'r13b-travel-scene-vocabulary', contentVersion: '1.0.0', categoryId: scene.categoryId, sceneId: scene.sceneId, questionIds: scene.questions.map((question) => question.questionId), answers: [], selectedOptionId: null, phase: 'answering', createdAt: now, updatedAt: now })
    })
  }

  select(optionIdValue: string): Promise<SceneVocabularyPracticeSnapshot> {
    return this.queue(async () => {
      const snapshot = this.requireSnapshot()
      const question = currentQuestion(snapshot, this.requireScene())
      if (snapshot.phase !== 'answering' || !question || !meaningsFor(question).some((_, index) => optionId(question.questionId, index) === optionIdValue)) throw new VocabularyError('session-transition-invalid', 'Option does not belong to the active scene vocabulary question.')
      return this.save({ ...snapshot, selectedOptionId: optionIdValue, updatedAt: this.now() })
    })
  }

  submit(): Promise<SceneVocabularyPracticeSnapshot> {
    return this.queue(async () => {
      const snapshot = this.requireSnapshot()
      const question = currentQuestion(snapshot, this.requireScene())
      if (snapshot.phase !== 'answering' || !question || snapshot.selectedOptionId === null) throw new VocabularyError('session-transition-invalid', 'Select a scene vocabulary meaning before submitting.')
      return this.save({ ...snapshot, answers: [...snapshot.answers, { questionId: question.questionId, selectedOptionId: snapshot.selectedOptionId, submittedAt: this.now() }], selectedOptionId: null, phase: 'feedback', updatedAt: this.now() })
    })
  }

  advance(): Promise<SceneVocabularyPracticeSnapshot> {
    return this.queue(async () => {
      const snapshot = this.requireSnapshot()
      if (snapshot.phase !== 'feedback') throw new VocabularyError('session-transition-invalid', 'Advance is available only after scene vocabulary feedback.')
      const completed = snapshot.answers.length === snapshot.questionIds.length
      return this.save({ ...snapshot, phase: completed ? 'completed' : 'answering', selectedOptionId: null, updatedAt: this.now() })
    })
  }

  restart(): Promise<SceneVocabularyPracticeSnapshot> {
    return this.queue(async () => {
      const scene = this.requireScene()
      await this.repository.delete(this.sessionId)
      const now = this.now()
      return this.save({ schemaVersion: 1, sessionId: this.sessionId, bankId: 'r13b-travel-scene-vocabulary', contentVersion: '1.0.0', categoryId: scene.categoryId, sceneId: scene.sceneId, questionIds: scene.questions.map((question) => question.questionId), answers: [], selectedOptionId: null, phase: 'answering', createdAt: now, updatedAt: now })
    })
  }

  toView(): SceneVocabularyPracticeView {
    const snapshot = this.requireSnapshot()
    const scene = this.requireScene()
    const correctCount = snapshot.answers.filter((answer, index) => answer.selectedOptionId === correctOptionId(scene.questions[index]!)).length
    const progress = { answeredCount: snapshot.answers.length, correctCount, totalCount: snapshot.questionIds.length, accuracy: snapshot.answers.length === 0 ? null : correctCount / snapshot.answers.length }
    if (snapshot.phase === 'completed') return { status: 'completed', progress, completion: { title: '场景词汇练习完成' } }
    const question = currentQuestion(snapshot, scene)
    if (!question) throw new VocabularyError('session-transition-invalid', 'Active scene vocabulary practice has no question.')
    const targetIndex = question.sentenceEn.indexOf(question.targetText)
    const answers = snapshot.answers
    const currentAnswer = answers[answers.length - 1]
    const feedback = snapshot.phase === 'feedback' && currentAnswer ? { correct: currentAnswer.selectedOptionId === correctOptionId(question), correctMeaningZh: question.correctMeaningZh } : undefined
    return {
      status: snapshot.phase === 'feedback' ? 'feedback' : 'question',
      progress,
      question: {
        questionId: question.questionId,
        promptZh: '这个词是什么意思？',
        sentenceEn: { beforeTarget: question.sentenceEn.slice(0, targetIndex), targetText: question.targetText, afterTarget: question.sentenceEn.slice(targetIndex + question.targetText.length) },
        options: meaningsFor(question).map((labelZh, index) => {
          const id = optionId(question.questionId, index)
          const state: SceneVocabularyOptionState = snapshot.phase === 'answering' ? snapshot.selectedOptionId === id ? 'selected' : 'default' : id === correctOptionId(question) ? 'correct' : id === currentAnswer?.selectedOptionId ? 'incorrect' : 'default'
          return { id, labelZh, state }
        }),
        targetPlayback: { intent: 'play-target-only', text: question.targetText, locale: 'en-US' },
      },
      feedback,
    }
  }
}

export { SCENE_VOCABULARY_BANK_ID, SCENE_VOCABULARY_CONTENT_VERSION, SCENE_VOCABULARY_STORAGE_NAMESPACE }
