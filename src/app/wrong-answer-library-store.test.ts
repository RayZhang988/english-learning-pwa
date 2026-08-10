import { afterEach, describe, expect, it } from 'vitest'
import { applyWrongAnswerEvidence, createWrongAnswerLibraryState, type WrongAnswerEvidence } from '../learning-engine/index.ts'
import { AppDatabase } from '../storage/indexed-db/AppDatabase.ts'
import { createRecordId } from '../storage/record-id.ts'
import { WRONG_ANSWER_LIBRARY_BACKUP_NAMESPACE, WRONG_ANSWER_LIBRARY_KEY, WRONG_ANSWER_LIBRARY_NAMESPACE, WrongAnswerLibraryStore } from './wrong-answer-library-store.ts'

const databases: AppDatabase[] = []
function database(name = `wrong-answer-${crypto.randomUUID()}`) { const value = new AppDatabase(name); databases.push(value); return value }
afterEach(async () => { for (const value of databases.splice(0)) { value.close(); await value.delete() } })

function evidence(eventId: string, reviewContentId: string): WrongAnswerEvidence {
  return { schemaVersion: 1, eventId, occurredAt: '2026-08-10T00:00:00.000Z', domain: 'vocabulary', source: 'daily-training', reviewContentId, originalQuestionType: 'choice', outcome: 'incorrect', formallyScored: true }
}

describe('WrongAnswerLibraryStore cross-instance atomic persistence', () => {
  it('does not lose writes from two independent database instances', async () => {
    const name = `wrong-answer-tabs-${crypto.randomUUID()}`
    const firstDatabase = database(name); const secondDatabase = database(name)
    const first = new WrongAnswerLibraryStore(firstDatabase); const second = new WrongAnswerLibraryStore(secondDatabase)
    await Promise.all([first.publish(evidence('a', 'review-a')), second.publish(evidence('b', 'review-b'))])
    const restored = await first.load()
    expect(restored.records['review-a::choice']?.incorrectCount).toBe(1)
    expect(restored.records['review-b::choice']?.incorrectCount).toBe(1)
  })

  it('persists a same-reference transform instead of skipping the write', async () => {
    const db = database(); const store = new WrongAnswerLibraryStore(db, () => '2026-08-10T00:00:01.000Z')
    await store.update((state) => state)
    const record = await db.records.get(createRecordId(WRONG_ANSWER_LIBRARY_NAMESPACE, WRONG_ANSWER_LIBRARY_KEY))
    expect(record?.updatedAt).toBe('2026-08-10T00:00:01.000Z')
  })

  it('backs up corrupt data and resets only the unified library after confirmation', async () => {
    const db = database(); const store = new WrongAnswerLibraryStore(db, () => '2026-08-10T00:00:02.000Z')
    await db.records.put({ id: createRecordId(WRONG_ANSWER_LIBRARY_NAMESPACE, WRONG_ANSWER_LIBRARY_KEY), namespace: WRONG_ANSWER_LIBRARY_NAMESPACE, key: WRONG_ANSWER_LIBRARY_KEY, value: { broken: true }, schemaVersion: 1, updatedAt: 'old' })
    await db.records.put({ id: createRecordId('app.learning-runtime', 'active-plan'), namespace: 'app.learning-runtime', key: 'active-plan', value: { kept: true }, schemaVersion: 1, updatedAt: 'old' })
    await expect(store.load()).rejects.toThrow()
    expect(await db.records.where('namespace').equals(WRONG_ANSWER_LIBRARY_BACKUP_NAMESPACE).count()).toBe(1)
    await store.resetAfterUserRecovery()
    expect(await store.load()).toEqual(createWrongAnswerLibraryState())
    expect((await db.records.get(createRecordId('app.learning-runtime', 'active-plan')))?.value).toEqual({ kept: true })
  })

  it('validates the transformed state before committing it', async () => {
    const db = database(); const store = new WrongAnswerLibraryStore(db)
    await store.update((state) => applyWrongAnswerEvidence(state, evidence('valid', 'review')).state)
    await expect(store.update(() => ({ broken: true }) as never)).rejects.toThrow()
    expect((await store.load()).records['review::choice']?.incorrectCount).toBe(1)
  })
})
