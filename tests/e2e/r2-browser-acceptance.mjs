import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  fakeAssessmentClockScript,
  fakeNeutralSpeechSynthesisScript,
  launchQaChrome,
} from './lib/cdp-browser.mjs'

const baseUrl = new URL(
  process.env.QA_BASE_URL ??
    'https://rayzhang988.github.io/english-learning-pwa/',
)
const expectedAsset =
  process.env.QA_R2_EXPECTED_ASSET ?? 'index-CgCA6fnf.js'
const expectedPagesRun =
  process.env.QA_R2_PAGES_RUN ?? '30254660989'
const expectedCommits = {
  learningEngine: '32b952a',
  ui: '13094f7',
  app: '463bee4',
  state: 'c5fd00d',
}
const MODULES = ['vocabulary', 'listening', 'speaking']
const COMPLETION_ORDERS = [
  ['vocabulary', 'listening', 'speaking'],
  ['vocabulary', 'speaking', 'listening'],
  ['listening', 'vocabulary', 'speaking'],
  ['listening', 'speaking', 'vocabulary'],
  ['speaking', 'vocabulary', 'listening'],
  ['speaking', 'listening', 'vocabulary'],
]
const FIRST_SURFACES = [
  'training',
  'today',
  'training',
  'today',
  'training',
  'today',
]
const evidence = {
  baseUrl: baseUrl.href,
  expectedAsset,
  expectedPagesRun,
  expectedCommits,
  isolatedProfiles: true,
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

function taskIdsByModule(runtime) {
  const entries = runtime.activePlan.plan.tasks.map((task) => [
    task.targetModuleId,
    task.taskId,
  ])
  assert.deepEqual(
    entries.map(([moduleId]) => moduleId).sort(),
    MODULES.slice().sort(),
  )
  const result = Object.fromEntries(entries)
  assert.equal(new Set(Object.values(result)).size, 3)
  return result
}

function sessionRecord(databases, moduleId, taskId) {
  return recordByNamespaceAndKey(
    databases,
    `feature.${moduleId}`,
    `session:${taskId}`,
  )
}

function durableSessionResult(session) {
  return {
    taskId: session.task?.taskId ?? null,
    phase: session.phase,
    questionIndex: session.questionIndex ?? null,
    promptIndex: session.promptIndex ?? null,
    answers: session.answers ?? [],
  }
}

function queryForSurface(surface) {
  return surface === 'today'
    ? 'button.task-row'
    : 'button.module-card'
}

async function cardsForSurface(page, surface) {
  await page.navigate(new URL('#/', baseUrl).href)
  await page.waitFor(
    `!document.body.innerText.includes('正在恢复今日学习计划')`,
    20_000,
  )
  if (surface === 'today') {
    if (!(await page.bodyText()).includes('任选一项开始')) {
      await page.clickByText('今天')
    }
    await page.waitFor(
      `document.body.innerText.includes('任选一项开始')`,
      20_000,
    )
  } else {
    if (!(await page.bodyText()).includes('选择训练')) {
      await page.clickByText('训练')
    }
    await page.waitFor(
      `Boolean(document.querySelector('.module-grid')) &&
        document.body.innerText.includes('选择训练')`,
      20_000,
    )
  }
  return page.evaluate(`(() =>
    [...document.querySelectorAll(${JSON.stringify(
      queryForSurface(surface),
    )})].map((button) => ({
      moduleId: button.dataset.moduleId ?? null,
      taskId: button.dataset.taskId ?? null,
      availability: button.dataset.availability ?? null,
      recommended: button.dataset.recommended === 'true',
      disabled: Boolean(button.disabled),
      text: button.innerText.trim(),
      ariaLabel: button.getAttribute('aria-label'),
    }))
  )()`)
}

function specialtyCards(cards) {
  return cards.filter((card) => MODULES.includes(card.moduleId))
}

function assertInitialFreeChoice(cards, expectedTaskIds, label) {
  const specialty = specialtyCards(cards)
  assert.equal(specialty.length, 3, `${label} did not show three tasks.`)
  assert.equal(
    specialty.filter((card) => card.recommended).length,
    1,
    `${label} must show exactly one non-binding recommendation.`,
  )
  assert.equal(
    new Set(specialty.map((card) => card.taskId)).size,
    3,
    `${label} reused a taskId across modules.`,
  )
  for (const moduleId of MODULES) {
    const card = specialty.find(
      (candidate) => candidate.moduleId === moduleId,
    )
    assert.ok(card, `${label} is missing ${moduleId}.`)
    assert.equal(card.taskId, expectedTaskIds[moduleId])
    assert.equal(card.availability, 'startable')
    assert.equal(card.disabled, false)
    assert.doesNotMatch(
      `${card.text} ${card.ariaLabel ?? ''}`,
      /尚未轮到|完成当前任务后|暂无可用训练|训练内容接入后/u,
    )
  }
}

function assertProgressCards(
  cards,
  expectedTaskIds,
  completedModules,
  label,
) {
  const specialty = specialtyCards(cards)
  assert.equal(specialty.length, 3)
  for (const moduleId of MODULES) {
    const card = specialty.find(
      (candidate) => candidate.moduleId === moduleId,
    )
    assert.ok(card, `${label} is missing ${moduleId}.`)
    assert.equal(card.taskId, expectedTaskIds[moduleId])
    if (completedModules.has(moduleId)) {
      assert.equal(card.disabled, true)
      assert.equal(card.availability, 'unavailable')
      assert.match(card.text, /已完成/u)
    } else {
      assert.equal(card.disabled, false)
      assert.equal(card.availability, 'startable')
      assert.doesNotMatch(
        `${card.text} ${card.ariaLabel ?? ''}`,
        /尚未轮到|完成当前任务后/u,
      )
    }
  }
  const unfinished = specialty.filter(
    (card) => !completedModules.has(card.moduleId),
  )
  assert.equal(
    unfinished.filter((card) => card.recommended).length,
    unfinished.length === 0 ? 0 : 1,
    `${label} recommendation count is not consistent.`,
  )
}

async function clickModuleCard(
  page,
  surface,
  moduleId,
  rapid = false,
) {
  const result = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(
      queryForSurface(surface),
    )})].find(
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
    if (${JSON.stringify(rapid)}) button.click()
    return {
      clicked: true,
      taskId: button.dataset.taskId ?? null,
    }
  })()`)
  assert.equal(
    result.clicked,
    true,
    `Could not start ${moduleId} from ${surface}: ${JSON.stringify(result)}`,
  )
  return result.taskId
}

async function waitForModuleRoute(page, moduleId, taskId) {
  await page.waitFor(
    `location.hash.includes(${JSON.stringify(`/${moduleId}?taskId=`)}) &&
      !document.body.innerText.includes(${JSON.stringify(
        `正在加载${
          moduleId === 'vocabulary'
            ? '词汇'
            : moduleId === 'listening'
              ? '听力'
              : '口语'
        }训练`,
      )})`,
    20_000,
  )
  const url = await page.url()
  const hashQuery = new URL(url).hash.split('?')[1] ?? ''
  assert.equal(new URLSearchParams(hashQuery).get('taskId'), taskId)
  const text = await page.bodyText()
  assert.doesNotMatch(
    text,
    /暂无可用训练|训练内容接入后会显示在这里|暂时无法继续/u,
  )
  assert.match(
    text,
    moduleId === 'vocabulary'
      ? /词汇/u
      : moduleId === 'listening'
        ? /听力/u
        : /口语/u,
  )
  return { url, text: text.slice(0, 1_200) }
}

async function completeVocabulary(page, rapidCompletion) {
  for (let question = 0; question < 12; question += 1) {
    if ((await page.bodyText()).includes('词汇任务已完成')) break
    await page.clickFirstEnabledChoice()
    await page.waitFor(
      `[...document.querySelectorAll('button')].some((button) =>
        button.innerText.trim() === '提交答案' && !button.disabled
      )`,
    )
    await page.clickByText('提交答案')
    await page.waitFor(
      `[...document.querySelectorAll('button')].some((button) =>
        ['下一题', '完成训练'].includes(button.innerText.trim()) &&
        !button.disabled
      )`,
    )
    const completes = await page.evaluate(
      `[...document.querySelectorAll('button')].some((button) =>
        button.innerText.trim() === '完成训练' && !button.disabled
      )`,
    )
    if (completes && rapidCompletion) {
      await page.evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find(
          (candidate) =>
            candidate.innerText.trim() === '完成训练' &&
            !candidate.disabled
        )
        button.click()
        button.click()
      })()`)
    } else {
      await page.clickByText(completes ? '完成训练' : '下一题')
    }
    if (completes) break
  }
  await page.waitFor(
    `document.body.innerText.includes('词汇任务已完成')`,
    20_000,
  )
}

