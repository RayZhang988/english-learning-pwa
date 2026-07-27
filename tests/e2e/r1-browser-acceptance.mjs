import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
  createPlacementAssessmentRuntime,
  createVocabularyPlacementRuntime,
  TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
  VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
} from '../../src/features/assessment/index.ts'
import { travelVocabularyBankR1 } from '../../content/assessment/travel-vocabulary-bank.r1.ts'
import {
  fakeAssessmentClockScript,
  launchQaChrome,
} from './lib/cdp-browser.mjs'

const baseUrl = new URL(
  process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173/',
)
const expectedAsset =
  process.env.QA_R1_EXPECTED_ASSET ?? 'index-CT4ajse6.js'
const assessmentNamespace = 'feature.assessment'
const latestProfileKey = 'latest-ability-profile'
const corruptBackupPrefix =
  'corrupt-travel-vocabulary-assessment-r1-v1'
const scorePattern = [0, 6, 15, 30, 0]
const expectedMastery = ['0%', '20%', '50%', '100%', '0%']
const expectedStageLabels = [
  '基础出行词汇',
  '核心旅行词汇',
  '独立旅行词汇',
  '进阶旅行词汇',
  '高阶旅行词汇',
]
const correctMeaningByWord = new Map(
  travelVocabularyBankR1.stages.flatMap((stage) =>
    stage.candidates.map((candidate) => [
      candidate.word,
      candidate.meaningZh,
    ]),
  ),
)
const evidence = {
  baseUrl: baseUrl.href,
  expectedAsset,
  checkpoints: [],
}

function checkpoint(name, details = {}) {
  evidence.checkpoints.push({ name, ...details })
}

function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
}

function allRecords(databases) {
  return databases.flatMap(
    (database) => database.stores.records ?? [],
  )
}

function recordByKey(databases, key) {
  return allRecords(databases).find(
    (record) =>
      record.namespace === assessmentNamespace &&
      record.key === key,
  )
}

function requireR1Snapshot(databases) {
  const record = recordByKey(
    databases,
    TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
  )
  assert.ok(record, 'The R1 runtime snapshot is missing.')
  assert.equal(record.schemaVersion, 3)
  assert.equal(
    record.value?.assessmentKind,
    'staged-travel-vocabulary',
  )
  return record.value
}

async function httpEvidence() {
  const indexResponse = await fetch(baseUrl)
  assert.equal(indexResponse.status, 200)
  const html = await indexResponse.text()
  assert.match(html, new RegExp(`assets/${expectedAsset}`, 'u'))

  const resources = {}
  for (const relative of [
    'manifest.webmanifest',
    'sw.js',
    `assets/${expectedAsset}`,
  ]) {
    const response = await fetch(new URL(relative, baseUrl))
    resources[relative] = {
      status: response.status,
      contentType: response.headers.get('content-type'),
    }
    assert.equal(response.status, 200, `${relative} did not return 200.`)
  }
  checkpoint('r1-release-http', resources)
}

async function waitForAssessmentReady(page) {
  await page.waitFor(
    `!document.body.innerText.includes('正在读取本机 R1 旅游英语词汇测试')`,
    20_000,
  )
}

async function currentQuestion(page) {
  return page.evaluate(`(() => {
    const word = document.querySelector(
      '.travel-r1-word-card h2'
    )?.textContent?.trim() ?? null
    const number = document.querySelector(
      '.travel-r1-word-card .eyebrow'
    )?.textContent?.trim() ?? null
    const options = [...document.querySelectorAll(
      '.travel-r1-choice-list button[role="radio"]:not(.travel-r1-uncertain)'
    )].map((button) => ({
      text: button.innerText.trim(),
      checked: button.getAttribute('aria-checked') === 'true',
      disabled: button.disabled,
    }))
    const uncertain = document.querySelector(
      '.travel-r1-choice-list .travel-r1-uncertain'
    )
    return {
      word,
      number,
      options,
      uncertain: uncertain
        ? {
            text: uncertain.innerText.trim(),
            checked: uncertain.getAttribute('aria-checked') === 'true',
            disabled: uncertain.disabled,
          }
        : null,
    }
  })()`)
}

