import assert from 'node:assert/strict'
import { launchQaChrome } from './lib/cdp-browser.mjs'

const baseUrl = new URL(
  process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173/',
)
const qa = await launchQaChrome()

try {
  await qa.page.initialize()
  await qa.page.setViewport(390, 844)
  await qa.page.navigate(new URL('#/', baseUrl).href)
  await qa.page.waitFor(
    `!document.body.innerText.includes('正在恢复今日学习计划')`,
  )
  await qa.page.clickByText('开始水平测试')
  await qa.page.waitFor(
    `location.hash.includes('/assessment') && !document.body.innerText.includes('正在恢复水平测试')`,
  )
  await qa.page.clickByText('检查设备并开始')
  await qa.page.waitFor(
    `[...document.querySelectorAll('button.choice-row')].length > 0`,
  )
  await qa.page.clickFirstEnabledChoice()
  await qa.page.waitFor(
    `[...document.querySelectorAll('button')].some((button) => button.innerText.trim() === '提交答案' && !button.disabled)`,
  )
  await qa.page.clickByText('提交答案')
  await qa.page.waitFor(`document.body.innerText.includes('继续下一题')`)
  await qa.page.clickByText('继续下一题')
  await qa.page.waitFor(
    `document.body.innerText.includes('暂停测试') && !document.body.innerText.includes('正在继续')`,
  )
  await qa.page.clickByText('暂停测试')
  await qa.page.waitFor(`document.body.innerText.includes('水平测试已暂停')`)

  const beforeReload = await qa.page.dumpIndexedDb()
  await qa.page.reload()
  await qa.page.waitFor(
    `document.body.innerText.includes('水平测试已暂停')`,
  )
  const afterReload = await qa.page.dumpIndexedDb()
  assert.deepEqual(afterReload, beforeReload)

  await qa.page.clickByText('结束并保存当前结果')
  await qa.page.waitFor(
    `document.body.innerText.includes('进入今日计划') || document.body.innerText.includes('暂时无法继续')`,
    20_000,
  )
  const text = await qa.page.bodyText()
  assert.doesNotMatch(text, /暂时无法继续/u)
  assert.match(text, /进入今日计划/u)
  await qa.page.clickByText('进入今日计划')
  await qa.page.waitFor(
    `location.hash === '#/' &&
      !document.body.innerText.includes('正在恢复今日学习计划')`,
    20_000,
  )
  const planText = await qa.page.bodyText()
  const planDatabases = await qa.page.dumpIndexedDb()
  assert.doesNotMatch(planText, /暂时无法继续/u)
  assert.match(planText, /45 分钟/u)
  assert.match(planText, /词汇训练/u)
  assert.match(planText, /听力训练/u)
  assert.match(planText, /口语训练/u)
  assert.match(JSON.stringify(planDatabases), /active-plan/u)

  console.log(
    JSON.stringify(
      {
        status: 'passed',
        restoredPausedAssessment: true,
        resultText: text.slice(0, 1_500),
        firstDayPlanText: planText.slice(0, 1_500),
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
        url: await qa.page.url().catch(() => null),
        text: await qa.page.bodyText().catch(() => null),
        consoleMessages: qa.page.consoleMessages,
        pageErrors: qa.page.pageErrors,
        requests: qa.page.requests,
        databases: await qa.page.dumpIndexedDb().catch(() => null),
      },
      null,
      2,
    ),
  )
  throw error
} finally {
  await qa.close()
}
