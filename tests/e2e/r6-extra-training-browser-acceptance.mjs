import assert from 'node:assert/strict'
import {
  fakeAssessmentClockScript,
  launchQaChrome,
} from './lib/cdp-browser.mjs'

const baseUrl = new URL(
  process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173/',
)
const expectedAsset = process.env.QA_EXPECTED_ASSET ?? null
const expectedPagesRun = process.env.QA_PAGES_RUN ?? null
const dailyFirstOnly =
  process.env.QA_R6_DAILY_FIRST_ONLY === '1'
const verifyThirtySecondTestMode =
  process.env.QA_VERIFY_30_SECOND_TEST_MODE === '1'
const verifyR9Bilingual =
  process.env.QA_VERIFY_R9_BILINGUAL === '1'
const verifyR12Framework =
  process.env.QA_VERIFY_R12_FRAMEWORK === '1'
const appDatabaseName = verifyThirtySecondTestMode
  ? 'english-learning-pwa-training-test-30s'
  : 'english-learning-pwa'
const MODULES = ['vocabulary', 'listening', 'speaking']
const evidence = {
  status: 'running',
  baseUrl: baseUrl.href,
  expectedAsset,
  expectedPagesRun,
  isolatedProfile: true,
  userDeviceDataTouched: false,
  checkpoints: [],
}

function checkpoint(name, details = {}) {
  evidence.checkpoints.push({ name, ...details })
}

function controlledSpeechSynthesisScript() {
  return `(() => {
    const probe = {
      availableVoices: [],
      utterances: [],
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
      queueMicrotask(() => utterance.onend?.())
      return true
    }
    const synthesis = {
      get paused() { return paused },
      get speaking() { return speaking },
      getVoices() { return [] },
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

const controlledRecognitionScript = `(() => {
  class QaSpeechRecognition {
    lang = 'en-US'
    continuous = false
    interimResults = false
    maxAlternatives = 3
    onresult = null
    onerror = null
    onend = null
    start() {}
    stop() {
      const alternative = {
        transcript: "Hi Maya, I'm Lin.",
        confidence: 0.99,
      }
      const result = {
        0: alternative,
        length: 1,
        isFinal: true,
      }
      queueMicrotask(() => {
        this.onresult?.({
          resultIndex: 0,
          results: {
            0: result,
            length: 1,
          },
        })
        this.onend?.()
      })
    }
    abort() {
      queueMicrotask(() => this.onend?.())
    }
  }
  for (const key of ['SpeechRecognition', 'webkitSpeechRecognition']) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: QaSpeechRecognition,
      writable: true,
    })
  }
})()`

function allRecords(databases) {
  return databases.flatMap(
    (database) => database.stores.records ?? [],
  )
}

function storedRecord(databases, namespace, key) {
  return allRecords(databases).find(
    (record) =>
      record.namespace === namespace &&
      (key === undefined || record.key === key),
  )
}

function activeRuntime(databases) {
  const record = storedRecord(
    databases,
    'app.learning-runtime',
    'active-plan',
  )
  assert.ok(record, 'The production active-plan record is missing.')
  return record.value
}

function engineState(databases) {
  const record = storedRecord(
    databases,
    'learning.engine',
    'current-state',
  )
  assert.ok(record, 'The production learning-engine record is missing.')
  return record.value
}

function executionFor(runtime, moduleId) {
  const execution = runtime.activePlan.tasks.find(
    (candidate) =>
      candidate.task.targetModuleId === moduleId,
  )
  assert.ok(execution, `The ${moduleId} daily execution is missing.`)
  return execution
}

function extraSessions(databases, moduleId) {
  return Object.values(
    engineState(databases).extraTraining?.sessions ?? {},
  )
    .filter((session) => session.targetModuleId === moduleId)
    .sort((left, right) =>
      left.startedAt.localeCompare(right.startedAt),
    )
}

function extraSession(databases, sessionId) {
  const session =
    engineState(databases).extraTraining?.sessions?.[sessionId]
  assert.ok(session, `Extra-training session ${sessionId} is missing.`)
  return session
}

function extraFeatureSnapshot(databases, moduleId, sessionId) {
  const record = storedRecord(
    databases,
    `feature.${moduleId}.extra-training`,
    `session:${sessionId}`,
  )
  assert.ok(
    record,
    `${moduleId} extra-training feature snapshot is missing.`,
  )
  return record.value
}

async function putRecords(page, records) {
  await page.evaluate(`(async () => {
    const records = ${JSON.stringify(records)}
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(${JSON.stringify(appDatabaseName)})
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

async function updateStoredRecord(page, namespace, key, update) {
  const databases = await page.dumpIndexedDb()
  const current = storedRecord(databases, namespace, key)
  assert.ok(current, `Stored record ${namespace}/${key} is missing.`)
  const next = structuredClone(current)
  update(next.value)
  next.updatedAt = new Date().toISOString()
  await putRecords(page, [next])
}

async function prepareFirstDayPlan(page) {
  await page.navigate(new URL('#/assessment', baseUrl).href)
  await page.waitFor(
    `!document.body.innerText.includes(
      '正在读取本机 R1 旅游英语词汇测试'
    )`,
    20_000,
  )
  assert.match(await page.bodyText(), /5 个阶段|每阶段 30 题/u)
  await page.clickByText('开始测试')
  await page.waitFor(
    `document.body.innerText.includes('第 1 / 30 题')`,
    20_000,
  )
  await page.clickFirstEnabledChoice()
  await page.waitFor(
    `[...document.querySelectorAll('button')].some((button) =>
      button.innerText.trim() === '检查并提交本阶段' &&
      !button.disabled
    )`,
    20_000,
  )
  await page.clickByText('检查并提交本阶段')
  await page.waitFor(
    `Boolean(document.querySelector('.travel-r1-screen--review'))`,
  )
  await page.clickByText('剩余全部不会，结束测试')
  await page.waitFor(
    `Boolean(document.querySelector(
      '.travel-r1-screen--finish-confirmation'
    ))`,
  )
  await page.clickByText('确认剩余全部不会并结束')
  await page.waitFor(
    `Boolean(document.querySelector('.travel-r1-screen--results'))`,
    20_000,
  )
  await page.clickByText('进入今日计划')
  await page.waitFor(
    `location.hash === '#/' &&
      !document.body.innerText.includes('正在恢复今日学习计划') &&
      document.body.innerText.includes('任选一项开始')`,
    20_000,
  )
}

async function clickSelector(page, selector) {
  const clicked = await page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!(element instanceof HTMLButtonElement) || element.disabled) {
      return false
    }
    element.click()
    return true
  })()`)
  assert.equal(clicked, true, `Cannot click ${selector}.`)
}

async function verifyR12TrainingFramework(page) {
  await page.clickByText('训练')
  await page.waitFor(
    `document.querySelectorAll('[data-training-area]').length === 3`,
    20_000,
  )
  const hub = await page.evaluate(`(() => ({
    hash: location.hash,
    areas: [...document.querySelectorAll('[data-training-area]')]
      .map((card) => ({
        id: card.dataset.trainingArea,
        text: card.innerText.trim(),
      })),
  }))()`)
  assert.equal(hub.hash, '#/practice')
  assert.deepEqual(
    hub.areas.map((area) => area.id),
    ['daily', 'scenes', 'ai'],
  )
  assert.match(
    hub.areas.find((area) => area.id === 'ai')?.text ?? '',
    /暂未开放/u,
  )
  const hub320 = await assertResponsive(page, 320, 'R12 hub')
  const hub390 = await assertResponsive(page, 390, 'R12 hub')

  await clickSelector(page, '[data-training-area="daily"]')
  await page.waitFor(
    `location.hash === '#/practice/daily' &&
      document.querySelectorAll('[data-module-id]').length === 4`,
    20_000,
  )
  await page.reload()
  await page.waitFor(
    `location.hash === '#/practice/daily' &&
      document.querySelectorAll('[data-module-id]').length === 4`,
    20_000,
  )
  const dailyModules = await page.evaluate(
    `[...document.querySelectorAll('[data-module-id]')]
      .map((card) => card.dataset.moduleId)`,
  )
  assert.deepEqual(dailyModules, [
    'assessment',
    'vocabulary',
    'listening',
    'speaking',
  ])

  await clickSelector(page, 'button[aria-label="返回训练方式"]')
  await page.waitFor(
    `document.querySelectorAll('[data-training-area]').length === 3`,
    20_000,
  )
  await clickSelector(page, '[data-training-area="scenes"]')
  await page.waitFor(
    `location.hash === '#/practice/scenes' &&
      document.querySelectorAll('[data-scene-category]').length === 6`,
    20_000,
  )
  const categoryIds = await page.evaluate(
    `[...document.querySelectorAll('[data-scene-category]')]
      .map((card) => card.dataset.sceneCategory)`,
  )
  assert.deepEqual(categoryIds, [
    'airport-flight',
    'city-transport',
    'stay-dining',
    'shopping-sightseeing',
    'help-connectivity',
    'health',
  ])
  const categories320 = await assertResponsive(
    page,
    320,
    'R13-A category grid',
  )
  await assertResponsive(page, 390, 'R13-A category grid')

  const sceneCounts = []
  for (const categoryId of categoryIds) {
    await clickSelector(
      page,
      `[data-scene-category="${categoryId}"]`,
    )
    await page.waitFor(
      `location.hash.includes(
        '/practice/scenes/${categoryId}'
      ) && document.querySelectorAll('[data-travel-scene]').length > 0`,
      20_000,
    )
    sceneCounts.push(
      await page.evaluate(
        `document.querySelectorAll('[data-travel-scene]').length`,
      ),
    )
    await clickSelector(page, 'button[aria-label="返回上一级"]')
    await page.waitFor(
      `location.hash === '#/practice/scenes' &&
        document.querySelectorAll('[data-scene-category]').length === 6`,
      20_000,
    )
  }
  assert.deepEqual(sceneCounts, [7, 3, 2, 2, 3, 1])
  assert.equal(
    sceneCounts.reduce((sum, count) => sum + count, 0),
    18,
  )

  await clickSelector(
    page,
    '[data-scene-category="airport-flight"]',
  )
  await clickSelector(page, '[data-travel-scene="baggage-claim"]')
  await page.waitFor(
    `location.hash ===
      '#/practice/scenes/airport-flight/baggage-claim' &&
      document.body.innerText.includes('场景框架已建立')`,
    20_000,
  )
  await page.reload()
  await page.waitFor(
    `location.hash ===
      '#/practice/scenes/airport-flight/baggage-claim' &&
      document.body.innerText.includes('场景框架已建立')`,
    20_000,
  )
  const scene = await page.evaluate(`(() => ({
    pendingCount:
      (document.body.innerText.match(/内容准备中/g) ?? []).length,
    hasFakeStart:
      [...document.querySelectorAll('button')].some((button) =>
        /开始.*训练/u.test(button.innerText)
      ),
  }))()`)
  assert.equal(scene.pendingCount, 3)
  assert.equal(scene.hasFakeStart, false)
  const scene320 = await assertResponsive(
    page,
    320,
    'R13-A scene placeholder',
  )
  await assertResponsive(page, 390, 'R13-A scene placeholder')
  await page.evaluate('history.back()')
  await page.waitFor(
    `location.hash === '#/practice/scenes/airport-flight' &&
      document.querySelectorAll('[data-travel-scene]').length === 7`,
    20_000,
  )
  await page.evaluate('history.forward()')
  await page.waitFor(
    `location.hash ===
      '#/practice/scenes/airport-flight/baggage-claim' &&
      document.body.innerText.includes('场景框架已建立')`,
    20_000,
  )

  await page.navigate(new URL('#/practice/ai', baseUrl).href)
  await page.waitFor(
    `document.body.innerText.includes('AI 对话训练') &&
      document.body.innerText.includes('暂未开放')`,
    20_000,
  )
  const aiText = await page.bodyText()
  assert.match(aiText, /不接入开放式AI/u)
  assert.doesNotMatch(aiText, /开始对话/u)

  return {
    hub,
    dailyModules,
    categoryIds,
    sceneCounts,
    scene,
    responsive: { hub320, hub390, categories320, scene320 },
    browserHistory: true,
    aiBoundary: true,
  }
}

async function clickDailyModule(page, moduleId) {
  if (!(await page.bodyText()).includes('今日安排')) {
    await page.navigate(new URL('#/', baseUrl).href)
    await page.waitFor(
      `!document.body.innerText.includes('正在恢复今日学习计划')`,
      20_000,
    )
  }
  const result = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button.task-row')].find(
      (candidate) =>
        candidate.dataset.moduleId === ${JSON.stringify(moduleId)} &&
        !candidate.disabled
    )
    if (!button) return null
    const taskId = button.dataset.taskId ?? null
    button.click()
    return taskId
  })()`)
  assert.ok(result, `Could not open daily ${moduleId}.`)
  await page.waitFor(
    `location.hash.includes(${JSON.stringify(`/${moduleId}?taskId=`)}) &&
      !document.body.innerText.includes('正在加载')`,
    20_000,
  )
  return result
}

