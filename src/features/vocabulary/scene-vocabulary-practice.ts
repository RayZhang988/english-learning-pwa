import type { ReadonlyDataSource } from '../../core/index.ts'
import { localStorageService, type NamespaceStore } from '../../storage/index.ts'
import { VocabularyError } from './errors.ts'

const SCENE_VOCABULARY_BANK_ID = 'r13b-travel-scene-vocabulary'
/** Content remains at 1.0.0 until the R13-C 500-item authored bank is released. */
const SCENE_VOCABULARY_CONTENT_VERSION = '1.0.0'
const SCENE_VOCABULARY_STORAGE_NAMESPACE = 'feature.vocabulary.scene-practice'
const SHORT_TERM_EXCLUSION_LIMIT = 3

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) throw new VocabularyError('content-invalid', `${label} must be an object.`)
  return value
}

function requireString(record: UnknownRecord, key: string, label: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new VocabularyError('content-invalid', `${label}.${key} must be a non-empty string.`)
  }
  return value
}

function requireStringArray(record: UnknownRecord, key: string, label: string): readonly string[] {
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
  const distractors = requireStringArray(question, 'distractorMeaningsZh', label)
  const source = requireRecord(question.source, `${label}.source`)
  if (
    question.targetOccurrence !== 1 || distractors.length !== 3 || new Set(distractors).size !== 3 ||
    sentenceEn.toLocaleLowerCase('en-US').indexOf(targetText.toLocaleLowerCase('en-US')) === -1 ||
    sentenceEn.toLocaleLowerCase('en-US').indexOf(targetText.toLocaleLowerCase('en-US')) !== sentenceEn.toLocaleLowerCase('en-US').lastIndexOf(targetText.toLocaleLowerCase('en-US')) ||
    source.kind !== 'project-authored-controlled-text' || source.rights !== 'original-project-content'
  ) throw new VocabularyError('content-invalid', `${label} violates the frozen scene vocabulary contract.`)
  const correctMeaningZh = requireString(question, 'correctMeaningZh', label)
  if (distractors.includes(correctMeaningZh)) {
    throw new VocabularyError('content-invalid', `${label} repeats the correct meaning as a distractor.`)
  }
  return {
    questionId: requireString(question, 'questionId', label), sentenceEn, targetText,
    targetOccurrence: 1, correctMeaningZh,
    distractorMeaningsZh: distractors as [string, string, string],
    source: { sourceId: requireString(source, 'sourceId', `${label}.source`), kind: 'project-authored-controlled-text', rights: 'original-project-content' },
  }
}

/** Parses only the released R13-C contract. Callers must not scan content directories. */
export function createSceneVocabularyQuestionBank(value: unknown): SceneVocabularyQuestionBank {
  const document = requireRecord(value, 'scene vocabulary question bank')
  if (document.schemaVersion !== 1 || document.documentType !== 'scene-vocabulary-question-bank' || document.contentVersion !== SCENE_VOCABULARY_CONTENT_VERSION || document.bankId !== SCENE_VOCABULARY_BANK_ID) {
    throw new VocabularyError('content-version-unsupported', 'Scene vocabulary question bank uses an unsupported version.')
  }
  const interaction = requireRecord(document.interaction, 'scene vocabulary interaction')
  if (interaction.promptZh !== '这个词是什么意思？' || interaction.targetPlayback !== 'tap-highlighted-target-only' || interaction.sentenceTranslationAllowed !== false) {
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
    if (sceneIds.has(sceneId) || !Array.isArray(scene.questions) || scene.questions.length < 6) {
      throw new VocabularyError('content-invalid', `scenes[${index}] has an invalid id or question count.`)
    }
    sceneIds.add(sceneId)
    const questions = scene.questions.map((question, questionIndex) => {
      const parsed = parseQuestion(question, `scenes[${index}].questions[${questionIndex}]`)
      if (questionIds.has(parsed.questionId)) throw new VocabularyError('content-invalid', `Duplicate scene vocabulary question ${parsed.questionId}.`)
      questionIds.add(parsed.questionId)
      return parsed
    })
    return { sceneId, categoryId: requireString(scene, 'categoryId', `scenes[${index}]`), titleZh: requireString(scene, 'titleZh', `scenes[${index}]`), questions }
  })
  return {
    schemaVersion: 1, documentType: 'scene-vocabulary-question-bank', contentVersion: '1.0.0', bankId: 'r13b-travel-scene-vocabulary',
    interaction: { promptZh: '这个词是什么意思？', targetPlayback: 'tap-highlighted-target-only', sentenceTranslationAllowed: false },
    scenes, getScene: (categoryId, sceneId) => scenes.find((scene) => scene.categoryId === categoryId && scene.sceneId === sceneId),
  }
}