async function goToQuestion(page, index) {
  const result = await page.evaluate(`(() => {
    const details = document.querySelector(
      'details.travel-r1-question-map'
    )
    if (details) details.open = true
    const buttons = [...document.querySelectorAll(
      'button.travel-r1-question-number'
    )]
    const button = buttons[${index}]
    if (!button || button.disabled) {
      return {
        clicked: false,
        count: buttons.length,
        disabled: button?.disabled ?? null,
      }
    }
    button.click()
    return { clicked: true, count: buttons.length }
  })()`)
  assert.equal(result.count, 30)
  assert.equal(
    result.clicked,
    true,
    `Could not navigate to R1 question ${index + 1}.`,
  )
  await page.waitFor(
    `document.querySelector(
      '.travel-r1-word-card .eyebrow'
    )?.textContent?.trim() === ${JSON.stringify(`第 ${index + 1} 题`)} &&
    [...document.querySelectorAll(
      '.travel-r1-choice-list button[role="radio"]'
    )].every((button) => !button.disabled)`,
  )
}

async function selectCurrentAnswer(page, kind) {
  const question = await currentQuestion(page)
  assert.match(question.word ?? '', /^[a-z]+(?:-[a-z]+)?$/u)
  assert.equal(question.options.length, 4)
  assert.equal(new Set(question.options.map((option) => option.text)).size, 4)
  const correctMeaning = correctMeaningByWord.get(question.word)
  assert.ok(correctMeaning, `No independent answer oracle for ${question.word}.`)

  if (kind === 'uncertain') {
    const clicked = await page.evaluate(`(() => {
      const button = document.querySelector(
        '.travel-r1-choice-list .travel-r1-uncertain'
      )
      if (!button || button.disabled) return false
      button.click()
      return true
    })()`)
    assert.equal(clicked, true)
    await page.waitFor(
      `document.querySelector(
        '.travel-r1-choice-list .travel-r1-uncertain'
      )?.getAttribute('aria-checked') === 'true' &&
      !document.querySelector(
        '.travel-r1-choice-list .travel-r1-uncertain'
      )?.disabled`,
    )
    return { word: question.word, selected: 'uncertain' }
  }

  const label =
    kind === 'correct'
      ? correctMeaning
      : question.options.find(
          (option) => option.text !== correctMeaning,
        )?.text
  assert.ok(label)
  const clicked = await page.evaluate(`(() => {
    const label = ${JSON.stringify(label)}
    const button = [...document.querySelectorAll(
      '.travel-r1-choice-list button[role="radio"]:not(.travel-r1-uncertain)'
    )].find((candidate) => candidate.innerText.trim() === label)
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert.equal(clicked, true)
  await page.waitFor(
    `[...document.querySelectorAll(
      '.travel-r1-choice-list button[role="radio"]:not(.travel-r1-uncertain)'
    )].some((button) =>
      button.innerText.trim() === ${JSON.stringify(label)} &&
      button.getAttribute('aria-checked') === 'true' &&
      !button.disabled
    )`,
  )
  return { word: question.word, selected: label }
}

async function clearCurrentAnswer(page) {
  await page.clickByText('清除答案')
  await page.waitFor(
    `!document.querySelector('.travel-r1-clear-answer') &&
    [...document.querySelectorAll(
      '.travel-r1-choice-list button[role="radio"]'
    )].every((button) =>
      button.getAttribute('aria-checked') !== 'true' && !button.disabled
    )`,
  )
}

async function answerStageRange(
  page,
  correctCount,
  startIndex = 0,
  endIndex = 30,
) {
  for (let index = startIndex; index < endIndex; index += 1) {
    await goToQuestion(page, index)
    await page.evaluate(`globalThis.__qaAdvanceTime(1_000)`)
    await selectCurrentAnswer(
      page,
      index < correctCount ? 'correct' : 'uncertain',
    )
  }
}

async function reviewAndSubmitStage(
  page,
  stageIndex,
  isFinal = false,
) {
  await page.clickByText('检查并提交本阶段')
  await page.waitFor(
    `document.body.innerText.includes('提交前检查')`,
  )
  const submitState = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) =>
        candidate.innerText.trim() === '确认提交本阶段'
    )
    return button
      ? { disabled: button.disabled, label: button.getAttribute('aria-label') }
      : null
  })()`)
  assert.deepEqual(submitState, {
    disabled: false,
    label: '确认提交本阶段',
  })

  const rapidSubmit = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) =>
        candidate.innerText.trim() === '确认提交本阶段'
    )
    if (!button || button.disabled) return false
    button.click()
    button.click()
    return true
  })()`)
  assert.equal(rapidSubmit, true)
  if (isFinal) {
    await page.waitFor(
      `Boolean(document.querySelector('.travel-r1-screen--results'))`,
      20_000,
    )
    return
  }

  await page.waitFor(
    `Boolean(document.querySelector('.travel-r1-screen--stage-result')) &&
    document.querySelector('.travel-r1-stage-score strong')
      ?.textContent?.trim() === ${JSON.stringify(
        `${scorePattern[stageIndex]} / 30`,
      )}`,
    20_000,
  )
  const text = await page.bodyText()
  assert.match(text, new RegExp(expectedMastery[stageIndex], 'u'))
  assert.match(text, /没有满分门槛/u)
  assert.equal(
    await page.evaluate(
      `document.querySelectorAll('.travel-r1-choice-list').length`,
    ),
    0,
    'Submitted stage still exposed editable choices.',
  )
}

async function continueStage(page, expectedStageIndex) {
  const continued = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) =>
        candidate.innerText.trim() === '进入下一阶段'
    )
    if (!button || button.disabled) return false
    button.click()
    button.click()
    return true
  })()`)
  assert.equal(continued, true)
  await page.waitFor(
    `document.querySelector(
      '.training-topbar__title .eyebrow'
    )?.textContent?.trim() === ${JSON.stringify(
      `STAGE ${expectedStageIndex + 1} / 5`,
    )} &&
    document.querySelector(
      '.training-topbar__title h1'
    )?.textContent?.trim() === ${JSON.stringify(
      expectedStageLabels[expectedStageIndex],
    )} &&
    document.body.innerText.includes('第 1 / 30 题')`,
    20_000,
  )
}