async function completeListening(page, rapidCompletion) {
  for (let question = 0; question < 12; question += 1) {
    if ((await page.bodyText()).includes('听力任务已完成')) break
    await page.clickByText('播放音频')
    await page.waitFor(
      `document.body.innerText.includes('播放完毕') ||
        document.body.innerText.includes('播放失败')`,
      30_000,
    )
    assert.doesNotMatch(await page.bodyText(), /播放失败/u)
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
      const filled = await page.evaluate(`(() => {
        const input = document.querySelector(
          'input[type="text"], textarea'
        )
        if (!input || input.disabled) return false
        const setter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(input),
          'value',
        )?.set
        setter?.call(input, 'hello')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
      assert.equal(filled, true)
    }
    await page.waitFor(
      `[...document.querySelectorAll('button')].some((button) =>
        button.innerText.trim() === '提交答案' && !button.disabled
      )`,
    )
    await page.clickByText('提交答案')
    await page.waitFor(
      `[...document.querySelectorAll('button')].some((button) =>
        ['下一题', '完成训练'].includes(button.innerText.trim()) &&
        !button.disabled
      )`,
    )
    const completes = await page.evaluate(
      `[...document.querySelectorAll('button')].some((button) =>
        button.innerText.trim() === '完成训练' && !button.disabled
      )`,
    )
    if (completes && rapidCompletion) {
      await page.evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find(
          (candidate) =>
            candidate.innerText.trim() === '完成训练' &&
            !candidate.disabled
        )
        button.click()
        button.click()
      })()`)
    } else {
      await page.clickByText(completes ? '完成训练' : '下一题')
    }
    if (completes) break
  }
  await page.waitFor(
    `document.body.innerText.includes('听力任务已完成')`,
    20_000,
  )
}