export interface SceneVocabularyPracticeAnswer {
  readonly questionId: string
  readonly selectedOptionId: string
  readonly submittedAt: string
}

/** A new explicit round preserves the old scene result without touching plan data. */
export interface SceneVocabularyPracticeRoundSummary {
  readonly round: number
  readonly answeredCount: number
  readonly correctCount: number
  readonly incorrectCount: number
  readonly endedAt: string
}

interface LegacySceneVocabularyPracticeSnapshot {
  readonly schemaVersion: 1
  readonly sessionId: string
  readonly bankId: 'r13b-travel-scene-vocabulary'
  readonly contentVersion: '1.0.0'
  readonly categoryId: string
  readonly sceneId: string
  readonly questionIds: readonly string[]
  readonly answers: readonly SceneVocabularyPracticeAnswer[]
  readonly selectedOptionId: string | null
  readonly phase: 'answering' | 'feedback' | 'completed'
  readonly createdAt: string
  readonly updatedAt: string
}

/** R13-C durable state. `questionIds` is the explicitly persisted order for the active round. */
export interface SceneVocabularyPracticeSnapshot {
  readonly schemaVersion: 2
  readonly sessionId: string
  readonly bankId: 'r13b-travel-scene-vocabulary'
  readonly contentVersion: '1.0.0'
  readonly categoryId: string
  readonly sceneId: string
  readonly round: number
  readonly supplyCursor: number
  readonly questionIds: readonly string[]
  readonly shortTermExclusionIds: readonly string[]
  readonly currentQuestionId: string
  /** Cumulative, including answers restored from a migrated R13-B snapshot. */
  readonly answers: readonly SceneVocabularyPracticeAnswer[]
  readonly correctCount: number
  readonly incorrectCount: number
  /** Prior explicit rounds, retained only in this scene's dedicated snapshot. */
  readonly priorRounds: readonly SceneVocabularyPracticeRoundSummary[]
  readonly selectedOptionId: string | null
  readonly phase: 'answering' | 'feedback'
  readonly createdAt: string
  readonly updatedAt: string
}

type StoredSceneVocabularyPracticeSnapshot = SceneVocabularyPracticeSnapshot | LegacySceneVocabularyPracticeSnapshot

export interface SceneVocabularyPracticeRepository {
  load(sessionId: string): Promise<StoredSceneVocabularyPracticeSnapshot | undefined>
  save(snapshot: SceneVocabularyPracticeSnapshot): Promise<void>
  /** Removes only the supplied scene-session key after explicit user confirmation. */
  discardInvalidSnapshot(sessionId: string): Promise<void>
}

function isAnswer(value: unknown): value is SceneVocabularyPracticeAnswer {
  return isRecord(value) && typeof value.questionId === 'string' && typeof value.selectedOptionId === 'string' && typeof value.submittedAt === 'string'
}