async function waitForDailyQuestion(page, moduleId) {
  if (moduleId === 'vocabulary') {
    await page.waitFor(
      `[...document.querySelectorAll(
        'button.choice-row, button.choice-card, [role="radio"]'
      )].some((button) =>
        !button.disabled &&
        button.getAttribute('aria-disabled') !== 'true'
      )`,
      20_000,
    )
  } else if (moduleId === 'listening') {
    await page.waitFor(
      `[...document.querySelectorAll('button')].some((button) =>
        (button.innerText.trim() === '播放音频' ||
          button.getAttribute('aria-label') === '播放音频') &&
        !button.disabled
      )`,
      20_000,
    )
  } else {
    await page.waitFor(
      `[...document.querySelectorAll('button')].some((button) =>
        (button.innerText.trim() === '开始录音' ||
          button.getAttribute('aria-label') === '开始录音') &&
        !button.disabled
      )`,
      20_000,
    )
  }
  assert.doesNotMatch(
    await page.bodyText(),
    /暂时无法继续|identity.*match|provider-failure|JSON-portable/u,
  )
}

async function forceDailyFinishCurrent(page, moduleId) {
  await updateStoredRecord(
    page,
    'app.learning-runtime',
    'active-plan',
    (runtime) => {
      const execution = executionFor(runtime, moduleId)
      execution.status = 'active'
      execution.completionKind = null
      execution.effectiveSeconds = 900
      execution.startedAt ??= new Date().toISOString()
      execution.updatedAt = new Date().toISOString()
      execution.training = {
        ...execution.training,
        targetEffectiveSeconds: 900,
        remainingEffectiveSeconds: 0,
        status: 'finish-current-item',
      }
      runtime.activePlan.status = 'in-progress'
      runtime.activePlan.updatedAt = execution.updatedAt
    },
  )
  await page.reload()
  try {
    await waitForDailyQuestion(page, moduleId)
  } catch (error) {
    throw new Error(
      `Daily ${moduleId} did not restore after forcing finish-current-item: ${JSON.stringify(
        {
          cause:
            error instanceof Error
              ? error.message
              : String(error),
          url: await page.url(),
          bodyText: await page.bodyText(),
          pageErrors: [...page.pageErrors],
          consoleMessages: [...page.consoleMessages],
          runtime: activeRuntime(await page.dumpIndexedDb()),
        },
        null,
        2,
      )}`,
    )
  }
}

