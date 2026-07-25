import {
  INTERNAL_LEVEL_MAX,
  INTERNAL_LEVEL_MIN,
} from './levels.ts'
import type {
  AbilityDomain,
  AssessmentBank,
  AssessmentItem,
  AssessmentItemFormat,
  PublicAssessmentItem,
} from './types.ts'

const FORMATS_BY_DOMAIN: Readonly<
  Record<AbilityDomain, readonly AssessmentItemFormat[]>
> = {
  vocabulary: ['word-meaning', 'sentence-understanding'],
  listening: [
    'listening-gist',
    'listening-detail',
    'listening-inference',
  ],
  speaking: ['read-aloud', 'repeat', 'spoken-response'],
}

function assertFiniteRange(
  value: number,
  min: number,
  max: number,
  field: string,
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${field} must be between ${min} and ${max}`)
  }
}

function assertItem(item: AssessmentItem): void {
  if (!/^[a-z][a-z0-9-]+$/.test(item.id)) {
    throw new TypeError(`Invalid assessment item id: ${item.id}`)
  }

  if (item.schemaVersion !== 1) {
    throw new TypeError(`Unsupported item schema version for ${item.id}`)
  }

  if (!FORMATS_BY_DOMAIN[item.domain].includes(item.format)) {
    throw new TypeError(
      `Item ${item.id} uses ${item.format} in ${item.domain}`,
    )
  }

  assertFiniteRange(
    item.difficulty,
    INTERNAL_LEVEL_MIN,
    INTERNAL_LEVEL_MAX,
    `${item.id}.difficulty`,
  )
  assertFiniteRange(
    item.discrimination,
    0.5,
    2,
    `${item.id}.discrimination`,
  )
  assertFiniteRange(
    item.expectedSeconds,
    10,
    180,
    `${item.id}.expectedSeconds`,
  )

  if (item.prompt.trim().length === 0 || item.tags.length === 0) {
    throw new TypeError(`Item ${item.id} needs a prompt and at least one tag`)
  }

  if (item.kind === 'choice') {
    if (item.options.length !== 4) {
      throw new TypeError(`Choice item ${item.id} must have four options`)
    }

    const optionIds = new Set(item.options.map((option) => option.id))
    if (
      optionIds.size !== item.options.length ||
      !optionIds.has(item.scoring.correctOptionId)
    ) {
      throw new TypeError(`Choice item ${item.id} has invalid answer options`)
    }

    if (item.domain === 'listening' && !item.stimulus.audioText) {
      throw new TypeError(`Listening item ${item.id} needs audio text`)
    }
  } else {
    if (item.scoring.rubric !== item.format) {
      throw new TypeError(`Speech rubric does not match format for ${item.id}`)
    }

    if (
      item.format === 'read-aloud' &&
      (!item.stimulus.text || !item.scoring.referenceText)
    ) {
      throw new TypeError(`Read-aloud item ${item.id} needs visible text`)
    }

    if (
      item.format === 'repeat' &&
      (!item.stimulus.audioText || !item.scoring.referenceText)
    ) {
      throw new TypeError(`Repeat item ${item.id} needs reference audio`)
    }

    if (
      item.format === 'spoken-response' &&
      item.scoring.keyConcepts.length === 0
    ) {
      throw new TypeError(`Spoken response ${item.id} needs key concepts`)
    }
  }
}

function countItems(
  items: readonly AssessmentItem[],
  domain: AbilityDomain,
  format?: AssessmentItemFormat,
): number {
  return items.filter(
    (item) => item.domain === domain && (!format || item.format === format),
  ).length
}

function assertCoverage(items: readonly AssessmentItem[]): void {
  const minimumByDomain: Readonly<Record<AbilityDomain, number>> = {
    vocabulary: 12,
    listening: 9,
    speaking: 6,
  }

  for (const domain of Object.keys(minimumByDomain) as AbilityDomain[]) {
    if (countItems(items, domain) < minimumByDomain[domain]) {
      throw new TypeError(`Assessment bank lacks ${domain} coverage`)
    }

    const domainItems = items.filter((item) => item.domain === domain)
    if (
      !domainItems.some((item) => item.difficulty <= 2) ||
      !domainItems.some((item) => item.difficulty >= 11)
    ) {
      throw new TypeError(`Assessment bank lacks ${domain} boundary items`)
    }
  }

  const requiredFormats: readonly AssessmentItemFormat[] = [
    'word-meaning',
    'sentence-understanding',
    'listening-gist',
    'listening-detail',
    'listening-inference',
    'read-aloud',
    'repeat',
    'spoken-response',
  ]

  for (const format of requiredFormats) {
    const minimum =
      format === 'word-meaning' || format === 'sentence-understanding'
        ? 4
        : 1
    const domain = (
      Object.keys(FORMATS_BY_DOMAIN) as AbilityDomain[]
    ).find((candidate) => FORMATS_BY_DOMAIN[candidate].includes(format))

    if (!domain || countItems(items, domain, format) < minimum) {
      throw new TypeError(`Assessment bank lacks ${format} coverage`)
    }
  }
}

function assertAnswerDistribution(items: readonly AssessmentItem[]): void {
  const choiceItems = items.filter((item) => item.kind === 'choice')
  const counts = new Map<string, number>()
  for (const item of choiceItems) {
    const index = item.options.findIndex(
      (option) => option.id === item.scoring.correctOptionId,
    )
    const position = String(index)
    counts.set(position, (counts.get(position) ?? 0) + 1)
  }

  for (let position = 0; position < 4; position += 1) {
    const share =
      (counts.get(String(position)) ?? 0) / Math.max(1, choiceItems.length)
    if (share < 0.15 || share > 0.35) {
      throw new TypeError(
        `Assessment bank answer position ${position + 1} is imbalanced`,
      )
    }
  }
}

export function validateAssessmentBank(bank: AssessmentBank): AssessmentBank {
  if (!/^placement-en-us-v[1-9][0-9]*$/.test(bank.id)) {
    throw new TypeError(`Invalid assessment bank id: ${bank.id}`)
  }

  if (bank.schemaVersion !== 1 || bank.locale !== 'en-US') {
    throw new TypeError('Unsupported assessment bank schema or locale')
  }

  const ids = new Set<string>()
  for (const item of bank.items) {
    assertItem(item)
    if (ids.has(item.id)) {
      throw new TypeError(`Duplicate assessment item id: ${item.id}`)
    }
    ids.add(item.id)
  }

  assertCoverage(bank.items)
  assertAnswerDistribution(bank.items)
  return bank
}

/**
 * Removes answer keys and rubrics before an item crosses the presentation
 * boundary.
 */
export function toPublicAssessmentItem(
  item: AssessmentItem,
): PublicAssessmentItem {
  const publicItem = { ...item } as unknown as Record<string, unknown>
  Reflect.deleteProperty(publicItem, 'scoring')
  return publicItem as unknown as PublicAssessmentItem
}