function isLegacySnapshot(value: unknown): value is LegacySceneVocabularyPracticeSnapshot {
  return isRecord(value) && value.schemaVersion === 1 && value.bankId === SCENE_VOCABULARY_BANK_ID && value.contentVersion === SCENE_VOCABULARY_CONTENT_VERSION && Array.isArray(value.questionIds) && Array.isArray(value.answers) && typeof value.sessionId === 'string' && typeof value.categoryId === 'string' && typeof value.sceneId === 'string' && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string' && (value.selectedOptionId === null || typeof value.selectedOptionId === 'string') && ['answering', 'feedback', 'completed'].includes(String(value.phase)) && value.questionIds.every((id) => typeof id === 'string') && value.answers.every(isAnswer)
}

function isSnapshot(value: unknown): value is SceneVocabularyPracticeSnapshot {
  return isRecord(value) && value.schemaVersion === 2 && value.bankId === SCENE_VOCABULARY_BANK_ID && value.contentVersion === SCENE_VOCABULARY_CONTENT_VERSION && Array.isArray(value.questionIds) && Array.isArray(value.shortTermExclusionIds) && Array.isArray(value.answers) && Array.isArray(value.priorRounds) && typeof value.sessionId === 'string' && typeof value.categoryId === 'string' && typeof value.sceneId === 'string' && Number.isInteger(value.round) && Number.isInteger(value.supplyCursor) && typeof value.currentQuestionId === 'string' && Number.isInteger(value.correctCount) && Number.isInteger(value.incorrectCount) && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string' && (value.selectedOptionId === null || typeof value.selectedOptionId === 'string') && ['answering', 'feedback'].includes(String(value.phase)) && value.questionIds.every((id) => typeof id === 'string') && value.shortTermExclusionIds.every((id) => typeof id === 'string') && value.answers.every(isAnswer) && value.priorRounds.every(isRoundSummary)
}

function isRoundSummary(value: unknown): value is SceneVocabularyPracticeRoundSummary {
  return isRecord(value) && Number.isInteger(value.round) && Number.isInteger(value.answeredCount) && Number.isInteger(value.correctCount) && Number.isInteger(value.incorrectCount) && typeof value.endedAt === 'string'
}

export class StoredSceneVocabularyPracticeRepository implements SceneVocabularyPracticeRepository {
  private readonly store: NamespaceStore
  constructor(store: NamespaceStore = localStorageService.namespace(SCENE_VOCABULARY_STORAGE_NAMESPACE)) { this.store = store }
  private key(sessionId: string): string { return `session:${sessionId}` }
  async load(sessionId: string): Promise<StoredSceneVocabularyPracticeSnapshot | undefined> {
    const record = await this.store.get<unknown>(this.key(sessionId))
    if (!record) return undefined
    if ((!isSnapshot(record.value) && !isLegacySnapshot(record.value)) || record.value.sessionId !== sessionId) {
      throw new VocabularyError('session-recovery-invalid', 'Stored scene vocabulary practice snapshot is invalid.')
    }
    return record.value
  }
  async save(snapshot: SceneVocabularyPracticeSnapshot): Promise<void> {
    const portable = JSON.parse(JSON.stringify(snapshot)) as unknown
    if (!isSnapshot(portable)) throw new VocabularyError('session-recovery-invalid', 'Scene vocabulary practice snapshot is not JSON-portable.')
    await this.store.put(this.key(snapshot.sessionId), portable, 2)
  }
  discardInvalidSnapshot(sessionId: string): Promise<void> {
    return this.store.delete(this.key(sessionId))
  }
}

export type SceneVocabularyOptionState = 'default' | 'selected' | 'correct' | 'incorrect'
export interface SceneVocabularyPracticeView {
  readonly status: 'question' | 'feedback'
  readonly progress: {
    readonly answeredCount: number
    readonly correctCount: number
    readonly incorrectCount: number
    /** R13-B presentation compatibility only: current offline pool size, never a completion target. */
    readonly totalCount: number
    readonly accuracy: number | null
  }
  readonly question?: { readonly questionId: string; readonly promptZh: '这个词是什么意思？'; readonly sentenceEn: { readonly beforeTarget: string; readonly targetText: string; readonly afterTarget: string }; readonly options: readonly { readonly id: string; readonly labelZh: string; readonly state: SceneVocabularyOptionState }[]; readonly targetPlayback: { readonly intent: 'play-target-only'; readonly text: string; readonly locale: 'en-US' } }
  readonly feedback?: { readonly correct: boolean; readonly correctMeaningZh: string }
}

