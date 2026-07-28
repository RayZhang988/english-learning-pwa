import assert from 'node:assert/strict'
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
  process.env.QA_R3_EXPECTED_ASSET ?? 'index-CDUEKV0C.js'
const expectedPagesRun =
  process.env.QA_R3_PAGES_RUN ?? '30326369853'
const isLocalPreview = ['127.0.0.1', 'localhost'].includes(
  baseUrl.hostname,
)
const expectedFirstDaySeconds = {
  vocabulary: 123,
  listening: 211,
  speaking: 181,
}
const evidence = {
  baseUrl: baseUrl.href,
  mode: isLocalPreview ? 'local-production-preview' : 'formal-release',
  expectedAsset: isLocalPreview ? null : expectedAsset,
  expectedPagesRun: isLocalPreview ? null : expectedPagesRun,
  isolatedProfile: true,
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

async function prepareBrowser() {
  const qa = await launchQaChrome()
  await qa.page.initialize()
  await qa.page.addInitScript(fakeAssessmentClockScript)
  await qa.page.addInitScript(fakeNeutralSpeechSynthesisScript())
  await qa.page.setViewport(390, 844)
  return qa
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
  const query =
    surface === 'today' ? 'button.task-row' : 'button.module-card'
  return page.evaluate(`(() =>
    [...document.querySelectorAll(${JSON.stringify(query)})]
      .filter((button) =>
        ['vocabulary', 'listening', 'speaking'].includes(
          button.dataset.moduleId
        )
      )
      .map((button) => {
        const duration = button.querySelector('.duration-estimate')
        return {
          moduleId: button.dataset.moduleId,
          taskId: button.dataset.taskId ?? null,
          availability: button.dataset.availability ?? null,
          recommended: button.dataset.recommended === 'true',
          disabled: Boolean(button.disabled),
          text: button.innerText.trim(),
          ariaLabel: button.getAttribute('aria-label'),
          estimateSeconds: duration
            ? Number(duration.dataset.estimateSeconds)
            : null,
          durationBasis: duration?.dataset.durationBasis ?? null,
        }
      })
  )()`)
}

async function createFirstDayPlan() {
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
    await qa.page.waitFor(
      `location.hash === '#/' &&
        !document.body.innerText.includes('正在恢复今日学习计划') &&
        document.body.innerText.includes('任选一项开始')`,
      20_000,
    )

    const databases = await qa.page.dumpIndexedDb()
    const runtime = activeRuntime(databases)
    const tasks = runtime.activePlan.plan.tasks.map((task) => ({
      taskId: task.taskId,
      moduleId: task.targetModuleId,
      estimatedSeconds: task.estimatedSeconds,
      durationEstimate: task.durationEstimate ?? null,
    }))
    assert.equal(tasks.length, 3)
    assert.equal(
      new Set(tasks.map((task) => task.taskId)).size,
      3,
    )
    const today = await cardsForSurface(qa.page, 'today')
    const training = await cardsForSurface(qa.page, 'training')
    checkpoint('r3-first-day-duration-baseline', {
      profileSchemaVersion: recordByNamespaceAndKey(
        databases,
        'feature.assessment',
        'latest-ability-profile',
      )?.value?.schemaVersion,
      planId: runtime.activePlan.plan.planId,
      planTargetSeconds: runtime.activePlan.plan.targetSeconds,
      planPlannedSeconds: runtime.activePlan.plan.plannedSeconds,
      tasks,
      today,
      training,
    })

    const estimates = tasks.map(
      (task) =>
        task.durationEstimate?.estimateSeconds ??
        task.estimatedSeconds,
    )
    assert.equal(runtime.activePlan.plan.targetSeconds, 2_700)
    assert.equal(
      runtime.activePlan.plan.plannedSeconds,
      estimates.reduce((total, seconds) => total + seconds, 0),
    )
    assert.equal(runtime.activePlan.plan.plannedSeconds, 515)
    assert.equal(
      tasks.every(
        (task) =>
          task.durationEstimate?.baselineSource ===
          'structured-content',
      ),
      true,
      'QA-009: production tasks do not carry structured content baselines.',
    )
    assert.equal(
      estimates.every((seconds) => seconds === 900),
      false,
      'QA-009: vocabulary, listening and speaking still use the fixed 900-second legacy estimate.',
    )
    assert.ok(
      new Set(estimates).size > 1,
      'QA-009: all three production tasks still share one equal-split estimate.',
    )
    for (const task of tasks) {
      assert.equal(
        task.durationEstimate?.estimateSeconds,
        expectedFirstDaySeconds[task.moduleId],
        `QA-009: ${task.moduleId} did not use its authored first-day baseline.`,
      )
      assert.equal(
        task.estimatedSeconds,
        expectedFirstDaySeconds[task.moduleId],
        `QA-009: ${task.moduleId} legacy task estimate drifted from its structured estimate.`,
      )
    }
    for (const [surface, cards] of [
      ['today', today],
      ['training', training],
    ]) {
      assert.equal(cards.length, 3)
      assert.equal(
        cards.every(
          (card) =>
            card.estimateSeconds === 900 &&
            /约 15 分钟/u.test(card.text),
        ),
        false,
        'QA-009: the public task cards still show fixed 15-minute estimates.',
      )
      for (const card of cards) {
        const task = tasks.find(
          (entry) => entry.moduleId === card.moduleId,
        )
        assert.ok(task, `${surface}: ${card.moduleId} task is missing.`)
        assert.equal(
          card.taskId,
          task.taskId,
          `${surface}: ${card.moduleId} changed taskId.`,
        )
        assert.equal(
          card.estimateSeconds,
          expectedFirstDaySeconds[card.moduleId],
          `${surface}: ${card.moduleId} displayed the wrong estimate.`,
        )
        assert.equal(
          card.durationBasis,
          'content-baseline',
          `${surface}: ${card.moduleId} did not disclose the content baseline.`,
        )
      }
    }
    assert.deepEqual(
      today.map(({ moduleId, taskId, estimateSeconds }) => ({
        moduleId,
        taskId,
        estimateSeconds,
      })).sort((left, right) =>
        left.moduleId.localeCompare(right.moduleId)
      ),
      training.map(({ moduleId, taskId, estimateSeconds }) => ({
        moduleId,
        taskId,
        estimateSeconds,
      })).sort((left, right) =>
        left.moduleId.localeCompare(right.moduleId)
      ),
      'Today and Training did not expose the same taskId/estimate pairs.',
    )

    const vocabularyClick = await qa.page.evaluate(`(() => {
      const button = [...document.querySelectorAll('button.module-card')]
        .find((candidate) =>
          candidate.dataset.moduleId === 'vocabulary' &&
          !candidate.disabled
        )
      if (!button) return false
      button.click()
      return true
    })()`)
    assert.equal(
      vocabularyClick,
      true,
      'The real vocabulary task card was not clickable.',
    )
    await qa.page.waitFor(
      `location.hash.startsWith('#/vocabulary?taskId=')`,
      20_000,
    )
    await qa.page.waitFor(
      `!document.body.innerText.includes('正在加载词汇训练')`,
      20_000,
    )
    const vocabularyRoute = {
      url: await qa.page.url(),
      text: await qa.page.bodyText(),
    }
    checkpoint('r3-first-day-vocabulary-route', vocabularyRoute)
    assert.doesNotMatch(
      vocabularyRoute.text,
      /词汇训练暂时无法继续|本次词汇任务无法评分|does not match its course unit/u,
      'The structured duration task was rejected by the real vocabulary route.',
    )
    assert.match(
      vocabularyRoute.text,
      /词汇训练[\s\S]*已完成 0 \/ 6[\s\S]*提交答案/u,
      'The real vocabulary route did not load its six production questions.',
    )
  } finally {
    await qa.close()
  }
}

