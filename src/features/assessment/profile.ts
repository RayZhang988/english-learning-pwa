import {
  calculateConfidence,
  confidenceBand,
} from './confidence.ts'
import {
  CEFR_DISCLAIMER,
  describeInternalLevel,
  INSUFFICIENT_EVIDENCE_MESSAGE,
  INTERNAL_LEVEL_MAX,
  INTERNAL_LEVEL_MIN,
  mapInternalLevelToCefr,
  roundInternalLevel,
} from './levels.ts'
import { DOMAIN_ORDER, DOMAIN_RULES } from './rules.ts'
import type {
  AbilityDomain,
  AbilityEstimate,
  AbilityProfile,
  AssessmentSession,
} from './types.ts'

function parseTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${field} must be a valid ISO timestamp`)
  }
  return timestamp
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function formatCoverageRatio(
  session: AssessmentSession,
  domain: AbilityDomain,
): number {
  const requirements = DOMAIN_RULES[domain].requiredFormats
  const satisfied = requirements.filter((requirement) => {
    const count = session.responses.filter(
      (response) =>
        response.domain === domain &&
        response.format === requirement.format &&
        response.score !== null,
    ).length
    return count >= requirement.count
  }).length

  return requirements.length === 0 ? 1 : satisfied / requirements.length
}

function warningsFor(
  session: AssessmentSession,
  domain: AbilityDomain,
  confidence: number,
  boundary: AbilityEstimate['boundary'],
): readonly string[] {
  const warnings: string[] = []
  if (confidence < 0.6) {
    warnings.push('专项证据有限，建议在设备正常时重测。')
  }
  if (boundary === 'upper-censored') {
    warnings.push('结果触及本短测上限，不能据此证明达到官方 C2。')
  } else if (boundary === 'lower-censored') {
    warnings.push('结果触及本短测下限，实际起点可能更低。')
  }
  if (
    session.responses.some(
      (response) =>
        response.domain === domain && response.failureReason !== null,
    )
  ) {
    warnings.push('部分作答因设备、音频或识别原因未计分。')
  }
  return warnings
}

function buildDomainEstimate(
  session: AssessmentSession,
  domain: AbilityDomain,
): AbilityEstimate {
  const estimate = session.estimates[domain]
  const rule = DOMAIN_RULES[domain]
  const meanReliability =
    estimate.scoredCount === 0
      ? 0
      : estimate.reliabilityTotal / estimate.scoredCount
  const coverageRatio = formatCoverageRatio(session, domain)
  const confidence = calculateConfidence({
    standardError: estimate.standardError,
    scoredCount: estimate.scoredCount,
    minimumEvidence: rule.minimumScored,
    coverageRatio,
    meanReliability,
  })
  const minimumPublishableEvidence = Math.max(
    2,
    Math.ceil(rule.minimumScored / 2),
  )
  const publishable =
    estimate.scoredCount >= minimumPublishableEvidence && confidence >= 0.4

  if (!publishable) {
    return {
      domain,
      status: 'unavailable',
      internalLevel: null,
      internalRange: null,
      score100: null,
      cefrEstimate: 'unknown',
      cefrRange: null,
      confidence,
      confidenceBand: confidenceBand(confidence),
      standardError:
        estimate.scoredCount === 0 ? null : estimate.standardError,
      evidenceCount: estimate.scoredCount,
      attemptedCount: estimate.attemptedCount,
      reliability: Math.round(clampUnit(meanReliability) * 100) / 100,
      boundary: 'unknown',
      message: INSUFFICIENT_EVIDENCE_MESSAGE,
      warnings: warningsFor(
        session,
        domain,
        confidence,
        'unknown',
      ),
    }
  }

  const internalLevel = roundInternalLevel(estimate.level)
  const margin = estimate.standardError * 1.28
  const lower = roundInternalLevel(
    Math.max(INTERNAL_LEVEL_MIN, estimate.level - margin),
  )
  const upper = roundInternalLevel(
    Math.min(INTERNAL_LEVEL_MAX, estimate.level + margin),
  )
  const boundary: AbilityEstimate['boundary'] =
    internalLevel <= INTERNAL_LEVEL_MIN + 0.5
      ? 'lower-censored'
      : internalLevel >= INTERNAL_LEVEL_MAX - 0.5
        ? 'upper-censored'
        : 'within-range'
  const status =
    confidence >= 0.6 ? 'estimated' : 'low-confidence'

  return {
    domain,
    status,
    internalLevel,
    internalRange: { lower, upper },
    score100: Math.round((internalLevel / INTERNAL_LEVEL_MAX) * 100),
    cefrEstimate: mapInternalLevelToCefr(internalLevel),
    cefrRange: {
      lower: mapInternalLevelToCefr(lower),
      upper: mapInternalLevelToCefr(upper),
    },
    confidence,
    confidenceBand: confidenceBand(confidence),
    standardError: estimate.standardError,
    evidenceCount: estimate.scoredCount,
    attemptedCount: estimate.attemptedCount,
    reliability: Math.round(clampUnit(meanReliability) * 100) / 100,
    boundary,
    message: describeInternalLevel(internalLevel),
    warnings: warningsFor(session, domain, confidence, boundary),
  }
}

export function buildAbilityProfile(input: {
  readonly session: AssessmentSession
  readonly completedAt: string
  /**
   * Active test time. Supplying this prevents background or interrupted time
   * from inflating the advertised 15–20 minute assessment duration.
   */
  readonly durationSeconds?: number
}): AbilityProfile {
  if (input.session.status === 'in-progress') {
    throw new TypeError('Cannot build a profile from an in-progress session')
  }

  const startedAt = parseTimestamp(input.session.startedAt, 'startedAt')
  const completedAt = parseTimestamp(input.completedAt, 'completedAt')
  if (completedAt < startedAt) {
    throw new RangeError('completedAt cannot be earlier than startedAt')
  }
  if (
    input.durationSeconds !== undefined &&
    (!Number.isFinite(input.durationSeconds) ||
      input.durationSeconds < 0)
  ) {
    throw new TypeError('durationSeconds must be a non-negative number')
  }

  const abilities = {
    vocabulary: buildDomainEstimate(input.session, 'vocabulary'),
    listening: buildDomainEstimate(input.session, 'listening'),
    speaking: buildDomainEstimate(input.session, 'speaking'),
  } as const
  const hasUnavailable = DOMAIN_ORDER.some(
    (domain) => abilities[domain].status === 'unavailable',
  )

  return {
    schemaVersion: 1,
    profileId: `${input.session.id}:profile:v1`,
    assessmentId: input.session.id,
    bankId: input.session.bankId,
    completedAt: input.completedAt,
    durationSeconds:
      input.durationSeconds === undefined
        ? Math.round((completedAt - startedAt) / 1000)
        : Math.round(input.durationSeconds),
    outcome:
      input.session.status === 'partial' || hasUnavailable
        ? 'partial'
        : 'completed',
    disclaimer: CEFR_DISCLAIMER,
    abilities,
  }
}
