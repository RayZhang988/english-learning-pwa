import assert from 'node:assert/strict'
import { launchQaChrome } from './lib/cdp-browser.mjs'
import {
  advanceAssessmentToSpeaking,
  startFreshAssessment,
} from './lib/assessment-flow.mjs'

const baseUrl = new URL(
  process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173/',
)
const qa = await launchQaChrome({ fakeMedia: false })

try {
  await qa.page.initialize()
  await qa.browser.send('Browser.setPermission', {
    permission: { name: 'microphone' },
    setting: 'denied',
    origin: baseUrl.origin,
  })
  await startFreshAssessment(qa.page, baseUrl)
  await advanceAssessmentToSpeaking(qa.page)
  await qa.page.clickByText('开始录音')
  await qa.page.waitFor(
    `document.body.innerText.includes('麦克风或录音不可用') || document.body.innerText.includes('录音失败')`,
  )

  const deniedText = await qa.page.bodyText()
  const deniedInteractive = await qa.page.interactiveElements()
  assert.match(deniedText, /麦克风|录音/u)
  assert.match(deniedText, /不会.*答错|不会.*猜测|不评分/u)
  assert.doesNotMatch(deniedText, /回答错误|答错了/u)
  assert.ok(
    deniedInteractive.some(
      (element) =>
        element.tag === 'button' &&
        !element.disabled &&
        /提交|继续|跳过/u.test(element.text),
    ),
    'Permission denial did not leave an enabled degradation action',
  )

  console.log(
    JSON.stringify(
      {
        status: 'passed',
        stateText: deniedText.slice(0, 1_500),
        interactive: deniedInteractive,
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
