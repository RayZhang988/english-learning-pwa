import assert from 'node:assert/strict'
import { launchQaChrome, fakeAssessmentClockScript } from './lib/cdp-browser.mjs'

const baseUrl = new URL(process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173/')
const expectedAsset = process.env.QA_EXPECTED_ASSET ?? null
const evidence = { status: 'running', baseUrl: baseUrl.href, isolatedProfile: true, userDeviceDataTouched: false, sessions: [] }

// Real route playback is made deterministic; the app still receives its normal onstart/onend events.
const speechScript = `(() => {
 let active = null
 class U { constructor(text) { this.text = text; this.onstart = null; this.onend = null; this.onerror = null; this.rate = 1; this.pitch = 1 } }
 const synth = { get speaking() { return Boolean(active) }, getVoices() { return [] }, speak(u) { active = u; queueMicrotask(() => u.onstart?.()) }, cancel() { active = null }, pause() {}, resume() {} }
 Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: U })
 Object.defineProperty(globalThis, 'speechSynthesis', { configurable: true, value: synth })
 Object.defineProperty(globalThis, '__r11FinishSpeech', { configurable: true, value: () => { if (!active) return false; const u = active; active = null; queueMicrotask(() => u.onend?.()); return true } })
})()`

function records(databases) { return databases.flatMap((database) => database.stores.records ?? []) }
function record(databases, namespace, key) { return records(databases).find((item) => item.namespace === namespace && item.key === key)?.value }
function activePlan(databases) { const value = record(databases, 'app.learning-runtime', 'active-plan'); assert.ok(value); return value }
function listeningExecution(databases) { const value = activePlan(databases).activePlan.tasks.find((task) => task.task.targetModuleId === 'listening'); assert.ok(value); return value }
function listeningSnapshot(databases) { return record(databases, 'feature.listening', `session:${listeningExecution(databases).task.taskId}`) }

async function createPlan(page) {
 await page.navigate(new URL('#/assessment', baseUrl).href)
 await page.waitFor(`!document.body.innerText.includes('正在读取本机 R1 旅游英语词汇测试')`, 20_000)
 await page.clickByText('开始测试')
 await page.waitFor(`document.body.innerText.includes('第 1 / 30 题')`, 20_000)
 await page.clickFirstEnabledChoice()
 await page.waitFor(`[...document.querySelectorAll('button')].some((x) => x.innerText.trim() === '检查并提交本阶段' && !x.disabled)`, 20_000)
 await page.clickByText('检查并提交本阶段')
 await page.waitFor(`Boolean(document.querySelector('.travel-r1-screen--review'))`, 20_000)
 await page.clickByText('剩余全部不会，结束测试')
 await page.clickByText('确认剩余全部不会并结束')
 await page.waitFor(`Boolean(document.querySelector('.travel-r1-screen--results'))`, 20_000)
 await page.clickByText('进入今日计划')
 await page.waitFor(`location.hash === '#/' && document.body.innerText.includes('任选一项开始')`, 20_000)
}

async function startListening(page) {
 const clicked = await page.evaluate(`(() => { const button = [...document.querySelectorAll('button.task-row')].find((x) => x.dataset.moduleId === 'listening' && !x.disabled); if (!button) return false; button.click(); return true })()`)
 assert.equal(clicked, true)
 try {
   await page.waitFor(`location.hash.includes('/listening?taskId=') && [...document.querySelectorAll('button')].some((x) => (x.innerText.trim() === '播放音频' || x.getAttribute('aria-label') === '播放音频') && !x.disabled)`, 20_000)
 } catch (error) {
   throw new Error(`${error.message}\n${await page.bodyText()}`)
 }
}

function itemFromSnapshot(snapshot) {
 const item = snapshot?.stream?.activeItem ?? snapshot?.activeItem ?? snapshot?.runtime?.activeItem ?? null
 assert.ok(item?.itemId, `Listening snapshot has no active item: ${JSON.stringify(snapshot)}`)
 return item
}

async function answerAndAdvance(page) {
 const played = await page.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((x) => (x.innerText.trim() === '播放音频' || x.getAttribute('aria-label') === '播放音频') && !x.disabled); if (!button) return false; button.click(); return true })()`)
 assert.equal(played, true)
 await page.waitFor(`globalThis.speechSynthesis.speaking === true`, 10_000)
 assert.equal(await page.evaluate(`globalThis.__r11FinishSpeech()`), true)
 await page.waitFor(`document.body.innerText.includes('播放完毕')`, 10_000)
 const hasChoices = await page.evaluate(`[...document.querySelectorAll('button.choice-row, button.choice-card, [role="radio"]')].some((x) => !x.disabled)`)
 if (hasChoices) await page.clickFirstEnabledChoice()
 else {
   const filled = await page.evaluate(`(() => { const input = document.querySelector('input[type="text"], textarea'); if (!input || input.disabled) return false; const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set; set?.call(input, 'hello'); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
   assert.equal(filled, true)
 }
 await page.waitFor(`[...document.querySelectorAll('button')].some((x) => x.innerText.trim() === '提交答案' && !x.disabled)`, 10_000)
 await page.clickByText('提交答案')
 const before = listeningSnapshot(await page.dumpIndexedDb())
 const previousItem = itemFromSnapshot(before)
 try {
   await page.waitFor(`[...document.querySelectorAll('button')].some((x) => ['下一题', '完成训练'].includes(x.innerText.trim()) && !x.disabled)`, 20_000)
 } catch (error) { throw new Error(`${error.message}\n${await page.bodyText()}`) }
 const advanced = await page.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((x) => ['下一题', '完成训练'].includes(x.innerText.trim()) && !x.disabled); if (!button) return false; button.click(); return true })()`)
 assert.equal(advanced, true)
 await page.waitFor(`[...document.querySelectorAll('button')].some((x) => x.innerText.trim() === '提交答案')`, 20_000)
 const after = listeningSnapshot(await page.dumpIndexedDb())
 assert.equal(after.phase, 'answering', 'Daily listening advance must return to answering.')
 assert.notEqual(itemFromSnapshot(after).itemId, previousItem.itemId, 'Daily listening advance must supply a new item.')
 assert.ok((after.stream?.completedItemIds?.length ?? 0) > (before.stream?.completedItemIds?.length ?? 0), 'Daily listening advance must grow its durable completed-item set.')
 assert.equal(after.stream?.completedItemIds?.includes(previousItem.itemId), true, 'Daily listening advance must durably record the completed item.')
}

function validateSequence(label, items) {
 assert.equal(new Set(items.map((item) => item.itemId)).size, items.length, `${label}: repeated itemId before exhaustion`)
 const normalizedAudio = items.map((item) =>
   String(item.audioText ?? '').toLowerCase().replace(/[\s\p{P}]+/gu, ' ').trim(),
 )
 assert.equal(
   new Set(normalizedAudio).size,
   normalizedAudio.length,
   `${label}: distinct item IDs replayed identical normalized audio.`,
 )
 for (let i = 1; i < items.length; i += 1) {
   assert.notEqual(items[i].source.variantId, items[i - 1].source.variantId, `${label}: adjacent type repeated at ${i}`)
   assert.equal(items.slice(Math.max(0, i - 4), i).some((old) => old.variantFamilyId === items[i].variantFamilyId), false, `${label}: family cooldown violated at ${i}`)
 }
}

async function runDailySession(label, refreshAt = 5) {
 const qa = await launchQaChrome()
 try {
   await qa.page.initialize(); await qa.page.addInitScript(fakeAssessmentClockScript); await qa.page.addInitScript(speechScript); await qa.page.setViewport(390, 844)
   await createPlan(qa.page); await startListening(qa.page)
   const startedDatabases = await qa.page.dumpIndexedDb()
   assert.ok(
     listeningSnapshot(startedDatabases)?.stream,
     `R11 daily listening must start a continuous stream: ${JSON.stringify({ execution: listeningExecution(startedDatabases), snapshot: listeningSnapshot(startedDatabases) })}`,
   )
   const items = []
   for (let index = 0; index < 30; index += 1) {
     const currentSnapshot = listeningSnapshot(await qa.page.dumpIndexedDb())
     const before = itemFromSnapshot(currentSnapshot)
     items.push({
       ...before,
       audioText: currentSnapshot?.questions?.[currentSnapshot.questionIndex]
         ?.segments?.find((segment) => segment.id === currentSnapshot.playback?.currentSegmentId)?.text ?? null,
     })
     if (index === refreshAt) {
       await qa.page.reload()
       await qa.page.waitFor(`[...document.querySelectorAll('button')].some((x) => (x.innerText.trim() === '播放音频' || x.getAttribute('aria-label') === '播放音频') && !x.disabled)`, 20_000)
       const after = itemFromSnapshot(listeningSnapshot(await qa.page.dumpIndexedDb()))
       assert.equal(after.itemId, before.itemId, `${label}: refresh changed the active item`)
     }
     await answerAndAdvance(qa.page)
   }
   validateSequence(label, items)
   const summary = { label, planId: activePlan(await qa.page.dumpIndexedDb()).activePlan.plan.planId, items: items.map((x) => ({ itemId: x.itemId, audioText: x.audioText, family: x.variantFamilyId, type: x.source.variantId })), itemIds: items.map((x) => x.itemId), families: items.map((x) => x.variantFamilyId), types: items.map((x) => x.source.variantId) }
   evidence.sessions.push(summary)
   return summary
 } finally { await qa.close() }
}

async function run() {
 const first = await runDailySession('daily-a')
 const second = await runDailySession('daily-b')
 assert.notDeepEqual(first.itemIds, second.itemIds, 'Different real daily sessions produced an identical 12-item order.')
 const home = await fetch(baseUrl).then((response) => response.text())
 const asset = home.match(/assets\/index-[^"']+\.js/u)?.[0] ?? null
 if (expectedAsset) assert.equal(asset, `assets/${expectedAsset}`)
 evidence.asset = asset
 evidence.status = 'passed'
 console.log(JSON.stringify(evidence, null, 2))
}

run().catch((error) => { evidence.status = 'failed'; evidence.error = error.stack ?? String(error); console.error(JSON.stringify(evidence, null, 2)); process.exitCode = 1 })
