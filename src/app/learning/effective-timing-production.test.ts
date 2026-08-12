import { describe, expect, it } from 'vitest'
import type {
  PlatformEvent,
  PlatformEventSink,
} from '../../core/index.ts'
import type {
  LearningTask,
  TrainingModuleId,
} from '../../learning-engine/index.ts'
import type {
  EffectiveTimingSessionSnapshot,
  EffectiveTimingSnapshotStore,
  EffectiveTimingTaskIdentity,
  TimingLifecycleEvent,
  TimingLifecyclePort,
} from '../../platform/index.ts'
import { ProductionEffectiveTimingSessionFactory } from './effective-timing-production.ts'

class NoopEventSink implements PlatformEventSink {
  async publish(_event: PlatformEvent): Promise<void> {}
}

class MemorySnapshotStore implements EffectiveTimingSnapshotStore {
  readonly records = new Map<string, EffectiveTimingSessionSnapshot>()

  async load(identity: EffectiveTimingTaskIdentity) {
    return this.records.get(identity.taskId)
  }

  async save(snapshot: EffectiveTimingSessionSnapshot): Promise<void> {
    this.records.set(snapshot.identity.taskId, snapshot)
  }

  async delete(identity: EffectiveTimingTaskIdentity): Promise<void> {
    this.records.delete(identity.taskId)
  }
}

class ManualLifecycle implements TimingLifecyclePort {
  currentVisibility() {
    return 'foreground' as const
  }

  subscribe(
    _listener: (event: TimingLifecycleEvent) => void,
  ): () => void {
    return () => undefined
  }
}

function task(): LearningTask {
  return {
    schemaVersion: 1,
    taskId: 'plan-1:task:vocabulary',
    planId: 'plan-1',
    sequence: 1,
    learningUnitId: 'unit-vocabulary-1',
    contentRef: 'lesson://course/day-1/vocabulary',
    domain: 'vocabulary',
    targetModuleId: 'vocabulary',
    mode: 'learn',
    origin: 'new',
    difficultyLevel: 1,
    estimatedSeconds: 300,
    required: true,
    dueAt: null,
    skipLimit: 2,
    tags: ['content-type:multiple-choice-set'],
  }
}

describe('ProductionEffectiveTimingSessionFactory', () => {
  it('creates a fresh timing clock when a training task actually starts', async () => {
    const snapshots = new MemorySnapshotStore()
    let createdClocks = 0
    const factory = new ProductionEffectiveTimingSessionFactory({
      resolveTask() {
        return { task: task(), localDate: '2026-08-12' }
      },
      eventSink: new NoopEventSink(),
      snapshotStore: snapshots,
      lifecycle: new ManualLifecycle(),
      createClock() {
        createdClocks += 1
        return undefined
      },
    })

    expect(createdClocks).toBe(0)
    const session = await factory.create(task().taskId, 'vocabulary')

    expect(createdClocks).toBe(1)
    await session.dispose()
  })

  it('resolves the real task identity and deduplicates concurrent route mounts', async () => {
    const snapshots = new MemorySnapshotStore()
    const resolvedTask = task()
    const calls: Array<{
      taskId: string
      expectedModuleId: TrainingModuleId | undefined
    }> = []
    const factory = new ProductionEffectiveTimingSessionFactory({
      resolveTask(taskId, expectedModuleId) {
        calls.push({ taskId, expectedModuleId })
        if (
          taskId !== resolvedTask.taskId ||
          expectedModuleId !== resolvedTask.targetModuleId
        ) {
          throw new TypeError('task identity mismatch')
        }
        return {
          task: resolvedTask,
          localDate: '2026-07-27',
        }
      },
      eventSink: new NoopEventSink(),
      snapshotStore: snapshots,
      lifecycle: new ManualLifecycle(),
      createId: () => 'production-session',
    })

    const [first, second] = await Promise.all([
      factory.create(resolvedTask.taskId, 'vocabulary'),
      factory.create(resolvedTask.taskId, 'vocabulary'),
    ])

    expect(first).toBe(second)
    expect(calls).toHaveLength(2)
    expect(
      snapshots.records.get(resolvedTask.taskId)?.identity,
    ).toEqual({
      planId: resolvedTask.planId,
      taskId: resolvedTask.taskId,
      learningUnitId: resolvedTask.learningUnitId,
      contentRef: resolvedTask.contentRef,
      domain: resolvedTask.domain,
      targetModuleId: resolvedTask.targetModuleId,
      localDate: '2026-07-27',
      mode: resolvedTask.mode,
    })
    await first.dispose()
  })

  it('rejects the wrong task or module before creating timing state', async () => {
    const snapshots = new MemorySnapshotStore()
    const factory = new ProductionEffectiveTimingSessionFactory({
      resolveTask(taskId, expectedModuleId) {
        if (
          taskId !== task().taskId ||
          expectedModuleId !== 'vocabulary'
        ) {
          throw new TypeError('task identity mismatch')
        }
        return {
          task: task(),
          localDate: '2026-07-27',
        }
      },
      eventSink: new NoopEventSink(),
      snapshotStore: snapshots,
      lifecycle: new ManualLifecycle(),
    })

    await expect(
      factory.create('unknown-task', 'listening'),
    ).rejects.toThrow('task identity mismatch')
    expect(snapshots.records.size).toBe(0)
  })
})
