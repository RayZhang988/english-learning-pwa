import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { launchQaChrome } from './lib/cdp-browser.mjs'

const baseUrl = new URL(process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173/')
const expectedAsset = process.env.QA_EXPECTED_ASSET ?? null
const expectedPagesRun = process.env.QA_PAGES_RUN ?? null
const bank = JSON.parse(await readFile(
  new URL('../../content/lessons/survival-travel-american-4w/scene-vocabulary-questions.v1.json', import.meta.url),
  'utf8',
))
const evidence = { status: 'running', baseUrl: baseUrl.href, expectedAsset, expectedPagesRun, isolatedProfile: true, userDeviceDataTouched: false, checkpoints: [] }
const checkpoint = (name, details = {}) => evidence.checkpoints.push({ name, ...details })
const routeFor = (scene) => new URL(`#/practice/scenes/${scene.categoryId}/${scene.sceneId}`, baseUrl).href

const speechProbe = `(() => {
  const probe = { utterances: [] }
  class Utterance { constructor(text) { this.text = String(text); this.lang = ''; this.rate = 1; this.pitch = 1 } }
  Object.defineProperty(globalThis, '__r13bSpeechProbe', { configurable: true, value: probe })
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, writable: true, value: Utterance })
  Object.defineProperty(globalThis, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak(utterance) { probe.utterances.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate, pitch: utterance.pitch }) }, getVoices() { return [] } } })
})()`

async function selectMeaning(page, meaning) {
  const selected = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('[data-scene-vocabulary-option]')].find((node) => node.innerText.trim() === ${JSON.stringify(meaning)})
    if (!button || button.disabled) return false
    button.click(); return true
  })()`)
  assert.equal(selected, true, `Could not select ${meaning}`)
}

async function completeScene(page, scene) {
  for (const question of scene.questions) {
    await page.waitFor(`document.querySelector('.scene-vocabulary-target')?.textContent.trim() === ${JSON.stringify(question.targetText)}`)
    await selectMeaning(page, question.correctMeaningZh)
    await page.clickByText('提交答案')
    await page.waitFor(`document.body.innerText.includes('回答正确')`)
    await page.clickByText('继续')
  }
  await page.waitFor(`document.body.innerText.includes('正确数') && document.body.innerText.includes('6 / 6') && document.body.innerText.includes('100%')`)
}

const qa = await launchQaChrome({ fakeMedia: false })
try {
  await qa.page.initialize()
  await qa.page.addInitScript(speechProbe)
  await qa.page.setViewport(390, 844)
  await qa.page.navigate(new URL('#/', baseUrl).href)
  await qa.page.waitFor(`document.readyState === 'complete'`)
  const homeHtml = await (await fetch(baseUrl)).text()
  const liveAsset = homeHtml.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/u)?.[1]
  assert.ok(liveAsset, 'The live home does not reference an index asset.')
  if (expectedAsset) assert.equal(liveAsset, expectedAsset)
  checkpoint('published-release', { asset: liveAsset, pagesRun: expectedPagesRun })

  const beforeRecords = await qa.page.dumpIndexedDb()
  const routeResults = []
  for (const scene of bank.scenes) {
    await qa.page.navigate(routeFor(scene))
    await qa.page.waitFor(`document.querySelector('.scene-vocabulary-target') && !document.body.innerText.includes('内容准备中')`)
    const first = scene.questions[0]
    const presentation = await qa.page.evaluate(`(() => ({
      sentence: document.querySelector('.scene-vocabulary-sentence')?.innerText.trim(),
      target: document.querySelector('.scene-vocabulary-target')?.innerText.trim(),
      targets: document.querySelectorAll('.scene-vocabulary-target').length,
      prompt: document.querySelector('#scene-vocabulary-question')?.innerText.trim(),
      optionTexts: [...document.querySelectorAll('[data-scene-vocabulary-option]')].map((node) => node.innerText.trim()),
    }))()`)
    assert.equal(presentation.sentence, first.sentenceEn)
    assert.equal(presentation.target, first.targetText)
    assert.equal(presentation.targets, 1, `${scene.sceneId} must have one highlighted target`)
    assert.equal(presentation.prompt, `${first.targetText} 是什么意思？`)
    assert.deepEqual([...presentation.optionTexts].sort(), [first.correctMeaningZh, ...first.distractorMeaningsZh].sort())
    routeResults.push(`${scene.categoryId}/${scene.sceneId}`)
  }
  assert.equal(routeResults.length, 18)
  assert.equal(new Set(bank.scenes.map((scene) => scene.categoryId)).size, 6)
  checkpoint('six-categories-eighteen-live-routes', { routes: routeResults })

  const completionScene = bank.scenes.find((scene) => scene.sceneId === 'restaurant')
  assert.ok(completionScene)
  await qa.page.navigate(routeFor(completionScene))
  await completeScene(qa.page, completionScene)
  checkpoint('chinese-answer-feedback-and-completion', { scene: completionScene.sceneId, progress: '6/6', accuracy: '100%' })

  const recoveryScene = bank.scenes.find((scene) => scene.sceneId === 'taxi')
  assert.ok(recoveryScene)
  await qa.page.navigate(routeFor(recoveryScene))
  await selectMeaning(qa.page, recoveryScene.questions[0].correctMeaningZh)
  await qa.page.reload()
  await qa.page.waitFor(`document.querySelector('.scene-vocabulary-option--selected')?.innerText.trim() === ${JSON.stringify(recoveryScene.questions[0].correctMeaningZh)}`)
  await qa.page.clickByText('提交答案')
  await qa.page.waitFor(`document.body.innerText.includes('回答正确')`)
  await qa.page.reload()
  await qa.page.waitFor(`document.body.innerText.includes('回答正确') && document.body.innerText.includes(${JSON.stringify(recoveryScene.questions[0].correctMeaningZh)})`)
  checkpoint('selection-and-feedback-recovery', { scene: recoveryScene.sceneId })

  const pronunciationScene = bank.scenes.find((scene) => scene.sceneId === 'airport')
  assert.ok(pronunciationScene)
  await qa.page.navigate(routeFor(pronunciationScene))
  const target = pronunciationScene.questions[0].targetText
  await qa.page.evaluate(`document.querySelector('.scene-vocabulary-target')?.click()`)
  await qa.page.waitFor(`globalThis.__r13bSpeechProbe.utterances.length === 1`)
  const utterances = await qa.page.evaluate(`globalThis.__r13bSpeechProbe.utterances`)
  assert.deepEqual(utterances, [{ text: target, lang: 'en-US', rate: 1, pitch: 1 }])
  checkpoint('target-only-en-us-pronunciation', { target, utterances })

  const layout = []
  for (const width of [320, 390]) {
    await qa.page.setViewport(width, 844)
    await qa.page.navigate(routeFor(pronunciationScene))
    await qa.page.waitFor(`document.querySelector('.scene-vocabulary-target')`)
    const current = await qa.page.layoutSnapshot()
    assert.ok(current.documentWidth <= current.viewportWidth, `${width}px has horizontal overflow: ${JSON.stringify(current)}`)
    layout.push(current)
  }
  await qa.page.clickByText('退出场景训练')
  await qa.page.waitFor(`location.hash === '#/practice/scenes/airport-flight'`)
  await qa.page.navigate(routeFor(pronunciationScene))
  await qa.page.waitFor(`document.querySelector('.scene-vocabulary-target')`)
  checkpoint('responsive-return-refresh-direct-url', { layout })

  const serviceWorker = await qa.page.serviceWorkerSnapshot()
  assert.ok(serviceWorker.controller, 'The production Service Worker did not control the isolated page.')
  assert.equal(serviceWorker.caches.some((cache) => cache.urls.some((url) => url.includes('scene-vocabulary-questions.v1-ChI8FAg7.json'))), true)
  await qa.page.setOffline(true)
  await qa.page.reload()
  await qa.page.waitFor(`document.querySelector('.scene-vocabulary-target') && !document.body.innerText.includes('内容准备中')`, 20_000)
  await qa.page.setOffline(false)
  checkpoint('pwa-offline-reopen', { controller: serviceWorker.controller, sceneAssetPrecaches: true })

  const afterRecords = await qa.page.dumpIndexedDb()
  const records = (databases) => databases.flatMap((database) => database.stores.records ?? [])
  const nonScene = (databases) => records(databases).filter((record) => record.namespace !== 'feature.vocabulary.scene-practice')
  assert.deepEqual(nonScene(afterRecords), nonScene(beforeRecords), 'Scene practice changed daily-plan, extra-training, or another non-scene snapshot.')
  const sceneRecords = records(afterRecords).filter((record) => record.namespace === 'feature.vocabulary.scene-practice')
  assert.ok(sceneRecords.length >= 1)
  checkpoint('independent-scene-snapshots', { sceneSnapshotCount: sceneRecords.length, preservedNonSceneRecords: nonScene(afterRecords).length })

  assert.deepEqual(qa.page.pageErrors, [])
  evidence.status = 'passed'
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await qa.close()
}
