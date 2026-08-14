import fs from 'node:fs'

const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
const tokens = (value) => normalize(value).split(' ').filter(Boolean)
const round = (value) => Math.round(value * 10000) / 10000

function read(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'))
}

function sourceItems() {
  const index = read('content/curriculum/package-index.v1.json')
  return index.lessonFiles.flatMap((file) => read(file).lessons).flatMap((lesson) =>
    lesson.learningUnits.filter((unit) => unit.domain === 'vocabulary').flatMap((unit) =>
      unit.activity.items.map((item) => ({
        ...item,
        difficulty: item.growthDifficultyLevel ?? unit.difficultyLevel,
      })),
    ),
  )
}

function opening(value, count = 4) {
  return tokens(value).slice(0, count).join(' ')
}

function skeleton(value) {
  if (tokens(value).length < 4) return `short:${normalize(value)}`
  const stop = new Set(['a','an','the','i','you','my','me','this','that','it','is','are','was','were','to','for','of','in','on','at','with'])
  return tokens(value).map((token) => stop.has(token) ? token : '{x}').join(' ')
}

function looksComplete(value) {
  const first = tokens(value)[0]
  return ['i','you','we','they','he','she','it','is','are','can','could','would','will','do','does','did','please','where','what','when','why','how'].includes(first)
}

function looksComplex(value) {
  return /\b(if|unless|although|because|whether|while|before|after|which|who|that)\b/iu.test(value) || /[,;]/u.test(value)
}

export function validateRubric(rubric) {
  if (rubric.rubricVersion !== '2.0.0') throw new Error('Unexpected rubric version.')
  if (rubric.levels.length !== 15) throw new Error('The rubric must define all fifteen levels.')
  rubric.levels.forEach((level, ordinal) => {
    if (level.ordinal !== ordinal) throw new Error(`Level ordinal mismatch: ${level.id}`)
    if (level.maxTokens < 1) throw new Error(`Invalid maxTokens: ${level.id}`)
  })
  if (new Set(rubric.levels.map((level) => level.id)).size !== 15) throw new Error('Duplicate rubric level ID.')
  return rubric
}