async function putRecord(page, input) {
  const record = {
    id: `${input.namespace}\u0000${input.key}`,
    namespace: input.namespace,
    key: input.key,
    value: input.value,
    schemaVersion: input.schemaVersion,
    updatedAt: '2026-07-27T00:00:00.000Z',
  }
  await page.evaluate(`(async () => {
    const record = ${JSON.stringify(record)}
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('english-learning-pwa')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('records', 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.objectStore('records').put(record)
    })
    database.close()
  })()`)
}

async function runLegacyMigration(input) {
  const qa = await launchQaChrome()
  try {
    await qa.page.initialize()
    await qa.page.setViewport(390, 844)
    await qa.page.navigate(new URL('#/', baseUrl).href)
    await qa.page.waitFor(
      `document.body.innerText.includes('需要先完成水平测试')`,
    )
    await putRecord(qa.page, {
      namespace: assessmentNamespace,
      key: input.key,
      value: input.snapshot,
      schemaVersion: input.schemaVersion,
    })
    await qa.page.navigate(new URL('#/assessment', baseUrl).href)
    await waitForAssessmentReady(qa.page)
    const migrationText = await qa.page.bodyText()
    assert.match(
      migrationText,
      /需要重新开始新的旅游英语词汇测试/u,
    )
    assert.match(migrationText, new RegExp(input.sourceLabel, 'u'))
    assert.doesNotMatch(
      migrationText,
      /估算旅游英语词汇量|旅游英语词汇结果/u,
    )

    const beforeStart = await qa.page.dumpIndexedDb()
    const legacyRecord = recordByKey(beforeStart, input.key)
    assert.ok(legacyRecord)
    assert.equal(legacyRecord.schemaVersion, input.schemaVersion)
    assert.deepEqual(legacyRecord.value, input.snapshot)
    const migratedSnapshot = requireR1Snapshot(beforeStart)
    assert.equal(
      migratedSnapshot.migrationNotice,
      'legacy-measurement-incompatible-new-sample-required',
    )
    assert.equal(
      migratedSnapshot.legacySource?.kind,
      input.legacyKind,
    )

    await qa.page.clickByText('开始新的 R1 测试')
    await qa.page.waitFor(
      `document.body.innerText.includes('第 1 / 30 题')`,
    )
    const afterStart = await qa.page.dumpIndexedDb()
    assert.deepEqual(
      recordByKey(afterStart, input.key)?.value,
      input.snapshot,
      `${input.label} source record was rewritten.`,
    )
    return {
      label: input.label,
      sourceKey: input.key,
      sourceDigest: digest(input.snapshot),
      preserved: true,
      r1SampleCount: requireR1Snapshot(afterStart).session.stagePlans
        .flatMap((stage) => stage.questions).length,
    }
  } finally {
    await qa.close()
  }
}

