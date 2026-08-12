export type TrainingSupplyDomain = 'vocabulary' | 'listening' | 'speaking'

type JsonRecord = Record<string, unknown>

export interface ReleasedTrainingSupplyIndex extends JsonRecord {
  readonly schemaVersion: 1
  readonly documentType: 'continuous-training-supply-index'
  readonly candidates: readonly JsonRecord[]
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fnvRank(seed: string, value: string): number {
  let hash = 0x811c9dc5
  for (const character of `${seed}|${value}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function digest(value: unknown): string {
  return `fnv1a32-${fnvRank('training-supply-v2-digest', JSON.stringify(value)).toString(16).padStart(8, '0')}`
}

function candidateOrder(left: JsonRecord, right: JsonRecord): number {
  const domains: Record<TrainingSupplyDomain, number> = { vocabulary: 0, listening: 1, speaking: 2 }
  const leftDomain = left.domain as TrainingSupplyDomain
  const rightDomain = right.domain as TrainingSupplyDomain
  return domains[leftDomain] - domains[rightDomain]
    || Number(left.supplyOrder) - Number(right.supplyOrder)
    || String(left.itemId).localeCompare(String(right.itemId))
}

/**
 * Accepts the retired v1 monolith during cache migration and the current v2
 * manifest. Consumers still receive the v1 shape so training cursors and all
 * existing providers retain their stable public contract.
 */
export async function loadReleasedTrainingSupplyIndex(
  manifestPath: string,
  domain: TrainingSupplyDomain,
  readJson: (path: string) => Promise<unknown>,
): Promise<ReleasedTrainingSupplyIndex> {
  const manifest = await readJson(manifestPath)
  if (isRecord(manifest) && manifest.schemaVersion === 1 && manifest.documentType === 'continuous-training-supply-index' && Array.isArray(manifest.candidates)) {
    return manifest as ReleasedTrainingSupplyIndex
  }
  if (!isRecord(manifest) || manifest.schemaVersion !== 2 || manifest.documentType !== 'continuous-training-supply-manifest' || !Array.isArray(manifest.shards) || !isRecord(manifest.totals)) {
    throw new TypeError('Training supply manifest is invalid.')
  }
  const descriptors = manifest.shards.filter((raw): raw is JsonRecord => isRecord(raw) && raw.domain === domain)
  if (!descriptors.length) throw new TypeError(`Training supply manifest has no ${domain} shards.`)
  const parts = await Promise.all(descriptors.map(async (descriptor) => {
    if (typeof descriptor.path !== 'string' || typeof descriptor.digest !== 'string' || typeof descriptor.candidateCount !== 'number') throw new TypeError('Training supply shard descriptor is invalid.')
    const shard = await readJson(descriptor.path)
    if (!isRecord(shard) || shard.schemaVersion !== 1 || shard.documentType !== 'continuous-training-supply-shard' || shard.domain !== domain || !Array.isArray(shard.candidates) || shard.candidateCount !== descriptor.candidateCount || shard.candidates.length !== descriptor.candidateCount || digest(shard) !== descriptor.digest) {
      throw new TypeError(`Training supply shard ${descriptor.path} is invalid or incomplete.`)
    }
    if (shard.candidates.some((candidate) => !isRecord(candidate) || candidate.domain !== domain)) throw new TypeError(`Training supply shard ${descriptor.path} contains the wrong domain.`)
    return shard.candidates as JsonRecord[]
  }))
  const candidates = parts.flat().sort(candidateOrder)
  if (new Set(candidates.map((candidate) => String(candidate.itemId))).size !== candidates.length) throw new TypeError(`Training supply ${domain} shards contain duplicate item ids.`)
  const declaredTotal = manifest.totals[`${domain}Candidates`]
  if (declaredTotal !== candidates.length) throw new TypeError(`Training supply ${domain} shard count is incomplete.`)
  return {
    schemaVersion: 1,
    documentType: 'continuous-training-supply-index',
    supplyVersion: manifest.supplyVersion,
    baseCourseId: manifest.baseCourseId,
    basePackageVersion: manifest.basePackageVersion,
    basePackageIndex: manifest.basePackageIndex,
    targetLocale: manifest.targetLocale,
    supplyPolicy: manifest.supplyPolicy,
    capacityPolicy: manifest.capacityPolicy,
    totals: { [`${domain}Candidates`]: candidates.length, allCandidates: candidates.length },
    candidates,
  }
}
