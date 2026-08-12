import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const writeMode = process.argv.includes('--write')
const packageIndexPath = 'content/curriculum/package-index.v1.json'
const supplyIndexPath = 'content/curriculum/training-supply-index.v1.json'
const extensionIndexPath =
  'content/curriculum/listening-exercise-extension-index.v1.json'
const durationRulesPath =
  'content/curriculum/duration-baseline-authoring.v1.json'
const domains = ['vocabulary', 'listening', 'speaking']
const modes = ['learn', 'calibration', 'review', 'retry']

function absolute(relativePath) {
  return path.join(root, relativePath)
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(absolute(relativePath), 'utf8'))
}

function writeJson(relativePath, value) {
  fs.writeFileSync(absolute(relativePath), `${JSON.stringify(value, null, 2)}\n`)
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function regexMatches(text, pattern) {
  return text.match(new RegExp(pattern, 'g')) ?? []
}

const packageIndex = readJson(packageIndexPath)
const durationRules = readJson(durationRulesPath)
const lessonDocuments = packageIndex.lessonFiles.map((relativePath) => ({
  relativePath,
  document: readJson(relativePath),
}))
const lessons = lessonDocuments.flatMap(({ document }) => document.lessons)
const extensionIndex = readJson(extensionIndexPath)
const extensionLessons = extensionIndex.exerciseBundleFiles
  .map(readJson)
  .flatMap((bundle) => bundle.lessons)
const extensionsByContentRef = new Map(
  extensionLessons.map((lesson) => [lesson.baseContentRef, lesson]),
)

function nominalUtteranceSeconds(text) {
  const tts = durationRules.nominalTts
  return Math.max(
    tts.minimumUtteranceSeconds,
    regexMatches(text, tts.wordUnitPattern).length * tts.secondsPerWordUnit +
      regexMatches(text, tts.minorPunctuationPattern).length *
        tts.secondsPerMinorPunctuation +
      regexMatches(text, tts.terminalPunctuationPattern).length *
        tts.secondsPerTerminalPunctuation,
  )
}

/**
 * Published playback identity deliberately follows the actual spoken text,
 * rather than the question or candidate id.  Keep this small deterministic
 * fingerprint here (instead of in the UI) so a content edit is caught when
 * the generated index drifts.
 */
function normalizedPlaybackText(text) {
  return text.toLocaleLowerCase('en-US').replace(/[\s\p{P}]+/gu, ' ').trim()
}

function playbackContentId(text) {
  const normalized = normalizedPlaybackText(text)
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `listening-playback-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function extensionAudioText(exercise, listeningUnit) {
  const source = exercise.audioSource
  if (source.sourceType === 'tts-text') {
    assert(source.locale === 'en-US' && source.ttsText.length > 0, `${exercise.exerciseId} has invalid TTS source.`)
    return source.ttsText
  }
  assert(
    source.sourceType === 'transcript-line' &&
      source.baseContentRef === listeningUnit.contentRef &&
      listeningUnit.activity.transcript[source.lineIndex]?.text === source.expectedText,
    `${exercise.exerciseId} transcript source has drifted.`,
  )
  return source.expectedText
}

function unitByDomain(lesson, domain) {
  const unit = lesson.learningUnits.find((candidate) => candidate.domain === domain)
  assert(unit !== undefined, `${lesson.lessonId} has no ${domain} unit.`)
  return unit
}

function candidateBase(unit, domain, order) {
  return {
    supplyOrder: order,
    domain,
    targetModuleId: domain,
    learningUnitId: unit.learningUnitId,
    contentRef: unit.contentRef,
    difficultyLevel: unit.difficultyLevel,
    tags: [...unit.tags, `supply-domain:${domain}`],
    allowedModes: modes,
    // Present on every generated candidate to keep the published JSON shape
    // stable; only listening has a spoken-audio identity.
    playbackContentId: null,
  }
}

function expectedCandidates() {
  const candidates = []
  const orders = Object.fromEntries(domains.map((domain) => [domain, 0]))
  const nextOrder = (domain) => {
    orders[domain] += 1
    return orders[domain]
  }
  const vocabularySources = lessons.flatMap((lesson) => {
    const unit = unitByDomain(lesson, 'vocabulary')
    return unit.activity.items.map((item) => ({ lesson, unit, item }))
  })
  const vocabularyIds = vocabularySources.map(({ item }) => item.id)
  const distractorsFor = (index) => {
    const answer = vocabularyIds[index]
    const distractors = []
    for (let offset = 1; distractors.length < 3; offset += 1) {
      const candidate = vocabularyIds[(index + offset) % vocabularyIds.length]
      if (candidate !== answer) {
        distractors.push(candidate)
      }
    }
    return distractors
  }

  for (const [index, { unit, item }] of vocabularySources.entries()) {
    for (const variantId of [
      'term-to-meaning-choice',
      'meaning-to-term-choice',
      'example-gap-choice',
    ]) {
      candidates.push({
        itemId: `supply-v1-vocabulary-${item.id}-${variantId}`,
        variantFamilyId: `supply-family-v1-vocabulary-${item.id}`,
        ...candidateBase(unit, 'vocabulary', nextOrder('vocabulary')),
        nominalEffectiveSeconds: 18,
        source: {
          sourceType: 'vocabulary-item',
          sourceId: item.id,
          variantId,
          distractorItemIds: distractorsFor(index),
        },
      })
    }
  }

  for (const lesson of lessons) {
    const unit = unitByDomain(lesson, 'listening')
    const extension = extensionsByContentRef.get(unit.contentRef)
    assert(extension?.listeningUnitId === unit.learningUnitId, `${unit.learningUnitId} lacks a matching extension bundle.`)
    for (const exercise of extension.exercises) {
      const audioText = extensionAudioText(exercise, unit)
      const audioSeconds = nominalUtteranceSeconds(audioText)
      candidates.push({
        itemId: `supply-v1-listening-${exercise.exerciseId}`,
        variantFamilyId: `supply-family-v1-listening-${unit.learningUnitId}`,
        ...candidateBase(unit, 'listening', nextOrder('listening')),
        nominalEffectiveSeconds: Math.round(audioSeconds + 19),
        playbackContentId: playbackContentId(audioText),
        source: {
          sourceType: 'listening-extension',
          sourceId: exercise.exerciseId,
          variantId: exercise.type,
        },
      })
    }
    const transcriptText = unit.activity.transcript.map((line) => line.text).join(durationRules.nominalTts.transcriptJoiner)
    // The player checkpoints/observes its primary segment before playing the
    // complete dialogue.  Identity therefore keys the first actually-played
    // segment for core checks; this is stricter than treating two dialogues
    // with the same opening line as distinct merely because later lines vary.
    const corePlaybackText = unit.activity.transcript[0]?.text
    assert(typeof corePlaybackText === 'string' && corePlaybackText.length > 0, `${unit.learningUnitId} has no primary playback text.`)
    const coreSeconds = Math.round(nominalUtteranceSeconds(transcriptText) + 19)
    for (const check of unit.activity.checks) {
      candidates.push({
        itemId: `supply-v1-listening-${check.id}`,
        variantFamilyId: `supply-family-v1-listening-${unit.learningUnitId}`,
        ...candidateBase(unit, 'listening', nextOrder('listening')),
        nominalEffectiveSeconds: coreSeconds,
        playbackContentId: playbackContentId(corePlaybackText),
        source: {
          sourceType: 'listening-core-check',
          sourceId: check.id,
          variantId: 'full-transcript-detail-choice',
        },
      })
    }
    const sceneQuiz = lesson.sceneQuiz.find((quiz) => quiz.domain === 'listening')
    assert(sceneQuiz?.format === 'single-choice' && typeof sceneQuiz.audioText === 'string', `${lesson.lessonId} lacks a listening scene quiz.`)
    candidates.push({
      itemId: `supply-v1-listening-${sceneQuiz.id}`,
      variantFamilyId: `supply-family-v1-listening-${unit.learningUnitId}`,
      ...candidateBase(unit, 'listening', nextOrder('listening')),
      nominalEffectiveSeconds: Math.round(nominalUtteranceSeconds(sceneQuiz.audioText) + 19),
      playbackContentId: playbackContentId(sceneQuiz.audioText),
      source: {
        sourceType: 'listening-scene-quiz',
        sourceId: sceneQuiz.id,
        variantId: 'scene-audio-single-choice',
      },
    })
  }

  for (const lesson of lessons) {
    const unit = unitByDomain(lesson, 'speaking')
    for (const prompt of unit.activity.prompts) {
      candidates.push({
        itemId: `supply-v1-speaking-${prompt.id}`,
        variantFamilyId: `supply-family-v1-speaking-${unit.learningUnitId}`,
        ...candidateBase(unit, 'speaking', nextOrder('speaking')),
        nominalEffectiveSeconds: 52,
        source: {
          sourceType: 'speaking-prompt',
          sourceId: prompt.id,
          variantId: 'activity-prompt',
        },
      })
    }
    const sceneQuiz = lesson.sceneQuiz.find((quiz) => quiz.domain === 'speaking')
    assert(sceneQuiz?.format === 'fixed-response', `${lesson.lessonId} lacks a speaking scene quiz.`)
    candidates.push({
      itemId: `supply-v1-speaking-${sceneQuiz.id}`,
      variantFamilyId: `supply-family-v1-speaking-${unit.learningUnitId}`,
      ...candidateBase(unit, 'speaking', nextOrder('speaking')),
      nominalEffectiveSeconds: 52,
      source: {
        sourceType: 'speaking-scene-quiz',
        sourceId: sceneQuiz.id,
        variantId: 'scene-fixed-response',
      },
    })
  }
  return candidates
}

const MINIMUM_DISTINCT_CANDIDATES = {
  vocabulary: 50,
  listening: 24,
  speaking: 18,
}

function isDifficultyEligible(candidate, targetDifficulty) {
  if (targetDifficulty < 0 || targetDifficulty > 5.5) {
    return false
  }
  if (targetDifficulty < 0.5) {
    return candidate.difficultyLevel >= 0.5 && candidate.difficultyLevel <= 2.5
  }
  return Math.abs(candidate.difficultyLevel - targetDifficulty) <= 1.5
}

function capacityRows(candidates) {
  return Array.from({ length: 12 }, (_, index) => index * 0.5).map((targetDifficulty) => ({
    targetDifficulty,
    domains: Object.fromEntries(domains.map((domain) => {
      const eligible = candidates.filter((candidate) => candidate.domain === domain && isDifficultyEligible(candidate, targetDifficulty))
      const nominalEffectiveSeconds = eligible.reduce((total, candidate) => total + candidate.nominalEffectiveSeconds, 0)
      return [domain, {
        candidateCount: eligible.length,
        nominalEffectiveSeconds,
        coversTarget: eligible.length >= MINIMUM_DISTINCT_CANDIDATES[domain] && nominalEffectiveSeconds >= 900,
      }]
    })),
  }))
}

function expectedIndex() {
  const candidates = expectedCandidates()
  const totals = Object.fromEntries(domains.map((domain) => [
    `${domain}Candidates`,
    candidates.filter((candidate) => candidate.domain === domain).length,
  ]))
  return {
    schemaVersion: 1,
    documentType: 'continuous-training-supply-index',
    supplyVersion: '1.2.0',
    baseCourseId: packageIndex.courseId,
    basePackageVersion: packageIndex.packageVersion,
    basePackageIndex: packageIndexPath,
    targetLocale: 'en-US',
    supplyPolicy: {
      supportedTargetDifficulty: {
        minimum: 0,
        maximum: 5.5,
        standardTolerance: 1.5,
        beginnerFloorUpperBound: 2.5,
      },
      cursor: {
        meaning: 'last-supplied-item-id',
        selection: 'stable-session-shuffle-with-durable-cursor-validation',
      },
      deduplication: {
        input: 'request.excludeItemIds',
        scope: 'all-current-stream-completed-item-ids',
        whenAllEligibleExcluded: 'all-eligible-content-recently-used',
        listeningPlaybackIdentity: 'candidate.playbackContentId derived from normalized published audio text',
      },
      diversity: {
        dailySeed: 'request.planId+request.taskId',
        extraTrainingSeed: 'request.sessionId',
        recentWindowItems: 10,
        variantFamilyCooldownItems: 4,
        avoidImmediateSameQuestionType: true,
        fallback:
          'relax-diversity-penalties-only-when-no-better-eligible-item',
      },
      contentExhaustion: {
        noEligible: 'no-eligible-content',
        allRecentlyUsed: 'all-eligible-content-recently-used',
        providerFailure: 'provider-failure',
      },
      extraTrainingPriority: {
        input: 'request.priorityItemIds',
        itemIdentity: 'published-candidate-item-id',
        order: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'],
        sameDayVariantFamilyField: 'candidate.variantFamilyId',
        unknownPriorityItem: 'provider-failure',
        allPriorityItemsExcluded: 'all-eligible-content-recently-used',
        fallback: 'continue-in-declared-priority-order-without-repeating-excluded-item',
      },
    },
    capacityPolicy: {
      targetEffectiveSeconds: 900,
      nominalOnly: true,
      minimumDistinctCandidates: MINIMUM_DISTINCT_CANDIDATES,
      capacityByTargetDifficulty: capacityRows(candidates),
    },
    totals: {
      ...totals,
      allCandidates: candidates.length,
    },
    candidates,
  }
}

function assertSelectionContract(index) {
  for (const row of index.capacityPolicy.capacityByTargetDifficulty) {
    for (const domain of domains) {
      assert(row.domains[domain].coversTarget, `${domain} cannot supply a nominal 900-second deduplicated stream at target ${row.targetDifficulty}.`)
    }
  }
  const ids = index.candidates.map((candidate) => candidate.itemId)
  assert(new Set(ids).size === ids.length, 'Supply item IDs are not unique.')
  for (const domain of domains) {
    const orders = index.candidates.filter((candidate) => candidate.domain === domain).map((candidate) => candidate.supplyOrder)
    assert(orders.every((order, index) => order === index + 1), `${domain} supplyOrder is not stable and contiguous.`)
  }
  for (const candidate of index.candidates) {
    assert(
      typeof candidate.variantFamilyId === 'string' && candidate.variantFamilyId.length > 0,
      `${candidate.itemId} lacks a stable same-day variant family.`,
    )
  }
  for (const candidate of index.candidates) {
    const family = index.candidates.filter((other) =>
      other.domain === candidate.domain && other.variantFamilyId === candidate.variantFamilyId,
    )
    assert(
      family.length >= 2,
      `${candidate.itemId} has no published same-day variant.`,
    )
  }
  const listening = index.candidates.filter((candidate) => candidate.domain === 'listening')
  assert(listening.every((candidate) => typeof candidate.playbackContentId === 'string' && candidate.playbackContentId.length > 0), 'Listening candidates lack a published playback content identity.')
  // The index intentionally permits same audio for distinct question formats,
  // but exact candidate facts must never be duplicated under another item id.
  const exactFacts = new Set()
  for (const candidate of listening) {
    const fact = JSON.stringify([candidate.playbackContentId, candidate.source.sourceId, candidate.source.variantId])
    assert(!exactFacts.has(fact), `${candidate.itemId} duplicates an identical listening candidate fact.`)
    exactFacts.add(fact)
  }
}

function selectForAudit(index, request) {
  if (!modes.includes(request.mode)) {
    return { status: 'content-exhausted', reason: 'provider-failure' }
  }
  if (
    request.cursor !== null &&
    !index.candidates.some((candidate) => candidate.itemId === request.cursor)
  ) {
    return { status: 'content-exhausted', reason: 'provider-failure' }
  }
  const eligible = index.candidates
    .filter((candidate) =>
      candidate.domain === request.domain &&
      candidate.targetModuleId === request.domain &&
      candidate.allowedModes.includes(request.mode) &&
      isDifficultyEligible(candidate, request.targetDifficulty),
    )
    .sort((left, right) => left.supplyOrder - right.supplyOrder)
  if (eligible.length === 0) {
    return { status: 'content-exhausted', reason: 'no-eligible-content' }
  }
  const excluded = new Set(request.excludeItemIds)
  const startIndex = request.cursor === null
    ? 0
    : (eligible.findIndex((candidate) => candidate.itemId === request.cursor) + 1) % eligible.length
  for (let offset = 0; offset < eligible.length; offset += 1) {
    const candidate = eligible[(startIndex + offset) % eligible.length]
    if (!excluded.has(candidate.itemId)) {
      return { status: 'item', item: candidate, nextCursor: candidate.itemId }
    }
  }
  return {
    status: 'content-exhausted',
    reason: 'all-eligible-content-recently-used',
  }
}

function orderedEligible(index, request) {
  const eligible = index.candidates
    .filter((candidate) =>
      candidate.domain === request.domain &&
      candidate.targetModuleId === request.domain &&
      candidate.allowedModes.includes(request.mode) &&
      isDifficultyEligible(candidate, request.targetDifficulty),
    )
    .sort((left, right) => left.supplyOrder - right.supplyOrder)
  if (request.cursor === null) {
    return eligible
  }
  const cursorIndex = eligible.findIndex((candidate) => candidate.itemId === request.cursor)
  if (cursorIndex < 0) {
    return null
  }
  return [...eligible.slice(cursorIndex + 1), ...eligible.slice(0, cursorIndex + 1)]
}

function selectExtraTrainingForAudit(index, request) {
  const ordered = orderedEligible(index, request)
  if (ordered === null || typeof request.priorityItemIds !== 'object' || request.priorityItemIds === null || Array.isArray(request.priorityItemIds)) {
    return { status: 'content-exhausted', reason: 'provider-failure' }
  }
  if (ordered.length === 0) {
    return { status: 'content-exhausted', reason: 'no-eligible-content' }
  }
  const byId = new Map(index.candidates.map((candidate) => [candidate.itemId, candidate]))
  const excluded = new Set(request.excludeItemIds)
  const priorityItemIds = request.priorityItemIds
  for (const [priority, itemIds] of Object.entries(priorityItemIds)) {
    if (!['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'].includes(priority) ||
      !Array.isArray(itemIds) || itemIds.some((itemId) => typeof itemId !== 'string')) {
      return { status: 'content-exhausted', reason: 'provider-failure' }
    }
  }
  const itemIdsFor = (priority) => priorityItemIds[priority] ?? []
  for (const priority of ['recent-error', 'due-review']) {
    for (const itemId of itemIdsFor(priority)) {
      const candidate = byId.get(itemId)
      if (!candidate) {
        return { status: 'content-exhausted', reason: 'provider-failure' }
      }
      if (ordered.some((eligible) => eligible.itemId === candidate.itemId) && !excluded.has(candidate.itemId)) {
        return { status: 'item', item: candidate, nextCursor: candidate.itemId, priority }
      }
    }
  }
  for (const itemId of itemIdsFor('same-day-variant')) {
    const source = byId.get(itemId)
    if (!source) {
      return { status: 'content-exhausted', reason: 'provider-failure' }
    }
    const variant = ordered.find((candidate) =>
      candidate.variantFamilyId === source.variantFamilyId &&
      candidate.itemId !== source.itemId && !excluded.has(candidate.itemId),
    )
    if (variant) {
      return { status: 'item', item: variant, nextCursor: variant.itemId, priority: 'same-day-variant' }
    }
  }
  const optional = ordered.find((candidate) => !excluded.has(candidate.itemId))
  if (optional) {
    return { status: 'item', item: optional, nextCursor: optional.itemId, priority: 'new-optional-content' }
  }
  return { status: 'content-exhausted', reason: 'all-eligible-content-recently-used' }
}

function assertExhaustionContract(index) {
  for (const row of index.capacityPolicy.capacityByTargetDifficulty) {
    for (const domain of domains) {
      const first = selectForAudit(index, {
        domain,
        mode: 'learn',
        targetDifficulty: row.targetDifficulty,
        cursor: null,
        excludeItemIds: [],
      })
      assert(first.status === 'item', `${domain} has no initial supply at ${row.targetDifficulty}.`)
      const next = selectForAudit(index, {
        domain,
        mode: 'learn',
        targetDifficulty: row.targetDifficulty,
        cursor: first.nextCursor,
        excludeItemIds: [first.item.itemId],
      })
      assert(
        next.status === 'item' && next.item.itemId !== first.item.itemId,
        `${domain} repeats an excluded item at ${row.targetDifficulty}.`,
      )
      const allEligibleIds = index.candidates
        .filter((candidate) => candidate.domain === domain && isDifficultyEligible(candidate, row.targetDifficulty))
        .map((candidate) => candidate.itemId)
      const exhausted = selectForAudit(index, {
        domain,
        mode: 'learn',
        targetDifficulty: row.targetDifficulty,
        cursor: null,
        excludeItemIds: allEligibleIds,
      })
      assert(
        exhausted.status === 'content-exhausted' && exhausted.reason === 'all-eligible-content-recently-used',
        `${domain} does not report all-eligible-content-recently-used honestly.`,
      )
    }
  }
  assert(
    selectForAudit(index, {
      domain: 'vocabulary', mode: 'learn', targetDifficulty: 6, cursor: null, excludeItemIds: [],
    }).reason === 'no-eligible-content',
    'Out-of-coverage target difficulty must report no-eligible-content.',
  )
  assert(
    selectForAudit(index, {
      domain: 'vocabulary', mode: 'learn', targetDifficulty: 2.5, cursor: 'unknown-cursor', excludeItemIds: [],
    }).reason === 'provider-failure',
    'Unknown cursor must report provider-failure.',
  )
}

function assertExtraTrainingPriorityContract(index) {
  for (const domain of domains) {
    const requestBase = {
      domain,
      mode: 'learn',
      targetDifficulty: 2.5,
      cursor: null,
      excludeItemIds: [],
    }
    const eligible = orderedEligible(index, requestBase)
    assert(eligible !== null && eligible.length >= 3, `${domain} lacks enough candidates for priority checks.`)
    const [recent, due, sameDay] = eligible
    const request = (priorityItemIds, overrides = {}) => ({
      ...requestBase,
      priorityItemIds,
      ...overrides,
    })
    const emptyBuckets = {
      'recent-error': [],
      'due-review': [],
      'same-day-variant': [],
      'new-optional-content': [],
    }
    const recentFirst = selectExtraTrainingForAudit(index, request({
      ...emptyBuckets,
      'recent-error': [recent.itemId],
    }))
    assert(recentFirst.status === 'item' && recentFirst.item.itemId === recent.itemId && recentFirst.priority === 'recent-error', `${domain} does not prefer a recent-error item.`)
    const dueAfterRecentExcluded = selectExtraTrainingForAudit(index, request({
      ...emptyBuckets,
      'recent-error': [recent.itemId],
      'due-review': [due.itemId],
    }, { excludeItemIds: [recent.itemId] }))
    assert(dueAfterRecentExcluded.status === 'item' && dueAfterRecentExcluded.item.itemId === due.itemId && dueAfterRecentExcluded.priority === 'due-review', `${domain} does not fall through from excluded recent-error to due-review.`)
    const variant = selectExtraTrainingForAudit(index, request({
      ...emptyBuckets,
      'same-day-variant': [sameDay.itemId],
    }))
    assert(variant.status === 'item' && variant.priority === 'same-day-variant' && variant.item.itemId !== sameDay.itemId && variant.item.variantFamilyId === sameDay.variantFamilyId, `${domain} cannot resolve a distinct same-day variant from published content.`)
    const optional = selectExtraTrainingForAudit(index, request(emptyBuckets))
    assert(optional.status === 'item' && optional.priority === 'new-optional-content', `${domain} does not fall through to new optional content.`)
    const repeatable = selectExtraTrainingForAudit(index, request(emptyBuckets))
    assert(deepEqual(optional, repeatable), `${domain} does not restore the same cursor deterministically.`)
    const exhausted = selectExtraTrainingForAudit(index, request(emptyBuckets, {
      excludeItemIds: eligible.map((candidate) => candidate.itemId),
    }))
    assert(exhausted.status === 'content-exhausted' && exhausted.reason === 'all-eligible-content-recently-used', `${domain} does not report recently excluded exhaustion.`)
    const unknown = selectExtraTrainingForAudit(index, request({
      ...emptyBuckets,
      'recent-error': ['supply-v1-unknown-item'],
    }))
    assert(unknown.status === 'content-exhausted' && unknown.reason === 'provider-failure', `${domain} does not report an unknown priority item as provider failure.`)
  }
}

const expected = expectedIndex()
if (writeMode) {
  writeJson(supplyIndexPath, expected)
  packageIndex.trainingSupplyTotals = expected.totals
  writeJson(packageIndexPath, packageIndex)
  console.log(JSON.stringify({ mode: 'write', supplyIndexPath, totals: expected.totals }, null, 2))
  process.exit(0)
}

const observed = readJson(supplyIndexPath)
assert(deepEqual(observed, expected), 'Training supply index has drifted from released content facts.')
assertSelectionContract(observed)
assertExhaustionContract(observed)
assertExtraTrainingPriorityContract(observed)
assert(packageIndex.trainingSupplyIndexFile === supplyIndexPath, 'Package index does not expose the training supply index.')
assert(
  packageIndex.trainingSupplyIndexSchemaFile ===
    'content/curriculum/training-supply-index.schema.v1.json',
  'Package index does not expose the training supply schema.',
)
assert(deepEqual(packageIndex.trainingSupplyTotals, observed.totals), 'Package index supply totals have drifted.')
console.log(JSON.stringify({ schemaVersion: 1, totals: observed.totals, capacityByTargetDifficulty: observed.capacityPolicy.capacityByTargetDifficulty, selectionChecks: 'passed' }, null, 2))
