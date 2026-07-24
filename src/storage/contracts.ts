export interface StoredRecord<T> {
  readonly namespace: string
  readonly key: string
  readonly value: T
  readonly schemaVersion: number
  readonly updatedAt: string
}

export interface NamespaceStore {
  get<T>(key: string): Promise<StoredRecord<T> | undefined>
  put<T>(key: string, value: T, schemaVersion?: number): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<readonly string[]>
  clear(): Promise<void>
}

export interface LocalStorageService {
  namespace(name: string): NamespaceStore
}
