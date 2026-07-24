export type StoragePersistenceMode =
  | 'persistent'
  | 'best-effort'
  | 'unsupported'

export interface StorageHealthSnapshot {
  readonly persistence: StoragePersistenceMode
  readonly usageBytes?: number
  readonly quotaBytes?: number
  readonly availableBytes?: number
  readonly usageRatio?: number
}

export interface StorageHealthService {
  inspect(): Promise<StorageHealthSnapshot>
  requestPersistence(): Promise<StorageHealthSnapshot>
}
