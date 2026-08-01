import assert from 'node:assert/strict'
import { launchQaChrome, fakeAssessmentClockScript } from './lib/cdp-browser.mjs'

const baseUrl = new URL(process.env.QA_BASE_URL ?? 'https://rayzhang988.github.io/english-learning-pwa/?trainingTest=30')
const expectedAsset = process.env.QA_EXPECTED_ASSET ?? 'index-WVAhWKtK.js'
const dbName = 'english-learning-pwa-training-test-30s'
const evidence = { status: 'running', baseUrl: baseUrl.href, database: dbName, normalDatabaseTouched: false, sessions: [] }
const checkpoint = (stage, details = {}) => console.log(JSON.stringify({ R11_E2E_HEARTBEAT: true, at: new Date().toISOString(), stage, ...details }))

// The production route still owns playback; this only supplies browser onstart/onend.
const speech = `(() => { let active; class U { constructor(text) { this.text=text; this.onstart=null; this.onend=null; this.onerror=null; this.rate=1; this.pitch=1 } }; const s={get speaking(){return !!active},getVoices(){return []},speak(u){active=u;queueMicrotask(()=>u.onstart?.())},cancel(){active=null},pause(){},resume(){}}; Object.defineProperty(globalThis,'SpeechSynthesisUtterance',{configurable:true,value:U});Object.defineProperty(globalThis,'speechSynthesis',{configurable:true,value:s});Object.defineProperty(globalThis,'__finishSpeech',{configurable:true,value:()=>{if(!active)return false;const u=active;active=null;queueMicrotask(()=>u.onend?.());return true}}) })()`
const noRecognition = `for (const k of ['SpeechRecognition','webkitSpeechRecognition']) Object.defineProperty(globalThis,k,{configurable:true,value:undefined})`
const rows = ds => ds.flatMap(d => d.stores.records ?? [])
const rec = (ds, ns, key) => rows(ds).find(r => r.namespace === ns && r.key === key)?.value
const runtime = ds => { const r = rec(ds, 'app.learning-runtime', 'active-plan'); assert.ok(r); return r }
const daily = (ds, id) => { const x = runtime(ds).activePlan.tasks.find(t => t.task.targetModuleId === id); assert.ok(x); return x }
const snapshot = (ds, taskId) => rec(ds, 'feature.listening', `session:${taskId}`)
const completedDailyListeningItemIds = ds => { const execution=daily(ds,'listening'); const ids=snapshot(ds,execution.task.taskId)?.stream?.completedItemIds; assert.ok(Array.isArray(ids)&&ids.length>0,'Daily listening completedItemIds are missing from its durable session.'); assert.equal(new Set(ids).size,ids.length); return ids }
const extraState = ds => { const r = rec(ds, 'learning.engine', 'current-state'); assert.ok(r); return r }
const extraSnapshot = (ds, id) => rec(ds, 'feature.listening.extra-training', `session:${id}`)
async function extraListeningDiagnostic(page, sessionId) { const ds=await page.dumpIndexedDb(); return { hash:await page.url(), sessionId, snapshot:extraSnapshot(ds,sessionId), engine:extraState(ds), keys:rows(ds).filter(r=>r.namespace==='feature.listening.extra-training').map(r=>r.key), buttons:await page.evaluate(`[...document.querySelectorAll('button')].map(x=>({text:x.innerText.trim(),aria:x.getAttribute('aria-label'),disabled:x.disabled}))`), body:await page.bodyText() } }
async function submitExtraListening(page, sessionId, expectedItemId) {
 let s=extraSnapshot(await page.dumpIndexedDb(),sessionId); assert.equal(s.activeItem?.itemId,expectedItemId); await page.clickByText('播放音频'); await page.waitFor(`document.body.innerText.includes('正在播放')`,10000); const playingDeadline=Date.now()+10000;while(Date.now()<playingDeadline){s=extraSnapshot(await page.dumpIndexedDb(),sessionId);if(s.playback?.status==='playing')break;await page.evaluate(`new Promise(r=>setTimeout(r,50))`)}assert.equal(s.playback?.status,'playing'); assert.equal(await page.evaluate('__finishSpeech()'),true); await page.waitFor(`document.body.innerText.includes('播放完毕')`,10000)
 const deadline=Date.now()+10000; while(Date.now()<deadline){s=extraSnapshot(await page.dumpIndexedDb(),sessionId);if(s?.activeItem?.itemId===expectedItemId&&s.playback?.status==='ended'&&!(s.pendingEvents?.length))break;await page.evaluate(`new Promise(r=>setTimeout(r,50))`)} if(s?.playback?.status!=='ended')throw new Error(JSON.stringify(await extraListeningDiagnostic(page,sessionId)));
 if(s.question?.type==='keyword-dictation'){await page.evaluate(`(()=>{const x=document.querySelector('input[type="text"]:not([disabled]),textarea:not([disabled])');const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(x),'value').set;d.call(x,'nine thirty');x.dispatchEvent(new Event('input',{bubbles:true}));x.dispatchEvent(new Event('change',{bubbles:true}))})()`)}else{await page.waitFor(`document.querySelectorAll('.choice-list button:not([disabled]),[role="radio"]:not([aria-disabled="true"])').length>0`,10000);await page.evaluate(`document.querySelector('.choice-list button:not([disabled]),[role="radio"]:not([aria-disabled="true"])')?.click()`)}
 await page.waitFor(`[...document.querySelectorAll('button')].some(x=>x.innerText.trim()==='提交答案'&&!x.disabled)`,10000); await page.clickByText('提交答案');
 const feedbackDeadline=Date.now()+10000; while(Date.now()<feedbackDeadline){s=extraSnapshot(await page.dumpIndexedDb(),sessionId);if(s.activeItem?.itemId===expectedItemId&&s.phase==='feedback')return s;await page.evaluate(`new Promise(r=>setTimeout(r,50))`)} throw new Error(JSON.stringify(await extraListeningDiagnostic(page,sessionId)))
}
async function waitExtraTransition(page, sessionId, previousItemId, previousCount) {
 const deadline=Date.now()+20000
 while(Date.now()<deadline) {
  const s=extraSnapshot(await page.dumpIndexedDb(),sessionId)
  const item=s?.activeItem??s?.stream?.activeItem
  if(s?.phase==='answering'&&item?.itemId&&item.itemId!==previousItemId&&(s.session?.completedItemCount??0)>previousCount&&(s.session?.excludeItemIds??[]).includes(previousItemId)&&!(s.pendingEvents?.length)) return s
  await page.evaluate(`new Promise(r=>setTimeout(r,100))`)
 }
 throw new Error(`Extra transition timed out: ${JSON.stringify(extraSnapshot(await page.dumpIndexedDb(),sessionId))}`)
}
async function listeningDiagnostic(page) {
 const ds=await page.dumpIndexedDb(); const execution=daily(ds,'listening'); const s=snapshot(ds,execution.task.taskId)
 return { itemId:active(s).itemId, type:active(s).source?.variantId, phase:s?.phase, stream:s?.stream, playback:s?.playback, training:execution.training, body:await page.bodyText(), buttons:await page.evaluate(`[...document.querySelectorAll('button')].map(x=>({text:x.innerText.trim(),disabled:x.disabled,ariaDisabled:x.getAttribute('aria-disabled')}))`), inputs:await page.evaluate(`[...document.querySelectorAll('input,textarea')].map(x=>({tag:x.tagName,type:x.type,value:x.value,disabled:x.disabled}))`) }
}

