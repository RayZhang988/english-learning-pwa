import assert from 'node:assert/strict'
import {
  fakeAssessmentClockScript,
  launchQaChrome,
} from './lib/cdp-browser.mjs'

const baseUrl = new URL(
  process.env.QA_BASE_URL ??
    'https://rayzhang988.github.io/english-learning-pwa/',
)
const expectedAsset =
  process.env.QA_EXPECTED_ASSET ?? 'index-yjGhjGzs.js'
const expectedPagesRun =
  process.env.QA_PAGES_RUN ?? '30345631519'
const expectedHeadSha =
  process.env.QA_EXPECTED_HEAD_SHA ??
  'ac915a39a3adb0e7fa6888ff2383d7787f0604cc'
const rolloverOnly = process.env.QA_ROLLOVER_ONLY === '1'
const sameDayUpgradeOnly =
  process.env.QA_SAME_DAY_UPGRADE_ONLY === '1'
const modules = ['vocabulary', 'listening', 'speaking']
const evidence = {
  baseUrl: baseUrl.href,
  expectedAsset,
  expectedPagesRun,
  expectedHeadSha,
  isolatedProfiles: true,
  userDeviceDataTouched: false,
  checkpoints: [],
}

function checkpoint(name, details = {}) {
  evidence.checkpoints.push({ name, ...details })
}

function allRecords(databases) {
  return databases.flatMap(
    (database) => database.stores.records ?? [],
  )
}

function recordByNamespaceAndKey(databases, namespace, key) {
  return allRecords(databases).find(
    (record) =>
      record.namespace === namespace && record.key === key,
  )
}

function activeRuntime(databases) {
  const record = recordByNamespaceAndKey(
    databases,
    'app.learning-runtime',
    'active-plan',
  )
  assert.ok(record, 'The production active-plan record is missing.')
  assert.equal(record.schemaVersion, 1)
  assert.equal(record.value?.schemaVersion, 1)
  assert.equal(record.value?.activePlan?.schemaVersion, 1)
  return record.value
}

function executionFor(runtime, moduleId) {
  const execution = runtime.activePlan.tasks.find(
    (candidate) =>
      candidate.task.targetModuleId === moduleId,
  )
  assert.ok(execution, `The ${moduleId} execution is missing.`)
  return execution
}

function taskIdsByModule(runtime) {
  const entries = runtime.activePlan.plan.tasks.map((task) => [
    task.targetModuleId,
    task.taskId,
  ])
  assert.deepEqual(
    entries.map(([moduleId]) => moduleId).sort(),
    modules.slice().sort(),
  )
  return Object.fromEntries(entries)
}

function assertLegacyShape(runtime) {
  assert.equal(runtime.activePlan.plan.targetSeconds, 2_700)
  assert.equal(runtime.activePlan.plan.plannedSeconds, 515)
  assert.equal(
    runtime.activePlan.plan.tasks.every(
      (task) => !Object.hasOwn(task, 'trainingBudget'),
    ),
    true,
    'The seeded user-equivalent plan unexpectedly has trainingBudget.',
  )
  assert.equal(
    runtime.activePlan.tasks.every(
      (execution) =>
        !Object.hasOwn(execution.task, 'trainingBudget'),
    ),
    true,
    'A legacy execution task unexpectedly has trainingBudget.',
  )
  assert.equal(
    runtime.activePlan.tasks.every(
      (execution) => !Object.hasOwn(execution, 'training'),
    ),
    true,
    'A legacy execution persisted the non-portable training property.',
  )
}

function assertVocabularyPreserved(runtime, expected) {
  assert.deepEqual(
    executionFor(runtime, 'vocabulary'),
    expected,
    'Listening or speaking changed the completed 12-second vocabulary record.',
  )
}

function assertNoPortableError(text, pageErrors) {
  assert.doesNotMatch(
    text,
    /JSON-portable|not JSON-portable|暂时无法继续/u,
  )
  assert.equal(
    pageErrors.some((error) =>
      /JSON-portable|not JSON-portable/u.test(error),
    ),
    false,
    `The production page threw a JSON-portable error: ${pageErrors.join('\n')}`,
  )
}

