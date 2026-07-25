const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function formatLocalDate(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Cannot format an invalid Date.')
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function assertLocalDateValue(
  value: string,
  label = 'localDate',
): void {
  if (!LOCAL_DATE_PATTERN.test(value)) {
    throw new TypeError(`${label} must use YYYY-MM-DD.`)
  }

  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new TypeError(`${label} is not a real calendar date.`)
  }
}