async function completeSpeaking(page, rapidCompletion) {
  for (let prompt = 0; prompt < 3; prompt += 1) {
    await page.clickByText('开始录音')
    await page.waitFor(
      `document.body.innerText.includes('正在录音')`,
    )
    await page.evaluate(
      `new Promise((resolve) => setTimeout(resolve, 300))`,
    )
    await page.clickByText('停止录音')
    await page.waitFor(
      `[...document.querySelectorAll('button')].some((button) =>
        ['下一题', '完成训练'].includes(button.innerText.trim()) &&
        !button.disabled
      )`,
      20_000,
    )
    if (prompt === 2 && rapidCompletion) {
      await page.evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find(
          (candidate) =>
            candidate.innerText.trim() === '完成训练' &&
            !candidate.disabled
        )
        button.click()
        button.click()
      })()`)
    } else {
      await page.clickByText(
        prompt === 2 ? '完成训练' : '下一题',
      )
    }
    if (prompt < 2) {
      await page.waitFor(
        `[...document.querySelectorAll('button')].some((button) =>
          (button.innerText.trim() === '开始录音' ||
            button.getAttribute('aria-label') === '开始录音') &&
          !button.disabled
        )`,
      )
    }
  }
  await page.waitFor(
    `document.body.innerText.includes('口语练习已结束')`,
    20_000,
  )
}

async function completeModule(page, moduleId, rapidCompletion) {
  if (moduleId === 'vocabulary') {
    await completeVocabulary(page, rapidCompletion)
    return
  }
  if (moduleId === 'listening') {
    await completeListening(page, rapidCompletion)
    return
  }
  await completeSpeaking(page, rapidCompletion)
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

async function prepareQaBrowser(width) {
  const qa = await launchQaChrome()
  await qa.page.initialize()
  await qa.page.addInitScript(fakeAssessmentClockScript)
  await qa.page.addInitScript(fakeNeutralSpeechSynthesisScript())
  await qa.page.setViewport(width, 844)
  return qa
}

async function createFormalBaseline() {
  const qa = await prepareQaBrowser(390)
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
    await qa.page.waitFor(
      `location.hash === '#/' &&
        !document.body.innerText.includes('正在恢复今日学习计划') &&
        document.body.innerText.includes('任选一项开始')`,
      20_000,
    )

    const databases = await qa.page.dumpIndexedDb()
    const runtime = activeRuntime(databases)
    assert.equal(runtime.activePlan.status, 'not-started')
    assert.equal(runtime.activePlan.plan.targetSeconds, 2_700)
    assert.equal(runtime.activePlan.plan.tasks.length, 3)
    assert.equal(
      JSON.stringify(runtime.activePlan).includes('recommendedTaskId'),
      false,
      'R2 recommendation was persisted into the schema 1 plan.',
    )
    const taskIds = taskIdsByModule(runtime)
    const today = await cardsForSurface(qa.page, 'today')
    const training = await cardsForSurface(qa.page, 'training')
    assertInitialFreeChoice(today, taskIds, 'Today')
    assertInitialFreeChoice(training, taskIds, 'Training')

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
    checkpoint('r2-formal-baseline', {
      profileSchemaVersion:
        requiredRecords.find(
          (record) => record.key === 'latest-ability-profile',
        )?.value?.schemaVersion,
      planId: runtime.activePlan.plan.planId,
      planSchemaVersion: runtime.activePlan.schemaVersion,
      taskIds,
      today,
      training,
    })
    return {
      records: requiredRecords,
      taskIds,
      planId: runtime.activePlan.plan.planId,
    }
  } finally {
    await qa.close()
  }
}

async function seedFormalBaseline(page, records) {
  await page.navigate(new URL('#/', baseUrl).href)
  await page.waitFor(`document.readyState === 'complete'`)
  await putRecords(page, records)
  await page.reload()
  await page.waitFor(
    `!document.body.innerText.includes('正在恢复今日学习计划') &&
      document.body.innerText.includes('任选一项开始')`,
    20_000,
  )
}

async function assertResponsive(page, width, surface) {
  const layout = await page.layoutSnapshot()
  assert.equal(layout.viewportWidth, width)
  assert.ok(
    layout.documentWidth <= layout.viewportWidth,
    `${surface} overflows at ${width}px: ${JSON.stringify(layout)}`,
  )
  return layout
}

async function runCompletionOrder(
  baseline,
  order,
  firstSurface,
  index,
) {
  const width = index % 2 === 0 ? 320 : 390
  const qa = await prepareQaBrowser(width)
  const completed = new Set()
  const sessionDigests = {}
  try {
    await seedFormalBaseline(qa.page, baseline.records)
    const restored = activeRuntime(await qa.page.dumpIndexedDb())
    assert.equal(restored.activePlan.schemaVersion, 1)
    assert.equal(restored.activePlan.plan.planId, baseline.planId)
    assert.equal(
      JSON.stringify(restored.activePlan).includes('recommendedTaskId'),
      false,
    )

    const initialToday = await cardsForSurface(qa.page, 'today')
    assertInitialFreeChoice(initialToday, baseline.taskIds, 'Today')
    const todayLayout = await assertResponsive(
      qa.page,
      width,
      'Today',
    )
    const initialTraining = await cardsForSurface(qa.page, 'training')
    assertInitialFreeChoice(
      initialTraining,
      baseline.taskIds,
      'Training',
    )
    const trainingLayout = await assertResponsive(
      qa.page,
      width,
      'Training',
    )

    for (let step = 0; step < order.length; step += 1) {
      const moduleId = order[step]
      const surface = step === 0 ? firstSurface : 'today'
      const cards = await cardsForSurface(qa.page, surface)
      assertProgressCards(
        cards,
        baseline.taskIds,
        completed,
        `${surface}:${order.join('-')}:${step}`,
      )
      const clickedTaskId = await clickModuleCard(
        qa.page,
        surface,
        moduleId,
        step === 0,
      )
      assert.equal(clickedTaskId, baseline.taskIds[moduleId])
      const route = await waitForModuleRoute(
        qa.page,
        moduleId,
        baseline.taskIds[moduleId],
      )
      await completeModule(
        qa.page,
        moduleId,
        index === 0 && step === 0,
      )

      const beforeReturn = await qa.page.dumpIndexedDb()
      const completedSession = sessionRecord(
        beforeReturn,
        moduleId,
        baseline.taskIds[moduleId],
      )
      assert.ok(
        completedSession,
        `${moduleId} did not persist its production session.`,
      )
      assert.equal(completedSession.value?.phase, 'completed')
      sessionDigests[moduleId] = digest(
        durableSessionResult(completedSession.value),
      )

      await qa.page.clickByText('返回今日计划')
      await qa.page.waitFor(
        `location.hash === '#/' &&
          !document.body.innerText.includes('正在恢复今日学习计划')`,
        20_000,
      )
      await qa.page.reload()
      await qa.page.waitFor(
        `!document.body.innerText.includes('正在恢复今日学习计划')`,
        20_000,
      )
      completed.add(moduleId)

      const afterRefresh = await qa.page.dumpIndexedDb()
      const runtime = activeRuntime(afterRefresh)
      const completedTaskCount = runtime.activePlan.tasks.filter(
        (execution) => execution.status === 'completed',
      ).length
      assert.equal(completedTaskCount, step + 1)
      assert.equal(
        runtime.activePlan.status === 'completed',
        step === 2,
      )
      for (const finishedModule of completed) {
        const restoredSession = sessionRecord(
          afterRefresh,
          finishedModule,
          baseline.taskIds[finishedModule],
        )
        assert.ok(restoredSession)
        assert.equal(restoredSession.value?.phase, 'completed')
        assert.equal(
          digest(durableSessionResult(restoredSession.value)),
          sessionDigests[finishedModule],
          `${finishedModule} result changed after ${moduleId} and refresh.`,
        )
      }

      const todayAfter = await cardsForSurface(qa.page, 'today')
      assertProgressCards(
        todayAfter,
        baseline.taskIds,
        completed,
        `Today after ${step + 1}/3`,
      )
      const trainingAfter = await cardsForSurface(
        qa.page,
        'training',
      )
      assertProgressCards(
        trainingAfter,
        baseline.taskIds,
        completed,
        `Training after ${step + 1}/3`,
      )
      checkpoint('r2-order-step', {
        order: order.join('→'),
        firstSurface,
        step: step + 1,
        moduleId,
        taskId: baseline.taskIds[moduleId],
        route: route.url,
        completedTaskCount,
        planCompleted: runtime.activePlan.status === 'completed',
      })
    }

    const finalDatabases = await qa.page.dumpIndexedDb()
    const finalRuntime = activeRuntime(finalDatabases)
    assert.equal(finalRuntime.activePlan.status, 'completed')
    assert.deepEqual(
      finalRuntime.activePlan.tasks
        .map((execution) => execution.task.targetModuleId)
        .sort(),
      MODULES.slice().sort(),
    )
    assert.equal(
      finalRuntime.activePlan.tasks.every(
        (execution) => execution.status === 'completed',
      ),
      true,
    )
    assert.equal(
      new Set(finalRuntime.processedEventIds).size,
      finalRuntime.processedEventIds.length,
      'Duplicate completion produced duplicate processed event IDs.',
    )
    for (const moduleId of MODULES) {
      assert.equal(
        sessionRecord(
          finalDatabases,
          moduleId,
          baseline.taskIds[moduleId],
        )?.value?.phase,
        'completed',
      )
    }
    return {
      order: order.join('→'),
      firstSurface,
      width,
      planCompleted: true,
      completedTaskCount: 3,
      todayLayout,
      trainingLayout,
      resultDigests: sessionDigests,
    }
  } finally {
    await qa.close()
  }
}

async function runInterruptedRecommendation(baseline) {
  const qa = await prepareQaBrowser(390)
  try {
    await seedFormalBaseline(qa.page, baseline.records)
    const today = await cardsForSurface(qa.page, 'today')
    const initialRecommended = specialtyCards(today).find(
      (card) => card.recommended,
    )?.moduleId
    const interruptedModule =
      initialRecommended === 'listening' ? 'vocabulary' : 'listening'
    await clickModuleCard(
      qa.page,
      'today',
      interruptedModule,
      false,
    )
    await waitForModuleRoute(
      qa.page,
      interruptedModule,
      baseline.taskIds[interruptedModule],
    )
    if (interruptedModule === 'listening') {
      await qa.page.clickByText('播放音频')
      await qa.page.waitFor(
        `document.body.innerText.includes('播放完毕')`,
      )
      await qa.page.clickByText('退出听力训练')
    } else {
      await qa.page.clickFirstEnabledChoice()
      await qa.page.clickByText('退出词汇训练')
    }
    await qa.page.waitFor(
      `location.hash === '#/' &&
        !document.body.innerText.includes('正在恢复今日学习计划')`,
      20_000,
    )
    await qa.page.reload()
    await qa.page.waitFor(
      `!document.body.innerText.includes('正在恢复今日学习计划')`,
      20_000,
    )
    const interruptedRuntime = activeRuntime(
      await qa.page.dumpIndexedDb(),
    )
    assert.equal(
      interruptedRuntime.activePlan.tasks.find(
        (execution) =>
          execution.task.targetModuleId === interruptedModule,
      )?.status,
      'paused',
    )

    const afterPause = await cardsForSurface(qa.page, 'today')
    const pausedCard = specialtyCards(afterPause).find(
      (card) => card.moduleId === interruptedModule,
    )
    assert.equal(pausedCard?.recommended, true)
    assert.equal(pausedCard?.disabled, false)
    const alternative = MODULES.find(
      (moduleId) => moduleId !== interruptedModule,
    )
    assert.ok(alternative)
    const alternativeCard = specialtyCards(afterPause).find(
      (card) => card.moduleId === alternative,
    )
    assert.equal(alternativeCard?.recommended, false)
    assert.equal(alternativeCard?.disabled, false)

    const training = await cardsForSurface(qa.page, 'training')
    assert.equal(
      specialtyCards(training).find(
        (card) => card.moduleId === interruptedModule,
      )?.recommended,
      true,
    )
    await clickModuleCard(qa.page, 'training', alternative)
    const alternativeRoute = await waitForModuleRoute(
      qa.page,
      alternative,
      baseline.taskIds[alternative],
    )
    checkpoint('r2-paused-recommendation-is-nonbinding', {
      interruptedModule,
      initialRecommended,
      recommendedAfterPause: interruptedModule,
      alternativeStarted: alternative,
      alternativeRoute: alternativeRoute.url,
    })
  } finally {
    await qa.close()
  }
}

async function runInvalidStateRejection(baseline) {
  const qa = await prepareQaBrowser(390)
  try {
    await seedFormalBaseline(qa.page, baseline.records)
    const activePlanRecord = baseline.records.find(
      (record) =>
        record.namespace === 'app.learning-runtime' &&
        record.key === 'active-plan',
    )
    assert.ok(activePlanRecord)
    const corrupted = structuredClone(activePlanRecord)
    const corruptedExecution =
      corrupted.value.activePlan.tasks.find(
        (execution) =>
          execution.task.targetModuleId === 'vocabulary',
      )
    assert.ok(corruptedExecution)
    corruptedExecution.task.contentRef =
      `${corruptedExecution.task.contentRef}:corrupted`
    await putRecords(qa.page, [corrupted])
    await qa.page.reload()
    await qa.page.waitFor(
      `!document.body.innerText.includes('正在恢复今日学习计划')`,
      20_000,
    )

    const today = await cardsForSurface(qa.page, 'today')
    const corruptedToday = specialtyCards(today).find(
      (card) => card.moduleId === 'vocabulary',
    )
    assert.equal(corruptedToday?.disabled, true)
    assert.equal(corruptedToday?.availability, 'unavailable')
    assert.match(corruptedToday?.text ?? '', /任务异常|数据不完整/u)
    for (const moduleId of ['listening', 'speaking']) {
      assert.equal(
        specialtyCards(today).find(
          (card) => card.moduleId === moduleId,
        )?.disabled,
        false,
      )
    }

    const training = await cardsForSurface(qa.page, 'training')
    const corruptedTraining = specialtyCards(training).find(
      (card) => card.moduleId === 'vocabulary',
    )
    assert.equal(corruptedTraining?.disabled, true)
    assert.match(
      corruptedTraining?.text ?? '',
      /任务异常|数据不完整/u,
    )

    const missingTaskId = 'qa-r2-missing-task'
    await qa.page.navigate(
      new URL(
        `#/vocabulary?taskId=${encodeURIComponent(missingTaskId)}`,
        baseUrl,
      ).href,
    )
    await qa.page.waitFor(
      `!document.body.innerText.includes('正在加载词汇训练')`,
      20_000,
    )
    const missingText = await qa.page.bodyText()
    assert.match(missingText, /无法打开训练任务/u)
    assert.match(
      missingText,
      /taskId is not part of the active daily plan/u,
    )
    assert.doesNotMatch(missingText, /请选择正确答案|提交答案/u)
    checkpoint('r2-invalid-and-missing-task-rejection', {
      corruptedModule: 'vocabulary',
      todayCard: corruptedToday,
      trainingCard: corruptedTraining,
      missingTaskId,
      missingRouteText: missingText.slice(0, 800),
    })
  } finally {
    await qa.close()
  }
}