export function auditDailyLevelQuality(items, rubric) {
  validateRubric(rubric)
  const levelFor = (difficulty) => rubric.levels.find((level, index) => {
    const minimum = rubric.globalRules.difficultyBoundaries[index]
    const maximum = rubric.globalRules.difficultyBoundaries[index + 1] ?? Infinity
    return difficulty >= minimum && difficulty < maximum
  })
  const canonical = new Map()
  for (const item of items) {
    const key = item.dailyKnowledgeId ?? `missing:${item.id}`
    if (!canonical.has(key)) canonical.set(key, item)
  }
  const byLevel = new Map(rubric.levels.map((level) => [level.id, []]))
  for (const item of canonical.values()) {
    const level = levelFor(item.difficulty)
    if (!level) throw new Error(`No level for difficulty ${item.difficulty}`)
    byLevel.get(level.id).push(item)
  }

  const formLevels = new Map()
  for (const [levelId, levelItems] of byLevel) for (const item of levelItems) {
    const form = normalize(item.term)
    const levels = formLevels.get(form) ?? new Set()
    levels.add(levelId)
    formLevels.set(form, levels)
  }
  const crossLevelForms = [...formLevels].filter(([, levels]) => levels.size > 1)
    .map(([form, levels]) => ({ form, levels: [...levels] })).sort((a, b) => a.form.localeCompare(b.form))

  const levels = rubric.levels.map((rule) => {
    const levelItems = byLevel.get(rule.id)
    const tokenCounts = levelItems.map((item) => tokens(item.term).length)
    const wordCount = tokenCounts.filter((count) => count === 1).length
    const utteranceCount = levelItems.filter((item) => looksComplete(item.term)).length
    const complexCount = levelItems.filter((item) => looksComplex(item.term)).length
    const overTokenLimit = levelItems.filter((item) => tokens(item.term).length > rule.maxTokens).map((item) => item.id)
    const openings = Object.entries(Object.groupBy(levelItems, (item) => opening(item.term)))
      .filter(([key, values]) => key && values.length > rubric.globalRules.templateRules.maximumSharedOpeningFourTokensPerLevel)
      .map(([key, values]) => ({ opening: key, count: values.length })).sort((a, b) => b.count - a.count)
    const skeletons = Object.entries(Object.groupBy(levelItems, (item) => skeleton(item.term)))
      .filter(([, values]) => values.length > rubric.globalRules.templateRules.maximumSharedSkeletonPerLevel)
      .map(([key, values]) => ({ skeleton: key, count: values.length })).sort((a, b) => b.count - a.count)
    const excluded = rule.id === 'kindergarten' ? levelItems.filter((item) =>
      rubric.kindergartenExclusions.includes(normalize(item.term)),
    ).map((item) => item.term) : []
    const metrics = {
      count: levelItems.length,
      wordRatio: round(wordCount / Math.max(1, levelItems.length)),
      completeUtteranceRatio: round(utteranceCount / Math.max(1, levelItems.length)),
      complexUtteranceRatio: round(complexCount / Math.max(1, levelItems.length)),
      averageTokens: round(tokenCounts.reduce((sum, value) => sum + value, 0) / Math.max(1, tokenCounts.length)),
      maximumTokens: Math.max(0, ...tokenCounts),
    }
    const repairLowerBounds = {
      countDelta: Math.abs(metrics.count - rubric.globalRules.knowledgePointsPerLevel),
      wordDeficit: Math.max(0, Math.ceil(rule.minimumWordRatio * rubric.globalRules.knowledgePointsPerLevel) - wordCount),
      utteranceExcess: Math.max(0, utteranceCount - Math.floor(rule.maximumCompleteUtteranceRatio * rubric.globalRules.knowledgePointsPerLevel)),
      complexUtteranceExcess: Math.max(0, complexCount - Math.floor(rule.maximumComplexUtteranceRatio * rubric.globalRules.knowledgePointsPerLevel)),
      overTokenLimit: overTokenLimit.length,
      collapsedOpeningExcess: openings.reduce((sum, row) => sum + row.count - rubric.globalRules.templateRules.maximumSharedOpeningFourTokensPerLevel, 0),
      collapsedSkeletonExcess: skeletons.reduce((sum, row) => sum + row.count - rubric.globalRules.templateRules.maximumSharedSkeletonPerLevel, 0),
      kindergartenExclusions: excluded.length,
    }
    repairLowerBounds.minimumRecordsRequiringRewriteOrReassignment = Math.max(...Object.values(repairLowerBounds))
    const violations = []
    if (metrics.count !== rubric.globalRules.knowledgePointsPerLevel) violations.push(`count:${metrics.count}`)
    if (metrics.wordRatio < rule.minimumWordRatio) violations.push(`word-ratio:${metrics.wordRatio}`)
    if (metrics.completeUtteranceRatio > rule.maximumCompleteUtteranceRatio) violations.push(`utterance-ratio:${metrics.completeUtteranceRatio}`)
    if (metrics.complexUtteranceRatio > rule.maximumComplexUtteranceRatio) violations.push(`complex-ratio:${metrics.complexUtteranceRatio}`)
    if (overTokenLimit.length) violations.push(`over-token-limit:${overTokenLimit.length}`)
    if (openings.length) violations.push(`collapsed-openings:${openings.length}`)
    if (skeletons.length) violations.push(`collapsed-skeletons:${skeletons.length}`)
    if (excluded.length) violations.push(`kindergarten-exclusions:${excluded.length}`)
    return { id: rule.id, labelZh: rule.labelZh, metrics, repairLowerBounds, violations, excluded, collapsedOpenings: openings.slice(0, 10), collapsedSkeletons: skeletons.slice(0, 10), overTokenLimitCount: overTokenLimit.length }
  })

  const blockingViolations = levels.reduce((sum, level) => sum + level.violations.length, 0) + crossLevelForms.length
  return {
    schemaVersion: 1,
    documentType: 'daily-level-quality-audit',
    auditVersion: '2.0.0',
    rubricVersion: rubric.rubricVersion,
    currentSourceRecords: items.length,
    currentUniqueIdentityCount: canonical.size,
    expectedUniqueIdentityCount: 3000,
    crossLevelDuplicateForms: crossLevelForms,
    levels,
    repairEstimate: {
      conservativeMinimumRecordsRequiringRewriteOrReassignment: levels.reduce((sum, level) => sum + level.repairLowerBounds.minimumRecordsRequiringRewriteOrReassignment, 0),
      note: 'This is a mathematical lower bound, not a production estimate. Naturalness, lexical frequency, abstraction and travel-use review can only increase the required count.',
    },
    blockingViolations,
    releaseStatus: blockingViolations === 0 && canonical.size === 3000 ? 'pass' : 'blocked',
  }
}

export function createCurrentAudit() {
  return auditDailyLevelQuality(sourceItems(), read('content/curriculum/daily-level-rubric.v2.json'))
}

if (process.argv[1]?.endsWith('audit-daily-level-quality.v2.mjs')) {
  const audit = createCurrentAudit()
  const serialized = `${JSON.stringify(audit, null, 2)}\n`
  const output = 'content/curriculum/daily-level-quality-audit.v2.json'
  if (process.argv.includes('--write')) fs.writeFileSync(output, serialized)
  else if (fs.readFileSync(output, 'utf8') !== serialized) throw new Error(`${output} is stale; run with --write`)
  console.log(`Daily level quality: ${audit.releaseStatus}; ${audit.blockingViolations} blocking violations.`)
  if (!process.argv.includes('--report-only') && audit.releaseStatus !== 'pass') process.exitCode = 1
}
