import type { AbilityDomain } from './contracts.ts'

export const ABILITY_DOMAINS: readonly AbilityDomain[] = [
  'vocabulary',
  'listening',
  'speaking',
]

export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function round(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function mean(values: readonly number[], fallback = 0): number {
  if (values.length === 0) {
    return fallback
  }
  return values.reduce((total, value) => total + value, 0) / values.length
}

export function parseTimestamp(value: string, fieldName: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${fieldName} must be a valid ISO 8601 timestamp`)
  }
  return parsed
}

export function assertLocalDate(value: string, fieldName = 'localDate'): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${fieldName} must use YYYY-MM-DD`)
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${fieldName} must be a valid calendar date`)
  }
  if (new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${fieldName} must be a valid calendar date`)
  }
}

export function localDateOrdinal(value: string): number {
  assertLocalDate(value)
  return Math.floor(
    Date.parse(`${value}T00:00:00.000Z`) / MILLISECONDS_PER_DAY,
  )
}

export function addMilliseconds(
  timestamp: string,
  milliseconds: number,
): string {
  const parsed = parseTimestamp(timestamp, 'timestamp')
  return new Date(parsed + milliseconds).toISOString()
}

export function elapsedDays(from: string, to: string): number {
  const fromTime = parseTimestamp(from, 'from')
  const toTime = parseTimestamp(to, 'to')
  return Math.max(0, (toTime - fromTime) / MILLISECONDS_PER_DAY)
}

export function uniqueStrings<T extends string>(
  values: readonly T[],
): readonly T[] {
  return [...new Set(values)]
}

export function assertUnitInterval(
  value: number,
  fieldName: string,
): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${fieldName} must be between 0 and 1`)
  }
}

export function assertPositiveSeconds(
  value: number,
  fieldName: string,
): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be greater than 0`)
  }
}

export function recordFromEntries<T>(
  entries: readonly (readonly [string, T])[],
): Readonly<Record<string, T>> {
  return Object.fromEntries(entries)
}
