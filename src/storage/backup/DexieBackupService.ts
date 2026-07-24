import { AppError } from '../../core/errors/AppError.ts'
import { assertValidNamespace } from '../namespace.ts'
import { assertPortableValue } from '../portable-value.ts'
import { createRecordId } from '../record-id.ts'
import { toStorageError } from '../storage-error.ts'
import {
  appDatabase,
  type AppDatabase,
  type DatabaseRecord,
} from '../indexed-db/AppDatabase.ts'
import type {
  BackupEnvelope,
  BackupRecord,
  BackupSummary,
  LocalBackupService,
  RestoreMode,
  RestoreResult,
} from './contracts.ts'

const backupFormat = 'english-learning-pwa-backup'
const backupFormatVersion = 1
const excludedNamespaces = new Set(['pwa.offline-packages'])

function isBackupEligibleNamespace(namespace: string) {
  return !excludedNamespaces.has(namespace)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function invalidBackup(message: string, cause?: unknown): AppError {
  return new AppError('backup_invalid', message, {
    cause,
    recoverable: true,
  })
}

function parseRecord(
  value: unknown,
  index: number,
  ids: Set<string>,
): BackupRecord {
  if (!isObject(value)) {
    throw invalidBackup(`备份中的第 ${index + 1} 条记录格式错误。`)
  }

  const { namespace, key, schemaVersion, updatedAt } = value
  if (typeof namespace !== 'string') {
    throw invalidBackup(`备份中的第 ${index + 1} 条记录缺少命名空间。`)
  }

  try {
    assertValidNamespace(namespace)
  } catch (error) {
    throw invalidBackup(`备份包含无效命名空间：${namespace}`, error)
  }

  if (!isBackupEligibleNamespace(namespace)) {
    throw invalidBackup(`备份包含不可迁移命名空间：${namespace}`)
  }

  if (typeof key !== 'string') {
    throw invalidBackup(`备份中的第 ${index + 1} 条记录缺少键。`)
  }

  if (!Number.isInteger(schemaVersion) || Number(schemaVersion) < 1) {
    throw invalidBackup(`备份中的第 ${index + 1} 条记录版本无效。`)
  }

  if (!isValidTimestamp(updatedAt)) {
    throw invalidBackup(`备份中的第 ${index + 1} 条记录时间无效。`)
  }

  try {
    assertPortableValue(value.value)
  } catch (error) {
    throw invalidBackup(`备份中的第 ${index + 1} 条记录数据无效。`, error)
  }

  const id = createRecordId(namespace, key)
  if (ids.has(id)) {
    throw invalidBackup(`备份包含重复记录：${namespace}/${key}`)
  }
  ids.add(id)

  return {
    namespace,
    key,
    value: value.value,
    schemaVersion: Number(schemaVersion),
    updatedAt,
  }
}

function parseBackup(json: string): BackupEnvelope {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (error) {
    throw invalidBackup('备份文件不是有效 JSON。', error)
  }

  if (!isObject(value)) {
    throw invalidBackup('备份文件缺少根对象。')
  }

  if (
    value.format !== backupFormat ||
    value.formatVersion !== backupFormatVersion
  ) {
    throw invalidBackup('备份格式或版本不受支持。')
  }

  if (!isValidTimestamp(value.exportedAt)) {
    throw invalidBackup('备份导出时间无效。')
  }

  if (!Array.isArray(value.records)) {
    throw invalidBackup('备份记录列表无效。')
  }

  const ids = new Set<string>()
  const records = value.records.map((record, index) =>
    parseRecord(record, index, ids),
  )

  return {
    format: backupFormat,
    formatVersion: backupFormatVersion,
    exportedAt: value.exportedAt,
    records,
  }
}

function summarize(backup: BackupEnvelope): BackupSummary {
  return {
    exportedAt: backup.exportedAt,
    recordCount: backup.records.length,
    namespaces: [
      ...new Set(backup.records.map((record) => record.namespace)),
    ].sort(),
  }
}

function toDatabaseRecord(record: BackupRecord): DatabaseRecord {
  return {
    id: createRecordId(record.namespace, record.key),
    namespace: record.namespace,
    key: record.key,
    value: record.value,
    schemaVersion: record.schemaVersion,
    updatedAt: record.updatedAt,
  }
}

export class DexieBackupService implements LocalBackupService {
  private readonly database: AppDatabase

  constructor(database: AppDatabase = appDatabase) {
    this.database = database
  }

  async exportJson(): Promise<string> {
    try {
      const records = (await this.database.records.toArray()).filter((record) =>
        isBackupEligibleNamespace(record.namespace),
      )
      records.sort(
        (left, right) =>
          left.namespace.localeCompare(right.namespace) ||
          left.key.localeCompare(right.key),
      )

      for (const record of records) {
        assertPortableValue(record.value)
      }

      const backup: BackupEnvelope = {
        format: backupFormat,
        formatVersion: backupFormatVersion,
        exportedAt: new Date().toISOString(),
        records: records.map(
          ({ namespace, key, value, schemaVersion, updatedAt }) => ({
            namespace,
            key,
            value,
            schemaVersion,
            updatedAt,
          }),
        ),
      }

      return JSON.stringify(backup, null, 2)
    } catch (error) {
      throw toStorageError(error)
    }
  }

  inspectJson(json: string): BackupSummary {
    return summarize(parseBackup(json))
  }

  async restoreJson(
    json: string,
    mode: RestoreMode,
  ): Promise<RestoreResult> {
    if (mode !== 'merge' && mode !== 'replace') {
      throw new TypeError('Restore mode must be merge or replace')
    }

    const backup = parseBackup(json)
    const records = backup.records.map(toDatabaseRecord)

    try {
      await this.database.transaction('rw', this.database.records, async () => {
        if (mode === 'replace') {
          await this.database.records.clear()
        }
        await this.database.records.bulkPut(records)
      })
    } catch (error) {
      throw toStorageError(error)
    }

    return {
      ...summarize(backup),
      mode,
    }
  }
}

export const localBackupService = new DexieBackupService()
