import type { PortableData } from './portable-data.ts'

/**
 * Infrastructure envelope only. Event names and payload meanings belong to
 * the producing business task.
 */
export interface PlatformEvent<
  TType extends string = string,
  TPayload extends PortableData = PortableData,
> {
  readonly id: string
  readonly type: TType
  readonly sourceModuleId: string
  readonly occurredAt: string
  readonly schemaVersion: number
  readonly payload: TPayload
}

export interface PlatformEventSink {
  publish(event: PlatformEvent): Promise<void>
}
