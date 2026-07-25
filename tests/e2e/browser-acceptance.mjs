import assert from 'node:assert/strict'
import {
  fakeAssessmentClockScript,
  fakeNeutralSpeechSynthesisScript,
  launchQaChrome,
} from './lib/cdp-browser.mjs'

const baseUrl = new URL(
  process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173/',
)
const ttsNeutralProbe =
  process.env.QA_TTS_NEUTRAL_PROBE === '1'
assert.ok(
  process.env.QA_TTS_NEUTRAL_PROBE === undefined ||
    process.env.QA_TTS_NEUTRAL_PROBE === '1',
  'QA_TTS_NEUTRAL_PROBE must be 1 when provided.',
)
const qa = await launchQaChrome()
const evidence = {
  baseUrl: baseUrl.href,
  ttsNeutralProbe,
  checkpoints: [],
}

function checkpoint(name, details = {}) {
  evidence.checkpoints.push({ name, ...details })
}

function storedListeningSession(databases, taskId) {
  const records = databases.flatMap(
    (database) => database.stores.records ?? [],
  )
  return records.find(
    (record) =>
      record.namespace === 'feature.listening' &&
      record.key === `session:${taskId}`,
  )?.value
}

function assertContinuousNeutralSpeechProbe(
  question,
  playback,
  utterances,
) {
  const expectedText = question.segments
    .map((segment) => segment.text.trim())
    .filter((text) => text.length > 0)
    .join(' ')
  assert.equal(
    utterances.length,
    1,
    'A full dialogue must create exactly one continuous utterance.',
  )
  const utterance = utterances[0]
  assert.equal(
    utterance.text,
    expectedText,
    'The continuous utterance did not preserve transcript order.',
  )
  for (const segment of question.segments) {
    if (segment.speaker) {
      assert.equal(
        utterance.text.includes(`${segment.speaker}:`),
        false,
        `The spoken text contains the speaker label ${segment.speaker}:`,
      )
    }
  }
  assert.equal(utterance.lang, 'en-US')
  assert.equal(utterance.voiceId, null)
  assert.equal(utterance.pitch, 1)
  assert.equal(utterance.rate, playback.rate)

  return {
    expectedText,
    utterance,
  }
}

