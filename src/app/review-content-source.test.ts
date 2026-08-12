import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { ReviewContentSource } from './review-content-source.ts'

async function released(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL('../../content/curriculum/review-content-index.v1.json', import.meta.url), 'utf8')) as Record<string, unknown>
}
function fetchValue(value: unknown) { return vi.fn(async () => ({ ok: true, json: async () => value }) as Response) }

describe('production R13-D review index source', () => {
  it('accepts the released 2421 daily plus 612 scene aliases', async () => {
    const source = new ReviewContentSource(fetchValue(await released()))
    await expect(source.load()).resolves.toMatchObject({ schemaVersion: 1, documentType: 'review-content-index' })
  })
  it('rejects a count-preserving alias-key/source identity drift', async () => {
    const document = await released()
    const aliases = { ...(document.aliases as Record<string, Record<string, unknown>>) }
    const [key, value] = Object.entries(aliases)[0]!
    aliases[key] = { ...value, source: { ...(value.source as Record<string, unknown>), itemId: 'different-item' } }
    const source = new ReviewContentSource(fetchValue({ ...document, aliases }))
    await expect(source.load()).rejects.toThrow('alias source')
  })
})
