/*
 * R17 growth-upgrade browser acceptance.
 *
 * This is deliberately a black-box script.  It starts its own temporary
 * Chrome profile, seeds only that profile's engine growth ledger, and talks
 * to the rendered application through CDP.  It must never be run against a
 * personal browser profile.
 */
import assert from 'node:assert/strict'
import { launchQaChrome } from './lib/cdp-browser.mjs'

const baseUrl = new URL(process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173/')
const databaseName = 'english-learning-pwa'
const domains = ['vocabulary', 'listening', 'speaking']
const at = '2026-08-13T08:00:00.000Z'
const evidence = { status: 'running', baseUrl: baseUrl.href, isolatedProfile: true, checkpoints: [] }

function checkpoint(name, details = {}) { evidence.checkpoints.push({ name, ...details }) }
function allRecords(databases) { return databases.flatMap((database) => database.stores.records ?? []) }
function record(databases, namespace, key) { return allRecords(databases).find((value) => value.namespace === namespace && value.key === key) }

async function putRecords(page, records) {
  await page.evaluate(`(async () => {
    const values = ${JSON.stringify(records)}
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(${JSON.stringify(databaseName)})
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('records', 'readwrite')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      const store = transaction.objectStore('records')
      for (const value of values) store.put(value)
    })
    database.close()
  })()`)
}

function qualifiedDomain(domain, currentLevelOrdinal = 0) {
  const sessions = Array.from({ length: 5 }, (_, index) => ({
    eventId: `r17-browser:${domain}:session:${index}`,
    sessionId: `r17-browser:${domain}:session:${index}`,
    domain,
    source: index % 2 === 0 ? 'daily-training' : 'extra-training',
    levelOrdinal: currentLevelOrdinal,
    correctCount: 8,
    incorrectCount: 2,
    localDate: `2026-08-${String(index + 1).padStart(2, '0')}`,
    completedAt: `2026-08-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`,
  }))
  return {
    currentLevelOrdinal,
    levelScoredItemCount: 50,
    eligibleSessionCount: 5,
    sessions,
    processedEventIds: [],
    upgradeTest: null,
    lastUpgradeResult: null,
    retryAvailableAfterEligibleSessionCount: null,
  }
}

function eligibleGrowth() {
  return {
    schemaVersion: 3,
    domains: Object.fromEntries(domains.map((domain) => [domain, qualifiedDomain(domain)])),
  }
}

function immutableEngineProjection(value) {
  const copy = structuredClone(value)
  delete copy.growth
  return copy
}

async function bootstrap(page) {
  await page.initialize()
  await page.setViewport(390, 844)
  await page.navigate(new URL('#/', baseUrl).href)
  await page.waitFor(`document.readyState === 'complete'`, 20_000)
  await page.waitFor(`!document.body.innerText.includes('正在恢复今日学习计划')`, 20_000)
  // A fresh profile intentionally has no engine ledger.  Produce the same
  // schema-3 profile and active-plan baseline used by R2/R6 acceptance before
  // touching only its additive growth branch.
  await page.navigate(new URL('#/assessment', baseUrl).href)
  await page.waitFor(`!document.body.innerText.includes('正在读取本机 R1 旅游英语词汇测试')`, 20_000)
  assert.match(await page.bodyText(), /5 个阶段|每阶段 30 题/u)
  await page.clickByText('开始测试')
  await page.waitFor(`document.body.innerText.includes('第 1 / 30 题')`, 20_000)
  await page.clickFirstEnabledChoice()
  await page.waitFor(`
    [...document.querySelectorAll('button')].some((button) =>
      button.innerText.trim() === '检查并提交本阶段' && !button.disabled
    )
  `, 20_000)
  await page.clickByText('检查并提交本阶段')
  await page.waitFor(`Boolean(document.querySelector('.travel-r1-screen--review'))`, 20_000)
  await page.clickByText('剩余全部不会，结束测试')
  await page.waitFor(`Boolean(document.querySelector('.travel-r1-screen--finish-confirmation'))`, 20_000)
  await page.clickByText('确认剩余全部不会并结束')
  await page.waitFor(`Boolean(document.querySelector('.travel-r1-screen--results'))`, 20_000)
  await page.clickByText('进入今日计划')
  await page.waitFor(`location.hash === '#/' && !document.body.innerText.includes('正在恢复今日学习计划') && document.body.innerText.includes('任选一项开始')`, 20_000)
  const databases = await page.dumpIndexedDb()
  assert.ok(record(databases, 'learning.engine', 'current-state'), 'Assessment must create the production learning-engine record.')
  assert.ok(record(databases, 'app.learning-runtime', 'active-plan'), 'Assessment must create the production active-plan record.')

  // QA-R17-001: the expanded vocabulary corpus exposes more than 1,000
  // eligible candidates.  The real daily route must build its complete round
  // and render a question instead of rejecting the old enumeration bound.
  const openedVocabulary = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button.task-row')].find(
      (candidate) => candidate.dataset.moduleId === 'vocabulary' && !candidate.disabled,
    )
    if (!button) return false
    button.click()
    return true
  })()`)
  assert.equal(openedVocabulary, true, 'The daily vocabulary task was not startable.')
  await page.waitFor(`location.hash.startsWith('#/vocabulary?taskId=') && (
    document.body.innerText.includes('提交答案') ||
    document.body.innerText.includes('检查答案') ||
    document.body.innerText.includes('无法准备训练题目顺序') ||
    document.body.innerText.includes('Supply provider exceeded')
  )`, 20_000)
  assert.doesNotMatch(
    await page.bodyText(),
    /无法准备训练题目顺序|Supply provider exceeded|exceeded the released candidate index/u,
    'The expanded daily vocabulary round failed to initialize.',
  )
  const vocabularyText = await page.bodyText()
  assert.match(
    vocabularyText,
    /提交答案|检查答案/u,
    `The daily vocabulary question did not render. Body: ${vocabularyText.slice(0, 800)}`,
  )
  await page.navigate(new URL('#/', baseUrl).href)
  await page.waitFor(`document.body.innerText.includes('任选一项开始')`, 20_000)
}

async function seedEligibleGrowth(page) {
  const databases = await page.dumpIndexedDb()
  const engine = record(databases, 'learning.engine', 'current-state')
  assert.ok(engine, 'The production engine record must exist before R17 seeding.')
  const seeded = structuredClone(engine)
  seeded.value.growth = eligibleGrowth()
  seeded.updatedAt = at
  await putRecords(page, [seeded])
  return {
    engineWithoutGrowth: immutableEngineProjection(engine.value),
    plan: structuredClone(record(databases, 'app.learning-runtime', 'active-plan')?.value ?? null),
    wrongAnswers: allRecords(databases).filter((value) => value.namespace.includes('wrong-answer')).map((value) => structuredClone(value)),
    scene: allRecords(databases).filter((value) => value.namespace.includes('scene')).map((value) => structuredClone(value)),
  }
}

async function clickGrowthAction(page, domain) {
  await page.navigate(new URL('#/?section=progress', baseUrl).href)
  await page.waitFor(`document.body.innerText.includes('成长') || document.body.innerText.includes('进度')`, 20_000)
  const clicked = await page.evaluate(`(() => {
    const domain = ${JSON.stringify(domain)}
    const label = ({ vocabulary: '词汇', listening: '听力', speaking: '口语' })[domain]
    const cards = [...document.querySelectorAll('section[aria-label="专项成长进度"] article.task-card')]
    const matches = cards.filter((card) => card.innerText.trim().split('\\n')[0] === label)
    if (matches.length !== 1) return { clicked: false, reason: 'card-count', count: matches.length, cards: cards.map((card) => card.innerText.trim()) }
    const button = [...matches[0].querySelectorAll('button')].find((node) =>
      ['开始升级测试', '参加升级测试', '继续升级测试'].some((text) => node.innerText.includes(text)) && !node.disabled
    )
    if (!button) return { clicked: false, reason: 'action-missing', text: matches[0].innerText.trim() }
    button.click(); return { clicked: true, label }
  })()`)
  assert.equal(clicked.clicked, true, `The ${domain} growth action was not available: ${JSON.stringify(clicked)}`)
  await page.waitFor(`location.hash.includes('/progress/growth/${domain}')`, 20_000)
  await page.waitFor(`document.body.innerText.includes('第 1/10 题') || document.body.innerText.includes('第 1 / 10 题')`, 20_000)
}

async function selectFirstAnswer(page, domain) {
  const selected = await page.evaluate(`(() => {
    const choice = [...document.querySelectorAll('button')].find((node) =>
      !node.disabled && node.getAttribute('aria-pressed') === 'false' && !/播放|提交|退出|下一题/u.test(node.innerText)
    )
    if (choice) { choice.click(); return { kind: 'choice', value: choice.innerText.trim() } }
    const input = document.querySelector('input[aria-label="听写答案"]')
    if (input && !input.disabled) { input.focus(); return { kind: 'dictation' } }
    return null
  })()`)
  assert.ok(selected, `The rendered ${domain} upgrade question had no interactive answer control. Body: ${(await page.bodyText()).slice(0, 800)}`)
  if (selected.kind === 'dictation') {
    await page.insertText('qa draft')
    selected.value = 'qa draft'
  }
  return selected
}

async function assertDraftRestores(page, domain) {
  const selected = await selectFirstAnswer(page, domain)
  // The production route serializes draft writes.  Give the IndexedDB write a
  // real event-loop turn before simulating a reload; `waitFor(true)` is not a
  // delay and used to make this assertion race the save itself.
  await page.evaluate(`new Promise((resolve) => setTimeout(() => resolve(true), 750))`)
  const saved = record(await page.dumpIndexedDb(), 'learning.engine', 'current-state')
  assert.ok(saved?.value?.growth?.domains?.[domain]?.upgradeTest?.draft, `${domain} draft was not persisted before refresh.`)
  await page.reload()
  await page.waitFor(`document.body.innerText.includes('第 1/10 题') || document.body.innerText.includes('第 1 / 10 题')`, 20_000)
  const restored = await page.evaluate(`(() => ({
    input: document.querySelector('input[aria-label="听写答案"]')?.value ?? '',
    choices: [...document.querySelectorAll('button[aria-pressed="true"]')].map((node) => node.innerText.trim()),
  }))()`)
  if (selected.kind === 'dictation') {
    assert.equal(restored.input, selected.value, `${domain} dictation draft was lost after refresh.`)
  } else {
    assert.ok(restored.choices.includes(selected.value), `${domain} selected choice was lost after refresh.`)
  }
}

async function submitAndReadFeedback(page) {
  await page.clickByText('提交答案')
  await page.waitFor(`document.body.innerText.includes('下一题') || document.body.innerText.includes('升级测试结果')`, 20_000)
  return page.bodyText()
}

async function assertListeningDisclosure(page) {
  const text = await submitAndReadFeedback(page)
  assert.doesNotMatch(text, /\{"domain"|choiceTranslations|dictationReview/u, 'Listening feedback rendered raw JSON.')
  assert.match(text, /参考答案|目标关键词|中文|翻译/u, 'Listening feedback omitted R9/R10 disclosure.')
}

async function assertSpeakingControls(page) {
  const controls = await page.interactiveElements()
  assert.ok(controls.some((item) => item.text === '开始录音'), 'Speaking upgrade lacks recording start.')
  assert.ok(controls.some((item) => item.text === '退出并保存'), 'Speaking upgrade lacks safe exit.')
  const semantics = await page.evaluate(`(() => ({
    mainLabel: document.querySelector('main')?.getAttribute('aria-label'),
    live: [...document.querySelectorAll('[aria-live]')].map((node) => node.getAttribute('aria-live')),
  }))()`)
  assert.match(semantics.mainLabel ?? '', /口语升级测试/u)
  assert.ok(semantics.live.includes('polite'), 'Speaking status must be announced to a screen reader.')
}

function assertNoUnrelatedSideEffects(before, after) {
  const engine = record(after, 'learning.engine', 'current-state')
  assert.ok(engine, 'The engine record disappeared.')
  assert.deepEqual(immutableEngineProjection(engine.value), before.engineWithoutGrowth, 'R17 changed Plan/R7/other engine state.')
  assert.deepEqual(record(after, 'app.learning-runtime', 'active-plan')?.value ?? null, before.plan, 'R17 changed the active plan.')
  const wrong = allRecords(after).filter((value) => value.namespace.includes('wrong-answer'))
  const scene = allRecords(after).filter((value) => value.namespace.includes('scene'))
  assert.deepEqual(wrong, before.wrongAnswers, 'R17 changed the wrong-answer library.')
  assert.deepEqual(scene, before.scene, 'R17 changed scene progress.')
}

async function assertMobileAccessibility(page) {
  for (const width of [320, 390]) {
    await page.setViewport(width, 844)
    const layout = await page.layoutSnapshot()
    assert.ok(layout.documentWidth <= width + 1, `${width}px upgrade route horizontally overflows.`)
  }
  const zoom = await page.evaluate(`(() => { document.documentElement.style.fontSize = '200%'; return document.body.scrollWidth <= innerWidth + 1 })()`)
  assert.equal(zoom, true, '200% text causes horizontal overflow.')
  await page.pressKey('Tab')
  const layout = await page.layoutSnapshot()
  assert.notEqual(layout.focusedText, '', 'Keyboard focus is not visible on the upgrade route.')
}

async function assertOfflineRestore(page) {
  await page.setOffline(true)
  await page.reload()
  await page.waitFor(`document.readyState === 'complete'`, 20_000)
  assert.doesNotMatch(await page.bodyText(), /无法恢复升级测试|网络错误/u, 'Offline reload cannot restore the saved upgrade session.')
  await page.setOffline(false)
}

async function runDomain(page, domain) {
  await clickGrowthAction(page, domain)
  if (domain !== 'speaking') await assertDraftRestores(page, domain)
  if (domain === 'listening') await assertListeningDisclosure(page)
  if (domain === 'speaking') await assertSpeakingControls(page)
  await assertMobileAccessibility(page)
  await assertOfflineRestore(page)
  checkpoint(`${domain}-route`, { draftRestored: domain !== 'speaking', offlineRestored: true })
}

/*
 * The completed-result seeds exercise both legal score boundaries without
 * asking a browser test to know course answer keys.  They are deliberately
 * built from the actual active upgrade state after it has been started, so
 * the order and stable item identities remain production-owned.
 */
async function assertResultBoundary(page, domain, correctCount) {
  const databases = await page.dumpIndexedDb()
  const engine = record(databases, 'learning.engine', 'current-state')
  const test = engine?.value?.growth?.domains?.[domain]?.upgradeTest
  assert.ok(test?.itemIds?.length === 10, 'A legal ten-item upgrade state is required.')
  const answers = test.itemIds.map((itemId, index) => ({
    itemId,
    draft: `qa-${index}`,
    feedback: { correct: index < correctCount, answeredAt: at },
    displayEvidence: null,
  }))
  const domainState = engine.value.growth.domains[domain]
  const result = {
    sessionId: test.testId, domain, seed: test.seed,
    targetLevelOrdinal: domainState.currentLevelOrdinal + 1,
    previousLevelOrdinal: domainState.currentLevelOrdinal,
    resultingLevelOrdinal: correctCount >= 8 ? domainState.currentLevelOrdinal + 1 : domainState.currentLevelOrdinal,
    score: { correctCount, answeredCount: 10 }, total: 10,
    passed: correctCount >= 8, completedAt: at,
    cooldownRequired: correctCount >= 8 ? 0 : 2,
    itemIds: test.itemIds, answers,
  }
  const next = structuredClone(engine)
  next.value.growth.domains[domain] = {
    ...domainState,
    upgradeTest: null,
    lastUpgradeResult: result,
    retryAvailableAfterEligibleSessionCount: correctCount >= 8 ? null : domainState.eligibleSessionCount + 2,
  }
  await putRecords(page, [next])
  await page.reload()
  await page.waitFor(`document.readyState === 'complete'`, 20_000)
  await page.navigate(new URL(`#/progress/growth/${domain}`, baseUrl).href)
  try {
    await page.waitFor(`document.body.innerText.includes('升级成功') || document.body.innerText.includes('本次未通过')`, 20_000)
  } catch (cause) {
    throw new Error(`The ${correctCount}/10 result did not render. Body: ${(await page.bodyText()).slice(0, 1200)}`, { cause })
  }
  const text = await page.bodyText()
  assert.match(text, new RegExp(`${correctCount}/10`), 'The persisted upgrade score is not displayed.')
  if (correctCount >= 8) assert.match(text, /升级成功/u)
  else assert.match(text, /不降级|再完成 2 次正式训练|再完成2次正式训练/u)
  await page.clickByText('返回进度')
  await page.waitFor(`location.hash.includes('section=progress')`, 20_000)
}

async function main() {
  const qa = await launchQaChrome()
  try {
    await bootstrap(qa.page)
    const before = await seedEligibleGrowth(qa.page)
    await qa.page.reload()
    for (const domain of domains) await runDomain(qa.page, domain)
    await clickGrowthAction(qa.page, 'vocabulary')
    await assertResultBoundary(qa.page, 'vocabulary', 7)
    await seedEligibleGrowth(qa.page)
    await qa.page.reload()
    await qa.page.waitFor(`document.readyState === 'complete'`, 20_000)
    await clickGrowthAction(qa.page, 'vocabulary')
    await assertResultBoundary(qa.page, 'vocabulary', 8)
    assertNoUnrelatedSideEffects(before, await qa.page.dumpIndexedDb())
    evidence.status = 'passed'
    console.log(JSON.stringify(evidence, null, 2))
  } finally {
    await qa.close()
  }
}

await main()
