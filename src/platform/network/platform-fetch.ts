export function createPlatformFetch(
  fetcher: typeof fetch = globalThis.fetch,
): typeof fetch {
  return (input, init) =>
    Reflect.apply(fetcher, globalThis, [input, init]) as Promise<Response>
}

export const platformFetch = createPlatformFetch()
