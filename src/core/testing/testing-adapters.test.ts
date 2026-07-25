import { describe, expect, it } from 'vitest'
import {
  createFailingDataSource,
  createStaticDataSource,
  InMemoryPlatformEventSink,
} from './index.ts'

describe('testing adapters', () => {
  it('loads caller-provided fixture data', async () => {
    const source = createStaticDataSource({ status: 'fixture' })

    await expect(source.load()).resolves.toEqual({ status: 'fixture' })
  })

  it('exposes deterministic load failures', async () => {
    const error = new Error('fixture failure')
    const source = createFailingDataSource(error)

    await expect(source.load()).rejects.toBe(error)
  })

  it('records published platform events in memory', async () => {
    const sink = new InMemoryPlatformEventSink()
    const event = {
      id: 'event-1',
      type: 'fixture.created',
      sourceModuleId: 'fixture',
      occurredAt: '2026-07-24T00:00:00.000Z',
      schemaVersion: 1,
      payload: { fixture: true },
    } as const

    await sink.publish(event)

    expect(sink.events).toEqual([event])
    sink.clear()
    expect(sink.events).toEqual([])
  })
})
