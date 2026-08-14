const DOMAINS = ['vocabulary', 'listening', 'speaking']

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function eligible(candidate, targetDifficulty) {
  return targetDifficulty < 0.5
    ? candidate.difficultyLevel >= 0.5 && candidate.difficultyLevel <= 2.5
    : Math.abs(candidate.difficultyLevel - targetDifficulty) <= 1.5
}

export function validateSemanticMetadata(index, taxonomy) {
  invariant(index.semanticMetadata?.taxonomyVersion === '1.0.0', 'Unknown semantic taxonomy version.')
  invariant(index.semanticMetadata?.normalizationVersion === 'semantic-text-v1', 'Unknown semantic normalization version.')
  invariant(taxonomy?.schemaVersion === 1 && taxonomy?.taxonomyVersion === index.semanticMetadata.taxonomyVersion, 'Semantic taxonomy document mismatch.')
  invariant(taxonomy.normalizationVersion === index.semanticMetadata.normalizationVersion, 'Semantic normalization document mismatch.')
  invariant(Array.isArray(taxonomy.rules) && taxonomy.rules.length > 1, 'Semantic taxonomy rules are missing.')
  invariant(new Set(taxonomy.rules.map((rule) => rule.ruleId)).size === taxonomy.rules.length, 'Semantic taxonomy repeats a ruleId.')
  invariant(new Set(taxonomy.rules.map((rule) => rule.categoryId)).size === taxonomy.rules.length, 'Semantic taxonomy repeats a categoryId.')
  invariant(taxonomy.rules.every((rule, position) => rule.priority === position + 1), 'Semantic taxonomy priority is not stable.')
  invariant(Array.isArray(index.candidates), 'Training supply candidates are missing.')
  invariant(new Set(index.candidates.map((item) => item.itemId)).size === index.candidates.length, 'Training supply repeats an itemId.')

  const vocabularyFamilies = new Map()
  for (const candidate of index.candidates) {
    invariant(/^knowledge-v1-(vocabulary|listening|speaking)-[a-f0-9]{8}$/u.test(candidate.knowledgePointId ?? ''), `${candidate.itemId} has an empty or invalid knowledgePointId.`)
    invariant(/^semantic-v1(?::[a-z0-9-]+|-[a-z0-9-]+-[a-f0-9]{8})$/u.test(candidate.semanticCategoryId ?? ''), `${candidate.itemId} has an empty or invalid semanticCategoryId.`)
    if (candidate.domain === 'vocabulary') {
      const prior = vocabularyFamilies.get(candidate.variantFamilyId)
      invariant(prior === undefined || prior === candidate.knowledgePointId, `${candidate.variantFamilyId} does not share one knowledge point.`)
      vocabularyFamilies.set(candidate.variantFamilyId, candidate.knowledgePointId)
    }
  }

  return Array.from({ length: 12 }, (_, value) => value * 0.5).flatMap((targetDifficulty) =>
    DOMAINS.map((domain) => {
      const pool = index.candidates.filter((candidate) => candidate.domain === domain && eligible(candidate, targetDifficulty))
      const counts = new Map()
      for (const candidate of pool) counts.set(candidate.semanticCategoryId, (counts.get(candidate.semanticCategoryId) ?? 0) + 1)
      const fallbackCount = pool.filter((candidate) => candidate.semanticCategoryId.startsWith('semantic-v1-lexical-concept-')).length
      const maximumCategoryCount = Math.max(0, ...counts.values())
      const row = {
        domain,
        targetDifficulty,
        candidateCount: pool.length,
        categoryCount: counts.size,
        taxonomyMatchRate: Number(((pool.length - fallbackCount) / pool.length).toFixed(4)),
        fallbackRate: Number((fallbackCount / pool.length).toFixed(4)),
        maximumCategoryShare: Number((maximumCategoryCount / pool.length).toFixed(4)),
      }
      invariant(row.categoryCount > 1 && row.maximumCategoryShare < 1, `${domain} difficulty ${targetDifficulty} collapses into one semantic category.`)
      return row
    }),
  )
}