async function finishControlledSpeech(page) {
  await page.clickByText('播放音频')
  await page.waitFor(`globalThis.speechSynthesis?.speaking === true`)
  await page.waitFor(
    `document.body.innerText.includes('正在播放')`,
    10_000,
  )
  await page.evaluate(
    `new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    )`,
  )
  assert.equal(
    (await page.bodyText()).includes('任务已完成'),
    false,
    'A listening task was truncated while audio was active.',
  )
  assert.equal(
    await page.evaluate(`globalThis.__qaFinishSpeech()`),
    true,
  )
  try {
    await page.waitFor(
      `document.body.innerText.includes('播放完毕')`,
      10_000,
    )
  } catch {
    throw new Error(
      `Listening playback did not settle: ${await page.bodyText()}`,
    )
  }
}

async function answerListening(page) {
  const hasChoice = await page.evaluate(
    `[...document.querySelectorAll(
      'button.choice-row, button.choice-card, [role="radio"]'
    )].some((candidate) =>
      !candidate.disabled &&
      candidate.getAttribute('aria-disabled') !== 'true'
    )`,
  )
  if (hasChoice) {
    await page.clickFirstEnabledChoice()
  } else {
    if (process.env.QA_VERIFY_R10_DICTATION === '1') {
      const rules = await page.evaluate(`(() => {
        const field = document.querySelector('.keyword-dictation')
        return {
          text: field?.textContent ?? '',
          target:
            field?.querySelector(
              '.keyword-dictation__target strong'
            )?.textContent?.trim() ?? '',
          items:
            field?.querySelectorAll(
              '.keyword-dictation__requirements li'
            ).length ?? 0,
        }
      })()`)
      assert.equal(
        rules.target,
        '写出听到的见面时间。',
      )
      assert.equal(rules.items, 3)
      assert.match(rules.text, /需要填写 2 项关键信息/u)
      assert.match(rules.text, /必须按照音频中出现的顺序填写/u)
      assert.match(rules.text, /用空格连接/u)
    }
    const filled = await page.evaluate(`(() => {
      const input = document.querySelector('input[type="text"], textarea')
      if (!input || input.disabled) return false
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input),
        'value',
      )?.set
      setter?.call(
        input,
        ${JSON.stringify(
          process.env.QA_VERIFY_R10_DICTATION === '1'
            ? 'nine thirty'
            : 'hello',
        )}
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    assert.equal(filled, true, 'Listening dictation input is unavailable.')
  }
  await page.waitFor(
    `[...document.querySelectorAll('button')].some((button) =>
      button.innerText.trim() === '提交答案' && !button.disabled
    )`,
    20_000,
  )
  await page.clickByText('提交答案')
  if (
    !hasChoice &&
    process.env.QA_VERIFY_R10_DICTATION === '1'
  ) {
    await page.waitFor(
      `document.querySelector('.keyword-dictation__review')`,
      20_000,
    )
    const review = await page.evaluate(`(() => {
      const panel = document.querySelector(
        '.keyword-dictation__review'
      )
      const rows = [...(panel?.querySelectorAll('dl > div') ?? [])]
        .map((row) => ({
          label: row.querySelector('dt')?.textContent?.trim() ?? '',
          value: row.querySelector('dd')?.textContent?.trim() ?? '',
        }))
      return {
        text: panel?.textContent ?? '',
        response:
          rows.find((row) => row.label === '你的输入')?.value ?? '',
        standard:
          rows.find((row) => row.label === '参考答案')?.value ?? '',
        targets: [
          ...(panel?.querySelectorAll('ol > li') ?? []),
        ].map((item) => item.textContent?.trim() ?? ''),
      }
    })()`)
    assert.equal(review.response, 'nine thirty')
    assert.equal(review.standard, 'nine thirty')
    assert.deepEqual(review.targets, ['nine', 'thirty'])
    assert.match(review.text, /回答正确/u)
  }
}

async function verifyR9ListeningChoiceFlow(page) {
  await clickDailyModule(page, 'listening')
  await waitForDailyQuestion(page, 'listening')

  const beforePlayback = await page.evaluate(`(() => ({
    waiting: document.body.innerText.includes(
      '请先完整播放一次，播放结束后显示英文选项。'
    ),
    choiceCount:
      document.querySelectorAll('.choice-list .choice-row').length,
  }))()`)
  assert.equal(beforePlayback.waiting, true)
  assert.equal(beforePlayback.choiceCount, 0)

  await finishControlledSpeech(page)
  const afterPlayback = await page.evaluate(`(() => {
    const choices = [
      ...document.querySelectorAll('.choice-list .choice-row')
    ]
    return {
      count: choices.length,
      labels: choices.map((choice) =>
        choice.querySelector('strong')?.textContent?.trim() ?? ''
      ),
      translations: choices.map((choice) =>
        choice.querySelector('small')?.textContent?.trim() ?? ''
      ),
    }
  })()`)
  assert.ok(afterPlayback.count > 0)
  assert.equal(
    afterPlayback.labels.every(
      (label) =>
        label.length > 0 &&
        !/[\u3400-\u9fff]/u.test(label)
    ),
    true,
  )
  assert.deepEqual(
    afterPlayback.translations,
    Array(afterPlayback.count).fill(''),
  )

  await answerListening(page)
  await page.waitFor(
    `[...document.querySelectorAll(
      '.choice-list .choice-row'
    )].every((choice) =>
      Boolean(choice.querySelector('small')?.textContent?.trim())
    )`,
    20_000,
  )
  const afterSubmit = await page.evaluate(`(() => {
    const choices = [
      ...document.querySelectorAll('.choice-list .choice-row')
    ]
    return {
      count: choices.length,
      translations: choices.map((choice) =>
        choice.querySelector('small')?.textContent?.trim() ?? ''
      ),
      markedAnswerCount: choices.filter((choice) =>
        choice.classList.contains('choice-row--correct') ||
        choice.classList.contains('choice-row--incorrect')
      ).length,
      hasExplanation:
        Boolean(
          document.querySelector(
            '.transcript-panel__rationale'
          )?.textContent?.trim()
        ),
    }
  })()`)
  assert.equal(afterSubmit.count, afterPlayback.count)
  assert.equal(
    afterSubmit.translations.every(
      (translation) =>
        translation.length > 0 &&
        /[\u3400-\u9fff]/u.test(translation)
    ),
    true,
  )
  assert.ok(afterSubmit.markedAnswerCount > 0)
  assert.equal(afterSubmit.hasExplanation, true)

  return {
    beforePlayback,
    afterPlayback,
    afterSubmit,
  }
}

async function submitVocabularyAnswer(page) {
  await page.clickFirstEnabledChoice()
  try {
    await page.waitFor(
      `[...document.querySelectorAll('button')].some((button) =>
        button.innerText.trim() === '提交答案' &&
        !button.disabled &&
        button.getAttribute('aria-disabled') !== 'true'
      )`,
      10_000,
    )
  } catch {
    throw new Error(
      `Vocabulary submit did not unlock: ${await page.bodyText()}`,
    )
  }
  await page.clickByText('提交答案')
}

async function recordSpeaking(page) {
  await page.clickByText('开始录音')
  await page.waitFor(
    `document.body.innerText.includes('正在录音')`,
    20_000,
  )
  assert.equal(
    (await page.bodyText()).includes('练习已结束'),
    false,
    'A speaking task was truncated while recording.',
  )
  await page.clickByText('停止录音')
  await page.waitFor(
    `document.body.innerText.includes('录音完成') ||
      document.body.innerText.includes('录音不可用')`,
    20_000,
  )
  if (process.env.QA_VERIFY_R8_RECOGNITION === '1') {
    await page.waitFor(
      `document.querySelector(
        '.speaking-content-match[data-content-match-state="recognized"]'
      )`,
      20_000,
    )
    const comparison = await page.evaluate(`(() => {
      const panel = document.querySelector('.speaking-content-match')
      const rows = [...(panel?.querySelectorAll('dl > div') ?? [])]
        .map((row) => ({
          label: row.querySelector('dt')?.textContent?.trim() ?? '',
          value: row.querySelector('dd')?.textContent?.trim() ?? '',
        }))
      return {
        state: panel?.getAttribute('data-content-match-state') ?? null,
        level: panel?.getAttribute('data-content-match-level') ?? null,
        target: rows.find((row) => row.label === '目标表达')?.value ?? '',
        recognized:
          rows.find((row) => row.label === '实际识别')?.value ?? '',
        text: panel?.textContent ?? '',
      }
    })()`)
    assert.equal(comparison.state, 'recognized')
    assert.ok(comparison.level)
    assert.ok(comparison.target)
    assert.equal(comparison.recognized, "Hi Maya, I'm Lin.")
    assert.match(comparison.text, /不是发音、口音或流利度评分/u)
  } else {
    await page.waitFor(
      `document.querySelector(
        '.speaking-content-match[data-content-match-state="unscorable"]'
      )`,
      20_000,
    )
    assert.match(
      await page.bodyText(),
      /本次没有得到可用的识别文本/u,
    )
  }
}

async function waitForDailyExecutionCompleted(
  page,
  moduleId,
  timeout = 20_000,
) {
  const deadline = Date.now() + timeout
  let lastRuntime = null
  while (Date.now() < deadline) {
    lastRuntime = activeRuntime(await page.dumpIndexedDb())
    if (executionFor(lastRuntime, moduleId).status === 'completed') {
      return lastRuntime
    }
    await page.evaluate(
      `new Promise((resolve) => setTimeout(resolve, 100))`,
    )
  }
  const diagnostic = await completionTransitionDiagnostic(
    page,
    moduleId,
  )
  throw new Error(
    `Daily ${moduleId} completion did not persist within ${timeout}ms: ${JSON.stringify(
      {
        ...diagnostic,
        lastRuntime,
      },
      null,
      2,
    )}`,
  )
}

async function finishDailyModule(page, moduleId) {
  await clickDailyModule(page, moduleId)
  await waitForDailyQuestion(page, moduleId)
  await forceDailyFinishCurrent(page, moduleId)
  if (moduleId === 'vocabulary') {
    await submitVocabularyAnswer(page)
  } else if (moduleId === 'listening') {
    await finishControlledSpeech(page)
    await answerListening(page)
  } else {
    await recordSpeaking(page)
  }
  await page.waitFor(
    `[...document.querySelectorAll('button')].some((button) =>
      ['完成训练', '完成本题并结束'].includes(
        button.innerText.trim()
      ) && !button.disabled
    )`,
    20_000,
  )
  await page.clickByText('完成训练', '完成本题并结束')
  await page.waitFor(
    `document.body.innerText.includes(${
      JSON.stringify(
        moduleId === 'vocabulary'
          ? '词汇任务已完成'
          : moduleId === 'listening'
            ? '听力任务已完成'
            : '口语练习已结束',
      )
    }) &&
      [...document.querySelectorAll('button')].some((button) =>
        button.innerText.trim() === '返回今日计划' &&
        !button.disabled &&
        button.getAttribute('aria-disabled') !== 'true'
      )`,
    20_000,
  )
  const runtime = await waitForDailyExecutionCompleted(
    page,
    moduleId,
  )
  const execution = executionFor(runtime, moduleId)
  assert.ok(
    execution.score,
    `Daily ${moduleId} first completion page is missing the R7 score ledger.`,
  )
  const total =
    execution.score.correctCount +
    execution.score.incorrectCount
  const firstCompletionText = await page.bodyText()
  assert.match(
    firstCompletionText,
    new RegExp(
      `${execution.score.correctCount}\\s*/\\s*${total}`,
      'u',
    ),
  )
  if (total > 0) {
    assert.match(
      firstCompletionText,
      new RegExp(
        `正确率\\s*${Math.round(
          execution.score.correctCount / total * 100,
        )}%`,
        'u',
      ),
    )
  } else {
    assert.match(firstCompletionText, /正确率无法计算/u)
  }
  return runtime
}

async function completionTransitionDiagnostic(page, moduleId) {
  const ui = await page.evaluate(`(() => ({
    url: location.href,
    bodyText: document.body?.innerText ?? '',
    completionScreen: Boolean(
      document.querySelector('.training-completion-screen')
    ),
    buttons: [...document.querySelectorAll('button')].map(
      (button) => ({
        text: button.innerText.trim(),
        disabled: Boolean(button.disabled),
        ariaDisabled: button.getAttribute('aria-disabled'),
        ariaBusy: button.getAttribute('aria-busy'),
      })
    ),
  }))()`)
  const databases = await page.dumpIndexedDb()
  return {
    moduleId,
    ui,
    pageErrors: [...page.pageErrors],
    consoleMessages: [...page.consoleMessages],
    activePlan: activeRuntime(databases).activePlan,
    engineState: engineState(databases),
  }
}

async function returnFromDailyModule(page, moduleId) {
  await page.clickByText('返回今日计划')
  const transition = await page.evaluate(`new Promise((resolve) => {
    const deadline = performance.now() + 20_000
    let stableFrames = 0
    const inspect = () => {
      const text = document.body?.innerText ?? ''
      const errorBoundary =
        text.includes('重新加载') &&
        !document.querySelector('.training-completion-screen')
      const completion = Boolean(
        document.querySelector('.training-completion-screen')
      )
      const returnButton = [...document.querySelectorAll('button')].find(
        (button) =>
          button.innerText.trim() === '返回今日计划' &&
          !button.disabled &&
          button.getAttribute('aria-disabled') !== 'true'
      )
      if (errorBoundary) {
        resolve('error')
        return
      }
      if (completion && returnButton) {
        stableFrames += 1
        if (stableFrames >= 8) {
          resolve('completion')
          return
        }
      } else {
        stableFrames = 0
      }
      if (performance.now() >= deadline) {
        resolve('timeout')
        return
      }
      requestAnimationFrame(inspect)
    }
    requestAnimationFrame(inspect)
  })`)
  if (transition !== 'completion') {
    const diagnostic = await completionTransitionDiagnostic(
      page,
      moduleId,
    )
    throw new Error(
      `Daily ${moduleId} first return reached ${transition}: ${JSON.stringify(
        diagnostic,
        null,
        2,
      )}`,
    )
  }
  const runtimeBeforeReturn = activeRuntime(
    await page.dumpIndexedDb(),
  )
  const execution = executionFor(runtimeBeforeReturn, moduleId)
  assert.ok(
    execution.score,
    `Daily ${moduleId} completion is missing the R7 score ledger.`,
  )
  const total =
    execution.score.correctCount +
    execution.score.incorrectCount
  assert.ok(
    total > 0 || execution.score.unscorableCount > 0,
    `Daily ${moduleId} score contains no completed outcome.`,
  )
  const completionText = await page.bodyText()
  assert.match(
    completionText,
    new RegExp(
      `${execution.score.correctCount}\\s*/\\s*${total}`,
      'u',
    ),
  )
  if (total > 0) {
    assert.match(
      completionText,
      new RegExp(
        `正确率\\s*${Math.round(
          execution.score.correctCount / total * 100,
        )}%`,
        'u',
      ),
    )
  } else {
    assert.match(completionText, /正确率无法计算/u)
  }
  if (execution.score.unscorableCount > 0) {
    assert.match(
      completionText,
      new RegExp(
        `另有\\s*${execution.score.unscorableCount}\\s*题`,
        'u',
      ),
    )
  }
  await page.clickByText('返回今日计划')
  await page.waitFor(
    `location.hash === '#/' &&
      !document.body.innerText.includes('正在恢复今日学习计划')`,
    20_000,
  )
}

async function dailyPlanToThreeOfThree(page) {
  let runtime
  for (const moduleId of MODULES) {
    runtime = await finishDailyModule(page, moduleId)
    await returnFromDailyModule(page, moduleId)
  }
  assert.ok(runtime)
  assert.equal(runtime.activePlan.status, 'completed')
  assert.equal(
    runtime.activePlan.tasks.every(
      (execution) => execution.status === 'completed',
    ),
    true,
  )
  return runtime
}

async function verifyThirtySecondMode(page) {
  assert.match(await page.bodyText(), /测试模式：每项 30 秒/u)
  const databaseNames = await page.evaluate(`(async () =>
    (await indexedDB.databases()).map((database) => database.name)
  )()`)
  assert.ok(
    databaseNames.includes(
      'english-learning-pwa-training-test-30s',
    ),
  )
  assert.equal(
    databaseNames.includes('english-learning-pwa'),
    false,
  )

  await clickDailyModule(page, 'vocabulary')
  await waitForDailyQuestion(page, 'vocabulary')
  const displayedBudget = await page.evaluate(`(() => {
    const progress = document.querySelector(
      '.training-budget-progress'
    )
    const metrics = [
      ...(progress?.querySelectorAll(
        '.training-budget-progress__metrics > div'
      ) ?? []),
    ].map((metric) => ({
      label: metric.querySelector('dt')?.textContent?.trim() ?? '',
      value: metric.querySelector('dd')?.textContent?.trim() ?? '',
    }))
    return {
      displayTargetSeconds:
        progress?.getAttribute('data-display-target-seconds') ?? null,
      target:
        metrics.find((metric) => metric.label === '目标')?.value ?? null,
      bodyText: document.body.innerText,
    }
  })()`)
  assert.equal(displayedBudget.displayTargetSeconds, '30')
  assert.equal(displayedBudget.target, '00:30')
  assert.doesNotMatch(
    displayedBudget.bodyText,
    /目标\\s*15:00/u,
  )
  const startedAt = Date.now()
  const deadline = startedAt + 35_000
  let execution
  while (Date.now() < deadline) {
    execution = executionFor(
      activeRuntime(await page.dumpIndexedDb()),
      'vocabulary',
    )
    if (execution.training?.status === 'finish-current-item') {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const elapsedWallSeconds = (Date.now() - startedAt) / 1_000
  assert.equal(execution?.training?.status, 'finish-current-item')
  assert.equal(
    execution?.training?.remainingEffectiveSeconds,
    0,
  )
  assert.ok(
    elapsedWallSeconds >= 28 && elapsedWallSeconds <= 35,
    `30-second mode ended after ${elapsedWallSeconds}s.`,
  )
  assert.match(
    await page.bodyText(),
    /时间已到，完成本题后结束/u,
  )
  await submitVocabularyAnswer(page)
  await page.waitFor(
    `[...document.querySelectorAll('button')].some((button) =>
      ['完成训练', '完成本题并结束'].includes(
        button.innerText.trim()
      ) && !button.disabled
    )`,
    20_000,
  )
  await page.clickByText('完成训练')
  const completedRuntime = await waitForDailyExecutionCompleted(
    page,
    'vocabulary',
  )
  assert.equal(
    executionFor(completedRuntime, 'vocabulary').status,
    'completed',
  )
  return { databaseNames, elapsedWallSeconds }
}

async function verifyR62ModuleFirstCompletion(page, moduleId) {
  const before = activeRuntime(await page.dumpIndexedDb()).activePlan
  await clickDailyModule(page, moduleId)
  await waitForDailyQuestion(page, moduleId)
  const deadline = Date.now() + 35_000
  let budgetRuntime
  while (Date.now() < deadline) {
    budgetRuntime = activeRuntime(await page.dumpIndexedDb())
    if (executionFor(budgetRuntime, moduleId).training?.status === 'finish-current-item') break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.equal(executionFor(budgetRuntime, moduleId).training?.status, 'finish-current-item')
  if (moduleId === 'vocabulary') await submitVocabularyAnswer(page)
  else if (moduleId === 'listening') {
    await finishControlledSpeech(page)
    await answerListening(page)
  } else await recordSpeaking(page)
  await page.waitFor(`Array.from(document.querySelectorAll('button')).some((button) => ['完成训练', '完成本题并结束'].includes(button.innerText.trim()) && !button.disabled)`, 20_000)
  await page.clickByText('完成训练', '完成本题并结束')
  const completed = await waitForDailyExecutionCompleted(page, moduleId)
  const completionText = await page.bodyText()
  assert.match(completionText, /本模块今日任务已完成/u)
  assert.match(completionText, /继续训练/u)
  assert.doesNotMatch(completionText, /完成今日\s*3\/3\s*后再继续训练/u)

  // The real completion surface must route directly to this module's extra session.
  await page.clickByText('继续训练')
  await page.waitFor(
    `location.hash.startsWith(${JSON.stringify(`#/extra-training/${moduleId}?sessionId=`)})`,
    20_000,
  )
  await waitForExtraQuestion(page, moduleId)
  const directSessionId = new URLSearchParams(
    new URL(await page.url()).hash.split('?')[1] ?? '',
  ).get('sessionId')
  assert.ok(directSessionId)
  await exitExtra(page, moduleId)

  // Today and Training show only the independently qualified module as extra.
  await page.navigate(new URL('#/', baseUrl).href)
  await page.waitFor(`document.body.innerText.includes('今日安排')`, 20_000)
  const today = await page.evaluate(`(() => [...document.querySelectorAll('button.task-row')].map((b) => ({ moduleId: b.dataset.moduleId, taskId: b.dataset.taskId, text: b.innerText })))()`)
  assert.equal(executionFor(completed, moduleId).status, 'completed')
  const after = activeRuntime(await page.dumpIndexedDb()).activePlan
  for (const other of MODULES.filter((id) => id !== moduleId)) {
    assert.equal(executionFor(after, other).status, 'pending')
  }
  assert.deepEqual(
    after.tasks.map((x) => x.task.taskId),
    before.tasks.map((x) => x.task.taskId),
  )
  await page.clickByText('训练')
  await page.waitFor(`document.querySelectorAll('[data-training-area]').length === 3`, 20_000)
  await clickSelector(page, '[data-training-area="daily"]')
  await page.waitFor(`document.querySelectorAll('.module-card').length === 3`, 20_000)
  const cards = await page.evaluate(`(() => [...document.querySelectorAll('.module-card')].map((c) => ({moduleId:c.dataset.moduleId, availability:c.dataset.availability, text:c.innerText})))()`)
  assert.equal(cards.filter((c) => c.availability === 'extra-training').length, 1)
  assert.equal(cards.find((c) => c.moduleId === moduleId)?.availability, 'extra-training')
  assert.equal(cards.filter((c) => c.moduleId !== moduleId).every((c) => c.availability !== 'extra-training'), true)
  return { moduleId, directSessionId, cards, today }
}

async function waitForPicker(page) {
  await page.waitFor(
    `location.hash === '#/extra-training' &&
      document.body.innerText.includes('额外训练不设时长')`,
    20_000,
  )
}

async function pickerSnapshot(page) {
  return page.evaluate(`(() =>
    [...document.querySelectorAll('.extra-training-module-card')].map(
      (card) => ({
        moduleId: card.dataset.moduleId,
        status: card.dataset.extraTrainingStatus,
        text: card.innerText.trim(),
        buttonText:
          card.querySelector('button')?.innerText.trim() ?? null,
        disabled: Boolean(card.querySelector('button')?.disabled),
      })
    )
  )()`)
}

async function startOrResumeExtra(page, moduleId, rapid = false) {
  const result = await page.evaluate(`(() => {
    const card = [...document.querySelectorAll(
      '.extra-training-module-card'
    )].find(
      (candidate) =>
        candidate.dataset.moduleId === ${JSON.stringify(moduleId)}
    )
    const button = card?.querySelector('button')
    if (!button || button.disabled) {
      return { clicked: false, text: card?.innerText ?? null }
    }
    button.click()
    if (${rapid}) button.click()
    return { clicked: true, label: button.innerText.trim() }
  })()`)
  assert.equal(
    result.clicked,
    true,
    `Could not open extra ${moduleId}: ${JSON.stringify(result)}`,
  )
  await page.waitFor(
    `location.hash.startsWith(
      ${JSON.stringify(`#/extra-training/${moduleId}?sessionId=`)}
    ) && !document.body.innerText.includes('正在恢复') &&
      !document.body.innerText.includes('正在获取')`,
    20_000,
  )
  await waitForExtraQuestion(page, moduleId)
  const url = new URL(await page.url())
  const sessionId = new URLSearchParams(
    url.hash.split('?')[1] ?? '',
  ).get('sessionId')
  assert.ok(sessionId, `Extra ${moduleId} URL has no sessionId.`)
  return sessionId
}

async function waitForExtraQuestion(page, moduleId) {
  await waitForDailyQuestion(page, moduleId)
  assert.match(await page.bodyText(), /额外训练|额外.+训练/u)
}

async function exitExtra(page, moduleId) {
  const labels = {
    vocabulary: '退出并保存额外词汇训练',
    listening: '退出并保存额外听力训练',
    speaking: '退出并保存额外口语训练',
  }
  await page.clickByText(labels[moduleId])
  await waitForPicker(page)
}

function snapshotIdentity(snapshot) {
  return {
    itemId: snapshot.activeItem?.itemId ?? null,
    cursor:
      snapshot.suppliedNextCursor ??
      snapshot.session.nextSupplyCursor ??
      null,
    completedItemCount: snapshot.session.completedItemCount,
    effectiveSeconds:
      snapshot.session.effectiveSeconds ?? 0,
  }
}

async function verifyExitRefreshResume(page, moduleId, rapid = false) {
  const sessionId = await startOrResumeExtra(page, moduleId, rapid)
  const beforeDatabases = await page.dumpIndexedDb()
  const before = snapshotIdentity(
    extraFeatureSnapshot(beforeDatabases, moduleId, sessionId),
  )
  assert.ok(before.itemId, `${moduleId} has no released active item.`)
  await exitExtra(page, moduleId)
  const exited = extraSession(
    await page.dumpIndexedDb(),
    sessionId,
  )
  assert.equal(exited.status, 'paused')
  await page.reload()
  await waitForPicker(page)
  const restoredSessionId = await startOrResumeExtra(page, moduleId)
  assert.equal(restoredSessionId, sessionId)
  const after = snapshotIdentity(
    extraFeatureSnapshot(
      await page.dumpIndexedDb(),
      moduleId,
      sessionId,
    ),
  )
  assert.deepEqual(
    {
      itemId: after.itemId,
      cursor: after.cursor,
      completedItemCount: after.completedItemCount,
    },
    {
      itemId: before.itemId,
      cursor: before.cursor,
      completedItemCount: before.completedItemCount,
    },
  )
  assert.ok(
    after.effectiveSeconds >= before.effectiveSeconds &&
      after.effectiveSeconds <= before.effectiveSeconds + 1,
    `${moduleId} charged offline/refresh time: ${JSON.stringify({
      before,
      after,
    })}`,
  )
  await exitExtra(page, moduleId)
  return { sessionId, before, after }
}

async function verifyOpenEndedContinues(
  page,
  moduleId,
  sessionId,
) {
  const opened = await startOrResumeExtra(page, moduleId)
  assert.equal(opened, sessionId)
  const before = extraSession(await page.dumpIndexedDb(), sessionId)
  const body = await page.bodyText()
  assert.match(body, /不限时额外训练/u)
  assert.doesNotMatch(body, /剩余有效时间|完成本题并结束/u)

  if (moduleId === 'vocabulary') {
    await submitVocabularyAnswer(page)
  } else if (moduleId === 'listening') {
    await finishControlledSpeech(page)
    await answerListening(page)
  } else {
    await recordSpeaking(page)
  }
  await page.waitFor(
    `[...document.querySelectorAll('button')].some(
      (button) =>
        button.innerText.trim() === '下一题' &&
        !button.disabled
    )`,
    20_000,
  )
  await page.clickByText('下一题')
  await page.waitFor(
    `!document.querySelector('.extra-training-completion-screen')`,
    20_000,
  )
  await waitForExtraQuestion(page, moduleId)
  const after = extraSession(await page.dumpIndexedDb(), sessionId)
  assert.equal(after.status, 'running')
  assert.ok(after.completedItemCount > before.completedItemCount)
  assert.equal(after.completionMode, 'open-ended')
  assert.equal('targetEffectiveSeconds' in after, false)
  assert.equal('remainingEffectiveSeconds' in after, false)
  await exitExtra(page, moduleId)
  return after
}

async function forceExtraFinishCurrent(page, sessionId) {
  await updateStoredRecord(
    page,
    'learning.engine',
    'current-state',
    (state) => {
      const session = state.extraTraining?.sessions?.[sessionId]
      assert.ok(session, `Cannot control missing session ${sessionId}.`)
      session.remainingEffectiveSeconds = 0
      session.status = 'finish-current-item'
      session.endReason = null
      session.endedAt = null
      session.updatedAt = new Date().toISOString()
    },
  )
}

/** Historical pre-R6.1 completion probe retained for deployed-version audits. */
export async function completeExtra(page, moduleId, sessionId) {
  const opened = await startOrResumeExtra(page, moduleId)
  assert.equal(opened, sessionId)
  await forceExtraFinishCurrent(page, sessionId)
  await page.reload()
  await waitForExtraQuestion(page, moduleId)
  if (moduleId === 'vocabulary') {
    await submitVocabularyAnswer(page)
  } else if (moduleId === 'listening') {
    await finishControlledSpeech(page)
    assert.equal(
      extraSession(
        await page.dumpIndexedDb(),
        sessionId,
      ).status,
      'finish-current-item',
    )
    await answerListening(page)
  } else {
    await recordSpeaking(page)
    const hasPlayback = await page.evaluate(
      `[...document.querySelectorAll('button')].some((button) =>
        (button.innerText.trim() === '播放录音' ||
          button.getAttribute('aria-label') === '播放录音') &&
        !button.disabled
      )`,
    )
    assert.equal(
      hasPlayback,
      true,
      'Speaking fallback did not preserve recording playback.',
    )
    await page.clickByText('播放录音')
  }
  const completionTransition = await page.evaluate(`new Promise((resolve) => {
    const deadline = performance.now() + 10_000
    const inspect = () => {
      if (document.querySelector('.extra-training-completion-screen')) {
        resolve('completed')
        return
      }
      const action = [...document.querySelectorAll('button')].find(
        (button) =>
          button.innerText.trim() === '完成本题并结束' &&
          !button.disabled
      )
      if (action) {
        resolve('action')
        return
      }
      if (performance.now() >= deadline) {
        resolve('timeout')
        return
      }
      requestAnimationFrame(inspect)
    }
    requestAnimationFrame(inspect)
  })`)
  if (completionTransition === 'action') {
    await page.clickByText('完成本题并结束')
  } else if (completionTransition !== 'completed') {
    throw new Error(
      `Extra ${moduleId} did not expose its finish action: ${
        await page.bodyText()
      }`,
    )
  }
  await page.waitFor(
    `Boolean(document.querySelector(
      '.extra-training-completion-screen'
    ))`,
    20_000,
  )
  const completed = extraSession(
    await page.dumpIndexedDb(),
    sessionId,
  )
  assert.equal(completed.status, 'completed')
  assert.equal(completed.endReason, 'budget-reached')
  assert.equal(completed.remainingEffectiveSeconds, 0)
  assert.ok(completed.completedItemCount >= 1)
  assert.ok(
    completed.score,
    `Extra ${moduleId} completion is missing the R7 score ledger.`,
  )
  const scoreTotal =
    completed.score.correctCount +
    completed.score.incorrectCount
  assert.ok(
    scoreTotal > 0 || completed.score.unscorableCount > 0,
    `Extra ${moduleId} score contains no completed outcome.`,
  )
  const completionText = await page.bodyText()
  assert.match(
    completionText,
    new RegExp(
      `${completed.score.correctCount}\\s*/\\s*${scoreTotal}`,
      'u',
    ),
  )
  if (scoreTotal > 0) {
    assert.match(
      completionText,
      new RegExp(
        `正确率\\s*${Math.round(
          completed.score.correctCount / scoreTotal * 100,
        )}%`,
        'u',
      ),
    )
  } else {
    assert.match(completionText, /正确率无法计算/u)
  }
  return completed
}

async function assertDailyThreeOfThree(page, expectedRuntime) {
  const runtime = activeRuntime(await page.dumpIndexedDb())
  assert.deepEqual(runtime.activePlan, expectedRuntime.activePlan)
  assert.equal(runtime.activePlan.status, 'completed')
  assert.equal(runtime.activePlan.tasks.length, 3)
  assert.equal(
    runtime.activePlan.tasks.every(
      (execution) => execution.status === 'completed',
    ),
    true,
  )
  return runtime
}

async function assertResponsive(page, width, label) {
  await page.setViewport(width, 844)
  const layout = await page.layoutSnapshot()
  assert.equal(layout.viewportWidth, width)
  assert.ok(
    layout.documentWidth <= layout.viewportWidth,
    `${label} overflows at ${width}px: ${JSON.stringify(layout)}`,
  )
  return layout
}

async function assertPwaCache(page) {
  const snapshot = await page.serviceWorkerSnapshot()
  assert.equal(snapshot.supported, true)
  assert.ok(snapshot.controller)
  const urls = snapshot.caches.flatMap((cache) => cache.urls)
  const indexAssets = urls.filter((url) =>
    /\/assets\/index-[^/]+\.js(?:$|\?)/u.test(url),
  )
  assert.equal(
    new Set(indexAssets).size,
    1,
    `PWA cache must contain one current index asset: ${JSON.stringify(
      indexAssets,
    )}`,
  )
  const courseAssets = urls.filter(
    (url) =>
      /package-index|survival-travel-american|week-[1-4]|listening-exercise-extension-index|training-supply-index|listening-exercises|listening-choice-bilingual-options/u.test(
        url,
      ),
  )
  assert.equal(
    new Set(courseAssets).size,
    10,
    `PWA cache must contain all ten released course/supply resources.`,
  )
  assert.ok(
    courseAssets.some((url) =>
      /training-supply-index/u.test(url),
    ),
    'The 864-candidate supply index is not precached.',
  )
  if (expectedAsset) {
    assert.ok(
      indexAssets.some((url) => url.includes(expectedAsset)),
      `Expected deployed asset ${expectedAsset} is not active.`,
    )
  }
  return { indexAssets, courseAssets }
}

async function verifyOfflineCore(page) {
  await page.setOffline(true)
  try {
    await page.reload()
    await waitForPicker(page)
    assert.match(await page.bodyText(), /不会改变今日 3\/3 完成状态/u)

    const vocabularyId = await startOrResumeExtra(
      page,
      'vocabulary',
    )
    assert.ok(vocabularyId)
    assert.doesNotMatch(
      await page.bodyText(),
      /网络错误|暂时无法继续|provider-failure/u,
    )
    await exitExtra(page, 'vocabulary')

    const listeningId = await startOrResumeExtra(
      page,
      'listening',
    )
    assert.ok(listeningId)
    await finishControlledSpeech(page)
    assert.doesNotMatch(
      await page.bodyText(),
      /播放失败|暂时无法继续/u,
    )
    await exitExtra(page, 'listening')

    const speakingId = await startOrResumeExtra(
      page,
      'speaking',
    )
    assert.ok(speakingId)
    await recordSpeaking(page)
    assert.match(
      await page.bodyText(),
      /识别不可用|录音完成|无法评分/u,
    )
    assert.equal(
      await page.evaluate(
        `[...document.querySelectorAll('button')].some((button) =>
          button.innerText.trim() === '播放录音' &&
          !button.disabled
        )`,
      ),
      true,
    )
    await exitExtra(page, 'speaking')
    return { vocabularyId, listeningId, speakingId }
  } finally {
    await page.setOffline(false)
  }
}

async function run() {
  const qa = await launchQaChrome()
  try {
    await qa.page.initialize()
    await qa.page.addInitScript(fakeAssessmentClockScript)
    await qa.page.addInitScript(controlledSpeechSynthesisScript())
    await qa.page.addInitScript(
      process.env.QA_VERIFY_R8_RECOGNITION === '1'
        ? controlledRecognitionScript
        : disableRecognitionScript,
    )
    await qa.page.setViewport(390, 844)

    await prepareFirstDayPlan(qa.page)
    if (process.env.QA_VERIFY_R10_DICTATION === '1') {
      await updateStoredRecord(
        qa.page,
        'app.learning-runtime',
        'active-plan',
        (runtime) => {
          const execution = executionFor(runtime, 'listening')
          assert.ok(execution.training)
          execution.training.nextSupplyCursor =
            'supply-v1-listening-st4w-w1d4-ss-01'
        },
      )
      await qa.page.reload()
      await qa.page.waitFor(
        `location.hash === '#/' &&
          document.body.innerText.includes('任选一项开始')`,
        20_000,
      )
    }
    const generated = activeRuntime(await qa.page.dumpIndexedDb())
    assert.equal(generated.activePlan.plan.tasks.length, 3)
    assert.deepEqual(
      generated.activePlan.plan.tasks.map(
        (task) => task.trainingBudget?.targetEffectiveSeconds,
      ),
      [900, 900, 900],
    )
    checkpoint('r6-real-r1-plan-created', {
      planId: generated.activePlan.plan.planId,
      taskIds: Object.fromEntries(
        generated.activePlan.plan.tasks.map((task) => [
          task.targetModuleId,
          task.taskId,
        ]),
      ),
    })

    const r62FirstModule = process.env.QA_R62_FIRST_MODULE
    if (r62FirstModule) {
      assert.ok(MODULES.includes(r62FirstModule))
      const result = await verifyR62ModuleFirstCompletion(
        qa.page,
        r62FirstModule,
      )
      checkpoint('r62-module-first-completion', result)
      evidence.status = 'passed'
      console.log(JSON.stringify(evidence, null, 2))
      return
    }

    if (verifyR12Framework) {
      const result = await verifyR12TrainingFramework(qa.page)
      checkpoint('r12-r13a-training-framework', result)
      evidence.status = 'passed'
      console.log(JSON.stringify(evidence, null, 2))
      return
    }

    if (verifyR9Bilingual) {
      const result = await verifyR9ListeningChoiceFlow(qa.page)
      checkpoint('r9-listening-choice-bilingual-gate', result)
      evidence.status = 'passed'
      console.log(JSON.stringify(evidence, null, 2))
      return
    }

    if (dailyFirstOnly) {
      const vocabularyRuntime = await finishDailyModule(
        qa.page,
        'vocabulary',
      )
      await returnFromDailyModule(qa.page, 'vocabulary')
      const diagnostic = await completionTransitionDiagnostic(
        qa.page,
        'vocabulary',
      )
      checkpoint('r6-daily-first-only', {
        status: executionFor(
          vocabularyRuntime,
          'vocabulary',
        ).status,
        activePlanStatus:
          vocabularyRuntime.activePlan.status,
        diagnostic,
      })
      evidence.status = 'passed'
      console.log(JSON.stringify(evidence, null, 2))
      return
    }

    if (verifyThirtySecondTestMode) {
      const result = await verifyThirtySecondMode(qa.page)
      checkpoint('training-test-mode-30-seconds', result)
      evidence.status = 'passed'
      console.log(JSON.stringify(evidence, null, 2))
      return
    }

    const completedRuntime = await dailyPlanToThreeOfThree(qa.page)
    assert.match(
      await qa.page.bodyText(),
      /今日计划 3\/3 已完成/u,
    )
    assert.match(
      await qa.page.bodyText(),
      /额外练习不会改变今日完成状态/u,
    )
    await qa.page.reload()
    await qa.page.waitFor(
      `document.body.innerText.includes('今日计划 3/3 已完成')`,
      20_000,
    )
    await assertDailyThreeOfThree(qa.page, completedRuntime)
    checkpoint('r6-real-daily-plan-completed-3-of-3', {
      status: completedRuntime.activePlan.status,
      executions: completedRuntime.activePlan.tasks.map(
        (execution) => ({
          moduleId: execution.task.targetModuleId,
          taskId: execution.task.taskId,
          status: execution.status,
          budgetStatus: execution.training?.status,
        }),
      ),
    })

    await qa.page.clickByText('查看今日计划')
    await qa.page.waitFor(
      `location.hash === '#/' &&
        document.body.innerText.includes('今日计划')`,
      20_000,
    )
    await qa.page.clickByText('训练')
    await qa.page.waitFor(
      `document.querySelectorAll('[data-training-area]').length === 3`,
      20_000,
    )
    await clickSelector(
      qa.page,
      '[data-training-area="daily"]',
    )
    await qa.page.waitFor(
      `document.querySelectorAll(
        '.module-card[data-availability="extra-training"]'
      ).length === 3`,
      20_000,
    )
    const practiceEntries = await qa.page.evaluate(`(() =>
      [...document.querySelectorAll(
        '.module-card[data-availability="extra-training"]'
      )].map((card) => ({
        moduleId: card.dataset.moduleId,
        disabled: Boolean(card.disabled),
        text: card.innerText.trim(),
      }))
    )()`)
    assert.deepEqual(
      practiceEntries.map(({ moduleId, disabled }) => ({
        moduleId,
        disabled,
      })),
      MODULES.map((moduleId) => ({
        moduleId,
        disabled: false,
      })),
    )
    assert.equal(
      practiceEntries.every(
        (entry) =>
          entry.text.includes('继续训练') &&
          entry.text.includes('不限时'),
      ),
      true,
    )
    const directVocabularyStart = await qa.page.evaluate(`(() => {
      const card = document.querySelector(
        '.module-card[data-module-id="vocabulary"]' +
        '[data-availability="extra-training"]'
      )
      if (!card || card.disabled) return false
      card.click()
      return true
    })()`)
    assert.equal(directVocabularyStart, true)
    await qa.page.waitFor(
      `location.hash.startsWith(
        '#/extra-training/vocabulary?sessionId='
      )`,
      20_000,
    )
    await waitForExtraQuestion(qa.page, 'vocabulary')
    await exitExtra(qa.page, 'vocabulary')
    await waitForPicker(qa.page)
    const initialPicker = await pickerSnapshot(qa.page)
    assert.deepEqual(
      initialPicker.map(({ moduleId, status }) => ({
        moduleId,
        status,
      })),
      [
        { moduleId: 'vocabulary', status: 'paused' },
        { moduleId: 'listening', status: 'available' },
        { moduleId: 'speaking', status: 'available' },
      ],
    )
    assert.equal(
      initialPicker.every(
        (module) =>
          module.text.includes('主动退出') &&
          module.disabled === false,
      ),
      true,
    )
    const picker320 = await assertResponsive(
      qa.page,
      320,
      'R6 picker',
    )
    const picker390 = await assertResponsive(
      qa.page,
      390,
      'R6 picker',
    )
    checkpoint('r6-training-tab-direct-extra-entry', {
      practiceEntries,
    })

    const recovery = {}
    for (const [index, moduleId] of MODULES.entries()) {
      recovery[moduleId] = await verifyExitRefreshResume(
        qa.page,
        moduleId,
        index === 0,
      )
      await assertDailyThreeOfThree(qa.page, completedRuntime)
    }
    assert.equal(
      extraSessions(
        await qa.page.dumpIndexedDb(),
        'vocabulary',
      ).length,
      1,
      'Rapid double start created duplicate vocabulary sessions.',
    )
    checkpoint('r6-three-routes-exit-refresh-resume', {
      recovery,
      picker320,
      picker390,
    })

    const openEndedExtras = {}
    for (const moduleId of MODULES) {
      openEndedExtras[moduleId] = await verifyOpenEndedContinues(
        qa.page,
        moduleId,
        recovery[moduleId].sessionId,
      )
      await assertDailyThreeOfThree(qa.page, completedRuntime)
    }
    checkpoint('r6-open-ended-all-modules', {
      modules: Object.fromEntries(
        Object.entries(openEndedExtras).map(
          ([moduleId, session]) => [
            moduleId,
            {
              sessionId: session.sessionId,
              status: session.status,
              completedItemCount: session.completedItemCount,
              effectiveSeconds: session.effectiveSeconds,
            },
          ],
        ),
      ),
      speechProbe: await qa.page.speechSynthesisSnapshot(),
    })

    const freshSpeakingStarted = await qa.page.evaluate(`(() => {
      const card = document.querySelector(
        '.extra-training-module-card[data-module-id="speaking"]'
      )
      const button = [...(card?.querySelectorAll('button') ?? [])]
        .find((candidate) =>
          candidate.innerText.trim() === '开始新一轮'
        )
      if (!button || button.disabled) return false
      button.click()
      return true
    })()`)
    assert.equal(freshSpeakingStarted, true)
    await qa.page.waitFor(
      `location.hash.startsWith(
        '#/extra-training/speaking?sessionId='
      )`,
      20_000,
    )
    const freshSpeakingId = new URL(
      await qa.page.url(),
    ).hash.split('sessionId=')[1]?.split('&')[0]
    assert.ok(freshSpeakingId)
    assert.notEqual(
      decodeURIComponent(freshSpeakingId),
      recovery.speaking.sessionId,
    )
    const replacedSpeaking = extraSession(
      await qa.page.dumpIndexedDb(),
      recovery.speaking.sessionId,
    )
    assert.equal(replacedSpeaking.status, 'expired')
    assert.equal(replacedSpeaking.endReason, 'user-restarted')
    await waitForExtraQuestion(qa.page, 'speaking')
    await exitExtra(qa.page, 'speaking')
    checkpoint('r6-user-starts-fresh-round', {
      previousSessionId: recovery.speaking.sessionId,
      newSessionId: decodeURIComponent(freshSpeakingId),
    })

    const pwa = await assertPwaCache(qa.page)
    const offline = await verifyOfflineCore(qa.page)
    await assertDailyThreeOfThree(qa.page, completedRuntime)
    checkpoint('r6-pwa-offline-core', { pwa, offline })

    assert.equal(
      qa.page.pageErrors.some((message) =>
        /JSON-portable|identity.*match|provider-failure/u.test(
          message,
        ),
      ),
      false,
      qa.page.pageErrors.join('\n'),
    )
    evidence.status = 'passed'
    console.log(JSON.stringify(evidence, null, 2))
  } finally {
    await qa.close()
  }
}

run().catch((error) => {
  evidence.status = 'failed'
  evidence.error =
    error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(JSON.stringify(evidence, null, 2))
  process.exitCode = 1
})
