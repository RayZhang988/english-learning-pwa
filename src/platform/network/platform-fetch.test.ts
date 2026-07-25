import { describe, expect, it } from 'vitest'
import { createPlatformFetch } from './platform-fetch.ts'

describe('createPlatformFetch', () => {
  it('keeps the platform receiver when consumers store fetch as a field', async () => {
    const receivers: unknown[] = []
    const receiverSensitiveFetch = function (
      this: typeof globalThis,
    ): Promise<Response> {
      receivers.push(this)
      return Promise.resolve(new Response('{}'))
    } as typeof fetch
    const holder = {
      fetcher: createPlatformFetch(receiverSensitiveFetch),
    }

    const response = await holder.fetcher('https://example.test/data.json')

    expect(receivers).toEqual([globalThis])
    expect(response.ok).toBe(true)
  })
})
