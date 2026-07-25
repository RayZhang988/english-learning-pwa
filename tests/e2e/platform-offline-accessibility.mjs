import assert from 'node:assert/strict'
import { launchQaChrome } from './lib/cdp-browser.mjs'

const baseUrl = new URL(
  process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173/',
)
const qa = await launchQaChrome()
let serviceWorkerEvidence = null

try {
  await qa.page.initialize()
  await qa.page.setViewport(390, 844)
  await qa.page.navigate(new URL('#/', baseUrl).href)
  await qa.page.waitFor(
    `!document.body.innerText.includes('正在恢复今日学习计划')`,
  )

  const metadata = await qa.page.evaluate(`({
    lang: document.documentElement.lang,
    viewport: document.querySelector('meta[name="viewport"]')?.content ?? null,
    manifest: document.querySelector('link[rel="manifest"]')?.href ?? null,
  })`)
  assert.equal(metadata.lang, 'zh-CN')
  assert.match(metadata.viewport ?? '', /width=device-width/u)
  assert.ok(metadata.manifest)

  for (const width of [320, 375, 390]) {
    await qa.page.setViewport(width, 844)
    const layout = await qa.page.layoutSnapshot()
    assert.ok(
      layout.documentWidth <= layout.viewportWidth,
      `${width}px viewport has horizontal overflow: ${JSON.stringify(layout)}`,
    )
  }

  const interactive = await qa.page.interactiveElements()
  assert.ok(interactive.length > 0)
  for (const element of interactive) {
    assert.ok(
      element.text.length > 0,
      `Interactive element has no accessible text: ${JSON.stringify(element)}`,
    )
  }
  await qa.page.pressKey('Tab')
  const focus = await qa.page.layoutSnapshot()
  assert.ok(focus.focusedText.length > 0, 'Tab did not reach a named control')

  let serviceWorker = await qa.page.serviceWorkerSnapshot()
  if (!serviceWorker.controller) {
    await qa.page.reload()
    await qa.page.waitFor(
      `!document.body.innerText.includes('正在恢复今日学习计划')`,
    )
    serviceWorker = await qa.page.serviceWorkerSnapshot()
  }
  serviceWorkerEvidence = serviceWorker
  assert.ok(serviceWorker.supported)
  assert.match(serviceWorker.scope, new RegExp(baseUrl.pathname, 'u'))
  assert.ok(serviceWorker.active)
  assert.ok(serviceWorker.controller)
  const cachedUrls = serviceWorker.caches.flatMap((cache) => cache.urls)
  assert.ok(
    cachedUrls.length >= 15,
    `Expected at least 15 unique cached URLs, found ${cachedUrls.length}`,
  )
  assert.ok(
    cachedUrls.some((url) => new URL(url).pathname.endsWith('/index.html')),
  )
  assert.ok(
    cachedUrls.filter((url) => new URL(url).pathname.endsWith('.json'))
      .length >= 6,
  )

  const sameOriginRequests = qa.page.requests.filter(
    (url) =>
      !url.startsWith(baseUrl.origin) &&
      !url.startsWith('data:') &&
      !url.startsWith('blob:'),
  )
  assert.deepEqual(
    sameOriginRequests,
    [],
    `Unexpected cross-origin requests: ${sameOriginRequests.join(', ')}`,
  )

  await qa.page.setOffline(true)
  await qa.page.reload()
  await qa.page.waitFor(
    `document.body.innerText.includes('水平测试') && !document.body.innerText.includes('正在恢复')`,
    20_000,
  )
  const offlineText = await qa.page.bodyText()
  assert.match(offlineText, /水平测试/u)
  assert.doesNotMatch(offlineText, /ERR_INTERNET_DISCONNECTED/u)

  console.log(
    JSON.stringify(
      {
        status: 'passed',
        metadata,
        focus,
        serviceWorker,
        offlineText: offlineText.slice(0, 1_000),
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
        serviceWorker: serviceWorkerEvidence,
      },
      null,
      2,
    ),
  )
  throw error
} finally {
  await qa.close()
}
