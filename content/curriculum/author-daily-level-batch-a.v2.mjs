import fs from 'node:fs'

const writeMode = process.argv.includes('--write')
const normalize = (value) => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim()
const normalizeZh = (value) => value.trim().replace(/\s+/g, '')
const tokens = (value) => value.toLocaleLowerCase('en-US').trim().split(/\s+/u).map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, '')).filter(Boolean)

function fingerprint(value) {
  let hash = 0x811c9dc5
  for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 0x01000193) }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function parseAssessment() {
  const source = fs.readFileSync('content/assessment/travel-vocabulary-data.r1.ts', 'utf8')
  return Object.fromEntries([...source.matchAll(/'([^']+)': `([\s\S]*?)`/gu)].map((match) => [
    match[1], match[2].trim().split('\n').map((row) => {
      const [term, meaningZh] = row.split('|')
      return { term, meaningZh }
    }),
  ]))
}

function releasedItems() {
  const index = JSON.parse(fs.readFileSync('content/curriculum/package-index.v1.json', 'utf8'))
  return index.lessonFiles.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).lessons).flatMap((lesson) =>
    lesson.learningUnits.filter((unit) => unit.domain === 'vocabulary').flatMap((unit) => unit.activity.items.map((item) => ({
      ...item, difficulty: item.growthDifficultyLevel ?? unit.difficultyLevel,
    }))),
  )
}

const completeOpeners = new Set(['i','you','we','they','he','she','it','is','are','can','could','would','will','do','does','did','please','where','what','when','why','how'])
const isComplete = (value) => completeOpeners.has(tokens(value)[0])
const isComplex = (value) => tokens(value).length >= 4 && (/\b(if|unless|although|because|whether|while|before|after|which|who|that)\b/iu.test(value) || /[,;]/u.test(value))
const key = (row) => `${normalize(row.term)}|${normalizeZh(row.meaningZh)}`

function takeNamed(rows, names, label) {
  const byName = new Map(rows.map((row) => [normalize(row.term), row]))
  return names.map((name) => {
    const row = byName.get(normalize(name))
    if (!row) throw new Error(`${label} is missing ${name}`)
    return row
  })
}