async function plan(page) {
  await page.navigate(new URL('#/assessment', baseUrl).href)
  await page.waitFor(`!document.body.innerText.includes('正在读取本机 R1')`, 20000)
  await page.clickByText('开始测试'); await page.waitFor(`document.body.innerText.includes('第 1 / 30 题')`, 20000)
  await page.clickFirstEnabledChoice(); await page.waitFor(`[...document.querySelectorAll('button')].some(x=>x.innerText.trim()==='检查并提交本阶段'&&!x.disabled)`,20000); await page.clickByText('检查并提交本阶段')
  await page.waitFor(`Boolean(document.querySelector('.travel-r1-screen--review'))`, 20000)
  await page.clickByText('剩余全部不会，结束测试'); await page.clickByText('确认剩余全部不会并结束')
  await page.waitFor(`Boolean(document.querySelector('.travel-r1-screen--results'))`, 20000); await page.clickByText('进入今日计划')
  await page.waitFor(`location.hash === '#/' && document.body.innerText.includes('任选一项开始')`, 20000)
}
async function clickDaily(page, module) {
  const ok = await page.evaluate(`(()=>{const x=[...document.querySelectorAll('button.task-row')].find(x=>x.dataset.moduleId===${JSON.stringify(module)}&&!x.disabled);x?.click();return !!x})()`); assert.ok(ok)
  await page.waitFor(`location.hash.includes('/${module}?taskId=')`, 20000)
}
async function waitQuestion(page, module) {
  const q = module === 'vocabulary' ? `[...document.querySelectorAll('button.choice-row,button.choice-card,[role="radio"]')].some(x=>!x.disabled)` : module === 'listening' ? `[...document.querySelectorAll('button')].some(x=>(x.innerText.trim()==='播放音频'||x.getAttribute('aria-label')==='播放音频')&&!x.disabled)` : `[...document.querySelectorAll('button')].some(x=>(x.innerText.trim()==='开始录音'||x.getAttribute('aria-label')==='开始录音')&&!x.disabled)`
  await page.waitFor(q, 20000)
}
async function submit(page, module, alreadyActive = false) {
  if (module === 'vocabulary') { await page.clickFirstEnabledChoice(); await page.waitFor(`[...document.querySelectorAll('button')].some(x=>x.innerText.trim()==='提交答案'&&!x.disabled)`,10000); await page.clickByText('提交答案'); return }
  if (module === 'speaking') { if (!alreadyActive) { await page.clickByText('开始录音'); await page.waitFor(`document.body.innerText.includes('正在录音')`,20000) }; await page.clickByText('停止录音'); await page.waitFor(`document.body.innerText.includes('录音完成')||document.body.innerText.includes('录音不可用')`,20000); return }
  if (!alreadyActive) { await page.clickByText('播放音频'); await page.waitFor(`document.body.innerText.includes('正在播放')`,10000) }; assert.equal(await page.evaluate('__finishSpeech()'),true); await page.waitFor(`document.body.innerText.includes('播放完毕')`,10000)
  await page.waitFor(`document.body.innerText.includes('播放完毕') && (document.querySelectorAll('button.choice-row,button.choice-card,.choice-list button,[role="radio"],button').length>3 || document.querySelector('input[type="text"],textarea'))`,10000)
  const choices = await page.evaluate(`(()=>{const controls=new Set(['播放音频','提交答案','下一题','完成训练','完成本题并结束']);return [...document.querySelectorAll('button.choice-row,button.choice-card,.choice-list button,[role="radio"],button')].some(x=>!x.disabled&&x.getAttribute('aria-disabled')!=='true'&&x.innerText.trim()&& !controls.has(x.innerText.trim()) && !/^(0\.75×|1×|1\.25×|不重复|重复当前片段|循环全部片段)$/u.test(x.innerText.trim()))})()`)
  if (choices) {
    const chose = await page.evaluate(`(()=>{const controls=new Set(['播放音频','提交答案','下一题','完成训练','完成本题并结束']);const x=[...document.querySelectorAll('button.choice-row,button.choice-card,.choice-list button,[role="radio"],button')].find(x=>!x.disabled&&x.getAttribute('aria-disabled')!=='true'&&x.innerText.trim()&&!controls.has(x.innerText.trim())&&!/^(0\.75×|1×|1\.25×|不重复|重复当前片段|循环全部片段)$/u.test(x.innerText.trim()));x?.click();return !!x})()`)
    assert.ok(chose, `No enabled answer choice: ${JSON.stringify(await listeningDiagnostic(page))}`)
  } else {
    const dictation = await page.evaluate(`(()=>{const x=[...document.querySelectorAll('input[type="text"]:not([hidden]),textarea')].find(x=>{const c=getComputedStyle(x);return !x.disabled&&x.getAttribute('aria-hidden')!=='true'&&c.display!=='none'&&c.visibility!=='hidden'});if(!x)return null;const s=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(x),'value').set;s.call(x,'nine thirty');x.dispatchEvent(new Event('input',{bubbles:true}));x.dispatchEvent(new Event('change',{bubbles:true}));return {value:x.value,target:document.querySelector('.keyword-dictation__target strong')?.textContent?.trim()??'',requirements:document.querySelectorAll('.keyword-dictation__requirements li').length}})()`)
    assert.ok(dictation?.value, `No visible editable dictation input: ${JSON.stringify(await listeningDiagnostic(page))}`)
    assert.ok(dictation.target.length > 0, 'R10 dictation target is missing')
  }
  try { await page.waitFor(`[...document.querySelectorAll('button')].some(x=>x.innerText.trim()==='提交答案'&&!x.disabled)`,10000) } catch (error) { throw new Error(`Listening answer did not enable submission: ${JSON.stringify(await listeningDiagnostic(page))}`, {cause:error}) }; await page.clickByText('提交答案')
  if (!choices) await page.waitFor(`document.querySelector('.keyword-dictation__review')`,10000)
}
async function completeDaily(page, module) {
  await clickDaily(page,module); await waitQuestion(page,module)
  if (module === 'listening') { await page.clickByText('播放音频'); await page.waitFor(`speechSynthesis.speaking`,10000) }
  if (module === 'speaking') { await page.clickByText('开始录音'); await page.waitFor(`document.body.innerText.includes('正在录音')`,20000) }
  // 30-second test mode supplies the real time boundary; no state is injected.
  await page.waitFor(`document.body.innerText.includes('时间已到，完成本题后结束')`, 45000)
  await submit(page,module, module !== 'vocabulary')
  await page.waitFor(`[...document.querySelectorAll('button')].some(x=>['完成训练','完成本题并结束'].includes(x.innerText.trim())&&!x.disabled)`,20000)
  await page.clickByText('完成训练','完成本题并结束'); await page.waitFor(`document.body.innerText.includes('返回今日计划')`,20000)
  // The completion screen performs a stable first-return render before the
  // second public return action actually routes to Today.
  await page.clickByText('返回今日计划'); await page.waitFor(`document.querySelector('.training-completion-screen')`,20000)
  await page.clickByText('返回今日计划'); await page.waitFor(`location.hash==='#/'`,20000)
}
async function startExtra(page) {
  // Follow the public post-3/3 route.  Some deployed shells expose the picker
  // directly, while others first expose it through the Training tab.
  const direct = await page.evaluate(`(()=>{const x=[...document.querySelectorAll('button,a')].find(x=>x.innerText.trim()==='继续训练'&&!x.disabled);x?.click();return !!x})()`)
  if (!direct) {
    await page.clickByText('查看今日计划'); await page.waitFor(`location.hash==='#/'`,20000)
    await page.clickByText('训练'); await page.waitFor(`document.querySelectorAll('[data-training-area]').length===3`,20000)
    await page.evaluate(`document.querySelector('[data-training-area="daily"]')?.click()`)
    await page.waitFor(`document.querySelectorAll('.module-card[data-availability="extra-training"]').length===3`,20000)
    await page.evaluate(`document.querySelector('.module-card[data-module-id="listening"][data-availability="extra-training"]')?.click()`)
  }
  await page.waitFor(`location.hash==='#/extra-training' || location.hash.startsWith('#/extra-training/listening?')`,20000)
  if (await page.evaluate('location.hash !== "#/extra-training"')) return new URL(await page.url()).hash.match(/sessionId=([^&]+)/)?.[1]
  const ok=await page.evaluate(`(()=>{const c=document.querySelector('.extra-training-module-card[data-module-id="listening"] button');c?.click();return !!c})()`); assert.ok(ok)
  await page.waitFor(`location.hash.startsWith('#/extra-training/listening?sessionId=')`,20000)
  return new URL(await page.url()).hash.match(/sessionId=([^&]+)/)?.[1]
}
function active(s) { const x=s?.activeItem ?? s?.stream?.activeItem; assert.ok(x?.itemId, JSON.stringify(s)); return x }
async function answerExtra(page, sessionId, previous) {
  await submitExtraListening(page,sessionId,previous.itemId)
  await page.waitFor(`[...document.querySelectorAll('button')].some(x=>x.innerText.trim()==='下一题'&&!x.disabled)`,20000)
  await page.clickByText('下一题')
  const next=await waitExtraTransition(page,sessionId,previous.itemId,previous.session?.completedItemCount??0); const item=active(next)
  try { await page.waitFor(`document.body.innerText.includes('正在获取') === false && document.body.innerText.includes('播放完毕') === false && [...document.querySelectorAll('button')].some(x=>(x.innerText.trim()==='播放音频'||x.getAttribute('aria-label')==='播放音频')&&!x.disabled)`,20000) } catch { throw new Error(JSON.stringify(await extraListeningDiagnostic(page,sessionId))) }
  return next
}
function normalize(v) { return String(v??'').toLowerCase().replace(/[\s\p{P}]+/gu,' ').trim() }
async function auditSupply() {
  const url=new URL('content/curriculum/training-supply-index.v1-V5vNoWKx.json',baseUrl).href
  const data=await fetch(url).then(r=>{assert.ok(r.ok,`supply ${r.status}`);return r.json()})
  const items=data.candidates.filter(x=>x.domain==='listening'); assert.equal(items.length,253)
  const playback=new Map; for(const x of items) playback.set(x.playbackContentId,(playback.get(x.playbackContentId)??0)+1)
  assert.equal(playback.size,167)
  return { items:items.length, playbackContentIds:playback.size, reuseDistribution:Object.fromEntries([...playback].reduce((m,[,n])=>(m.set(n,(m.get(n)??0)+1),m),new Map)), hiAudioCount:items.filter(x=>/^hi\b/i.test(x.audioText??'')).length }
}
async function verifyPreDeadlineListeningControl() {
 const qa=await launchQaChrome(); try {
  await qa.page.initialize(); await qa.page.addInitScript(fakeAssessmentClockScript); await qa.page.addInitScript(speech); await qa.page.addInitScript(noRecognition)
  await plan(qa.page); await clickDaily(qa.page,'listening'); await waitQuestion(qa.page,'listening')
  await submit(qa.page,'listening')
  return { passed:true, diagnostic:await listeningDiagnostic(qa.page) }
 } finally { await qa.close() }
}
async function run() {
 const qa=await launchQaChrome(); try {
  checkpoint('chrome-launched')
  await qa.page.initialize();await qa.page.addInitScript(fakeAssessmentClockScript);await qa.page.addInitScript(speech);await qa.page.addInitScript(noRecognition);await qa.page.setViewport(390,844)
  evidence.control=await verifyPreDeadlineListeningControl(); checkpoint('pre-deadline-listening-control-passed')
  await plan(qa.page); checkpoint('assessment-completed')
  for(const m of ['vocabulary','listening','speaking']) { checkpoint('daily-started',{module:m}); await completeDaily(qa.page,m); checkpoint('daily-completed',{module:m}) }
  const dailyListeningItemIds=completedDailyListeningItemIds(await qa.page.dumpIndexedDb()); evidence.dailyListening={completedItemIds:dailyListeningItemIds}
  await qa.page.waitFor(`document.body.innerText.includes('今日计划 3/3 已完成')`,20000)
  checkpoint('daily-3-of-3-completed'); const sessionId=await startExtra(qa.page); assert.ok(sessionId); await waitQuestion(qa.page,'listening'); const firstExtraItemId=active(extraSnapshot(await qa.page.dumpIndexedDb(),decodeURIComponent(sessionId))).itemId; assert.equal(dailyListeningItemIds.includes(firstExtraItemId),false,'Extra first item must not reuse a completed daily listening itemId.'); checkpoint('extra-listening-started',{sessionId,firstExtraItemId})
  const items=[]; let refreshChecked=false
  for(let i=0;i<30;i++) { const ds=await qa.page.dumpIndexedDb(), s=extraSnapshot(ds,decodeURIComponent(sessionId)), x=active(s); const audioText=s.question?.segments?.map(z=>z.text).join(' ')??'';assert.ok(audioText);items.push({itemId:x.itemId,playbackContentId:x.playbackContentId,family:x.variantFamilyId,type:x.source?.variantId,audioText}); if(i===10){await qa.page.reload();await waitQuestion(qa.page,'listening');assert.equal(active(extraSnapshot(await qa.page.dumpIndexedDb(),decodeURIComponent(sessionId))).itemId,x.itemId);refreshChecked=true;checkpoint('extra-refresh-recovered',{item:i+1})} await answerExtra(qa.page,decodeURIComponent(sessionId),x); if((i+1)%5===0)checkpoint('extra-listening-progress',{completed:i+1}) }
  const engine=extraState(await qa.page.dumpIndexedDb());const extra=engine.extraTraining?.sessions?.[decodeURIComponent(sessionId)];assert.ok(extra);const priorities=extra.priorityItemIds;assert.ok(priorities);const priorityOf=item=>Object.entries(priorities).find(([,ids])=>Array.isArray(ids)&&ids.includes(item.itemId))?.[0]??null;const familyViolations=items.flatMap((item,index)=>items.slice(Math.max(0,index-4),index).filter(old=>old.family===item.family).map(old=>({position:index+1,item:{...item,priority:priorityOf(item)},conflictsWith:items.indexOf(old)+1,old:{...old,priority:priorityOf(old)}}))); const typeViolations=items.slice(1).flatMap((item,index)=>item.type===items[index].type?[{position:index+2,item,previous:items[index]}]:[]); const playbackDuplicates=items.filter((item,index)=>items.findIndex(x=>x.playbackContentId===item.playbackContentId)!==index); const supply=await fetch(new URL('content/curriculum/training-supply-index.v1-V5vNoWKx.json',baseUrl)).then(r=>r.json());const playbackByItemId=new Map(supply.candidates.filter(x=>x.domain==='listening').map(x=>[x.itemId,x.playbackContentId]));const sameDaySeedItemIds=priorities['same-day-variant']??[];const sameDaySeedPlaybackContentIds=sameDaySeedItemIds.map(id=>{const playback=playbackByItemId.get(id);assert.ok(playback,`Same-day seed ${id} is not a published listening item.`);return playback});assert.equal(items.some(item=>dailyListeningItemIds.includes(item.itemId)),false,'Extra first 30 must not reuse a completed daily listening itemId.');assert.equal(items.some(item=>sameDaySeedPlaybackContentIds.includes(item.playbackContentId)),false,'Extra first 30 must not share playbackContentId with a same-day seed.'); evidence.dailyListening={completedItemIds:dailyListeningItemIds,extraFirstItemId:firstExtraItemId,sameDaySeedItemIds,sameDaySeedPlaybackContentIds}; evidence.sessions.push({sessionId:decodeURIComponent(sessionId),count:items.length,refreshChecked,priorityItemIds:priorities,items:items.map((item,index)=>({position:index+1,...item,priority:priorityOf(item)})),familyViolations,typeViolations,playbackDuplicates});
  assert.equal(new Set(items.map(x=>x.itemId)).size,30);assert.equal(new Set(items.map(x=>x.playbackContentId)).size,30)
  for(let i=1;i<items.length;i++){assert.notEqual(items[i].type,items[i-1].type);assert.equal(items.slice(Math.max(0,i-4),i).some(x=>x.family===items[i].family),false)}
  const dbs=await qa.page.dumpIndexedDb();const names=dbs.map(x=>x.name);assert.deepEqual(names,[dbName]);
  const sw=await qa.page.serviceWorkerSnapshot();assert.ok(sw.controller);const urls=sw.caches.flatMap(x=>x.urls);assert.ok(urls.some(x=>x.includes('training-supply-index.v1-V5vNoWKx.json')))
  await qa.page.setOffline(true);await qa.page.reload();await waitQuestion(qa.page,'listening');await qa.page.setOffline(false)
  const home=await fetch(baseUrl).then(r=>r.text());assert.match(home,new RegExp(`assets/${expectedAsset.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`))
  evidence.audit=await auditSupply();evidence.serviceWorker={controller:sw.controller,precacheSupply:true,offlineListeningReload:true};evidence.status='passed'
 } finally { await qa.close(); checkpoint('chrome-closed') } }
try {
  await run()
} catch (e) {
  evidence.status='failed'; evidence.error=e.stack??String(e)
  process.exitCode=1
}
console.log(`R11_E2E_RESULT ${JSON.stringify(evidence)}`)
