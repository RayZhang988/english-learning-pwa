import type {
  PlatformEvent,
  PlatformEventSink,
} from '../contracts/platform-event.ts'

export class InMemoryPlatformEventSink implements PlatformEventSink {
  readonly events: PlatformEvent[] = []

  async publish(event: PlatformEvent): Promise<void> {
    this.events.push(event)
  }

  clear(): void {
    this.events.length = 0
  }
}
