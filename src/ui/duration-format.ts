function normalizedSeconds(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null
  }
  return Math.round(seconds)
}

export function formatEstimatedDuration(seconds: number): string {
  const value = normalizedSeconds(seconds)
  if (value === null) {
    return '时长数据不可用'
  }
  if (value < 60) {
    return '不足 1 分钟'
  }
  return `约 ${Math.max(1, Math.round(value / 60))} 分钟`
}

export function formatDurationEstimateBasis(
  basis: 'content-baseline' | 'personal-history',
): string {
  return basis === 'personal-history'
    ? '按你的近期速度'
    : '内容估算'
}

export function formatEffectiveDuration(seconds: number): string {
  const value = normalizedSeconds(seconds)
  if (value === null) {
    return '时长数据不可用'
  }

  const hours = Math.floor(value / 3_600)
  const minutes = Math.floor((value % 3_600) / 60)
  const remainingSeconds = value % 60
  const parts: string[] = []

  if (hours > 0) {
    parts.push(`${hours} 小时`)
  }
  if (minutes > 0) {
    parts.push(`${minutes} 分钟`)
  }
  if (remainingSeconds > 0 || parts.length === 0) {
    parts.push(`${remainingSeconds} 秒`)
  }

  return parts.join(' ')
}