async function releaseEvidence() {
  const indexResponse = await fetch(baseUrl)
  assert.equal(indexResponse.status, 200)
  const html = await indexResponse.text()
  const assetMatch = html.match(
    /assets\/(index-[A-Za-z0-9_-]+\.js)/u,
  )
  assert.ok(assetMatch, 'The production index asset was not found.')
  const observedAsset = assetMatch[1]
  if (!isLocalPreview) {
    assert.equal(observedAsset, expectedAsset)
  }

  const resources = {}
  for (const relative of [
    'manifest.webmanifest',
    'sw.js',
    `assets/${observedAsset}`,
  ]) {
    const response = await fetch(new URL(relative, baseUrl))
    resources[relative] = {
      status: response.status,
      contentType: response.headers.get('content-type'),
    }
    assert.equal(response.status, 200, `${relative} did not return 200.`)
  }

  if (isLocalPreview) {
    checkpoint('r3-release-evidence', {
      mode: 'local-production-preview',
      observedAsset,
      resources,
    })
    return
  }

  const runResponse = await fetch(
    `https://api.github.com/repos/rayzhang988/english-learning-pwa/actions/runs/${expectedPagesRun}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'english-learning-pwa-r3-qa',
      },
    },
  )
  assert.equal(runResponse.status, 200)
  const run = await runResponse.json()
  assert.equal(run.status, 'completed')
  assert.equal(run.conclusion, 'success')
  checkpoint('r3-release-evidence', {
    mode: 'formal-release',
    observedAsset,
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
  await createFirstDayPlan()
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
