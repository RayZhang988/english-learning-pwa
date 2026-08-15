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
  process.env.QA_R3_EXPECTED_ASSET ?? 'index-DuWWQrUe.js'
const expectedPagesRun =
  process.env.QA_R3_PAGES_RUN ?? '30341029089'
const expectedHeadSha =
  process.env.QA_R3_EXPECTED_HEAD_SHA ??
  'ff7b85f95080d1e3c8d06ee9d114c6b52fd636e8'
const isLocalPreview = ['127.0.0.1', 'localhost'].includes(
  baseUrl.hostname,
)
const evidence = {
  baseUrl: baseUrl.href,
  mode: isLocalPreview ? 'local-production-preview' : 'formal-release',
  expectedAsset: isLocalPreview ? null : expectedAsset,
  expectedPagesRun: isLocalPreview ? null : expectedPagesRun,
  expectedHeadSha: isLocalPreview ? null : expectedHeadSha,
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

function recordByNamespace(databases, namespace) {
  return allRecords(databases).find(
    (record) => record.namespace === namespace,
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
    if (!(await page.bodyText()).includes('日常训练')) {
      await page.clickByText('训练')
    }
    if ((await page.bodyText()).includes('选择训练方式')) {
      await page.evaluate(`document.querySelector('[data-training-area="daily"]')?.click()`)
    }
    await page.waitFor(
      `Boolean(document.querySelector('.module-grid')) &&
        document.body.innerText.includes('日常训练')`,
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
        const budget = button.querySelector(
          '[data-training-duration-kind="training-budget"]'
        )
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

async function createFirstDayPlan(observedAsset) {
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
      trainingBudget: task.trainingBudget ?? null,
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
        task.estimatedSeconds,
        task.durationEstimate?.estimateSeconds,
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
            card.targetEffectiveSeconds === 900 &&
            /15 分钟有效训练/u.test(card.text),
        ),
        true,
        'QA-011: the public task cards do not show the required 15-minute effective budget.',
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
          null,
          `${surface}: ${card.moduleId} displayed an estimate instead of its required budget.`,
        )
        assert.equal(
          card.durationBasis,
          null,
          `${surface}: ${card.moduleId} exposed an estimate basis on a budget task.`,
        )
        assert.equal(
          task.trainingBudget?.targetEffectiveSeconds,
          900,
          `${surface}: ${card.moduleId} task lacks its 900-second budget.`,
        )
      }
    }
    assert.deepEqual(
      today.map(({ moduleId, taskId, targetEffectiveSeconds }) => ({
        moduleId,
        taskId,
        targetEffectiveSeconds,
      })).sort((left, right) =>
        left.moduleId.localeCompare(right.moduleId)
      ),
      training.map(({ moduleId, taskId, targetEffectiveSeconds }) => ({
        moduleId,
        taskId,
        targetEffectiveSeconds,
      })).sort((left, right) =>
        left.moduleId.localeCompare(right.moduleId)
      ),
      'Today and Training did not expose the same taskId/budget pairs.',
    )

    const speakingTask = tasks.find(
      (task) => task.moduleId === 'speaking',
    )
    assert.ok(speakingTask, 'The real speaking task is missing.')
    await qa.page.navigate(
      new URL(
        `#/speaking?taskId=${encodeURIComponent(
          speakingTask.taskId,
        )}`,
        baseUrl,
      ).href,
    )
    await qa.page.waitFor(
      `!document.body.innerText.includes('正在加载口语训练')`,
      20_000,
    )
    assert.doesNotMatch(
      await qa.page.bodyText(),
      /口语训练暂时无法继续|本次口语任务无法加载|provider-failure/u,
      'QA-012: the released speaking catalog failed before the first item.',
    )
    let initialSpeakingSession
    const speakingDeadline = Date.now() + 10_000
    while (Date.now() < speakingDeadline) {
      initialSpeakingSession = recordByNamespace(
        await qa.page.dumpIndexedDb(),
        'feature.speaking',
      )?.value
      if (initialSpeakingSession?.stream?.activeItem?.itemId) break
      await qa.page.evaluate(`new Promise((resolve) => setTimeout(resolve, 50))`)
    }
    assert.ok(
      initialSpeakingSession?.stream?.activeItem?.itemId,
      'QA-012: the released speaking stream did not load its first real item.',
    )
    checkpoint('qa-012-speaking-catalog-first-item', {
      activeItem: initialSpeakingSession.stream.activeItem,
      phase: initialSpeakingSession.phase,
      text: (await qa.page.bodyText()).slice(0, 1_500),
    })

    await qa.page.navigate(new URL('#/', baseUrl).href)
    await qa.page.waitFor(
      `!document.body.innerText.includes('正在恢复今日学习计划')`,
      20_000,
    )
    await cardsForSurface(qa.page, 'training')
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
      `!document.body.innerText.includes('正在准备训练题目顺序') &&
        document.body.innerText.includes('提交答案')`,
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
      /15:00[\s\S]*词汇训练[\s\S]*提交答案/u,
      'The real vocabulary route did not load its continuous budget task.',
    )

    const completedItemIds = []
    for (let completed = 0; completed < 6; completed += 1) {
      const before = recordByNamespace(
        await qa.page.dumpIndexedDb(),
        'feature.vocabulary',
      )?.value
      const activeItemId = before?.stream?.activeItem?.itemId
      assert.ok(
        activeItemId,
        `Vocabulary item ${completed + 1} is missing.`,
      )
      completedItemIds.push(activeItemId)
      await completeCurrentVocabularyItem(qa.page)
      const after = recordByNamespace(
        await qa.page.dumpIndexedDb(),
        'feature.vocabulary',
      )?.value
      assert.equal(after?.phase, 'answering')
      assert.equal(
        after?.stream?.completedItemIds.length,
        completed + 1,
      )
      assert.notEqual(
        after?.stream?.activeItem?.itemId,
        activeItemId,
      )
    }
    const afterSixDatabases = await qa.page.dumpIndexedDb()
    const afterSixSession = recordByNamespace(
      afterSixDatabases,
      'feature.vocabulary',
    )?.value
    const seventhItemId =
      afterSixSession?.stream?.activeItem?.itemId
    assert.ok(seventhItemId, 'The seventh vocabulary item is missing.')
    assert.equal(completedItemIds.includes(seventhItemId), false)
    assert.equal(
      new Set(afterSixSession.stream.completedItemIds).size,
      6,
    )
    const afterSixRuntime = activeRuntime(afterSixDatabases)
    const vocabularyExecution =
      afterSixRuntime.activePlan.tasks.find(
        (execution) =>
          execution.task.targetModuleId === 'vocabulary',
      )
    assert.ok(vocabularyExecution)
    assert.equal(vocabularyExecution.status, 'active')
    assert.equal(vocabularyExecution.training?.status, 'running')
    assert.ok(
      vocabularyExecution.training?.remainingEffectiveSeconds > 0,
    )
    checkpoint('qa-011-vocabulary-seventh-item', {
      completedItemIds:
        afterSixSession.stream.completedItemIds,
      seventhItemId,
      taskStatus: vocabularyExecution.status,
      budgetStatus: vocabularyExecution.training?.status,
      remainingEffectiveSeconds:
        vocabularyExecution.training?.remainingEffectiveSeconds,
    })

    await qa.page.navigate(new URL('#/', baseUrl).href)
    await qa.page.waitFor(
      `!document.body.innerText.includes('正在恢复今日学习计划')`,
      20_000,
    )
    await qa.page.navigate(
      new URL(
        `#/vocabulary?taskId=${encodeURIComponent(
          vocabularyExecution.task.taskId,
        )}`,
        baseUrl,
      ).href,
    )
    await qa.page.waitFor(
      `!document.body.innerText.includes('正在加载词汇训练')`,
      20_000,
    )
    const restoredSession = recordByNamespace(
      await qa.page.dumpIndexedDb(),
      'feature.vocabulary',
    )?.value
    assert.equal(
      restoredSession?.stream?.activeItem?.itemId,
      seventhItemId,
    )
    assert.deepEqual(
      restoredSession?.stream?.completedItemIds,
      afterSixSession.stream.completedItemIds,
    )
    checkpoint('qa-011-vocabulary-refresh-recovery', {
      seventhItemId,
      completedItemCount:
        restoredSession.stream.completedItemIds.length,
    })

    await qa.page.waitFor(
      `navigator.serviceWorker?.controller !== null`,
      20_000,
    )
    const serviceWorker = await qa.page.serviceWorkerSnapshot()
    assert.equal(serviceWorker.supported, true)
    assert.match(serviceWorker.controller ?? '', /\/sw\.js$/u)
    assert.match(serviceWorker.active ?? '', /\/sw\.js$/u)
    const cachedUrls = serviceWorker.caches.flatMap((entry) => entry.urls)
    const cachedIndexAssets = cachedUrls.filter((url) =>
      /\/assets\/index-[A-Za-z0-9_-]+\.js$/u.test(url)
    )
    const cachedCourseJson = [
      ...new Set(
        cachedUrls.filter((url) =>
          new URL(url).pathname.endsWith('.json')
        ),
      ),
    ]
    assert.ok(
      cachedIndexAssets.some((url) =>
        url.endsWith(`/assets/${observedAsset}`)
      ),
      `The current asset ${observedAsset} is missing from the active precache.`,
    )
    assert.deepEqual(
      [...new Set(cachedIndexAssets.map((url) => new URL(url).pathname))],
      [new URL(`assets/${observedAsset}`, baseUrl).pathname],
      'The isolated profile retained an outdated index asset cache.',
    )
    const requiredCourseAssets = [
      'training-supply-index.v1-',
      'review-content-index.v1-',
      'package-index.v1-',
      'listening-exercise-extension-index.v1-',
      'daily-level-identity-migration.v2-',
      'wrong-answer-review-identity-migration.v1-',
      'survival-travel-american-4w.v1-',
      'listening-exercises.v1-',
      'week-1.v1-',
      'week-2.v1-',
      'week-3.v1-',
      'week-4.v1-',
    ]
    assert.ok(
      cachedCourseJson.length >= requiredCourseAssets.length,
      'The active PWA cache contains fewer course resources than the released runtime requires.',
    )
    for (const requiredAsset of requiredCourseAssets) {
      assert.ok(
        cachedCourseJson.some((url) => url.includes(requiredAsset)),
        `The active PWA cache is missing ${requiredAsset}.`,
      )
    }
    const cachedSupplyUrl = cachedCourseJson.find((url) =>
      url.includes('training-supply-index.v1-')
    )
    assert.ok(
      cachedSupplyUrl,
      'The active PWA cache is missing the training supply index.',
    )
    await qa.page.setOffline(true)
    const offlineSupply = await qa.page.evaluate(`(async () => {
      const response = await caches.match(
        ${JSON.stringify(cachedSupplyUrl)}
      )
      if (!response) {
        return {
          ok: false,
          status: null,
          allCandidates: null,
          speakingCandidates: null,
          speakingSceneCandidates: null,
        }
      }
      const value = await response.json()
      return {
        ok: response.ok,
        status: response.status,
        allCandidates: value.totals?.allCandidates ?? null,
        speakingCandidates:
          value.totals?.speakingCandidates ?? null,
        speakingSceneCandidates: Array.isArray(value.candidates)
          ? value.candidates.filter(
              (candidate) =>
                candidate.domain === 'speaking' &&
                candidate.source?.sourceType ===
                  'speaking-scene-quiz'
            ).length
          : null,
      }
    })()`)
    assert.equal(offlineSupply.ok, true)
    assert.equal(offlineSupply.status, 200)
    assert.ok(
      Number.isInteger(offlineSupply.allCandidates) &&
        offlineSupply.allCandidates > 0,
      'The offline PWA supply manifest has no released candidates.',
    )
    assert.ok(
      Number.isInteger(offlineSupply.speakingCandidates) &&
        offlineSupply.speakingCandidates > 0,
      'The offline PWA supply manifest has no released speaking candidates.',
    )
    await qa.page.reload()
    await qa.page.waitFor(
      `!document.body.innerText.includes('正在加载词汇训练')`,
      20_000,
    )
    assert.doesNotMatch(
      await qa.page.bodyText(),
      /词汇训练暂时无法继续|本次词汇任务无法评分/u,
      'The cached continuous vocabulary route failed while offline.',
    )
    const offlineRestoredSession = recordByNamespace(
      await qa.page.dumpIndexedDb(),
      'feature.vocabulary',
    )?.value
    assert.equal(
      offlineRestoredSession?.stream?.activeItem?.itemId,
      seventhItemId,
      'The offline reload did not restore the seventh vocabulary item.',
    )
    await qa.page.setOffline(false)
    checkpoint('r3-service-worker-cache', {
      controller: serviceWorker.controller,
      active: serviceWorker.active,
      cacheNames: serviceWorker.caches.map((entry) => entry.cacheName),
      cachedIndexAssets,
      cachedCourseJson,
      offlineSupply,
      offlineRestoredItemId:
        offlineRestoredSession.stream.activeItem.itemId,
    })
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
    return observedAsset
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
  assert.equal(run.head_sha, expectedHeadSha)
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
  return observedAsset
}

try {
  const observedAsset = await releaseEvidence()
  await createFirstDayPlan(observedAsset)
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
