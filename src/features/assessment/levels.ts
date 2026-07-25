export const INTERNAL_LEVEL_MIN = 0
export const INTERNAL_LEVEL_MAX = 12

export type CefrBand =
  | 'pre-A1'
  | 'A1'
  | 'A2'
  | 'B1'
  | 'B2'
  | 'C1'
  | 'C2'
  | 'unknown'

export interface LevelDescriptor {
  readonly minInclusive: number
  readonly maxInclusive: number
  readonly cefr: Exclude<CefrBand, 'unknown'>
  readonly honestLabel: string
}

/**
 * Internal levels are deliberately finer than the reader-facing CEFR bands.
 * The mapping is an orientation aid, not a standards-based certification.
 */
export const LEVEL_DESCRIPTORS = [
  {
    minInclusive: 0,
    maxInclusive: 0.99,
    cefr: 'pre-A1',
    honestLabel: '约在 CEFR A1 之前',
  },
  {
    minInclusive: 1,
    maxInclusive: 2.99,
    cefr: 'A1',
    honestLabel: '约在 CEFR A1 范围',
  },
  {
    minInclusive: 3,
    maxInclusive: 4.99,
    cefr: 'A2',
    honestLabel: '约在 CEFR A2 范围',
  },
  {
    minInclusive: 5,
    maxInclusive: 6.99,
    cefr: 'B1',
    honestLabel: '约在 CEFR B1 范围',
  },
  {
    minInclusive: 7,
    maxInclusive: 8.99,
    cefr: 'B2',
    honestLabel: '约在 CEFR B2 范围',
  },
  {
    minInclusive: 9,
    maxInclusive: 10.99,
    cefr: 'C1',
    honestLabel: '约在 CEFR C1 范围',
  },
  {
    minInclusive: 11,
    maxInclusive: 12,
    cefr: 'C2',
    honestLabel: '约在 CEFR C2 范围',
  },
] as const satisfies readonly LevelDescriptor[]

export const CEFR_DISCLAIMER =
  '这是基于本次 15–20 分钟样本的起点估算，大致参考 CEFR 范围，不是官方认证。'

export const INSUFFICIENT_EVIDENCE_MESSAGE =
  '本次没有收集到足够可靠的专项证据，暂不估算等级。完成设备检查后可重测该专项。'

export function clampInternalLevel(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError('Internal level must be a finite number')
  }

  return Math.min(INTERNAL_LEVEL_MAX, Math.max(INTERNAL_LEVEL_MIN, value))
}

export function roundInternalLevel(value: number): number {
  return Math.round(clampInternalLevel(value) * 2) / 2
}

export function mapInternalLevelToCefr(value: number): Exclude<CefrBand, 'unknown'> {
  const level = clampInternalLevel(value)
  const descriptor = LEVEL_DESCRIPTORS.find(
    (candidate) =>
      level >= candidate.minInclusive && level <= candidate.maxInclusive,
  )

  if (!descriptor) {
    throw new RangeError(`No CEFR mapping for internal level ${level}`)
  }

  return descriptor.cefr
}

export function describeInternalLevel(value: number): string {
  const level = clampInternalLevel(value)
  const descriptor = LEVEL_DESCRIPTORS.find(
    (candidate) =>
      level >= candidate.minInclusive && level <= candidate.maxInclusive,
  )

  if (!descriptor) {
    throw new RangeError(`No description for internal level ${level}`)
  }

  return `${descriptor.honestLabel}（短时估算，非官方认证）`
}
