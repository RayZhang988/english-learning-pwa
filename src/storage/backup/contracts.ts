export type RestoreMode = 'merge' | 'replace'

export interface BackupRecord {
  readonly namespace: string
  readonly key: string
  readonly value: unknown
  readonly schemaVersion: number
  readonly updatedAt: string
}

export interface BackupEnvelope {
  readonly format: 'english-learning-pwa-backup'
  readonly formatVersion: 1
  readonly exportedAt: string
  readonly records: readonly BackupRecord[]
}

export interface BackupSummary {
  readonly exportedAt: string
  readonly recordCount: number
  readonly namespaces: readonly string[]
}

export interface RestoreResult extends BackupSummary {
  readonly mode: RestoreMode
}

export interface LocalBackupService {
  exportJson(): Promise<string>
  inspectJson(json: string): BackupSummary
  restoreJson(json: string, mode: RestoreMode): Promise<RestoreResult>
}