function controlledSpeechSynthesisScript() {
  return `(() => {
    const probe = {
      utterances: [],
      autoFinish: false,
      finishCount: 0,
      pauseCount: 0,
      resumeCount: 0,
      cancelCount: 0,
    }
    let active = null
    let generation = 0
    let paused = false
    let speaking = false

    class QaSpeechSynthesisUtterance {
      constructor(text) {
        this.text = String(text)
        this.lang = ''
        this.rate = 1
        this.pitch = 1
        this.voice = null
        this.onstart = null
        this.onend = null
        this.onpause = null
        this.onresume = null
        this.onerror = null
      }
    }

    const finish = () => {
      if (!active || paused) return false
      const utterance = active
      active = null
      speaking = false
      probe.finishCount += 1
      utterance.onend?.()
      return true
    }
    const synthesis = {
      get paused() {
        return paused
      },
      get speaking() {
        return speaking
      },
      getVoices() {
        return []
      },
      speak(utterance) {
        const token = ++generation
        active = utterance
        paused = false
        speaking = true
        probe.utterances.push({
          text: utterance.text,
          lang: utterance.lang,
          rate: utterance.rate,
          pitch: utterance.pitch,
          voiceId: null,
        })
        queueMicrotask(() => {
          if (token === generation && active === utterance) {
            utterance.onstart?.()
            if (probe.autoFinish) {
              queueMicrotask(() => finish())
            }
          }
        })
      },
      pause() {
        if (!speaking || paused) return
        paused = true
        probe.pauseCount += 1
        active?.onpause?.()
      },
      resume() {
        if (!speaking || !paused) return
        paused = false
        probe.resumeCount += 1
        active?.onresume?.()
      },
      cancel() {
        generation += 1
        active = null
        paused = false
        speaking = false
        probe.cancelCount += 1
      },
    }

    Object.defineProperty(globalThis, '__qaSpeechSynthesisProbe', {
      configurable: true,
      value: probe,
    })
    Object.defineProperty(globalThis, '__qaFinishSpeech', {
      configurable: true,
      value: finish,
    })
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: QaSpeechSynthesisUtterance,
      writable: true,
    })
    Object.defineProperty(globalThis, 'speechSynthesis', {
      configurable: true,
      value: synthesis,
    })
  })()`
}

const disableRecognitionScript = `(() => {
  for (const key of ['SpeechRecognition', 'webkitSpeechRecognition']) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: undefined,
      writable: true,
    })
  }
})()`

async function prepareBrowser() {
  const qa = await launchQaChrome()
  await qa.page.initialize()
  await qa.page.addInitScript(fakeAssessmentClockScript)
  await qa.page.addInitScript(controlledSpeechSynthesisScript())
  await qa.page.addInitScript(disableRecognitionScript)
  await qa.page.setViewport(390, 844)
  return qa
}