async function releaseEvidence() {
  const indexResponse = await fetch(baseUrl)
  assert.equal(indexResponse.status, 200)
  const html = await indexResponse.text()
  assert.match(
    html,
    new RegExp(`assets/${expectedAsset.replace('.', '\\.')}`, 'u'),
  )

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

  const runResponse = await fetch(
    `https://api.github.com/repos/rayzhang988/english-learning-pwa/actions/runs/${expectedPagesRun}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'english-learning-pwa-r2-qa',
      },
    },
  )
  assert.equal(
    runResponse.status,
    200,
    `GitHub Actions run ${expectedPagesRun} was not readable.`,
  )
  const run = await runResponse.json()
  assert.equal(run.status, 'completed')
  assert.equal(run.conclusion, 'success')
  checkpoint('r2-release-evidence', {
    resources,
    run: {
      id: String(run.id),
      status: run.status,
      conclusion: run.conclusion,
      htmlUrl: run.html_url,
      headSha: run.head_sha,
    },
  })
}

try {
  await releaseEvidence()
  const baseline = await createFormalBaseline()
  const orderResults = []
  for (let index = 0; index < COMPLETION_ORDERS.length; index += 1) {
    orderResults.push(
      await runCompletionOrder(
        baseline,
        COMPLETION_ORDERS[index],
        FIRST_SURFACES[index],
        index,
      ),
    )
  }
  await runInterruptedRecommendation(baseline)
  await runInvalidStateRejection(baseline)
  checkpoint('r2-six-orders-complete', { orderResults })
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