function author() {
  const stages = parseAssessment()
  const released = releasedItems()
  const banned = new Set(['ambulance','escalator','stomachache','banknote','between','crosswalk','toothpaste','first aid'])
  const kindergartenStage2 = [
    'backpack','wallet','camera','charger','battery','gate','flight','stairs','floor','shower','towel','pillow','blanket','breakfast','lunch','dinner','menu','bill','beef','pork','soup','salad','noodle','sandwich','egg','cheese','sugar','salt','bottle','cup','glass','plate','fork','knife','spoon','table','chair','seat','size','color','shirt','pants','shoe','hat','coat','gift','cash','card','change','coin',
  ]
  const primary1Stage3 = [
    'hostel','motel','resort','apartment','destination','return','single','aisle','window','economy','fare','pass','railway','vehicle','rental','license','insurance','emergency','accident','injury','medicine','doctor','dentist','clinic','pharmacy','pain','fever','cough','allergy','bandage',
  ]
  const primary3Stage4 = [
    'suite','voucher','invoice','signature','document','permit','duty','checkpoint','inspection','turbulence','runway','aircraft','cabin','crew','pilot','attendant','navigation','direction','intersection','pedestrian','pavement','highway','toll','detour','collision','breakdown','roadside','mechanic','fuel','gasoline','diesel','engine','tire','helmet','symptom','infection','nausea','dizziness','embassy','consulate','complaint','theft','robbery','scam','victim','witness','earthquake','hurricane','typhoon','flood','storm','lightning','shelter','sculpture','portrait','ancient','wheelchair','assistance','facility','equipment','gesture',
  ]

  const kWords = [...stages['stage-1-foundation'], ...takeNamed(stages['stage-2-essential'], kindergartenStage2, 'kindergarten stage 2')]
  const usedWordKeys = new Set(kWords.map(key))
  const remainingStage2 = stages['stage-2-essential'].filter((row) => !usedWordKeys.has(key(row)))
  const p1Named = takeNamed(stages['stage-3-independent'], primary1Stage3, 'primary 1 stage 3')
  const p1Words = [...remainingStage2, ...p1Named]
  p1Words.forEach((row) => usedWordKeys.add(key(row)))
  const remainingStage3 = stages['stage-3-independent'].filter((row) => !usedWordKeys.has(key(row)) && !banned.has(normalize(row.term)))
  const p2Words = remainingStage3.slice(0, 100)
  p2Words.forEach((row) => usedWordKeys.add(key(row)))
  const p3Words = [
    ...stages['stage-3-independent'].filter((row) => !usedWordKeys.has(key(row)) && !banned.has(normalize(row.term))).slice(0, 20),
    ...takeNamed(stages['stage-4-advanced'], primary3Stage4, 'primary 3 stage 4'),
  ]

  const usedForms = new Set([...kWords, ...p1Words, ...p2Words, ...p3Words].map((row) => normalize(row.term)))
  const phrasePool = released.filter((item) => item.difficulty <= 2 && tokens(item.term).length >= 2 && tokens(item.term).length <= 5 && !usedForms.has(normalize(item.term)))
    .sort((left, right) => left.difficulty - right.difficulty || tokens(left.term).length - tokens(right.term).length || left.id.localeCompare(right.id))
  const usedPhraseForms = new Set()
  const takePhrases = ({ count, maxTokens, completeTarget, complexLimit }) => {
    const rawEligible = phrasePool.filter((row) => !usedPhraseForms.has(normalize(row.term)) && tokens(row.term).length <= maxTokens)
    const eligible = [...rawEligible.filter((row) => !isComplex(row.term)), ...rawEligible.filter((row) => isComplex(row.term)).slice(0, complexLimit)]
    const byComplexity = (left, right) => Number(isComplex(left.term)) - Number(isComplex(right.term))
    const nonComplete = eligible.filter((row) => !isComplete(row.term)).sort(byComplexity)
    const complete = eligible.filter((row) => isComplete(row.term)).sort(byComplexity)
    const selected = [...nonComplete.slice(0, count - completeTarget), ...complete.slice(0, completeTarget)]
    if (selected.length !== count) throw new Error(`Only ${selected.length}/${count} phrases satisfy the batch constraints.`)
    selected.forEach((row) => usedPhraseForms.add(normalize(row.term)))
    return selected.map(({ term, meaningZh }) => ({ term, meaningZh }))
  }
  const p1Phrases = takePhrases({ count: 70, maxTokens: 3, completeTarget: 0, complexLimit: 0 })
  const p2Phrases = takePhrases({ count: 100, maxTokens: 4, completeTarget: 20, complexLimit: 0 })
  const p3Phrases = takePhrases({ count: 120, maxTokens: 5, completeTarget: 50, complexLimit: 4 })

  const specs = [
    ['kindergarten','幼儿园',0,'core','concrete',[...kWords]],
    ['primary-1','一年级',0.5,'core','immediate-function',[...p1Words,...p1Phrases]],
    ['primary-2','二年级',1,'common','immediate-function',[...p2Words,...p2Phrases]],
    ['primary-3','三年级',1.5,'common','immediate-function',[...p3Words,...p3Phrases]],
  ]
  const records = specs.flatMap(([levelId, labelZh, difficulty, lexicalFrequencyBand, abstractionBand, rows]) => {
    if (rows.length !== 200) throw new Error(`${levelId} has ${rows.length} records.`)
    return rows.map((row, index) => {
      const form = normalize(row.term)
      if (banned.has(form) && levelId === 'kindergarten') throw new Error(`Banned kindergarten term: ${form}`)
      const tokenCount = tokens(row.term).length
      const surfaceType = tokenCount === 1 ? 'word' : isComplete(row.term) ? 'functional-utterance' : 'short-phrase'
      const identity = `daily-knowledge-v2:${tokenCount === 1 ? 'word' : 'phrase'}:${fingerprint(`${form}|${normalizeZh(row.meaningZh)}`)}`
      return {
        sourceItemId: `qa-r17-003-a:${levelId}:${String(index + 1).padStart(3, '0')}`,
        dailyKnowledgeId: identity,
        levelId, labelZh, growthDifficultyLevel: difficulty,
        term: row.term, meaningZh: row.meaningZh,
        partOfSpeech: surfaceType,
        exampleEn: row.term, exampleZh: row.meaningZh,
        authoring: {
          lexicalFrequencyBand, abstractionBand, surfaceType,
          grammarFeatures: surfaceType === 'functional-utterance' ? ['simple-spoken-turn'] : [],
          travelUse: 'daily-travel-survival', contentReviewStatus: 'candidate-reviewed',
        },
      }
    })
  })
  if (new Set(records.map((row) => row.dailyKnowledgeId)).size !== 800) throw new Error('Batch A identities are not unique.')
  if (new Set(records.map((row) => normalize(row.term))).size !== 800) throw new Error('Batch A English forms are not unique.')

  const newByContent = new Map(records.map((row) => [key(row), row]))
  const oldBatch = released.filter((row) => row.difficulty <= 1.5)
  const entries = oldBatch.map((old) => {
    const target = newByContent.get(key(old))
    return target ? {
      sourceDailyKnowledgeId: old.dailyKnowledgeId ?? `legacy-daily-source-v1:${old.id}`,
      sourceIdentityKind: old.dailyKnowledgeId ? 'stable-daily-knowledge-v1' : 'legacy-source-item-fallback',
      sourceItemId: old.id,
      disposition: old.difficulty === target.growthDifficultyLevel ? 'equivalent' : 'moved-equivalent',
      targetDailyKnowledgeId: target.dailyKnowledgeId,
      evidenceTransferAllowed: true,
    } : {
      sourceDailyKnowledgeId: old.dailyKnowledgeId ?? `legacy-daily-source-v1:${old.id}`,
      sourceIdentityKind: old.dailyKnowledgeId ? 'stable-daily-knowledge-v1' : 'legacy-source-item-fallback',
      sourceItemId: old.id,
      disposition: 'retired',
      evidenceTransferAllowed: false,
    }
  })
  const mappedTargets = new Set(entries.flatMap((entry) => entry.targetDailyKnowledgeId ? [entry.targetDailyKnowledgeId] : []))
  const newIdentities = records.filter((row) => !mappedTargets.has(row.dailyKnowledgeId)).map((row) => row.dailyKnowledgeId)
  return {
    content: { schemaVersion:1, documentType:'daily-level-content-batch', contentVersion:'2.0.0-a', identityVersion:'daily-knowledge-v2', releaseStatus:'candidate-not-deployable-until-batches-b-and-c', levels:specs.map(([id,labelZh])=>({id,labelZh,recordCount:200})), records },
    migration: { schemaVersion:1, documentType:'daily-level-identity-migration', migrationVersion:'daily-level-v1-to-v2-batch-a', releaseStatus:'candidate', sourceIdentityVersion:'daily-knowledge-v1', targetIdentityVersion:'daily-knowledge-v2', sourceRecordCount:oldBatch.length, entries, newIdentities },
  }
}

const { content, migration } = author()
const outputs = [
  ['content/curriculum/daily-level-content-batch-a.v2.json', content],
  ['content/curriculum/daily-level-identity-migration-batch-a.v1.json', migration],
]
for (const [path, value] of outputs) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  if (writeMode) fs.writeFileSync(path, serialized)
  else if (fs.readFileSync(path, 'utf8') !== serialized) throw new Error(`${path} is stale; run with --write.`)
}
console.log(`Batch A authored: ${content.records.length} records; ${migration.entries.filter((row) => row.disposition.includes('equivalent')).length} exact equivalents; ${migration.entries.filter((row) => row.disposition === 'retired').length} retired v1 records; ${migration.newIdentities.length} new v2 identities.`)
