import { describe, expect, it, vi } from 'vitest'
import { ReviewContentSource } from './review-content-source.ts'
import { loadReleasedReviewContentIndex } from './review-content-test-fixtures.ts'

function fetchValue(value: unknown) { return vi.fn(async () => ({ ok: true, json: async () => value }) as Response) }

describe('production R13-D review index source', () => {
  it('accepts the released 2610 daily plus 612 scene aliases', async () => {
    await expect(loadReleasedReviewContentIndex()).resolves.toMatchObject({ schemaVersion: 1, documentType: 'review-content-index' })
  })
  it('rejects a count-preserving alias-key/source identity drift', async () => {
    const document = await loadReleasedReviewContentIndex()
    const aliases = { ...(document.aliases as unknown as Record<string, Record<string, unknown>>) }
    const [key, value] = Object.entries(aliases)[0]!
    aliases[key] = { ...value, source: { ...(value.source as Record<string, unknown>), itemId: 'different-item' } }
    const source = new ReviewContentSource(fetchValue({ ...document, aliases }))
    await expect(source.load()).rejects.toThrow('alias source')
  })
})
