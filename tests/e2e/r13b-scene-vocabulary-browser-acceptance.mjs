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
  Object.defineProperty(globalThis, '__r13cSpeechProbe', { configurable: true, value: probe })
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

async function answerCurrentCorrect(page, scene) {
  const target = await page.evaluate(`document.querySelector('.scene-vocabulary-target')?.textContent.trim()`)
  const question = scene.questions.find((entry) => entry.targetText === target)
  assert.ok(question, `No released question matches visible target ${target}`)
  await selectMeaning(page, question.correctMeaningZh)
  await page.clickByText('提交答案')
  await page.waitFor(`document.body.innerText.includes('回答正确')`)
  await page.clickByText('继续')
}

async function answerSeveral(page, scene, count) {
  for (let index = 0; index < count; index += 1) {
    await page.waitFor(`document.querySelector('.scene-vocabulary-target')`)
    await answerCurrentCorrect(page, scene)
  }
}

async function resumeIfPrompted(page) {
  const needsResume = await page.evaluate(`document.body.innerText.includes('继续上次训练？')`)
  if (needsResume) await page.clickByText('继续上次训练')
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
    const presentation = await qa.page.evaluate(`(() => ({
      sentence: document.querySelector('.scene-vocabulary-sentence')?.innerText.trim(),
      target: document.querySelector('.scene-vocabulary-target')?.innerText.trim(),
      targets: document.querySelectorAll('.scene-vocabulary-target').length,
      prompt: document.querySelector('#scene-vocabulary-question')?.innerText.trim(),
      optionTexts: [...document.querySelectorAll('[data-scene-vocabulary-option]')].map((node) => node.innerText.trim()),
    }))()`)
    const visible = scene.questions.find((question) => question.targetText === presentation.target)
    assert.ok(visible, `${scene.sceneId} must show a released target`)
    assert.equal(presentation.sentence, visible.sentenceEn)
    assert.equal(presentation.targets, 1, `${scene.sceneId} must have one highlighted target`)
    assert.equal(presentation.prompt, `${visible.targetText} 是什么意思？`)
    assert.deepEqual([...presentation.optionTexts].sort(), [visible.correctMeaningZh, ...visible.distractorMeaningsZh].sort())
    routeResults.push(`${scene.categoryId}/${scene.sceneId}`)
  }
  assert.equal(routeResults.length, 18)
  assert.equal(new Set(bank.scenes.map((scene) => scene.categoryId)).size, 6)
  checkpoint('six-categories-eighteen-live-routes', { routes: routeResults })

  const completionScene = bank.scenes.find((scene) => scene.sceneId === 'restaurant')
  assert.ok(completionScene)
  await qa.page.navigate(routeFor(completionScene))
  await answerSeveral(qa.page, completionScene, 6)
  await qa.page.waitFor(`document.querySelector('.scene-vocabulary-target')`)
  const continuousSummary = await qa.page.evaluate(`(() => ({ text: document.body.innerText, progress: document.querySelector('.scene-vocabulary-progress')?.innerText }))()`)
  assert.match(continuousSummary.progress ?? '', /已答题\s*6/u)
  assert.doesNotMatch(continuousSummary.text, /场景词汇练习完成|SCENE COMPLETE|倒计时|\/\s*48/u)
  checkpoint('continuous-scene-training-after-six', { scene: completionScene.sceneId, answered: 6 })

  const recoveryScene = bank.scenes.find((scene) => scene.sceneId === 'taxi')
  assert.ok(recoveryScene)
  await qa.page.navigate(routeFor(recoveryScene))
  await qa.page.waitFor(`document.querySelector('.scene-vocabulary-target')`)
  const recoveryTarget = await qa.page.evaluate(`document.querySelector('.scene-vocabulary-target')?.textContent.trim()`)
  const recoveryQuestion = recoveryScene.questions.find((question) => question.targetText === recoveryTarget)
  assert.ok(recoveryQuestion)
  await selectMeaning(qa.page, recoveryQuestion.correctMeaningZh)
  await qa.page.reload()
  await qa.page.waitFor(`document.body.innerText.includes('继续上次训练？')`)
  await resumeIfPrompted(qa.page)
  await qa.page.waitFor(`document.querySelector('.scene-vocabulary-option--selected')?.innerText.trim() === ${JSON.stringify(recoveryQuestion.correctMeaningZh)}`)
  await qa.page.clickByText('提交答案')
  await qa.page.waitFor(`document.body.innerText.includes('回答正确')`)
  await qa.page.reload()
  await qa.page.waitFor(`document.body.innerText.includes('继续上次训练？')`)
  await resumeIfPrompted(qa.page)
  await qa.page.waitFor(`document.body.innerText.includes('回答正确') && document.body.innerText.includes(${JSON.stringify(recoveryQuestion.correctMeaningZh)})`)
  await qa.page.reload()
  await qa.page.waitFor(`document.body.innerText.includes('继续上次训练？')`)
  await qa.page.clickByText('开始新一轮')
  await qa.page.waitFor(`document.querySelector('.scene-vocabulary-target')`)
  const newRound = await qa.page.evaluate(`document.querySelector('.scene-vocabulary-progress')?.innerText`)
  assert.match(newRound ?? '', /已答题\s*0/u)
  checkpoint('selection-feedback-recovery-and-explicit-new-round', { scene: recoveryScene.sceneId })

  const pronunciationScene = bank.scenes.find((scene) => scene.sceneId === 'airport')
  assert.ok(pronunciationScene)
  await qa.page.navigate(routeFor(pronunciationScene))
  await qa.page.waitFor(`document.querySelector('.scene-vocabulary-target')`)
  const target = await qa.page.evaluate(`document.querySelector('.scene-vocabulary-target')?.textContent.trim()`)
  assert.ok(pronunciationScene.questions.some((question) => question.targetText === target))
  await qa.page.evaluate(`document.querySelector('.scene-vocabulary-target')?.click()`)
  await qa.page.waitFor(`globalThis.__r13cSpeechProbe.utterances.length === 1`)
  const utterances = await qa.page.evaluate(`globalThis.__r13cSpeechProbe.utterances`)
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
  assert.equal(serviceWorker.caches.some((cache) => cache.urls.some((url) => /scene-vocabulary-questions\.v1-[A-Za-z0-9_-]+\.json/u.test(url))), true)
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