async function putRecords(page, records) {
  await page.evaluate(`(async () => {
    const records = ${JSON.stringify(records)}
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('english-learning-pwa')
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

async function storedUndefinedPaths(page) {
  return page.evaluate(`(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('english-learning-pwa')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const records = await new Promise((resolve, reject) => {
      const request = database
        .transaction('records', 'readonly')
        .objectStore('records')
        .getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()
    const record = records.find(
      (candidate) =>
        candidate.namespace === 'app.learning-runtime' &&
        candidate.key === 'active-plan'
    )
    if (!record) return ['__missing_active_plan_record__']
    const paths = []
    const seen = new WeakSet()
    const visit = (value, path) => {
      if (value === undefined) {
        paths.push(path)
        return
      }
      if (value === null || typeof value !== 'object') return
      if (seen.has(value)) return
      seen.add(value)
      for (const key of Object.keys(value)) {
        visit(value[key], path ? path + '.' + key : key)
      }
    }
    visit(record, 'record')
    return paths
  })()`)
}

async function waitForHome(page) {
  await page.waitFor(
    `location.hash === '#/' &&
      !document.body.innerText.includes('正在恢复今日学习计划')`,
    20_000,
  )
}

async function createProductionPlanRecords() {
  const qa = await prepareBrowser()
  try {
    await qa.page.navigate(new URL('#/assessment', baseUrl).href)
    await qa.page.waitFor(
      `!document.body.innerText.includes(
        '正在读取本机 R1 旅游英语词汇测试'
      )`,
      20_000,
    )
    assert.match(await qa.page.bodyText(), /5 个阶段|每阶段 30 题/u)
    await qa.page.clickByText('开始测试')
    await qa.page.waitFor(
      `document.body.innerText.includes('第 1 / 30 题')`,
      20_000,
    )
    await qa.page.clickFirstEnabledChoice()
    await qa.page.waitFor(
      `[...document.querySelectorAll('button')].some((button) =>
        button.innerText.trim() === '检查并提交本阶段' &&
        !button.disabled
      )`,
      20_000,
    )
    await qa.page.clickByText('检查并提交本阶段')
    await qa.page.waitFor(
      `Boolean(document.querySelector('.travel-r1-screen--review'))`,
    )
    await qa.page.clickByText('剩余全部不会，结束测试')
    await qa.page.waitFor(
      `Boolean(document.querySelector(
        '.travel-r1-screen--finish-confirmation'
      ))`,
    )
    await qa.page.clickByText('确认剩余全部不会并结束')
    await qa.page.waitFor(
      `Boolean(document.querySelector('.travel-r1-screen--results'))`,
      20_000,
    )
    await qa.page.clickByText('进入今日计划')
    await waitForHome(qa.page)

    const databases = await qa.page.dumpIndexedDb()
    const runtime = activeRuntime(databases)
    assert.equal(runtime.activePlan.plan.targetSeconds, 2_700)
    assert.equal(runtime.activePlan.plan.plannedSeconds, 515)
    assert.equal(
      runtime.activePlan.plan.tasks.every(
        (task) => task.trainingBudget?.targetEffectiveSeconds === 900,
      ),
      true,
    )

    const requiredRecords = allRecords(databases).filter(
      (record) =>
        (record.namespace === 'feature.assessment' &&
          record.key === 'latest-ability-profile') ||
        (record.namespace === 'learning.engine' &&
          record.key === 'current-state') ||
        (record.namespace === 'app.learning-runtime' &&
          record.key === 'active-plan'),
    )
    assert.equal(requiredRecords.length, 3)
    return requiredRecords
  } finally {
    await qa.close()
  }
}

function asUserEquivalentLegacyRecords(records) {
  const copied = structuredClone(records)
  const activePlanRecord = copied.find(
    (record) =>
      record.namespace === 'app.learning-runtime' &&
      record.key === 'active-plan',
  )
  assert.ok(activePlanRecord)
  const runtime = activePlanRecord.value
  const now = '2026-07-24T08:00:12.000Z'

  for (const task of runtime.activePlan.plan.tasks) {
    delete task.trainingBudget
  }
  for (const execution of runtime.activePlan.tasks) {
    delete execution.task.trainingBudget
    delete execution.training
  }

  const vocabulary = executionFor(runtime, 'vocabulary')
  Object.assign(vocabulary, {
    status: 'completed',
    completionKind: 'scored',
    spentSeconds: 12,
    effectiveSeconds: 12,
    timingSegmentCount: 0,
    excludedSeconds: 0,
    effectiveTimeSource: 'legacy-event-duration',
    startedAt: '2026-07-24T08:00:00.000Z',
    updatedAt: now,
  })
  runtime.activePlan.status = 'in-progress'
  runtime.activePlan.processedEventIds = [
    'qa-013:user-vocabulary-attempt',
  ]
  runtime.activePlan.updatedAt = now
  runtime.completedLearningUnitIds = [
    vocabulary.task.learningUnitId,
  ]
  runtime.processedEventIds = [
    'qa-013:user-vocabulary-attempt',
  ]
  runtime.skipHistory = []
  assertLegacyShape(runtime)
  return copied
}

async function seedLegacyRecords(page, records) {
  await page.navigate(new URL('#/', baseUrl).href)
  await page.waitFor(`document.readyState === 'complete'`)
  await putRecords(page, records)
  await page.reload()
  await waitForHome(page)
}

async function clickModule(page, moduleId) {
  if (!(await page.bodyText()).includes('选择训练')) {
    const text = await page.bodyText()
    assertNoPortableError(text, page.pageErrors)
    if (text.includes('重新加载')) {
      throw new Error(
        `Home route failed after training: ${text}\n${page.pageErrors.join('\n')}`,
      )
    }
    await page.clickByText('训练')
  }
  await page.waitFor(
    `document.body.innerText.includes('选择训练')`,
    20_000,
  )
  const result = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll(
      'button.module-card'
    )].find(
      (candidate) =>
        candidate.dataset.moduleId === ${JSON.stringify(moduleId)}
    )
    if (!button) return { clicked: false, reason: 'missing' }
    if (button.disabled) {
      return {
        clicked: false,
        reason: 'disabled',
        text: button.innerText.trim(),
      }
    }
    button.click()
    return {
      clicked: true,
      taskId: button.dataset.taskId ?? null,
    }
  })()`)
  assert.equal(
    result.clicked,
    true,
    `Could not start ${moduleId}: ${JSON.stringify(result)}`,
  )
  await page.waitFor(
    `location.hash.includes(${JSON.stringify(`/${moduleId}?taskId=`)}) &&
      !document.body.innerText.includes('正在加载')`,
    20_000,
  )
  return result.taskId
}

async function assertCheckpointAfterRefresh(
  qa,
  moduleId,
  vocabularySnapshot,
  taskId,
) {
  const beforeText = await qa.page.bodyText()
  assertNoPortableError(beforeText, qa.page.pageErrors)
  assert.deepEqual(
    await storedUndefinedPaths(qa.page),
    [],
    `${moduleId} wrote undefined into the active-plan record.`,
  )
  const before = activeRuntime(await qa.page.dumpIndexedDb())
  assertLegacyShape(before)
  assertVocabularyPreserved(before, vocabularySnapshot)
  assert.equal(executionFor(before, moduleId).task.taskId, taskId)
  const beforeExecution = structuredClone(executionFor(before, moduleId))

  await qa.page.reload()
  await qa.page.waitFor(
    `location.hash.includes(${JSON.stringify(`/${moduleId}?taskId=`)}) &&
      !document.body.innerText.includes('正在加载')`,
    20_000,
  )
  const afterText = await qa.page.bodyText()
  assertNoPortableError(afterText, qa.page.pageErrors)
  assert.deepEqual(await storedUndefinedPaths(qa.page), [])
  const after = activeRuntime(await qa.page.dumpIndexedDb())
  assertLegacyShape(after)
  assertVocabularyPreserved(after, vocabularySnapshot)
  assert.deepEqual(
    executionFor(after, moduleId),
    beforeExecution,
    `${moduleId} changed after a production refresh.`,
  )
  return after
}

async function waitForStoredExecution(
  page,
  moduleId,
  predicate,
  label,
  timeout = 20_000,
) {
  const deadline = Date.now() + timeout
  let lastExecution = null
  while (Date.now() < deadline) {
    const runtime = activeRuntime(await page.dumpIndexedDb())
    lastExecution = executionFor(runtime, moduleId)
    if (predicate(lastExecution)) return lastExecution
    await page.evaluate(
      `new Promise((resolve) => setTimeout(resolve, 100))`,
    )
  }
  throw new Error(
    `${label} was not durably persisted. Last execution: ${JSON.stringify(
      lastExecution,
    )}`,
  )
}

function listeningSession(databases) {
  const record = allRecords(databases).find(
    (candidate) => candidate.namespace === 'feature.listening',
  )
  assert.ok(record, 'The production listening session is missing.')
  return record.value
}

async function waitForStoredListeningSession(
  page,
  predicate,
  label,
  timeout = 20_000,
) {
  const deadline = Date.now() + timeout
  let lastSession = null
  while (Date.now() < deadline) {
    lastSession = listeningSession(await page.dumpIndexedDb())
    if (predicate(lastSession)) return lastSession
    await page.evaluate(
      `new Promise((resolve) => setTimeout(resolve, 100))`,
    )
  }
  throw new Error(
    `${label} was not durably persisted. Last session: ${JSON.stringify(
      lastSession,
    )}`,
  )
}

async function playCurrentListening(page, seconds) {
  const alreadyPlaying = await page.evaluate(
    `globalThis.speechSynthesis?.speaking === true`,
  )
  if (!alreadyPlaying) {
    await page.clickByText('播放音频')
  }
  await page.waitFor(`globalThis.speechSynthesis?.speaking === true`)
  await page.evaluate(
    `new Promise((resolve) => setTimeout(
      resolve,
      ${seconds * 1_000 + 200}
    ))`,
  )
  await page.evaluate(
    `globalThis.__qaAdvanceTime(${seconds * 1_000})`,
  )
  assert.equal(
    await page.evaluate(`globalThis.__qaFinishSpeech()`),
    true,
  )
  await page.waitFor(
    `document.body.innerText.includes('播放完毕')`,
    20_000,
  )
}

async function answerCurrentListening(page) {
  const listeningInteractive = await page.interactiveElements()
  const hasChoice = listeningInteractive.some(
    (element) =>
      element.className?.includes('choice-row') &&
      !element.disabled,
  )
  if (hasChoice) {
    await page.clickFirstEnabledChoice()
  } else {
    const focused = await page.evaluate(`(() => {
      const input = document.querySelector(
        'input[type="text"], textarea'
      )
      if (!input || input.disabled) return false
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
      return true
    })()`)
    assert.equal(focused, true)
    await page.insertText('hello')
  }
  try {
    await page.waitFor(
      `[...document.querySelectorAll('button')].some((button) =>
        button.innerText.trim() === '提交答案' && !button.disabled
      )`,
    )
  } catch (error) {
    const databases = await page.dumpIndexedDb()
    const session = allRecords(databases).find(
      (record) => record.namespace === 'feature.listening',
    )?.value
    const dom = await page.evaluate(`(() => ({
      url: location.href,
      inputs: [...document.querySelectorAll('input, textarea')].map(
        (input) => ({
          tag: input.tagName.toLowerCase(),
          type: input.getAttribute('type'),
          value: input.value,
          disabled: Boolean(input.disabled),
          ariaDisabled: input.getAttribute('aria-disabled'),
          name: input.getAttribute('name'),
          className:
            typeof input.className === 'string' ? input.className : null,
        })
      ),
      choiceRows: [...document.querySelectorAll('.choice-row')].map(
        (choice) => ({
          text: choice.innerText.trim(),
          disabled: Boolean(choice.disabled),
          ariaDisabled: choice.getAttribute('aria-disabled'),
          pressed: choice.getAttribute('aria-pressed'),
          checked: choice.getAttribute('aria-checked'),
        })
      ),
      buttons: [...document.querySelectorAll('button')].map(
        (button) => ({
          text: button.innerText.trim(),
          disabled: Boolean(button.disabled),
          className:
            typeof button.className === 'string'
              ? button.className
              : null,
        })
      ),
      bodyText: document.body.innerText.slice(0, 3000),
    }))()`)
    throw new Error(
      `Listening submit did not unlock: ${JSON.stringify({
        originalError: String(error),
        session: session
          ? {
              phase: session.phase,
              questionIndex: session.questionIndex,
              activeQuestion:
                session.questions?.[session.questionIndex] ?? null,
              dictationInput: session.dictationInput ?? null,
            }
          : null,
        dom,
      })}`,
    )
  }
  await page.clickByText('提交答案')
  await page.waitFor(
    `[...document.querySelectorAll('button')].some((button) =>
      ['下一题', '完成训练'].includes(button.innerText.trim()) &&
      !button.disabled
    )`,
    20_000,
  )
  return page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) =>
        ['下一题', '完成训练'].includes(candidate.innerText.trim()) &&
        !candidate.disabled
    )
    return button?.innerText.trim() ?? null
  })()`)
}

async function completeListeningAfterFirstPlayback(page) {
  await page.evaluate(
    `globalThis.__qaSpeechSynthesisProbe.autoFinish = true`,
  )
  for (let question = 0; question < 12; question += 1) {
    const beforeAnswer = listeningSession(
      await page.dumpIndexedDb(),
    )
    const action = await answerCurrentListening(page)
    assert.ok(action)
    await page.clickByText(action)
    if (action === '完成训练') break
    const expectedIndex = beforeAnswer.questionIndex + 1
    const nextSession = await waitForStoredListeningSession(
      page,
      (session) =>
        session.questionIndex === expectedIndex &&
        session.phase === 'answering',
      `Listening question ${expectedIndex + 1}`,
    )
    const primarySegmentId =
      nextSession.questions[expectedIndex].primarySegmentId
    await page.clickByText('播放音频')
    await waitForStoredListeningSession(
      page,
      (session) =>
        session.questionIndex === expectedIndex &&
        (session.playback.playCounts[primarySegmentId] ?? 0) > 0,
      `Listening playback for question ${expectedIndex + 1}`,
    )
    await page.waitFor(
      `/已播放 [1-9][0-9]* 次/u.test(document.body.innerText)`,
      20_000,
    )
  }
  await page.waitFor(
    `document.body.innerText.includes('听力任务已完成')`,
    20_000,
  )
}

async function recordCurrentSpeaking(page, seconds) {
  await page.clickByText('开始录音')
  await page.waitFor(
    `document.body.innerText.includes('正在录音')`,
    20_000,
  )
  await page.evaluate(
    `new Promise((resolve) => setTimeout(
      resolve,
      ${seconds * 1_000 + 200}
    ))`,
  )
  await page.evaluate(
    `globalThis.__qaAdvanceTime(${seconds * 1_000})`,
  )
  await page.clickByText('停止录音')
  await page.waitFor(
    `[...document.querySelectorAll('button')].some((button) =>
      ['下一题', '完成训练'].includes(button.innerText.trim()) &&
      !button.disabled
    )`,
    20_000,
  )
}

async function completeRemainingSpeaking(page) {
  for (let prompt = 0; prompt < 3; prompt += 1) {
    const action = await page.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(
        (candidate) =>
          ['下一题', '完成训练'].includes(candidate.innerText.trim()) &&
          !candidate.disabled
      )
      return button?.innerText.trim() ?? null
    })()`)
    assert.ok(action)
    await page.clickByText(action)
    if (action === '完成训练') break
    await page.waitFor(
      `[...document.querySelectorAll('button')].some((button) =>
        (button.innerText.trim() === '开始录音' ||
          button.getAttribute('aria-label') === '开始录音') &&
        !button.disabled
      )`,
      20_000,
    )
    await recordCurrentSpeaking(page, 3)
  }
  await page.waitFor(
    `document.body.innerText.includes('口语练习已结束')`,
    20_000,
  )
}

