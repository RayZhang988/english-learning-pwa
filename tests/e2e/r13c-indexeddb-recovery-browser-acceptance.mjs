import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { launchQaChrome } from './lib/cdp-browser.mjs'

const baseUrl = new URL(process.env.QA_BASE_URL ?? 'https://rayzhang988.github.io/english-learning-pwa/')
const expectedAsset = process.env.QA_EXPECTED_ASSET ?? 'index-pFiN7mRr.js'
const expectedPagesRun = process.env.QA_PAGES_RUN ?? '30529368908'
const databaseName = 'english-learning-pwa'
const namespace = 'feature.vocabulary.scene-practice'
const bank = JSON.parse(await readFile(
  new URL('../../content/lessons/survival-travel-american-4w/scene-vocabulary-questions.v1.json', import.meta.url),
  'utf8',
))

const evidence = {
  status: 'running',
  baseUrl: baseUrl.href,
  expectedAsset,
  expectedPagesRun,
  isolatedProfiles: ['A', 'B'],
  userDeviceDataTouched: false,
  checkpoints: [],
}
const checkpoint = (name, details = {}) => evidence.checkpoints.push({ name, ...details })
const sessionIdFor = (scene) => `r13b-scene-vocabulary:${scene.categoryId}:${scene.sceneId}`
const keyFor = (scene) => `session:${sessionIdFor(scene)}`
const routeFor = (scene) => new URL(`#/practice/scenes/${scene.categoryId}/${scene.sceneId}`, baseUrl).href
const recordId = (recordNamespace, key) => `${recordNamespace}\u0000${key}`
const timestamp = '2026-07-30T08:00:00.000Z'

function scene(sceneId) {
  const value = bank.scenes.find((entry) => entry.sceneId === sceneId)
  assert.ok(value, `Released scene ${sceneId} is missing.`)
  return value
}

