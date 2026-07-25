import assert from 'node:assert/strict'
import {
  fakeAssessmentClockScript,
  launchQaChrome,
} from './lib/cdp-browser.mjs'

const baseUrl = new URL(
  process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173/',
)
const qa = await launchQaChrome()
const evidence = {
  baseUrl: baseUrl.href,
  checkpoints: [],
}

function checkpoint(name, details = {}) {
  evidence.checkpoints.push({ name, ...details })
}

try {
  await qa.page.initialize()
  await qa.page.addInitScript(fakeAssessmentClockScript)
  await qa.page.setViewport(390, 844)
  await qa.page.navigate(new URL('#/', baseUrl).href)
  await qa.page.waitFor(
    `!document.body.innerText.includes('正在恢复今日学习计划')`,
  )

  const firstRunText = await qa.page.bodyText()
  assert.match(firstRunText, /水平测试/u)
  assert.doesNotMatch(firstRunText, /demoPlan|演示计划/u)
  const firstRunLayout = await qa.page.layoutSnapshot()
  assert.ok(
    firstRunLayout.documentWidth <= firstRunLayout.viewportWidth,
    `First-run page overflows: ${JSON.stringify(firstRunLayout)}`,
  )
  checkpoint('fresh-device-entry', {
    url: await qa.page.url(),
    layout: firstRunLayout,
    interactive: await qa.page.interactiveElements(),
  })

  await qa.page.clickByText('开始水平测试', '去完成水平测试', '开始测试')
  await qa.page.waitFor(`location.hash.includes('/assessment')`)
  await qa.page.waitFor(
    `!document.body.innerText.includes('正在恢复水平测试')`,
  )
  const introText = await qa.page.bodyText()
  assert.match(introText, /15.?20 分钟/u)
  assert.match(introText, /词汇/u)
  assert.match(introText, /听力/u)
  assert.match(introText, /口语/u)
  checkpoint('assessment-intro', {
    url: await qa.page.url(),
    interactive: await qa.page.interactiveElements(),
  })

  await qa.page.clickByText('开始测试', '检查设备并开始')
  await qa.page.waitFor(
    `document.body.innerText.includes('提交') || document.body.innerText.includes('录音')`,
  )
  checkpoint('first-assessment-item', {
    text: (await qa.page.bodyText()).slice(0, 1_200),
    interactive: await qa.page.interactiveElements(),
  })

  let answeredItems = 0
  for (let iteration = 0; iteration < 45; iteration += 1) {
    const url = await qa.page.url()
    const text = await qa.page.bodyText()
    const interactive = await qa.page.interactiveElements()
    const buttonLabels = interactive
      .filter((element) => element.tag === 'button')
      .map((element) => element.text)

    if (url.endsWith('#/') && !text.includes('正在恢复')) {
      break
    }
    if (buttonLabels.includes('继续下一题')) {
      await qa.page.clickByText('继续下一题')
      await qa.page.waitFor(
        `location.hash === '#/' || (
          !document.body.innerText.includes('继续下一题') &&
          !document.body.innerText.includes('正在继续')
        )`,
      )
      continue
    }
    if (interactive.some((element) => element.className?.includes('choice-row'))) {
      await qa.page.evaluate(`globalThis.__qaAdvanceTime(55_000)`)
      await qa.page.clickFirstEnabledChoice()
      await qa.page.waitFor(
        `[...document.querySelectorAll('button')].some((button) => button.innerText.trim() === '提交答案' && !button.disabled)`,
      )
      await qa.page.clickByText('提交答案')
      answeredItems += 1
      await qa.page.waitFor(
        `document.body.innerText.includes('继续下一题') || location.hash === '#/'`,
      )
      continue
    }
    if (buttonLabels.includes('跳过本题')) {
      await qa.page.evaluate(`globalThis.__qaAdvanceTime(55_000)`)
      await qa.page.clickByText('跳过本题')
      answeredItems += 1
      await qa.page.waitFor(
        `document.body.innerText.includes('继续下一题') || location.hash === '#/'`,
      )
      continue
    }

    throw new Error(
      `Assessment automation reached an unknown state.\n${text}\n${JSON.stringify(interactive)}`,
    )
  }

  await qa.page.waitFor(
    `location.hash === '#/' && !document.body.innerText.includes('正在恢复')`,
    20_000,
  )
  const planText = await qa.page.bodyText()
  const planInteractive = await qa.page.interactiveElements()
  const databases = await qa.page.dumpIndexedDb()
  checkpoint('ability-profile-and-first-day-plan', {
    answeredItems,
    text: planText.slice(0, 2_500),
    interactive: planInteractive,
    databases,
  })

  assert.match(planText, /今日/u)
  assert.match(planText, /词汇/u)
  assert.match(planText, /听力/u)
  assert.match(planText, /口语/u)
  const persistedText = JSON.stringify(databases)
  assert.match(persistedText, /latest-ability-profile/u)
  assert.match(persistedText, /"vocabulary"/u)
  assert.match(persistedText, /"listening"/u)
  assert.match(persistedText, /"speaking"/u)
  assert.match(persistedText, /active-plan/u)

  console.log(JSON.stringify({ status: 'inspection', ...evidence }, null, 2))
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status: 'failed',
        error: String(error),
        url: await qa.page.url().catch(() => null),
        text: await qa.page.bodyText().catch(() => null),
        consoleMessages: qa.page.consoleMessages,
        pageErrors: qa.page.pageErrors,
        requests: qa.page.requests,
        ...evidence,
      },
      null,
      2,
    ),
  )
  throw error
} finally {
  await qa.close()
}