async function runFreshR1() {
  const qa = await launchQaChrome()
  try {
    await qa.page.initialize()
    await qa.page.addInitScript(fakeAssessmentClockScript)
    await qa.page.setViewport(390, 844)
    await qa.page.navigate(new URL('#/', baseUrl).href)
    await qa.page.waitFor(
      `document.body.innerText.includes('需要先完成水平测试')`,
    )
    assert.doesNotMatch(await qa.page.bodyText(), /demoPlan|演示计划/u)
    await qa.page.clickByText('开始水平测试')
    await waitForAssessmentReady(qa.page)

    const introText = await qa.page.bodyText()
    assert.match(introText, /只测旅游英语单词/u)
    assert.match(introText, /分 5 个阶段/u)
    assert.match(introText, /30\s*词\s*\/\s*阶段/u)
    assert.match(introText, /约 150/u)
    assert.match(introText, /不设规定时长/u)
    assert.doesNotMatch(
      introText,
      /15.?20 分钟|听力测试|口语测试|语法题/u,
    )
    assert.equal(
      await qa.page.url(),
      new URL('#/assessment', baseUrl).href,
    )
    checkpoint('r1-fresh-intro', {
      url: await qa.page.url(),
      text: introText.slice(0, 1_500),
      interactive: await qa.page.interactiveElements(),
    })

    await qa.page.clickByText('开始测试')
    await qa.page.waitFor(
      `document.body.innerText.includes('第 1 / 30 题')`,
    )
    const firstQuestion = await currentQuestion(qa.page)
    assert.match(firstQuestion.word ?? '', /^[a-z]+(?:-[a-z]+)?$/u)
    assert.equal(firstQuestion.options.length, 4)
    assert.equal(firstQuestion.uncertain?.disabled, false)
    assert.doesNotMatch(
      await qa.page.bodyText(),
      /句子|听力|口语|语法|最长时长|限时/u,
    )

    const initialDatabases = await qa.page.dumpIndexedDb()
    const initialSnapshot = requireR1Snapshot(initialDatabases)
    const stagePlans = initialSnapshot.session.stagePlans
    assert.equal(stagePlans.length, 5)
    assert.deepEqual(
      stagePlans.map((stage) => stage.questions.length),
      [30, 30, 30, 30, 30],
    )
    const sampledWords = stagePlans.flatMap((stage) =>
      stage.questions.map((question) => question.wordId),
    )
    assert.equal(sampledWords.length, 150)
    assert.equal(new Set(sampledWords).size, 150)
    const snapshotJson = JSON.stringify(initialSnapshot)
    for (const forbidden of [
      'correctOptionId',
      'meaningZh',
      'scoring',
      'audioText',
      'sentence',
    ]) {
      assert.equal(
        snapshotJson.includes(forbidden),
        false,
        `R1 snapshot leaked ${forbidden}.`,
      )
    }
    const correctPositions = stagePlans.flatMap((stage) =>
      stage.questions.map((question) => {
        const meaning = correctMeaningByWord.get(question.word)
        return question.options.findIndex(
          (option) => option.text === meaning,
        )
      }),
    )
    assert.ok(
      new Set(correctPositions).size >= 4,
      'R1 option order did not vary across the 150 sampled questions.',
    )
    checkpoint('r1-sample-contract', {
      stages: stagePlans.map((stage) => ({
        id: stage.stageId,
        count: stage.questions.length,
      })),
      uniqueWordCount: new Set(sampledWords).size,
      correctOptionPositions: [...new Set(correctPositions)].sort(),
      sampleDigest: digest(stagePlans),
    })

    await goToQuestion(qa.page, 29)
    assert.equal((await currentQuestion(qa.page)).number, '第 30 题')
    await goToQuestion(qa.page, 0)
    await qa.page.clickByText('检查并提交本阶段')
    await qa.page.waitFor(
      `document.body.innerText.includes('提交前检查')`,
    )
    const incompleteText = await qa.page.bodyText()
    assert.match(incompleteText, /还有 30 题未作答/u)
    const incompleteSubmit = await qa.page.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(
        (candidate) =>
          candidate.innerText.trim() === '确认提交本阶段'
      )
      return button
        ? {
            disabled: button.disabled,
            label: button.getAttribute('aria-label'),
          }
        : null
    })()`)
    assert.equal(incompleteSubmit?.disabled, true)
    assert.match(
      incompleteSubmit?.label ?? '',
      /必须完成或标记全部 30 题/u,
    )
    await qa.page.clickByText('返回修改')
    await qa.page.waitFor(
      `document.body.innerText.includes('第 1 / 30 题')`,
    )

    const firstOptions = (await currentQuestion(qa.page)).options
    assert.equal(firstOptions.length, 4)
    await selectCurrentAnswer(qa.page, 'correct')
    const selectedCorrect = await currentQuestion(qa.page)
    assert.equal(
      selectedCorrect.options.filter((option) => option.checked).length,
      1,
    )
    await selectCurrentAnswer(qa.page, 'wrong')
    const selectedWrong = await currentQuestion(qa.page)
    assert.equal(
      selectedWrong.options.filter((option) => option.checked).length,
      1,
    )
    assert.notEqual(
      selectedCorrect.options.find((option) => option.checked)?.text,
      selectedWrong.options.find((option) => option.checked)?.text,
    )
    await selectCurrentAnswer(qa.page, 'uncertain')
    assert.equal((await currentQuestion(qa.page)).uncertain?.checked, true)
    await clearCurrentAnswer(qa.page)
    assert.equal(
      (await currentQuestion(qa.page)).options.some(
        (option) => option.checked,
      ),
      false,
    )
    checkpoint('r1-edit-navigation-and-incomplete-submit', {
      navigated: ['1', '30', '1'],
      changedChoice: true,
      markedUncertain: true,
      clearedAnswer: true,
      incompleteSubmitDisabled: true,
    })

    await answerStageRange(qa.page, scorePattern[0])
    await reviewAndSubmitStage(qa.page, 0)
    await continueStage(qa.page, 1)

    await answerStageRange(qa.page, scorePattern[1], 0, 3)
    const beforePauseQuestion = await currentQuestion(qa.page)
    const beforePauseDatabases = await qa.page.dumpIndexedDb()
    const beforePauseSnapshot = requireR1Snapshot(beforePauseDatabases)
    const fixedSampleDigest = digest(
      beforePauseSnapshot.session.stagePlans,
    )
    const fixedDraftDigest = digest(
      beforePauseSnapshot.session.draftAnswers,
    )
    await qa.page.clickByText('保存并退出')
    await qa.page.waitFor(
      `location.hash === '#/' &&
      document.body.innerText.includes('需要先完成水平测试')`,
    )
    const pausedSnapshot = requireR1Snapshot(
      await qa.page.dumpIndexedDb(),
    )
    const activeElapsedAtPause = pausedSnapshot.activeElapsedMs
    await qa.page.evaluate(`globalThis.__qaAdvanceTime(60_000)`)
    await qa.page.reload()
    await qa.page.waitFor(
      `document.body.innerText.includes('需要先完成水平测试')`,
    )
    await qa.page.clickByText('开始水平测试')
    await waitForAssessmentReady(qa.page)
    const resumeText = await qa.page.bodyText()
    assert.match(resumeText, /从上次位置继续/u)
    assert.match(resumeText, /原题和原选项顺序/u)

    const afterPauseSnapshot = requireR1Snapshot(
      await qa.page.dumpIndexedDb(),
    )
    assert.equal(
      digest(afterPauseSnapshot.session.stagePlans),
      fixedSampleDigest,
    )
    assert.equal(
      digest(afterPauseSnapshot.session.draftAnswers),
      fixedDraftDigest,
    )
    assert.equal(
      afterPauseSnapshot.activeElapsedMs,
      activeElapsedAtPause,
      'Paused wall time was added to active assessment time.',
    )

    const swUpdate = await qa.page.evaluate(`(async () => {
      const registration = await navigator.serviceWorker.ready
      await registration.update()
      return {
        controller: navigator.serviceWorker.controller?.scriptURL ?? null,
        active: registration.active?.scriptURL ?? null,
      }
    })()`)
    await qa.page.reload()
    await waitForAssessmentReady(qa.page)
    assert.equal(
      digest(
        requireR1Snapshot(
          await qa.page.dumpIndexedDb(),
        ).session.stagePlans,
      ),
      fixedSampleDigest,
      'Service Worker update/reload replaced the R1 sample.',
    )

    await qa.page.setOffline(true)
    await qa.page.reload()
    await waitForAssessmentReady(qa.page)
    assert.match(await qa.page.bodyText(), /从上次位置继续/u)
    const offlineSnapshot = requireR1Snapshot(
      await qa.page.dumpIndexedDb(),
    )
    assert.equal(
      digest(offlineSnapshot.session.stagePlans),
      fixedSampleDigest,
    )
    assert.equal(
      digest(offlineSnapshot.session.draftAnswers),
      fixedDraftDigest,
    )
    assert.equal(
      offlineSnapshot.activeElapsedMs,
      activeElapsedAtPause,
    )
    await qa.page.setOffline(false)
    await qa.page.clickByText('继续原测试')
    await qa.page.waitFor(
      `document.body.innerText.includes(${JSON.stringify(
        beforePauseQuestion.number,
      )})`,
    )
    const afterResumeQuestion = await currentQuestion(qa.page)
    assert.deepEqual(afterResumeQuestion, beforePauseQuestion)
    checkpoint('r1-refresh-offline-sw-recovery', {
      sampleDigest: fixedSampleDigest,
      draftDigest: fixedDraftDigest,
      activeElapsedAtPause,
      activeElapsedAfterOffline: offlineSnapshot.activeElapsedMs,
      restoredQuestion: afterResumeQuestion.number,
      swUpdate,
    })

    await answerStageRange(qa.page, scorePattern[1], 3)
    await reviewAndSubmitStage(qa.page, 1)
    await continueStage(qa.page, 2)
    await answerStageRange(qa.page, scorePattern[2])
    await reviewAndSubmitStage(qa.page, 2)
    await continueStage(qa.page, 3)
    await answerStageRange(qa.page, scorePattern[3])
    await reviewAndSubmitStage(qa.page, 3)
    await continueStage(qa.page, 4)
    await answerStageRange(qa.page, scorePattern[4])
    await reviewAndSubmitStage(qa.page, 4, true)

    const resultsText = await qa.page.bodyText()
    for (const expected of [
      '估算旅游英语词汇量',
      '合理区间',
      '五阶段明细',
      '150 题',
      '有效时间',
      '听力',
      '口语',
      '待校准',
      '不是学校学历',
      'CET-4 / CET-6',
    ]) {
      assert.match(resultsText, new RegExp(expected, 'u'))
    }
    for (const [stageIndex, correct] of scorePattern.entries()) {
      assert.match(
        resultsText,
        new RegExp(
          `${expectedStageLabels[stageIndex]}[\\s\\S]{0,300}${correct} / 30`,
          'u',
        ),
      )
    }

    const completedDatabases = await qa.page.dumpIndexedDb()
    const profileRecord = recordByKey(
      completedDatabases,
      latestProfileKey,
    )
    assert.ok(profileRecord)
    assert.equal(profileRecord.schemaVersion, 3)
    const profile = profileRecord.value
    assert.equal(profile.schemaVersion, 3)
    assert.equal(
      profile.assessmentKind,
      'staged-travel-vocabulary',
    )
    assert.equal(profile.travelVocabulary.validQuestionCount, 150)
    assert.deepEqual(
      profile.travelVocabulary.stageResults.map(
        (stage) => stage.correctCount,
      ),
      scorePattern,
    )
    assert.deepEqual(
      profile.travelVocabulary.stageResults.map(
        (stage) => stage.masteryRate,
      ),
      [0, 0.2, 0.5, 1, 0],
    )
    assert.equal(profile.travelVocabulary.estimatedWords, 1_230)
    assert.equal(profile.resultLevel.label, '初中一年级')
    assert.equal(profile.sampledWordIds.length, 150)
    assert.equal(new Set(profile.sampledWordIds).size, 150)
    assert.equal(
      profile.abilities.vocabulary.calibrationState,
      'estimated',
    )
    for (const domain of ['listening', 'speaking']) {
      assert.deepEqual(
        {
          status: profile.abilities[domain].status,
          calibrationState:
            profile.abilities[domain].calibrationState,
          internalLevel: profile.abilities[domain].internalLevel,
          cefrEstimate: profile.abilities[domain].cefrEstimate,
          confidence: profile.abilities[domain].confidence,
        },
        {
          status: 'unavailable',
          calibrationState: 'pending-calibration',
          internalLevel: null,
          cefrEstimate: 'unknown',
          confidence: 0,
        },
      )
    }

    const activePlanRecord = allRecords(completedDatabases).find(
      (record) => record.key === 'active-plan',
    )
    assert.ok(activePlanRecord)
    const activePlan = activePlanRecord.value?.activePlan
    assert.ok(activePlan)
    assert.equal(activePlan.plan.targetSeconds, 2_700)
    assert.ok(activePlan.plan.tasks.length > 0)
    assert.equal(
      activePlan.plan.tasks.some(
        (task) => task.mode === 'calibration',
      ),
      false,
    )
    const serializedPlan = JSON.stringify(activePlan)
    assert.doesNotMatch(
      serializedPlan,
      /forced-calibration|强制校准|calibration-task/u,
    )
    const engineState = allRecords(completedDatabases).find(
      (record) =>
        record.namespace === 'learning.engine' &&
        record.key === 'current-state',
    )?.value
    assert.ok(engineState)
    assert.deepEqual(
      engineState.progress.r1VocabularyStartPlacement,
      {
        kind: 'r1-conservative-travel-vocabulary',
        mappingVersion: 'learning-r1-first-day-start-v1',
        resultLevelId: 'junior-1',
        resultLevelOrdinal: 7,
        resultLevelMinimumEstimatedWords: 1_100,
        estimatedWords: 1_230,
        reasonableInterval: { lower: 800, upper: 1_490 },
        intervalLowerLevel: 3,
        pointEstimateLevel: 4.5,
        resultLevelFloor: 4,
        selectedStartLevel: 3,
      },
    )
    assert.equal(
      engineState.progress.domains.listening
        .pendingCalibrationPolicy,
      'normal-training',
    )
    assert.equal(
      engineState.progress.domains.speaking
        .pendingCalibrationPolicy,
      'normal-training',
    )
    assert.equal(
      engineState.progress.domains.listening.baselineLevel,
      2.5,
    )
    assert.equal(
      engineState.progress.domains.speaking.baselineLevel,
      2.5,
    )
    assert.match(resultsText, /初中一年级/u)

    const swSnapshot = await qa.page.serviceWorkerSnapshot()
    assert.equal(swSnapshot.supported, true)
    assert.match(swSnapshot.controller ?? '', /\/sw\.js$/u)
    const cachedUrls = swSnapshot.caches.flatMap(
      (cache) => cache.urls,
    )
    assert.ok(
      cachedUrls.some((url) => url.endsWith(`/assets/${expectedAsset}`)),
      'The deployed R1 asset is missing from PWA precache.',
    )
    checkpoint('r1-completed-profile-and-plan', {
      stageCorrectCounts: scorePattern,
      masteryRates:
        profile.travelVocabulary.stageResults.map(
          (stage) => stage.masteryRate,
        ),
      estimatedWords: profile.travelVocabulary.estimatedWords,
      reasonableInterval:
        profile.travelVocabulary.reasonableInterval,
      level: profile.resultLevel.label,
      durationSeconds: profile.durationSeconds,
      profileSchemaVersion: profile.schemaVersion,
      listeningCalibration:
        profile.abilities.listening.calibrationState,
      speakingCalibration:
        profile.abilities.speaking.calibrationState,
      planTargetSeconds: activePlan.plan.targetSeconds,
      planTaskCount: activePlan.plan.tasks.length,
      swController: swSnapshot.controller,
      cachedR1Asset: true,
    })

    const previousSample = [...profile.sampledWordIds]
    const corrupt = {
      schemaVersion: 3,
      assessmentKind: 'staged-travel-vocabulary',
      broken: true,
      marker: 'qa-r1-corrupt-preservation',
    }
    await putRecord(qa.page, {
      namespace: assessmentNamespace,
      key: TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
      value: corrupt,
      schemaVersion: 3,
    })
    await qa.page.reload()
    await waitForAssessmentReady(qa.page)
    const corruptText = await qa.page.bodyText()
    assert.match(corruptText, /R1 水平测试暂时无法继续/u)
    assert.match(corruptText, /原始数据仍保留在本机/u)
    await qa.page.clickByText('保留原记录并重新抽题')
    await qa.page.waitFor(
      `document.body.innerText.includes('旅游英语词汇测试') &&
      document.body.innerText.includes('分 5 个阶段')`,
    )
    const recoveredDatabases = await qa.page.dumpIndexedDb()
    const recoveredSnapshot = requireR1Snapshot(recoveredDatabases)
    const newSample = recoveredSnapshot.session.stagePlans.flatMap(
      (stage) =>
        stage.questions.map((question) => question.wordId),
    )
    assert.equal(newSample.length, 150)
    assert.equal(new Set(newSample).size, 150)
    assert.equal(
      newSample.filter((wordId) => previousSample.includes(wordId))
        .length,
      0,
      'Fresh R1 recovery did not avoid the immediately previous sample.',
    )
    const backupRecord = allRecords(recoveredDatabases).find(
      (record) =>
        record.namespace === assessmentNamespace &&
        record.key.startsWith(`${corruptBackupPrefix}:`),
    )
    assert.ok(backupRecord, 'The corrupt R1 record was not archived.')
    assert.deepEqual(backupRecord.value, corrupt)
    assert.deepEqual(
      recordByKey(recoveredDatabases, latestProfileKey)?.value,
      profile,
      'Corrupt recovery rewrote the completed R1 profile.',
    )
    checkpoint('r1-corrupt-backup-and-retest-sample', {
      previousSampleDigest: digest(previousSample),
      newSampleDigest: digest(newSample),
      overlap: 0,
      backupKey: backupRecord.key,
      backupDigest: digest(backupRecord.value),
      completedProfilePreserved: true,
    })

    return {
      profileSchemaVersion: profile.schemaVersion,
      estimatedWords: profile.travelVocabulary.estimatedWords,
      level: profile.resultLevel.label,
      planTargetSeconds: activePlan.plan.targetSeconds,
      sampleDigest: digest(stagePlans),
      pageErrors: qa.page.pageErrors,
      consoleMessages: qa.page.consoleMessages,
      requests: qa.page.requests,
    }
  } finally {
    await qa.close()
  }
}

try {
  await httpEvidence()
  const legacyNow = () => '2026-07-27T00:00:00.000Z'
  const legacyV1 = createPlacementAssessmentRuntime({
    now: legacyNow,
    createId: () => 'qa-legacy-v1',
  }).toSnapshot()
  const legacyV2 = createVocabularyPlacementRuntime({
    now: legacyNow,
    createId: () => 'qa-legacy-v2',
  }).toSnapshot()

  const migrations = []
  migrations.push(
    await runLegacyMigration({
      label: 'v1',
      key: ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
      snapshot: legacyV1,
      schemaVersion: 1,
      sourceLabel: '旧版综合水平测试',
      legacyKind: 'assessment-runtime-v1',
    }),
  )
  migrations.push(
    await runLegacyMigration({
      label: 'v2',
      key: VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
      snapshot: legacyV2,
      schemaVersion: 2,
      sourceLabel: '旧版逐题自适应词汇测试',
      legacyKind: 'adaptive-vocabulary-runtime-v2',
    }),
  )
  checkpoint('r1-legacy-migrations', { migrations })

  const fresh = await runFreshR1()
  assert.deepEqual(fresh.pageErrors, [])
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        ...evidence,
        fresh: {
          profileSchemaVersion: fresh.profileSchemaVersion,
          estimatedWords: fresh.estimatedWords,
          level: fresh.level,
          planTargetSeconds: fresh.planTargetSeconds,
          sampleDigest: fresh.sampleDigest,
          requestCount: fresh.requests.length,
        },
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status: 'failed',
        error: String(error),
        ...evidence,
      },
      null,
      2,
    ),
  )
  throw error
}