try {
  await qa.page.initialize()
  await qa.page.addInitScript(fakeAssessmentClockScript)
  if (ttsNeutralProbe) {
    await qa.page.addInitScript(
      fakeNeutralSpeechSynthesisScript(),
    )
  }
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
    if (buttonLabels.includes('进入今日计划')) {
      await qa.page.clickByText('进入今日计划')
      await qa.page.waitFor(
        `location.hash === '#/' && !document.body.innerText.includes('正在恢复')`,
      )
      continue
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

  const records = databases.flatMap(
    (database) => database.stores.records ?? [],
  )
  const activePlanRecord = records.find(
    (record) => record.key === 'active-plan',
  )
  const activePlan = activePlanRecord?.value?.activePlan
  assert.ok(activePlan)
  const planId = activePlan.plan.planId
  const firstTaskId = activePlan.plan.tasks[0].taskId
  const secondTaskId = activePlan.plan.tasks[1].taskId
  const thirdTaskId = activePlan.plan.tasks[2].taskId
  assert.equal(activePlan.plan.targetSeconds, 2_700)
  assert.equal(activePlan.plan.tasks.length, 3)

  await qa.page.reload()
  await qa.page.waitFor(
    `!document.body.innerText.includes('正在恢复今日学习计划')`,
  )
  const restoredDatabases = await qa.page.dumpIndexedDb()
  assert.match(JSON.stringify(restoredDatabases), new RegExp(planId, 'u'))
  assert.match(await qa.page.bodyText(), /已完成 0 项/u)
  checkpoint('plan-refresh-recovery', {
    planId,
    text: (await qa.page.bodyText()).slice(0, 1_200),
  })

  await qa.page.clickByText('开始今日计划')
  await qa.page.waitFor(`location.hash.includes('/speaking?taskId=')`)
  await qa.page.waitFor(
    `!document.body.innerText.includes('正在加载口语训练')`,
  )
  const speakingUrl = await qa.page.url()
  const speakingHashQuery = speakingUrl.split('?')[1] ?? ''
  const routedTaskId = new URLSearchParams(speakingHashQuery).get('taskId')
  const speakingText = await qa.page.bodyText()
  const speakingInteractive = await qa.page.interactiveElements()
  assert.equal(routedTaskId, firstTaskId)
  assert.match(speakingText, /口语/u)
  checkpoint('real-speaking-task-route', {
    taskId: firstTaskId,
    url: speakingUrl,
    text: speakingText.slice(0, 1_500),
    interactive: speakingInteractive,
  })

  for (let prompt = 0; prompt < 3; prompt += 1) {
    await qa.page.clickByText('开始录音')
    await qa.page.waitFor(
      `document.body.innerText.includes('正在录音')`,
    )
    await qa.page.evaluate(
      `new Promise((resolve) => setTimeout(resolve, 500))`,
    )
    await qa.page.clickByText('停止录音')
    await qa.page.waitFor(
      `[...document.querySelectorAll('button')].some((button) =>
        ['下一题', '完成训练'].includes(button.innerText.trim()) &&
        !button.disabled
      )`,
      20_000,
    )
    await qa.page.clickByText(
      prompt === 2 ? '完成训练' : '下一题',
    )
    if (prompt < 2) {
      await qa.page.waitFor(
        `[...document.querySelectorAll('button')].some((button) =>
          (button.innerText.trim() === '开始录音' ||
            button.getAttribute('aria-label') === '开始录音') &&
          !button.disabled
        )`,
      )
    }
  }
  await qa.page.waitFor(
    `document.body.innerText.includes('口语练习已结束')`,
  )
  await qa.page.clickByText('返回今日计划')
  await qa.page.waitFor(
    `location.hash === '#/' &&
      !document.body.innerText.includes('正在恢复今日学习计划')`,
  )
  const afterSpeakingText = await qa.page.bodyText()
  const speakingAdvancedPlan = afterSpeakingText.includes('已完成 1 项')
  checkpoint('speaking-completed-and-reported', {
    advancedPlan: speakingAdvancedPlan,
    text: afterSpeakingText.slice(0, 1_200),
  })
  if (process.env.QA_SPEAKING_FALLBACK_ONLY === '1') {
    assert.equal(
      speakingAdvancedPlan,
      true,
      'A completed recording-playback speaking fallback did not advance the daily plan.',
    )
  }

  if (speakingAdvancedPlan) {
    await qa.page.clickByText('继续今日计划')
  } else {
    await qa.page.navigate(
      new URL(
        `#/listening?taskId=${encodeURIComponent(secondTaskId)}`,
        baseUrl,
      ).href,
    )
  }
  await qa.page.waitFor(`location.hash.includes('/listening?taskId=')`)
  await qa.page.waitFor(
    `!document.body.innerText.includes('正在加载听力训练')`,
  )
  checkpoint('real-listening-task-route', {
    url: await qa.page.url(),
    text: (await qa.page.bodyText()).slice(0, 1_500),
    interactive: await qa.page.interactiveElements(),
  })

  let dictationRaceExercised = false
  let dialogueNeutralUtteranceExercised = false
  for (let question = 0; question < 10; question += 1) {
    if ((await qa.page.bodyText()).includes('听力任务已完成')) {
      break
    }
    let answerSubmitted = false
    const listeningSessionBeforePlayback = ttsNeutralProbe
      ? storedListeningSession(
          await qa.page.dumpIndexedDb(),
          secondTaskId,
        )
      : null
    const speechProbeBeforePlayback = ttsNeutralProbe
      ? await qa.page.speechSynthesisSnapshot()
      : null
    await qa.page.clickByText('播放音频')
    await qa.page.waitFor(
      `document.body.innerText.includes('播放完毕') ||
        document.body.innerText.includes('播放失败')`,
      30_000,
    )
    const listeningText = await qa.page.bodyText()
    assert.doesNotMatch(listeningText, /播放失败/u)
    const activeQuestion = listeningSessionBeforePlayback?.questions[
      listeningSessionBeforePlayback.questionIndex
    ]
    if (
      ttsNeutralProbe &&
      !dialogueNeutralUtteranceExercised &&
      activeQuestion?.playbackPolicy.sequenceMode === 'all-segments'
    ) {
      const speechProbeAfterPlayback =
        await qa.page.speechSynthesisSnapshot()
      assert.ok(speechProbeBeforePlayback)
      assert.ok(speechProbeAfterPlayback)
      const utterances = speechProbeAfterPlayback.utterances.slice(
        speechProbeBeforePlayback.utterances.length,
      )
      const dialogueEvidence = assertContinuousNeutralSpeechProbe(
        activeQuestion,
        listeningSessionBeforePlayback.playback,
        utterances,
      )
      checkpoint('listening-dialogue-continuous-neutral-utterance', {
        availableVoiceCount:
          speechProbeAfterPlayback.availableVoices.length,
        ...dialogueEvidence,
      })
      dialogueNeutralUtteranceExercised = true
    }
    const listeningInteractive = await qa.page.interactiveElements()
    if (
      listeningInteractive.some(
        (element) =>
          element.className?.includes('choice-row') && !element.disabled,
      )
    ) {
      await qa.page.clickFirstEnabledChoice()
    } else {
      if (!dictationRaceExercised) {
        const focused = await qa.page.evaluate(`(() => {
          const input = document.querySelector(
            'input[type="text"], textarea'
          )
          if (!input || input.disabled) return false
          input.focus()
          input.setSelectionRange(input.value.length, input.value.length)
          return true
        })()`)
        assert.equal(focused, true)

        await Promise.all([
          qa.page.insertText('a'),
          qa.page.insertText('b'),
          qa.page.insertText('c'),
        ])
        assert.equal(
          await qa.page.evaluate(
            `document.querySelector('input[type="text"], textarea')?.value`,
          ),
          'abc',
          'Rapid DOM input was expanded or overwritten before pause.',
        )

        await qa.page.clickByText('退出听力训练')
        await qa.page.waitFor(
          `location.hash === '#/' &&
            !document.body.innerText.includes('正在恢复今日学习计划')`,
        )
        const pausedDatabases = await qa.page.dumpIndexedDb()
        const pausedSession = storedListeningSession(
          pausedDatabases,
          secondTaskId,
        )
        assert.ok(pausedSession)
        assert.equal(pausedSession.phase, 'paused')
        assert.equal(
          pausedSession.dictationInput,
          'abc',
          'Immediate exit persisted a stale dictation value.',
        )

        await qa.page.reload()
        await qa.page.waitFor(
          `!document.body.innerText.includes('正在恢复今日学习计划')`,
        )
        if (speakingAdvancedPlan) {
          await qa.page.clickByText('继续今日计划')
        } else {
          await qa.page.navigate(
            new URL(
              `#/listening?taskId=${encodeURIComponent(secondTaskId)}`,
              baseUrl,
            ).href,
          )
        }
        await qa.page.waitFor(
          `location.hash.includes('/listening?taskId=') &&
            !document.body.innerText.includes('正在加载听力训练')`,
        )
        await qa.page.waitFor(
          `[...document.querySelectorAll('button')].some((button) =>
            button.innerText.trim() === '继续训练' && !button.disabled
          )`,
        )

        await qa.page.reload()
        await qa.page.waitFor(
          `!document.body.innerText.includes('正在加载听力训练') &&
            [...document.querySelectorAll('button')].some((button) =>
              button.innerText.trim() === '继续训练' && !button.disabled
            )`,
        )
        await qa.page.clickByText('继续训练')
        await qa.page.waitFor(
          `document.querySelector('input[type="text"], textarea') &&
            !document.querySelector('input[type="text"], textarea').disabled`,
        )
        assert.equal(
          await qa.page.evaluate(
            `document.querySelector('input[type="text"], textarea')?.value`,
          ),
          'abc',
          'Paused dictation did not recover the final rapid input.',
        )

        await qa.page.evaluate(`(() => {
          const input = document.querySelector(
            'input[type="text"], textarea'
          )
          input.focus()
          input.setSelectionRange(input.value.length, input.value.length)
        })()`)
        await Promise.all([
          qa.page.insertText('d'),
          qa.page.insertText('e'),
          qa.page.insertText('f'),
        ])
        await qa.page.clickByText('提交答案')
        await qa.page.waitFor(
          `[...document.querySelectorAll('button')].some((button) =>
            ['下一题', '完成训练'].includes(button.innerText.trim()) &&
            !button.disabled
          )`,
        )
        const submittedDatabases = await qa.page.dumpIndexedDb()
        const submittedSession = storedListeningSession(
          submittedDatabases,
          secondTaskId,
        )
        assert.ok(submittedSession)
        assert.equal(submittedSession.phase, 'feedback')
        assert.equal(
          submittedSession.answers.at(-1)?.response,
          'abcdef',
          'Immediate submit used a stale dictation value.',
        )
        checkpoint('listening-dictation-race-recovery', {
          taskId: secondTaskId,
          pausedValue: pausedSession.dictationInput,
          restoredValue: 'abc',
          submittedValue:
            submittedSession.answers.at(-1)?.response,
          persistedPhase: submittedSession.phase,
        })
        dictationRaceExercised = true
        answerSubmitted = true
      } else {
        const filled = await qa.page.evaluate(`(() => {
          const input = document.querySelector(
            'input[type="text"], textarea'
          )
          if (!input) return false
          const setter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(input),
            'value',
          )?.set
          setter?.call(input, 'hello')
          input.dispatchEvent(new Event('input', { bubbles: true }))
          return true
        })()`)
        assert.equal(filled, true)
      }
    }
    if (!answerSubmitted) {
      await qa.page.waitFor(
        `[...document.querySelectorAll('button')].some((button) =>
          button.innerText.trim() === '提交答案' && !button.disabled
        )`,
      )
      await qa.page.clickByText('提交答案')
      await qa.page.waitFor(
        `[...document.querySelectorAll('button')].some((button) =>
          ['下一题', '完成训练'].includes(button.innerText.trim()) &&
          !button.disabled
        )`,
      )
    }
    const actionLabels = (await qa.page.interactiveElements())
      .filter((element) => element.tag === 'button' && !element.disabled)
      .map((element) => element.text)
    const completesTraining = actionLabels.includes('完成训练')
    await qa.page.clickByText(
      completesTraining ? '完成训练' : '下一题',
    )
    if (completesTraining) {
      await qa.page.waitFor(
        `document.body.innerText.includes('听力任务已完成')`,
      )
      break
    }
  }
  assert.equal(
    dictationRaceExercised,
    true,
    'The production listening task did not expose keyword dictation.',
  )
  if (ttsNeutralProbe) {
    assert.equal(
      dialogueNeutralUtteranceExercised,
      true,
      'The production listening task did not expose a continuous neutral full-dialogue utterance checkpoint.',
    )
  }
  await qa.page.waitFor(
    `document.body.innerText.includes('听力任务已完成')`,
  )
  await qa.page.clickByText('返回今日计划')
  await qa.page.waitFor(
    `location.hash === '#/' &&
      document.body.innerText.includes(${
        JSON.stringify(speakingAdvancedPlan ? '已完成 2 项' : '已完成 1 项')
      })`,
  )
  checkpoint('listening-completed-and-reported', {
    text: (await qa.page.bodyText()).slice(0, 1_200),
  })

  if (speakingAdvancedPlan) {
    await qa.page.clickByText('继续今日计划')
  } else {
    await qa.page.navigate(
      new URL(
        `#/vocabulary?taskId=${encodeURIComponent(thirdTaskId)}`,
        baseUrl,
      ).href,
    )
  }
  await qa.page.waitFor(`location.hash.includes('/vocabulary?taskId=')`)
  await qa.page.waitFor(
    `!document.body.innerText.includes('正在加载词汇训练')`,
  )
  checkpoint('real-vocabulary-task-route', {
    url: await qa.page.url(),
    text: (await qa.page.bodyText()).slice(0, 1_500),
    interactive: await qa.page.interactiveElements(),
  })

  for (let question = 0; question < 10; question += 1) {
    if ((await qa.page.bodyText()).includes('词汇任务已完成')) {
      break
    }
    await qa.page.clickFirstEnabledChoice()
    await qa.page.waitFor(
      `[...document.querySelectorAll('button')].some((button) =>
        button.innerText.trim() === '提交答案' && !button.disabled
      )`,
    )
    await qa.page.clickByText('提交答案')
    await qa.page.waitFor(
      `[...document.querySelectorAll('button')].some((button) =>
        ['下一题', '完成训练'].includes(button.innerText.trim()) &&
        !button.disabled
      )`,
    )
    const actionLabels = (await qa.page.interactiveElements())
      .filter((element) => element.tag === 'button' && !element.disabled)
      .map((element) => element.text)
    const completesTraining = actionLabels.includes('完成训练')
    await qa.page.clickByText(
      completesTraining ? '完成训练' : '下一题',
    )
    if (completesTraining) {
      await qa.page.waitFor(
        `document.body.innerText.includes('词汇任务已完成')`,
      )
      break
    }
  }
  await qa.page.waitFor(
    `document.body.innerText.includes('词汇任务已完成')`,
  )
  await qa.page.clickByText('返回今日计划')
  await qa.page.waitFor(
    `location.hash === '#/' &&
      document.body.innerText.includes(${
        JSON.stringify(speakingAdvancedPlan ? '已完成 3 项' : '已完成 2 项')
      })`,
  )
  await qa.page.reload()
  await qa.page.waitFor(
    `!document.body.innerText.includes('正在恢复今日学习计划')`,
  )
  const completedPlanText = await qa.page.bodyText()
  const completedPlanDatabases = await qa.page.dumpIndexedDb()
  assert.match(
    completedPlanText,
    speakingAdvancedPlan ? /已完成 3 项/u : /已完成 2 项/u,
  )
  const completedPlanRecords = completedPlanDatabases.flatMap(
    (database) => database.stores.records ?? [],
  )
  const completedActivePlan = completedPlanRecords.find(
    (record) => record.key === 'active-plan',
  )?.value?.activePlan
  const completedTaskCount = completedActivePlan?.tasks.filter(
    (execution) => execution.status === 'completed',
  ).length
  const planCompleted = completedActivePlan?.status === 'completed'
  assert.equal(completedTaskCount, speakingAdvancedPlan ? 3 : 2)
  assert.equal(planCompleted, speakingAdvancedPlan)
  checkpoint('three-modules-completed-and-refresh-restored', {
    planId,
    completedTaskCount,
    planCompleted,
    speakingAdvancedPlan,
    text: completedPlanText.slice(0, 1_500),
    databases: completedPlanDatabases,
  })

  assert.equal(
    speakingAdvancedPlan,
    true,
    'A completed recording-playback speaking fallback did not advance the daily plan.',
  )

  console.log(JSON.stringify({ status: 'passed', ...evidence }, null, 2))
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