async function releaseEvidence() {
  const indexResponse = await fetch(baseUrl)
  assert.equal(indexResponse.status, 200)
  const html = await indexResponse.text()
  const assetMatch = html.match(
    /assets\/(index-[A-Za-z0-9_-]+\.js)/u,
  )
  assert.ok(assetMatch, 'The production index asset was not found.')
  assert.equal(assetMatch[1], expectedAsset)

  const resources = {}
  for (const relative of [
    'manifest.webmanifest',
    'sw.js',
    `assets/${expectedAsset}`,
  ]) {
    const response = await fetch(new URL(relative, baseUrl))
    resources[relative] = response.status
    assert.equal(response.status, 200, `${relative} did not return 200.`)
  }

  const runResponse = await fetch(
    `https://api.github.com/repos/rayzhang988/english-learning-pwa/actions/runs/${expectedPagesRun}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'english-learning-pwa-qa-013',
      },
    },
  )
  assert.equal(runResponse.status, 200)
  const run = await runResponse.json()
  assert.equal(run.status, 'completed')
  assert.equal(run.conclusion, 'success')
  assert.equal(run.head_sha, expectedHeadSha)
  checkpoint('qa-013-formal-release', {
    asset: assetMatch[1],
    resources,
    run: {
      id: String(run.id),
      status: run.status,
      conclusion: run.conclusion,
      headSha: run.head_sha,
    },
  })
}

async function runFormalLegacyPlan() {
  const generated = await createProductionPlanRecords()
  const records = asUserEquivalentLegacyRecords(generated)
  const qa = await prepareBrowser()
  try {
    if (sameDayUpgradeOnly) {
      await qa.page.navigate(new URL('#/', baseUrl).href)
      await qa.page.waitFor(`document.readyState === 'complete'`)
      await putRecords(qa.page, records)
      const legacy = activeRuntime(await qa.page.dumpIndexedDb())
      assertLegacyShape(legacy)
      const previousPlanId = legacy.activePlan.plan.planId
      const previousLocalDate = legacy.activePlan.plan.localDate

      await qa.page.reload()
      await waitForHome(qa.page)
      const upgraded = activeRuntime(
        await qa.page.dumpIndexedDb(),
      )
      assert.notEqual(
        upgraded.activePlan.plan.planId,
        previousPlanId,
      )
      assert.equal(
        upgraded.activePlan.plan.localDate,
        previousLocalDate,
      )
      assert.equal(
        upgraded.activePlan.plan.tasks.every(
          (task) =>
            task.trainingBudget?.targetEffectiveSeconds === 900,
        ),
        true,
      )
      assert.equal(
        upgraded.activePlan.tasks.every(
          (execution) =>
            execution.training?.targetEffectiveSeconds === 900 &&
            execution.training?.status === 'running',
        ),
        true,
      )
      checkpoint('qa-014-formal-same-day-upgrade', {
        previousPlanId,
        previousLocalDate,
        currentPlanId: upgraded.activePlan.plan.planId,
        currentLocalDate: upgraded.activePlan.plan.localDate,
        completedLearningUnitIds:
          upgraded.completedLearningUnitIds,
        tasks: upgraded.activePlan.plan.tasks.map((task) => ({
          moduleId: task.targetModuleId,
          targetEffectiveSeconds:
            task.trainingBudget?.targetEffectiveSeconds,
        })),
        userDataCleared: false,
      })
      return
    }

    await seedLegacyRecords(qa.page, records)
    const seeded = activeRuntime(await qa.page.dumpIndexedDb())
    assertLegacyShape(seeded)
    const taskIds = taskIdsByModule(seeded)
    const vocabularySnapshot = structuredClone(
      executionFor(seeded, 'vocabulary'),
    )
    assertVocabularyPreserved(seeded, vocabularySnapshot)
    assert.deepEqual(await storedUndefinedPaths(qa.page), [])
    checkpoint('qa-013-user-equivalent-legacy-plan-seeded', {
      planId: seeded.activePlan.plan.planId,
      noTrainingBudget: true,
      noExecutionTraining: true,
      vocabulary: vocabularySnapshot,
      pendingTaskIds: {
        listening: taskIds.listening,
        speaking: taskIds.speaking,
      },
    })

    if (rolloverOnly) {
      const previousPlanId = seeded.activePlan.plan.planId
      const previousLocalDate = seeded.activePlan.plan.localDate
      await qa.page.evaluate(
        `globalThis.__qaAdvanceTime(24 * 60 * 60 * 1_000)`,
      )
      await qa.page.evaluate(
        `window.dispatchEvent(new Event('pageshow'))`,
      )

      const deadline = Date.now() + 20_000
      let rolledOver = null
      while (Date.now() < deadline) {
        const runtime = activeRuntime(
          await qa.page.dumpIndexedDb(),
        )
        if (runtime.activePlan.plan.planId !== previousPlanId) {
          rolledOver = runtime
          break
        }
        await qa.page.evaluate(
          `new Promise((resolve) => setTimeout(resolve, 100))`,
        )
      }
      assert.ok(
        rolledOver,
        'The foreground pageshow event did not roll the stale plan to the current date.',
      )
      assert.notEqual(
        rolledOver.activePlan.plan.localDate,
        previousLocalDate,
      )
      assert.equal(
        rolledOver.activePlan.plan.tasks.every(
          (task) =>
            task.trainingBudget?.targetEffectiveSeconds === 900,
        ),
        true,
        'The foreground rollover did not create three 900-second budget tasks.',
      )
      assert.equal(
        rolledOver.activePlan.tasks.every(
          (execution) =>
            execution.training?.targetEffectiveSeconds === 900 &&
            execution.training?.status === 'running',
        ),
        true,
        'The foreground rollover did not initialize running budget progress.',
      )
      checkpoint('qa-014-formal-foreground-rollover', {
        previousPlanId,
        previousLocalDate,
        currentPlanId: rolledOver.activePlan.plan.planId,
        currentLocalDate: rolledOver.activePlan.plan.localDate,
        tasks: rolledOver.activePlan.plan.tasks.map((task) => ({
          moduleId: task.targetModuleId,
          targetEffectiveSeconds:
            task.trainingBudget?.targetEffectiveSeconds,
        })),
        userDataCleared: false,
      })
      return
    }

    const listeningTaskId = await clickModule(
      qa.page,
      'listening',
    )
    assert.equal(listeningTaskId, taskIds.listening)
    let restored = await assertCheckpointAfterRefresh(
      qa,
      'listening',
      vocabularySnapshot,
      listeningTaskId,
    )
    assert.equal(executionFor(restored, 'listening').status, 'active')
    checkpoint('qa-013-listening-started-refresh', {
      status: executionFor(restored, 'listening').status,
      processedEventCount:
        restored.activePlan.processedEventIds.length,
    })

    await playCurrentListening(qa.page, 1)
    await waitForStoredExecution(
      qa.page,
      'listening',
      (execution) =>
        execution.effectiveTimeSource === 'timing-segments' &&
        execution.effectiveSeconds >= 1 &&
        (execution.timingSegmentCount ?? 0) >= 1,
      'Listening timing event',
    )
    restored = await assertCheckpointAfterRefresh(
      qa,
      'listening',
      vocabularySnapshot,
      listeningTaskId,
    )
    const listeningTimed = executionFor(restored, 'listening')
    assert.equal(listeningTimed.status, 'active')
    assert.equal(listeningTimed.effectiveTimeSource, 'timing-segments')
    assert.ok(listeningTimed.effectiveSeconds >= 1)
    assert.ok((listeningTimed.timingSegmentCount ?? 0) >= 1)
    checkpoint('qa-013-listening-timing-refresh', {
      status: listeningTimed.status,
      effectiveSeconds: listeningTimed.effectiveSeconds,
      timingSegmentCount: listeningTimed.timingSegmentCount,
    })

    await completeListeningAfterFirstPlayback(qa.page)
    await waitForStoredExecution(
      qa.page,
      'listening',
      (execution) => execution.status === 'completed',
      'Listening attempt event',
    )
    restored = await assertCheckpointAfterRefresh(
      qa,
      'listening',
      vocabularySnapshot,
      listeningTaskId,
    )
    const listeningCompleted = executionFor(restored, 'listening')
    assert.equal(listeningCompleted.status, 'completed')
    assert.equal(listeningCompleted.completionKind, 'scored')
    checkpoint('qa-013-listening-attempt-refresh', {
      status: listeningCompleted.status,
      completionKind: listeningCompleted.completionKind,
      effectiveSeconds: listeningCompleted.effectiveSeconds,
      processedEventCount:
        restored.activePlan.processedEventIds.length,
    })

    await qa.page.clickByText('返回今日计划')
    await waitForHome(qa.page)
    const speakingTaskId = await clickModule(qa.page, 'speaking')
    assert.equal(speakingTaskId, taskIds.speaking)
    restored = await assertCheckpointAfterRefresh(
      qa,
      'speaking',
      vocabularySnapshot,
      speakingTaskId,
    )
    assert.equal(executionFor(restored, 'speaking').status, 'active')
    checkpoint('qa-013-speaking-started-refresh', {
      status: executionFor(restored, 'speaking').status,
      processedEventCount:
        restored.activePlan.processedEventIds.length,
    })

    await recordCurrentSpeaking(qa.page, 1)
    await waitForStoredExecution(
      qa.page,
      'speaking',
      (execution) =>
        execution.effectiveTimeSource === 'timing-segments' &&
        execution.effectiveSeconds >= 1 &&
        (execution.timingSegmentCount ?? 0) >= 1,
      'Speaking timing event',
    )
    restored = await assertCheckpointAfterRefresh(
      qa,
      'speaking',
      vocabularySnapshot,
      speakingTaskId,
    )
    const speakingTimed = executionFor(restored, 'speaking')
    assert.equal(speakingTimed.status, 'active')
    assert.equal(speakingTimed.effectiveTimeSource, 'timing-segments')
    assert.ok(speakingTimed.effectiveSeconds >= 1)
    assert.ok((speakingTimed.timingSegmentCount ?? 0) >= 1)
    checkpoint('qa-013-speaking-timing-refresh', {
      status: speakingTimed.status,
      effectiveSeconds: speakingTimed.effectiveSeconds,
      timingSegmentCount: speakingTimed.timingSegmentCount,
    })

    await completeRemainingSpeaking(qa.page)
    await waitForStoredExecution(
      qa.page,
      'speaking',
      (execution) => execution.status === 'completed',
      'Speaking attempt event',
    )
    restored = await assertCheckpointAfterRefresh(
      qa,
      'speaking',
      vocabularySnapshot,
      speakingTaskId,
    )
    const speakingCompleted = executionFor(restored, 'speaking')
    assert.equal(speakingCompleted.status, 'completed')
    assert.ok(
      ['scored', 'unscorable-practice'].includes(
        speakingCompleted.completionKind,
      ),
    )
    assert.deepEqual(
      restored.activePlan.tasks.map((execution) => execution.status),
      ['completed', 'completed', 'completed'],
    )
    assert.deepEqual(await storedUndefinedPaths(qa.page), [])
    checkpoint('qa-013-speaking-attempt-refresh', {
      status: speakingCompleted.status,
      completionKind: speakingCompleted.completionKind,
      effectiveSeconds: speakingCompleted.effectiveSeconds,
      vocabularyUnchanged: true,
      noExecutionTraining: true,
      noJsonPortableError: true,
    })
  } finally {
    await qa.close()
  }
}

try {
  await releaseEvidence()
  await runFormalLegacyPlan()
  console.log(JSON.stringify({ status: 'passed', ...evidence }, null, 2))
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
