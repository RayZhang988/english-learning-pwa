import assert from 'node:assert/strict'
import {
  advanceAssessmentToSpeaking,
  startFreshAssessment,
} from './lib/assessment-flow.mjs'
import { launchQaChrome } from './lib/cdp-browser.mjs'

const baseUrl = new URL(
  process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173/',
)
const qa = await launchQaChrome({ fakeMedia: true })

try {
  await qa.page.initialize()
  await startFreshAssessment(qa.page, baseUrl)
  await advanceAssessmentToSpeaking(qa.page)

  await qa.page.clickByText('开始录音')
  await qa.page.waitFor(`document.body.innerText.includes('正在录音')`)
  await qa.page.evaluate(
    `new Promise((resolve) => setTimeout(resolve, 500))`,
  )
  await qa.page.clickByText('停止录音')
  await qa.page.waitFor(
    `document.body.innerText.includes('识别失败，录音仍可回放') || document.body.innerText.includes('录音已就绪')`,
    20_000,
  )

  const reviewText = await qa.page.bodyText()
  const reviewInteractive = await qa.page.interactiveElements()
  assert.match(reviewText, /录音.*就绪|录音仍可回放/u)
  assert.ok(
    reviewInteractive.some(
      (element) =>
        element.tag === 'button' &&
        !element.disabled &&
        element.text === '播放录音',
    ),
    'Recording review did not expose an enabled playback action',
  )

  if (reviewText.includes('识别失败')) {
    assert.match(reviewText, /不会.*答错|不评分/u)
    assert.doesNotMatch(reviewText, /回答错误|答错了/u)
  }

  await qa.page.clickByText('播放录音')
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        recognitionFailed: reviewText.includes('识别失败'),
        reviewText: reviewText.slice(0, 1_500),
        interactive: reviewInteractive,
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
      },
      null,
      2,
    ),
  )
  throw error
} finally {
  await qa.close()
}