function optionIds(question) {
  const meanings = [question.correctMeaningZh, ...question.distractorMeaningsZh]
  let hash = 0
  for (const character of question.questionId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const offset = hash % meanings.length
  const ordered = [...meanings.slice(offset), ...meanings.slice(0, offset)]
  return ordered.map((label, index) => ({ id: `${question.questionId}:meaning:${index + 1}`, label }))
}

function correctOptionId(question) {
  const option = optionIds(question).find((candidate) => candidate.label === question.correctMeaningZh)
  assert.ok(option, `Released correct option is missing for ${question.questionId}.`)
  return option.id
}

function incorrectOptionId(question) {
  const option = optionIds(question).find((candidate) => candidate.label !== question.correctMeaningZh)
  assert.ok(option, `Released incorrect option is missing for ${question.questionId}.`)
  return option.id
}

function storedRecord(recordNamespace, key, value, schemaVersion = 2) {
  return {
    id: recordId(recordNamespace, key),
    namespace: recordNamespace,
    key,
    value,
    schemaVersion,
    updatedAt: timestamp,
  }
}

function legacySnapshot(value, answers, selectedOptionId, phase) {
  const questionIds = value.questions.slice(0, 6).map((question) => question.questionId)
  return {
    schemaVersion: 1,
    sessionId: sessionIdFor(value),
    bankId: 'r13b-travel-scene-vocabulary',
    contentVersion: '1.0.0',
    categoryId: value.categoryId,
    sceneId: value.sceneId,
    questionIds,
    answers,
    selectedOptionId,
    phase,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function validOtherSceneSnapshot(value) {
  const questionIds = value.questions.map((question) => question.questionId)
  return {
    schemaVersion: 2,
    sessionId: sessionIdFor(value),
    bankId: 'r13b-travel-scene-vocabulary',
    contentVersion: '1.0.0',
    categoryId: value.categoryId,
    sceneId: value.sceneId,
    round: 1,
    supplyCursor: 0,
    questionIds,
    shortTermExclusionIds: [],
    currentQuestionId: questionIds[0],
    answers: [],
    correctCount: 0,
    incorrectCount: 0,
    priorRounds: [],
    selectedOptionId: null,
    phase: 'answering',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function corruptedSnapshot(value) {
  return {
    schemaVersion: 2,
    sessionId: sessionIdFor(value),
    bankId: 'r13b-travel-scene-vocabulary',
    contentVersion: '1.0.0',
    categoryId: value.categoryId,
    // Deliberately JSON-readable but structurally incomplete: no sequence or active state.
    sceneId: value.sceneId,
  }
}

function driftedSnapshot(value) {
  const fresh = validOtherSceneSnapshot(value)
  return {
    ...fresh,
    questionIds: [
      'r13c-unreleased-question-id',
      ...fresh.questionIds.slice(1),
    ],
    currentQuestionId: 'r13c-unreleased-question-id',
  }
}

async function putRecords(page, records) {
  await page.evaluate(`(async () => {
    const records = ${JSON.stringify(records)}
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(${JSON.stringify(databaseName)})
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('records', 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      const store = transaction.objectStore('records')
      for (const record of records) store.put(record)
    })
    database.close()
  })()`)
}

function allRecords(databases) {
  return databases.flatMap((database) => database.stores.records ?? [])
}

function findRecord(databases, recordNamespace, key) {
  return allRecords(databases).find((record) => record.namespace === recordNamespace && record.key === key)
}

function assertRecordEqual(databases, expected, label) {
  assert.deepEqual(findRecord(databases, expected.namespace, expected.key), expected, `${label} changed.`)
}

async function prepareProfile(qa) {
  await qa.page.initialize()
  await qa.page.setViewport(390, 844)
  await qa.page.navigate(new URL('#/', baseUrl).href)
  await qa.page.waitFor('document.readyState === \'complete\'')
  const homeHtml = await (await fetch(baseUrl)).text()
  const liveAsset = homeHtml.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/u)?.[1]
  assert.equal(liveAsset, expectedAsset, 'The production recovery run used an unexpected asset.')
}

async function resumeIfPrompted(page) {
  if (await page.evaluate(`document.body.innerText.includes('继续上次训练？')`)) {
    await page.clickByText('继续上次训练')
  }
}

async function answerCurrentCorrect(page, value) {
  const target = await page.evaluate(`document.querySelector('.scene-vocabulary-target')?.textContent.trim()`)
  const question = value.questions.find((entry) => entry.targetText === target)
  assert.ok(question, `No released question matches ${target}.`)
  const selected = await page.evaluate(`(() => {
    const option = [...document.querySelectorAll('[data-scene-vocabulary-option]')].find((node) => node.innerText.trim() === ${JSON.stringify(question.correctMeaningZh)})
    if (!option || option.disabled) return false
    option.click()
    return true
  })()`)
  assert.equal(selected, true)
  await page.waitFor(`document.querySelector('.scene-vocabulary-option--selected')?.innerText.trim() === ${JSON.stringify(question.correctMeaningZh)}`)
  await page.clickByText('提交答案')
  await page.waitFor(`document.body.innerText.includes('回答正确')`)
  await page.clickByText('继续')
}

function assertSnapshotProgress(snapshot, expected) {
  assert.equal(snapshot?.value?.schemaVersion, 2)
  assert.equal(snapshot?.value?.answers?.length, expected.answered)
  assert.equal(snapshot?.value?.correctCount, expected.correct)
  assert.equal(snapshot?.value?.incorrectCount, expected.answered - expected.correct)
  assert.equal(snapshot?.value?.currentQuestionId, expected.currentQuestionId)
  assert.equal(snapshot?.value?.selectedOptionId ?? null, expected.selectedOptionId ?? null)
  assert.equal(snapshot?.value?.phase, expected.phase)
}

async function profileA() {
  const qa = await launchQaChrome({ fakeMedia: false })
  const airport = scene('airport')
  const taxi = scene('taxi')
  const airportAnswers = [
    { questionId: airport.questions[0].questionId, selectedOptionId: correctOptionId(airport.questions[0]), submittedAt: timestamp },
    { questionId: airport.questions[1].questionId, selectedOptionId: incorrectOptionId(airport.questions[1]), submittedAt: timestamp },
  ]
  const airportSelected = correctOptionId(airport.questions[2])
  const taxiAnswers = [{ questionId: taxi.questions[0].questionId, selectedOptionId: correctOptionId(taxi.questions[0]), submittedAt: timestamp }]
  const preservedDaily = storedRecord('learning.active-plan', 'qa-r13c-daily-plan', { dailyPlan: 'preserve-byte-for-byte', marker: [1, 2, 3] })
  const preservedExtra = storedRecord('learning.extra-training', 'qa-r13c-extra-session', { r61Extra: 'preserve-byte-for-byte', marker: { module: 'vocabulary' } })
  try {
    await prepareProfile(qa)
    await putRecords(qa.page, [
      storedRecord(namespace, keyFor(airport), legacySnapshot(airport, airportAnswers, airportSelected, 'answering')),
      storedRecord(namespace, keyFor(taxi), legacySnapshot(taxi, taxiAnswers, null, 'feedback')),
      preservedDaily,
      preservedExtra,
    ])

    await qa.page.navigate(routeFor(airport))
    await qa.page.waitFor(`document.body.innerText.includes('继续上次训练？')`)
    const migrationSnapshot = findRecord(await qa.page.dumpIndexedDb(), namespace, keyFor(airport))
    assertSnapshotProgress(migrationSnapshot, {
      answered: 2,
      correct: 1,
      currentQuestionId: airport.questions[2].questionId,
      selectedOptionId: airportSelected,
      phase: 'answering',
    })
    await qa.page.clickByText('继续上次训练')
    await qa.page.waitFor(`document.querySelector('.scene-vocabulary-option--selected')?.getAttribute('data-scene-vocabulary-option') === ${JSON.stringify(airportSelected)}`)

    for (let index = 0; index < 5; index += 1) {
      await qa.page.waitFor(`document.querySelector('.scene-vocabulary-target')`)
      await answerCurrentCorrect(qa.page, airport)
    }
    let airportSnapshot = findRecord(await qa.page.dumpIndexedDb(), namespace, keyFor(airport))
    assertSnapshotProgress(airportSnapshot, {
      answered: 7,
      correct: 6,
      currentQuestionId: airportSnapshot.value.currentQuestionId,
      phase: 'answering',
    })
    const afterSevenQuestionId = airportSnapshot.value.currentQuestionId
    await qa.page.reload()
    await qa.page.waitFor(`document.body.innerText.includes('继续上次训练？')`)
    await resumeIfPrompted(qa.page)
    await qa.page.waitFor(`document.querySelector('.scene-vocabulary-target')?.textContent.trim()`)
    airportSnapshot = findRecord(await qa.page.dumpIndexedDb(), namespace, keyFor(airport))
    assertSnapshotProgress(airportSnapshot, {
      answered: 7,
      correct: 6,
      currentQuestionId: afterSevenQuestionId,
      phase: 'answering',
    })

    await qa.page.navigate(routeFor(taxi))
    await qa.page.waitFor(`document.body.innerText.includes('继续上次训练？')`)
    await qa.page.clickByText('继续上次训练')
    await qa.page.waitFor(`document.body.innerText.includes('回答正确')`)
    const feedbackSnapshot = findRecord(await qa.page.dumpIndexedDb(), namespace, keyFor(taxi))
    assertSnapshotProgress(feedbackSnapshot, {
      answered: 1,
      correct: 1,
      currentQuestionId: taxi.questions[0].questionId,
      phase: 'feedback',
    })
    const records = await qa.page.dumpIndexedDb()
    assertRecordEqual(records, preservedDaily, 'Profile A daily-plan record')
    assertRecordEqual(records, preservedExtra, 'Profile A R6.1 extra record')
    assert.deepEqual(qa.page.pageErrors, [])
    checkpoint('profile-a-schema-1-selection-feedback-migration', {
      airportAnswered: 7,
      airportCorrect: 6,
      selectedOptionPreserved: true,
      feedbackPreserved: true,
      refreshedQuestionId: afterSevenQuestionId,
      preservedNonSceneRecords: 2,
    })
  } finally {
    await qa.close()
  }
}

async function assertInvalidRecovery(page, value, rawRecord, protectedRecords, label) {
  await page.navigate(routeFor(value))
  try {
    await page.waitFor(`document.body.innerText.includes('无法恢复此场景训练')`)
  } catch (error) {
    const records = await page.dumpIndexedDb()
    throw new Error(`${label} did not expose the invalid-snapshot recovery UI. ${JSON.stringify({
      url: await page.url(),
      body: await page.bodyText(),
      currentRecord: findRecord(records, rawRecord.namespace, rawRecord.key),
    })}`, { cause: error })
  }
  assert.match(await page.bodyText(), /不会自动删除它/u)
  await page.clickByText('重新开始此场景')
  await page.waitFor(`document.body.innerText.includes('确认重新开始此场景')`)
  await page.clickByText('取消')
  let records = await page.dumpIndexedDb()
  assertRecordEqual(records, rawRecord, `${label} cancel must retain corrupt current scene record`)
  for (const record of protectedRecords) assertRecordEqual(records, record, `${label} protected record`)
  await page.clickByText('重新开始此场景')
  await page.clickByText('确认重新开始此场景')
  await page.waitFor(`document.querySelector('.scene-vocabulary-target')`)
  records = await page.dumpIndexedDb()
  const replacement = findRecord(records, namespace, keyFor(value))
  assertSnapshotProgress(replacement, {
    answered: 0,
    correct: 0,
    currentQuestionId: replacement.value.currentQuestionId,
    phase: 'answering',
  })
  assert.equal(replacement.value.selectedOptionId, null)
  assert.match(await page.evaluate(`document.querySelector('.scene-vocabulary-progress')?.innerText ?? ''`), /已答题\s*0[\s\S]*答对\s*0[\s\S]*正确率\s*暂无/u)
  for (const record of protectedRecords) assertRecordEqual(records, record, `${label} protected record after confirm`)
  await page.reload()
  await page.waitFor(`document.querySelector('.scene-vocabulary-target')`)
  assert.doesNotMatch(await page.bodyText(), /无法恢复此场景训练/u)
}

async function profileB() {
  const qa = await launchQaChrome({ fakeMedia: false })
  const airport = scene('airport')
  const hotel = scene('hotel')
  const protectedOtherScene = storedRecord(namespace, keyFor(hotel), validOtherSceneSnapshot(hotel))
  const preservedDaily = storedRecord('learning.active-plan', 'qa-r13c-daily-plan', { dailyPlan: 'preserve-byte-for-byte', marker: [7, 8, 9] })
  const preservedExtra = storedRecord('learning.extra-training', 'qa-r13c-extra-session', { r61Extra: 'preserve-byte-for-byte', marker: { module: 'speaking' } })
  try {
    await prepareProfile(qa)
    const structuralRecord = storedRecord(namespace, keyFor(airport), corruptedSnapshot(airport))
    await putRecords(qa.page, [structuralRecord, protectedOtherScene, preservedDaily, preservedExtra])
    await assertInvalidRecovery(qa.page, airport, structuralRecord, [protectedOtherScene, preservedDaily, preservedExtra], 'Profile B structural corruption')

    const driftRecord = storedRecord(namespace, keyFor(airport), driftedSnapshot(airport))
    await putRecords(qa.page, [driftRecord])
    // The active route already owns a valid in-memory runtime after the first recovery.
    // A document reload is required to exercise production persistence hydration rather
    // than testing an in-memory route transition that never reads IndexedDB again.
    await qa.page.reload()
    await assertInvalidRecovery(qa.page, airport, driftRecord, [protectedOtherScene, preservedDaily, preservedExtra], 'Profile B released-order drift')
    assert.deepEqual(qa.page.pageErrors, [])
    checkpoint('profile-b-structural-and-question-order-recovery', {
      scenarios: ['json-readable-structural-corruption', 'released-question-id-drift'],
      cancelRetainedBadRecord: true,
      confirmReplacedOnlyCurrentScene: true,
      freshProgress: '0 answered / 0 correct / 暂无',
      preservedOtherSceneAndNonSceneRecords: 3,
    })
  } finally {
    await qa.close()
  }
}

try {
  await profileA()
  await profileB()
  evidence.status = 'passed'
  console.log(JSON.stringify(evidence, null, 2))
} catch (error) {
  evidence.status = 'failed'
  console.error(JSON.stringify(evidence, null, 2))
  throw error
}
