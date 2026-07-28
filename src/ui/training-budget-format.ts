function normalizedWholeSeconds(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null
  }

  return Math.round(seconds)
}

export function formatTrainingBudgetClock(seconds: number): string {
  const value = normalizedWholeSeconds(seconds)
  if (value === null) {
    return '时长不可用'
  }

  const hours = Math.floor(value / 3_600)
  const minutes = Math.floor((value % 3_600) / 60)
  const remainingSeconds = value % 60
  const paddedMinutes = String(minutes).padStart(2, '0')
  const paddedSeconds = String(remainingSeconds).padStart(2, '0')

  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${paddedMinutes}:${paddedSeconds}`
    : `${paddedMinutes}:${paddedSeconds}`
}

export function formatTrainingBudgetTarget(seconds: number): string {
  const value = normalizedWholeSeconds(seconds)
  if (value === null) {
    return '有效训练目标不可用'
  }

  if (value > 0 && value % 60 === 0) {
    return `${value / 60} 分钟有效训练`
  }

  return `${formatTrainingBudgetClock(value)} 有效训练`
}
