import assert from 'node:assert/strict'
import {
  fakeAssessmentClockScript,
  fakeNeutralSpeechSynthesisScript,
  launchQaChrome,
} from './lib/cdp-browser.mjs'

const baseUrl = new URL(
  process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173/',
)
const evidence = {
  status: 'running',
  baseUrl: baseUrl.href,
  isolatedProfile: true,
  checkpoints: [],
}

function checkpoint(name, details = {}) {
  evidence.checkpoints.push({ name, ...details })
}

function records(databases) {
  return databases.flatMap(
    (database) => database.stores.records ?? [],
  )
}

function recordFor(databases, namespace, key) {
  return records(databases).find(
    (record) =>
      record.namespace === namespace &&
      (key === undefined || record.key === key),
  )
}

function activeRuntime(databases) {
  const record = recordFor(
    databases,
    'app.learning-runtime',
    'active-plan',
  )
  assert.ok(record, 'The active-plan record is missing.')
  return record.value
}

function vocabularySession(databases) {
  const record = recordFor(databases, 'feature.vocabulary')
  assert.ok(record, 'The vocabulary session record is missing.')
  return record.value
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

async function taskCards(page, selector) {
  return page.evaluate(`(() =>
    [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((button) =>
        ['vocabulary', 'listening', 'speaking'].includes(
          button.dataset.moduleId
        )
      )
      .map((button) => {
        const budget = button.querySelector(
          '[data-training-duration-kind="training-budget"]'
        )
        return {
          moduleId: button.dataset.moduleId,
          taskId: button.dataset.taskId,
          disabled: Boolean(button.disabled),
          text: button.innerText.trim(),
          targetEffectiveSeconds: budget
            ? Number(budget.dataset.targetEffectiveSeconds)
            : null,
        }
      })
  )()`)
}

async function completeCurrentVocabularyItem(page) {
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
  const action = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) =>
        ['下一题', '完成训练'].includes(candidate.innerText.trim()) &&
        !candidate.disabled
    )
    return button?.innerText.trim() ?? null
  })()`)
  assert.ok(action, 'Vocabulary feedback has no enabled advance action.')
  await page.clickByText(action)
  await page.waitFor(
    `[...document.querySelectorAll(
      'button.choice-row, button.choice-card, [role="radio"]'
    )].some((choice) =>
      !choice.disabled &&
      choice.getAttribute('aria-disabled') !== 'true'
    ) && !document.body.innerText.includes('正在处理')`,
    20_000,
  )
}

async function run() {
  const qa = await launchQaChrome()
  try {
    await qa.page.initialize()
    await qa.page.addInitScript(fakeAssessmentClockScript)
    await qa.page.addInitScript(fakeNeutralSpeechSynthesisScript())
    await qa.page.setViewport(390, 844)
    await prepareFirstDayPlan(qa.page)

    const initialDatabases = await qa.page.dumpIndexedDb()
    const initialRuntime = activeRuntime(initialDatabases)
    const tasks = initialRuntime.activePlan.plan.tasks
    assert.equal(tasks.length, 3)
    assert.deepEqual(
      tasks.map(
        (task) => task.trainingBudget?.targetEffectiveSeconds,
      ),
      [900, 900, 900],
    )
    const todayCards = await taskCards(qa.page, 'button.task-row')
    assert.equal(todayCards.length, 3)
    assert.equal(
      todayCards.every(
        (card) =>
          card.targetEffectiveSeconds === 900 &&
          /15 分钟有效训练/u.test(card.text),
      ),
      true,
    )

    await qa.page.clickByText('训练')
    await qa.page.waitFor(
      `document.body.innerText.includes('选择训练')`,
      20_000,
    )
    const trainingCards = await taskCards(
      qa.page,
      'button.module-card',
    )
    assert.equal(trainingCards.length, 3)
    assert.equal(
      trainingCards.every(
        (card) =>
          card.targetEffectiveSeconds === 900 &&
          /15 分钟有效训练/u.test(card.text),
      ),
      true,
    )
    assert.deepEqual(
      todayCards
        .map(({ moduleId, taskId }) => ({ moduleId, taskId }))
        .sort((left, right) =>
          left.moduleId.localeCompare(right.moduleId)
        ),
      trainingCards
        .map(({ moduleId, taskId }) => ({ moduleId, taskId }))
        .sort((left, right) =>
          left.moduleId.localeCompare(right.moduleId)
        ),
    )
    checkpoint('qa-011-entry-budgets', {
      todayCards,
      trainingCards,
    })

    const opened = await qa.page.evaluate(`(() => {
      const button = [...document.querySelectorAll(
        'button.module-card'
      )].find(
        (candidate) =>
          candidate.dataset.moduleId === 'vocabulary' &&
          !candidate.disabled
      )
      if (!button) return false
      button.click()
      return true
    })()`)
    assert.equal(opened, true)
    await qa.page.waitFor(
      `location.hash.startsWith('#/vocabulary?taskId=') &&
        !document.body.innerText.includes('正在加载词汇训练')`,
      20_000,
    )
    assert.doesNotMatch(
      await qa.page.bodyText(),
      /词汇训练暂时无法继续|本次词汇任务无法评分/u,
    )

    const observedItemIds = []
    for (let completed = 0; completed < 6; completed += 1) {
      const before = vocabularySession(
        await qa.page.dumpIndexedDb(),
      )
      const activeItemId = before.stream?.activeItem?.itemId
      assert.ok(
        activeItemId,
        `Vocabulary item ${completed + 1} is missing.`,
      )
      observedItemIds.push(activeItemId)
      await completeCurrentVocabularyItem(qa.page)
      const after = vocabularySession(
        await qa.page.dumpIndexedDb(),
      )
      assert.equal(after.phase, 'answering')
      assert.equal(
        after.stream?.completedItemIds.length,
        completed + 1,
      )
      assert.equal(
        new Set(after.stream?.completedItemIds).size,
        completed + 1,
      )
      assert.notEqual(
        after.stream?.activeItem?.itemId,
        activeItemId,
      )
    }

    const finalDatabases = await qa.page.dumpIndexedDb()
    const finalSession = vocabularySession(finalDatabases)
    const seventhItemId = finalSession.stream?.activeItem?.itemId
    assert.ok(seventhItemId, 'The seventh vocabulary item is missing.')
    assert.equal(observedItemIds.includes(seventhItemId), false)
    assert.equal(finalSession.phase, 'answering')
    assert.equal(finalSession.stream.completedItemIds.length, 6)

    const finalRuntime = activeRuntime(finalDatabases)
    const vocabularyTask = finalRuntime.activePlan.tasks.find(
      (execution) =>
        execution.task.targetModuleId === 'vocabulary',
    )
    assert.ok(vocabularyTask, 'Vocabulary execution is missing.')
    assert.equal(vocabularyTask.status, 'active')
    assert.equal(
      vocabularyTask.training?.status,
      'running',
    )
    assert.ok(
      vocabularyTask.training?.remainingEffectiveSeconds > 0,
      'The vocabulary budget completed before 900 effective seconds.',
    )
    assert.equal(finalRuntime.activePlan.status, 'in-progress')
    checkpoint('qa-011-vocabulary-seventh-item', {
      completedItemIds: finalSession.stream.completedItemIds,
      seventhItemId,
      taskStatus: vocabularyTask.status,
      budgetStatus: vocabularyTask.training?.status,
      remainingEffectiveSeconds:
        vocabularyTask.training?.remainingEffectiveSeconds,
      url: await qa.page.url(),
    })

    await qa.page.navigate(new URL('#/', baseUrl).href)
    await qa.page.waitFor(
      `!document.body.innerText.includes('正在恢复今日学习计划')`,
      20_000,
    )
    await qa.page.navigate(
      new URL(
        `#/vocabulary?taskId=${encodeURIComponent(
          vocabularyTask.task.taskId,
        )}`,
        baseUrl,
      ).href,
    )
    await qa.page.waitFor(
      `!document.body.innerText.includes('正在加载词汇训练')`,
      20_000,
    )
    const restoredSession = vocabularySession(
      await qa.page.dumpIndexedDb(),
    )
    assert.equal(
      restoredSession.stream?.activeItem?.itemId,
      seventhItemId,
    )
    assert.deepEqual(
      restoredSession.stream?.completedItemIds,
      finalSession.stream.completedItemIds,
    )
    checkpoint('qa-011-vocabulary-refresh-recovery', {
      seventhItemId,
      completedItemCount:
        restoredSession.stream.completedItemIds.length,
    })

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