export interface SceneVocabularyPracticeRuntimeOptions {
  readonly categoryId: string
  readonly sceneId: string
  readonly contentSource: ReadonlyDataSource<SceneVocabularyQuestionBank>
  readonly repository?: SceneVocabularyPracticeRepository
  readonly sessionId?: string
  readonly now?: () => string
}

function optionId(questionId: string, position: number): string { return `${questionId}:meaning:${position + 1}` }
function meaningsFor(question: SceneVocabularyQuestion): readonly string[] {
  const meanings = [question.correctMeaningZh, ...question.distractorMeaningsZh]
  let hash = 0
  for (const character of question.questionId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const offset = hash % meanings.length
  return [...meanings.slice(offset), ...meanings.slice(0, offset)]
}
function correctOptionId(question: SceneVocabularyQuestion): string { return optionId(question.questionId, meaningsFor(question).indexOf(question.correctMeaningZh)) }
function questionById(scene: SceneVocabularyScene, questionId: string): SceneVocabularyQuestion | undefined { return scene.questions.find((question) => question.questionId === questionId) }
function stableRank(questionId: string, round: number): number {
  let hash = (round * 2_654_435_761) >>> 0
  for (const character of questionId) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0
  return hash
}
function orderForRound(scene: SceneVocabularyScene, round: number, excluded: readonly string[]): readonly string[] {
  const ordered = [...scene.questions.map((question) => question.questionId)].sort((left, right) => stableRank(left, round) - stableRank(right, round) || left.localeCompare(right))
  const start = ordered.findIndex((id) => !excluded.includes(id))
  return start <= 0 ? ordered : [...ordered.slice(start), ...ordered.slice(0, start)]
}
function newSnapshot(scene: SceneVocabularyScene, sessionId: string, now: string, round = 1, previous: Pick<SceneVocabularyPracticeSnapshot, 'answers' | 'correctCount' | 'incorrectCount' | 'shortTermExclusionIds' | 'priorRounds' | 'createdAt'> | undefined = undefined): SceneVocabularyPracticeSnapshot {
  const questionIds = orderForRound(scene, round, previous?.shortTermExclusionIds ?? [])
  return { schemaVersion: 2, sessionId, bankId: 'r13b-travel-scene-vocabulary', contentVersion: '1.0.0', categoryId: scene.categoryId, sceneId: scene.sceneId, round, supplyCursor: 0, questionIds, shortTermExclusionIds: previous?.shortTermExclusionIds ?? [], currentQuestionId: questionIds[0]!, answers: previous?.answers ?? [], correctCount: previous?.correctCount ?? 0, incorrectCount: previous?.incorrectCount ?? 0, priorRounds: previous?.priorRounds ?? [], selectedOptionId: null, phase: 'answering', createdAt: previous?.createdAt ?? now, updatedAt: now }
}

function validateSnapshot(snapshot: SceneVocabularyPracticeSnapshot, scene: SceneVocabularyScene, categoryId: string, sceneId: string, sessionId: string): void {
  const released = new Set(scene.questions.map((question) => question.questionId))
  if (snapshot.sessionId !== sessionId || snapshot.categoryId !== categoryId || snapshot.sceneId !== sceneId || snapshot.questionIds.length !== scene.questions.length || new Set(snapshot.questionIds).size !== scene.questions.length || snapshot.questionIds.some((id) => !released.has(id)) || snapshot.round < 1 || snapshot.supplyCursor < 0 || snapshot.supplyCursor >= snapshot.questionIds.length || snapshot.currentQuestionId !== snapshot.questionIds[snapshot.supplyCursor] || snapshot.shortTermExclusionIds.length > SHORT_TERM_EXCLUSION_LIMIT || snapshot.shortTermExclusionIds.some((id) => !released.has(id)) || snapshot.correctCount < 0 || snapshot.incorrectCount < 0 || snapshot.answers.length !== snapshot.correctCount + snapshot.incorrectCount || snapshot.priorRounds.some((summary) => summary.round < 1 || summary.answeredCount < 0 || summary.correctCount < 0 || summary.incorrectCount < 0 || summary.answeredCount !== summary.correctCount + summary.incorrectCount)) {
    throw new VocabularyError('session-recovery-invalid', 'Stored scene vocabulary practice does not match the released scene sequence.')
  }
  if (snapshot.answers.some((answer) => {
    const answeredQuestion = questionById(scene, answer.questionId)
    return !answeredQuestion || !meaningsFor(answeredQuestion).some((_, index) => optionId(answeredQuestion.questionId, index) === answer.selectedOptionId)
  })) {
    throw new VocabularyError('session-recovery-invalid', 'Stored scene vocabulary answers do not match released options.')
  }
  const active = questionById(scene, snapshot.currentQuestionId)
  if (!active || (snapshot.selectedOptionId !== null && !meaningsFor(active).some((_, index) => optionId(active.questionId, index) === snapshot.selectedOptionId))) {
    throw new VocabularyError('session-recovery-invalid', 'Stored selected scene vocabulary option does not match released options.')
  }
  const last = snapshot.answers.at(-1)
  if (snapshot.phase === 'feedback' && (!last || last.questionId !== active.questionId || snapshot.selectedOptionId !== null)) {
    throw new VocabularyError('session-recovery-invalid', 'Stored scene vocabulary feedback is invalid.')
  }
  if (snapshot.phase === 'answering' && last?.questionId === active.questionId && snapshot.selectedOptionId === null) {
    throw new VocabularyError('session-recovery-invalid', 'Stored scene vocabulary answer was not advanced.')
  }
}

function migrateLegacySnapshot(legacy: LegacySceneVocabularyPracticeSnapshot, scene: SceneVocabularyScene, categoryId: string, sceneId: string, sessionId: string, now: string): SceneVocabularyPracticeSnapshot {
  const releasedQuestionIds = scene.questions.map((question) => question.questionId)
  if (legacy.sessionId !== sessionId || legacy.categoryId !== categoryId || legacy.sceneId !== sceneId || legacy.questionIds.length !== 6 || legacy.questionIds.some((id, index) => id !== releasedQuestionIds[index]) || legacy.answers.length > legacy.questionIds.length || new Set(legacy.answers.map((answer) => answer.questionId)).size !== legacy.answers.length) {
    throw new VocabularyError('session-recovery-invalid', 'Legacy scene vocabulary practice cannot be migrated safely.')
  }
  legacy.answers.forEach((answer, index) => {
    const question = scene.questions[index]
    if (!question || answer.questionId !== question.questionId || !meaningsFor(question).some((_, optionIndex) => optionId(question.questionId, optionIndex) === answer.selectedOptionId)) throw new VocabularyError('session-recovery-invalid', 'Legacy scene vocabulary answer does not match released options.')
  })
  const correctCount = legacy.answers.filter((answer, index) => answer.selectedOptionId === correctOptionId(scene.questions[index]!)).length
  const exclusion = legacy.answers.slice(-SHORT_TERM_EXCLUSION_LIMIT).map((answer) => answer.questionId)
  if (legacy.phase === 'feedback') {
    const cursor = legacy.answers.length - 1
    const active = legacy.answers[cursor]!
    return { schemaVersion: 2, sessionId, bankId: 'r13b-travel-scene-vocabulary', contentVersion: '1.0.0', categoryId, sceneId, round: 1, supplyCursor: cursor, questionIds: releasedQuestionIds, shortTermExclusionIds: exclusion, currentQuestionId: active.questionId, answers: legacy.answers, correctCount, incorrectCount: legacy.answers.length - correctCount, priorRounds: [], selectedOptionId: null, phase: 'feedback', createdAt: legacy.createdAt, updatedAt: now }
  }
  if (legacy.phase === 'answering' && legacy.answers.length < releasedQuestionIds.length) {
    const cursor = legacy.answers.length
    const active = scene.questions[cursor]!
    if (legacy.selectedOptionId !== null && !meaningsFor(active).some((_, index) => optionId(active.questionId, index) === legacy.selectedOptionId)) throw new VocabularyError('session-recovery-invalid', 'Legacy scene vocabulary selection does not match released options.')
    return { schemaVersion: 2, sessionId, bankId: 'r13b-travel-scene-vocabulary', contentVersion: '1.0.0', categoryId, sceneId, round: 1, supplyCursor: cursor, questionIds: releasedQuestionIds, shortTermExclusionIds: exclusion, currentQuestionId: active.questionId, answers: legacy.answers, correctCount, incorrectCount: legacy.answers.length - correctCount, priorRounds: [], selectedOptionId: legacy.selectedOptionId, phase: 'answering', createdAt: legacy.createdAt, updatedAt: now }
  }
  return newSnapshot(scene, sessionId, now, 2, { answers: legacy.answers, correctCount, incorrectCount: legacy.answers.length - correctCount, shortTermExclusionIds: exclusion, priorRounds: [], createdAt: legacy.createdAt })
}

export class SceneVocabularyPracticeRuntime {
  private readonly options: SceneVocabularyPracticeRuntimeOptions
  private readonly repository: SceneVocabularyPracticeRepository
  private readonly now: () => string
  private snapshot: SceneVocabularyPracticeSnapshot | null = null
  private scene: SceneVocabularyScene | null = null
  private recoveryInvalidSnapshot = false
  private tail: Promise<void> = Promise.resolve()
  constructor(options: SceneVocabularyPracticeRuntimeOptions) { this.options = options; this.repository = options.repository ?? new StoredSceneVocabularyPracticeRepository(); this.now = options.now ?? (() => new Date().toISOString()) }
  get currentSnapshot(): SceneVocabularyPracticeSnapshot | null { return this.snapshot }
  private get sessionId(): string { return this.options.sessionId ?? `r13b-scene-vocabulary:${this.options.categoryId}:${this.options.sceneId}` }
  private requireSnapshot(): SceneVocabularyPracticeSnapshot { if (!this.snapshot) throw new VocabularyError('session-transition-invalid', 'Scene vocabulary runtime has not been initialized.'); return this.snapshot }
  private requireScene(): SceneVocabularyScene { if (!this.scene) throw new VocabularyError('session-transition-invalid', 'Scene vocabulary runtime has not loaded its scene.'); return this.scene }
  private queue<T>(operation: () => Promise<T>): Promise<T> { const result = this.tail.then(operation, operation); this.tail = result.then(() => undefined, () => undefined); return result }
  private async save(snapshot: SceneVocabularyPracticeSnapshot): Promise<SceneVocabularyPracticeSnapshot> { await this.repository.save(snapshot); this.snapshot = snapshot; return snapshot }
  initialize(): Promise<SceneVocabularyPracticeSnapshot> {
    return this.queue(async () => {
      try {
        const bank = await this.options.contentSource.load()
        const scene = bank.getScene(this.options.categoryId, this.options.sceneId)
        if (!scene) throw new VocabularyError('content-reference-missing', `Scene vocabulary content is unavailable for ${this.options.categoryId}/${this.options.sceneId}.`)
        this.scene = scene
        const stored = await this.repository.load(this.sessionId)
        if (stored && isSnapshot(stored)) { validateSnapshot(stored, scene, this.options.categoryId, this.options.sceneId, this.sessionId); this.snapshot = stored; this.recoveryInvalidSnapshot = false; return stored }
        if (stored && isLegacySnapshot(stored)) { const migrated = await this.save(migrateLegacySnapshot(stored, scene, this.options.categoryId, this.options.sceneId, this.sessionId, this.now())); this.recoveryInvalidSnapshot = false; return migrated }
        const fresh = await this.save(newSnapshot(scene, this.sessionId, this.now()))
        this.recoveryInvalidSnapshot = false
        return fresh
      } catch (error) {
        this.recoveryInvalidSnapshot = error instanceof VocabularyError && error.code === 'session-recovery-invalid'
        throw error
      }
    })
  }
  /**
   * An explicit, confirmed recovery action. It never runs from initialize and
   * can only remove this runtime's exact scene-session key.
   */
  restartAfterInvalidSnapshot(): Promise<SceneVocabularyPracticeSnapshot> {
    return this.queue(async () => {
      if (!this.recoveryInvalidSnapshot) {
        const snapshot = this.currentSnapshot
        if (snapshot) return snapshot
        throw new VocabularyError('session-transition-invalid', 'No invalid scene vocabulary snapshot is awaiting recovery.')
      }
      const bank = await this.options.contentSource.load()
      const scene = bank.getScene(this.options.categoryId, this.options.sceneId)
      if (!scene) throw new VocabularyError('content-reference-missing', `Scene vocabulary content is unavailable for ${this.options.categoryId}/${this.options.sceneId}.`)
      await this.repository.discardInvalidSnapshot(this.sessionId)
      this.scene = scene
      this.snapshot = null
      const fresh = await this.save(newSnapshot(scene, this.sessionId, this.now()))
      this.recoveryInvalidSnapshot = false
      return fresh
    })
  }
  select(optionIdValue: string): Promise<SceneVocabularyPracticeSnapshot> {
    return this.queue(async () => {
      const snapshot = this.requireSnapshot(); const question = questionById(this.requireScene(), snapshot.currentQuestionId)
      if (snapshot.phase !== 'answering' || !question || !meaningsFor(question).some((_, index) => optionId(question.questionId, index) === optionIdValue)) throw new VocabularyError('session-transition-invalid', 'Option does not belong to the active scene vocabulary question.')
      return this.save({ ...snapshot, selectedOptionId: optionIdValue, updatedAt: this.now() })
    })
  }
  submit(): Promise<SceneVocabularyPracticeSnapshot> {
    return this.queue(async () => {
      const snapshot = this.requireSnapshot(); const question = questionById(this.requireScene(), snapshot.currentQuestionId)
      if (snapshot.phase !== 'answering' || !question || snapshot.selectedOptionId === null) throw new VocabularyError('session-transition-invalid', 'Select a scene vocabulary meaning before submitting.')
      const correct = snapshot.selectedOptionId === correctOptionId(question)
      return this.save({ ...snapshot, answers: [...snapshot.answers, { questionId: question.questionId, selectedOptionId: snapshot.selectedOptionId, submittedAt: this.now() }], correctCount: snapshot.correctCount + (correct ? 1 : 0), incorrectCount: snapshot.incorrectCount + (correct ? 0 : 1), selectedOptionId: null, phase: 'feedback', updatedAt: this.now() })
    })
  }
  advance(): Promise<SceneVocabularyPracticeSnapshot> {
    return this.queue(async () => {
      const snapshot = this.requireSnapshot(); const scene = this.requireScene()
      if (snapshot.phase !== 'feedback') throw new VocabularyError('session-transition-invalid', 'Advance is available only after scene vocabulary feedback.')
      const exclusions = [...snapshot.shortTermExclusionIds, snapshot.currentQuestionId].slice(-SHORT_TERM_EXCLUSION_LIMIT)
      if (snapshot.supplyCursor + 1 < snapshot.questionIds.length) {
        const cursor = snapshot.supplyCursor + 1
        return this.save({ ...snapshot, supplyCursor: cursor, currentQuestionId: snapshot.questionIds[cursor]!, shortTermExclusionIds: exclusions, selectedOptionId: null, phase: 'answering', updatedAt: this.now() })
      }
      return this.save(newSnapshot(scene, this.sessionId, this.now(), snapshot.round + 1, { answers: snapshot.answers, correctCount: snapshot.correctCount, incorrectCount: snapshot.incorrectCount, shortTermExclusionIds: exclusions, priorRounds: snapshot.priorRounds, createdAt: snapshot.createdAt }))
    })
  }
  /** Explicit user intent: retains no prior progress under the same session id. */
  startNewRound(): Promise<SceneVocabularyPracticeSnapshot> {
    return this.queue(async () => {
      const snapshot = this.requireSnapshot(); const scene = this.requireScene()
      const endedAt = this.now()
      return this.save(newSnapshot(scene, this.sessionId, endedAt, snapshot.round + 1, {
        answers: [],
        correctCount: 0,
        incorrectCount: 0,
        shortTermExclusionIds: snapshot.shortTermExclusionIds,
        priorRounds: [...snapshot.priorRounds, {
          round: snapshot.round,
          answeredCount: snapshot.answers.length,
          correctCount: snapshot.correctCount,
          incorrectCount: snapshot.incorrectCount,
          endedAt,
        }],
        createdAt: endedAt,
      }))
    })
  }
  /** Explicit navigation intent. Every mutation is already durable; this records a final idempotent checkpoint. */
  exit(): Promise<SceneVocabularyPracticeSnapshot> {
    return this.queue(async () => {
      const snapshot = this.requireSnapshot()
      return this.save({ ...snapshot, updatedAt: this.now() })
    })
  }
  /** Kept only for R13-B callers; it is an explicit alias, never an automatic recovery action. */
  restart(): Promise<SceneVocabularyPracticeSnapshot> { return this.startNewRound() }
  toView(): SceneVocabularyPracticeView {
    const snapshot = this.requireSnapshot(); const scene = this.requireScene(); const question = questionById(scene, snapshot.currentQuestionId)
    if (!question) throw new VocabularyError('session-transition-invalid', 'Active scene vocabulary practice has no question.')
    const targetIndex = question.sentenceEn.toLocaleLowerCase('en-US').indexOf(question.targetText.toLocaleLowerCase('en-US'))
    const currentAnswer = snapshot.phase === 'feedback' ? snapshot.answers.at(-1) : undefined
    const feedback = currentAnswer ? { correct: currentAnswer.selectedOptionId === correctOptionId(question), correctMeaningZh: question.correctMeaningZh } : undefined
    return {
      status: snapshot.phase === 'feedback' ? 'feedback' : 'question',
      progress: { answeredCount: snapshot.answers.length, correctCount: snapshot.correctCount, incorrectCount: snapshot.incorrectCount, totalCount: scene.questions.length, accuracy: snapshot.answers.length === 0 ? null : snapshot.correctCount / snapshot.answers.length },
      question: {
        questionId: question.questionId, promptZh: '这个词是什么意思？',
        sentenceEn: { beforeTarget: question.sentenceEn.slice(0, targetIndex), targetText: question.targetText, afterTarget: question.sentenceEn.slice(targetIndex + question.targetText.length) },
        options: meaningsFor(question).map((labelZh, index) => { const id = optionId(question.questionId, index); const state: SceneVocabularyOptionState = snapshot.phase === 'answering' ? snapshot.selectedOptionId === id ? 'selected' : 'default' : id === correctOptionId(question) ? 'correct' : id === currentAnswer?.selectedOptionId ? 'incorrect' : 'default'; return { id, labelZh, state } }),
        targetPlayback: { intent: 'play-target-only', text: question.targetText, locale: 'en-US' },
      }, feedback,
    }
  }
}

export { SCENE_VOCABULARY_BANK_ID, SCENE_VOCABULARY_CONTENT_VERSION, SCENE_VOCABULARY_STORAGE_NAMESPACE }
