import { AppError } from '../../core/errors/AppError.ts'
import type {
  StorageHealthService,
  StorageHealthSnapshot,
  StoragePersistenceMode,
} from './contracts.ts'

function getStorageManager() {
  if (typeof navigator === 'undefined') {
    return undefined
  }

  return navigator.storage
}

async function inspectPersistence(
  storage: StorageManager,
): Promise<StoragePersistenceMode> {
  if (!storage.persisted) {
    return 'unsupported'
  }

  try {
    return (await storage.persisted()) ? 'persistent' : 'best-effort'
  } catch {
    return 'unsupported'
  }
}

async function inspectEstimate(storage: StorageManager) {
  if (!storage.estimate) {
    return {}
  }

  try {
    return await storage.estimate()
  } catch {
    return {}
  }
}

export class BrowserStorageHealthService implements StorageHealthService {
  async inspect(): Promise<StorageHealthSnapshot> {
    const storage = getStorageManager()
    if (!storage) {
      return { persistence: 'unsupported' }
    }

    const [persistence, estimate] = await Promise.all([
      inspectPersistence(storage),
      inspectEstimate(storage),
    ])
    const usageBytes = estimate.usage
    const quotaBytes = estimate.quota
    const availableBytes =
      usageBytes === undefined || quotaBytes === undefined
        ? undefined
        : Math.max(0, quotaBytes - usageBytes)
    const usageRatio =
      usageBytes === undefined || !quotaBytes
        ? undefined
        : usageBytes / quotaBytes

    return {
      persistence,
      usageBytes,
      quotaBytes,
      availableBytes,
      usageRatio,
    }
  }

  async requestPersistence(): Promise<StorageHealthSnapshot> {
    const storage = getStorageManager()
    if (!storage?.persist) {
      return this.inspect()
    }

    try {
      await storage.persist()
      return this.inspect()
    } catch (error) {
      throw new AppError(
        'storage_unavailable',
        '无法申请持久化本地存储。',
        {
          cause: error,
          recoverable: true,
        },
      )
    }
  }
}

export const storageHealthService = new BrowserStorageHealthService()
